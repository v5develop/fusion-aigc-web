<script setup lang="ts">
/**
 * 多视图：调镜头（原型 styles/scoped/CanvasMultiviewCube.css：.canvas-cube 200 高、r8、页面底色、细描边、touch-action:none，
 * 拖拽转动预览方块）→ POST /agent/canvas/multiview {imageUrl, num, scale, rotation, skew}（异步，按张数计费）
 * → 返回 taskIds 数组，逐个按 /api/v1/tasks/{taskUid} 轮询，每完成一张就写回一个结果图节点。
 * 取值域：num 1–9、scale 0.1–2.0、rotation -90–90、skew -30–60。
 */
import { computed, ref, watch } from 'vue'
import { canvasMultiview } from '@/api/agent.ts'
import { toApiError } from '@/api/index.ts'
import ActionStatus from './ActionStatus.vue'
import { useActionRun } from './useActionRun.ts'
import type { IImageSource } from './imageActions.ts'
import { addResultNodes, POLL_BROKEN, describeError, isAbort, pollCompatTask } from './imageActions.ts'
import { ACTION_BTN, ACTION_FIELD, ACTION_LABEL, ACTION_RING, ACTION_SUBMIT, SPINNER } from './actionUi.ts'

const props = defineProps<{ source: IImageSource }>()
const emit = defineEmits<{ busy: [value: boolean] }>()

const num = ref(4)
const scale = ref(1)
const rotation = ref(0)
const skew = ref(0)

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const round1 = (value: number) => Math.round(value * 10) / 10

function setScale(value: number) {
  scale.value = round1(clamp(value, 0.1, 2))
}
function setRotation(value: number) {
  rotation.value = Math.round(clamp(value, -90, 90))
}
function setSkew(value: number) {
  skew.value = Math.round(clamp(value, -30, 60))
}
function reset() {
  scale.value = 1
  rotation.value = 0
  skew.value = 0
}

// ---------------- 预览方块：拖拽 = 转动 / 俯仰，滚轮 = 缩放，键盘方向键 / 加减号 ----------------

let drag: { x: number; y: number; rotation: number; skew: number } | null = null

function onCubeDown(event: PointerEvent) {
  if (run.busy.value) return
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  drag = { x: event.clientX, y: event.clientY, rotation: rotation.value, skew: skew.value }
}
function onCubeMove(event: PointerEvent) {
  if (!drag) return
  setRotation(drag.rotation + (event.clientX - drag.x) * 0.5)
  setSkew(drag.skew - (event.clientY - drag.y) * 0.3)
}
function onCubeWheel(event: WheelEvent) {
  if (run.busy.value) return
  event.preventDefault()
  setScale(scale.value + (event.deltaY < 0 ? 0.1 : -0.1))
}
function onCubeKey(event: KeyboardEvent) {
  if (run.busy.value) return
  const step = event.shiftKey ? 15 : 5
  const actions: Record<string, () => void> = {
    ArrowLeft: () => setRotation(rotation.value - step),
    ArrowRight: () => setRotation(rotation.value + step),
    ArrowUp: () => setSkew(skew.value + step),
    ArrowDown: () => setSkew(skew.value - step),
    '+': () => setScale(scale.value + 0.1),
    '=': () => setScale(scale.value + 0.1),
    '-': () => setScale(scale.value - 0.1),
  }
  const action = actions[event.key]
  if (action) {
    event.preventDefault()
    action()
  }
}

const cubeTransform = computed(
  () =>
    `rotateX(${-skew.value}deg) rotateY(${rotation.value}deg) scale3d(${scale.value}, ${scale.value}, ${scale.value})`,
)
const FACES = [
  { key: 'front', transform: 'translateZ(48px)', image: true },
  { key: 'back', transform: 'rotateY(180deg) translateZ(48px)', image: false },
  { key: 'right', transform: 'rotateY(90deg) translateZ(48px)', image: false },
  { key: 'left', transform: 'rotateY(-90deg) translateZ(48px)', image: false },
  { key: 'top', transform: 'rotateX(90deg) translateZ(48px)', image: false },
  { key: 'bottom', transform: 'rotateX(-90deg) translateZ(48px)', image: false },
]

const sliders = computed(() => [
  { key: 'rotation', label: '旋转', unit: '°', min: -90, max: 90, step: 1, value: rotation.value, set: setRotation },
  { key: 'skew', label: '俯仰', unit: '°', min: -30, max: 60, step: 1, value: skew.value, set: setSkew },
  { key: 'scale', label: '缩放', unit: '×', min: 0.1, max: 2, step: 0.1, value: scale.value, set: setScale },
])

// ---------------- 提交与逐张轮询 ----------------

interface IViewItem {
  taskId: string
  status: 'polling' | 'done' | 'error'
  url?: string
  error?: string
}

const run = useActionRun()
const items = ref<IViewItem[]>([])
watch(run.busy, (value) => emit('busy', value), { immediate: true })

const doneCount = computed(() => items.value.filter((item) => item.status === 'done').length)
const failedItems = computed(() => items.value.filter((item) => item.status === 'error'))
/** 查询失败（网络）而非任务失败的：重试只需接着查 */
const pollBroken = ref(new Set<string>())

async function submit(count = num.value) {
  if (run.busy.value) return
  run.error.value = ''
  run.phase.value = 'submitting'
  let taskIds: string[]
  try {
    const res = await canvasMultiview(
      { imageUrl: props.source.url, num: count, scale: scale.value, rotation: rotation.value, skew: skew.value },
      run.idempotencyKey(),
    )
    run.releaseKey()
    taskIds = res.data?.taskIds ?? []
    if (!taskIds.length) throw new Error('提交成功但没有拿到任务号')
  } catch (err) {
    const info = describeError(err, '提交失败，请重试')
    if (!info.unknown) run.releaseKey()
    run.fail(info.message)
    return
  }
  // 重试失败张：去掉旧的失败项，新任务接在后面
  items.value = [
    ...items.value.filter((item) => item.status !== 'error'),
    ...taskIds.map((taskId) => ({ taskId, status: 'polling' as const })),
  ]
  await pollAll()
}

async function pollAll() {
  const pending = items.value.filter((item) => item.status === 'polling')
  if (!pending.length) return
  run.phase.value = 'polling'
  run.startClock()
  const signal = run.signal()
  let index = items.value.filter((item) => item.status === 'done').length
  await Promise.all(
    pending.map(async (item) => {
      try {
        const view = await pollCompatTask(item.taskId, { signal })
        item.url = view.result?.url ?? ''
        item.status = 'done'
        index += 1
        addResultNodes(props.source, [item.url], 'multiview', `多视图 ${index}`)
        pollBroken.value.delete(item.taskId)
      } catch (err) {
        if (isAbort(err)) return
        item.status = 'error'
        const broken = Boolean(toApiError(err))
        item.error = broken ? POLL_BROKEN : describeError(err, '生成失败').message
        if (broken) pollBroken.value.add(item.taskId)
      }
    }),
  )
  run.stopClock()
  if (signal.aborted) {
    run.phase.value = 'stopped'
    return
  }
  const failed = failedItems.value.length
  if (failed) run.fail(doneCount.value ? `${failed} 张没有生成成功` : (failedItems.value[0]?.error ?? '生成失败'))
  else run.phase.value = 'done'
}

/** 重试：查询断了的接着查；任务失败的按失败张数重新提交（会再次扣点） */
function retry() {
  const broken = failedItems.value.filter((item) => pollBroken.value.has(item.taskId))
  if (broken.length) {
    broken.forEach((item) => {
      item.status = 'polling'
      item.error = undefined
    })
    void pollAll()
    return
  }
  if (run.phase.value === 'error' && !items.value.length) {
    void submit()
    return
  }
  void submit(failedItems.value.length || num.value)
}

const retryText = computed(() => {
  if (failedItems.value.some((item) => pollBroken.value.has(item.taskId))) return '继续查询'
  return failedItems.value.length ? `重新生成失败的 ${failedItems.value.length} 张（会再次扣点）` : '重试'
})
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0">
    <div class="flex-1 min-h-0 overflow-y-auto px-12px pb-12px">
      <div class="flex items-center justify-between mb-6px">
        <span class="text-ink-2 text-12px font-600">镜头预览</span>
        <button
          type="button"
          :class="ACTION_BTN"
          class="!h-28px !px-8px !text-12px"
          :disabled="run.busy.value"
          @click="reset"
        >
          复位
        </button>
      </div>
      <!-- 原型 .canvas-cube -->
      <div
        class="relative w-full h-200px overflow-hidden rounded-8px border border-solid border-line bg-page touch-none grid place-items-center [perspective:600px] select-none"
        :class="[ACTION_RING, run.busy.value ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing']"
        tabindex="0"
        role="application"
        :aria-label="`镜头预览：旋转 ${rotation} 度，俯仰 ${skew} 度，缩放 ${scale} 倍。左右方向键旋转，上下方向键俯仰，加减号缩放`"
        @pointerdown="onCubeDown"
        @pointermove="onCubeMove"
        @pointerup="drag = null"
        @pointercancel="drag = null"
        @wheel="onCubeWheel"
        @keydown="onCubeKey"
      >
        <div
          class="relative w-96px h-96px [transform-style:preserve-3d] transition-transform duration-80 motion-reduce:transition-none"
          :style="{ transform: cubeTransform }"
        >
          <div
            v-for="face in FACES"
            :key="face.key"
            class="absolute inset-0 overflow-hidden border border-solid border-violet-line [backface-visibility:hidden]"
            :class="face.image ? 'bg-white' : 'bg-violet-soft'"
            :style="{ transform: face.transform }"
          >
            <img
              v-if="face.image"
              :src="source.url"
              alt=""
              draggable="false"
              class="block w-full h-full object-cover"
            />
          </div>
        </div>
        <span class="absolute left-8px bottom-6px text-muted text-11px pointer-events-none">拖动转动 · 滚轮缩放</span>
      </div>

      <div class="flex flex-col gap-10px mt-12px">
        <div v-for="slider in sliders" :key="slider.key">
          <label :for="`mv-${slider.key}`" :class="ACTION_LABEL">{{ slider.label }}</label>
          <div class="flex items-center gap-10px">
            <input
              :id="`mv-${slider.key}`"
              type="range"
              class="flex-1 min-w-0 accent-[#875f9a] cursor-pointer"
              :min="slider.min"
              :max="slider.max"
              :step="slider.step"
              :value="slider.value"
              :disabled="run.busy.value"
              @input="slider.set(Number(($event.target as HTMLInputElement).value))"
            />
            <input
              type="number"
              :class="ACTION_FIELD"
              class="w-84px"
              :min="slider.min"
              :max="slider.max"
              :step="slider.step"
              :value="slider.value"
              :disabled="run.busy.value"
              :aria-label="`${slider.label}（${slider.min} 到 ${slider.max}${slider.unit}）`"
              @change="slider.set(Number(($event.target as HTMLInputElement).value))"
            />
          </div>
        </div>

        <div>
          <span id="mv-num" :class="ACTION_LABEL">生成张数</span>
          <div class="flex items-center gap-6px" role="group" aria-labelledby="mv-num">
            <button
              type="button"
              :class="ACTION_BTN"
              class="!w-44px !h-44px !px-0 !text-16px"
              :disabled="run.busy.value || num <= 1"
              aria-label="少一张"
              @click="num -= 1"
            >
              −
            </button>
            <output class="grid w-56px h-44px place-items-center text-ink text-15px font-600" aria-live="polite">{{
              num
            }}</output>
            <button
              type="button"
              :class="ACTION_BTN"
              class="!w-44px !h-44px !px-0 !text-16px"
              :disabled="run.busy.value || num >= 9"
              aria-label="多一张"
              @click="num += 1"
            >
              +
            </button>
            <span class="ml-4px text-muted text-12px">最多 9 张，每张一个视角</span>
          </div>
        </div>
      </div>

      <div v-if="items.length" class="mt-14px">
        <span :class="ACTION_LABEL">结果（{{ doneCount }}/{{ items.length }}）</span>
        <ul class="grid grid-cols-4 gap-6px m-0 p-0 list-none">
          <li
            v-for="(item, index) in items"
            :key="item.taskId"
            class="relative grid aspect-square place-items-center overflow-hidden rounded-8px border border-solid"
            :class="item.status === 'error' ? 'border-[#e4b7b4] bg-[#fbeeed]' : 'border-line bg-page'"
            :title="item.error"
          >
            <img
              v-if="item.status === 'done' && item.url"
              :src="item.url"
              :alt="`多视图第 ${index + 1} 张`"
              class="block w-full h-full object-cover"
            />
            <span
              v-else-if="item.status === 'polling'"
              :class="SPINNER"
              role="img"
              :aria-label="`第 ${index + 1} 张生成中`"
            />
            <span v-else class="px-4px text-danger text-11px text-center">失败</span>
          </li>
        </ul>
      </div>
    </div>

    <footer class="shrink-0 flex flex-col gap-8px px-12px py-10px border-t border-t-solid border-line-soft">
      <ActionStatus
        :phase="run.phase.value"
        :error="run.error.value"
        :elapsed="run.elapsed.value"
        :running-text="`正在生成多视图（${doneCount}/${items.length}）`"
        :done-text="`${doneCount} 张已添加到画布并连好线`"
        :retry-text="retryText"
        @retry="retry"
        @stop="run.abort()"
        @resume="pollAll"
      />
      <span class="text-muted text-12px">按张数扣点，本次 {{ num }} 张</span>
      <button type="button" :class="[ACTION_SUBMIT, ACTION_RING]" :disabled="run.busy.value" @click="submit()">
        生成 {{ num }} 张多视图
      </button>
    </footer>
  </div>
</template>
