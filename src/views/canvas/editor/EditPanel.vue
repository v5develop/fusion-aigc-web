<script setup lang="ts">
/**
 * 图片编辑：选图（主图 + 可选的其它来源图，最多 9 张）→ 在图上点选 / 框选区域（每个区域先识别拿 region id）
 * → 提示词里插入区域标签 → POST /agent/canvas/image-edict（异步计费，带幂等键）
 * → 按 /api/v1/tasks/{taskUid} 轮询 → 成品写回为结果图节点，从来源节点连出。
 * 请求字段：imageUrls、prompt（标签序列化为 {{region_xxx}}）、regions[{id,imageIndex,bbox,label,description}]、resolution、aspectRatio。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { canvasImageEdit, type ICanvasImageEditReq } from '@/api/agent.ts'
import { toApiError } from '@/api/index.ts'
import RegionStage from './RegionStage.vue'
import RegionList from './RegionList.vue'
import RegionPromptEditor from './RegionPromptEditor.vue'
import ActionStatus from './ActionStatus.vue'
import { useActionRun } from './useActionRun.ts'
import type { IActionRegion, IImageSource, RatioPoint } from './image-actions.ts'
import {
  addRegion,
  addResultNodes,
  POLL_BROKEN,
  describeError,
  identifiableUrl,
  isAbort,
  pollCompatTask,
  regionBbox,
  regionsOf,
} from './image-actions.ts'
import { ACTION_FIELD, ACTION_LABEL, ACTION_RING, ACTION_SUBMIT } from './action-ui.ts'

const props = defineProps<{ source: IImageSource; sources: IImageSource[] }>()
const emit = defineEmits<{ busy: [value: boolean] }>()

const MAX_IMAGES = 9
const RESOLUTIONS = ['1k', '2k', '4k']
const RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', '9:21', '1:3', '3:1']

// ---------------- 图片 ----------------

const extras = ref<string[]>([])
const others = computed(() => props.sources.filter((item) => item.url !== props.source.url))
const images = computed(() => [props.source.url, ...extras.value].slice(0, MAX_IMAGES))

function toggleExtra(url: string, checked: boolean) {
  if (checked) {
    if (images.value.length < MAX_IMAGES && !extras.value.includes(url)) extras.value = [...extras.value, url]
  } else {
    extras.value = extras.value.filter((item) => item !== url)
  }
}

const previewUrl = ref(props.source.url)
watch(images, (list) => {
  if (!list.includes(previewUrl.value)) previewUrl.value = props.source.url
})

// ---------------- 区域 ----------------

const mode = ref<'point' | 'box'>('box')
const activeKey = ref('')
const allRegions = computed(() => images.value.flatMap((url) => regionsOf(url)))
const previewRegions = computed(() => regionsOf(previewUrl.value))
const numberOf = (region: IActionRegion) => allRegions.value.indexOf(region) + 1

function onDraw(shape: 'point' | 'box', points: RatioPoint[]) {
  addRegion(previewUrl.value, shape, points)
}

// ---------------- 提示词与参数 ----------------

const editorRef = ref<InstanceType<typeof RegionPromptEditor> | null>(null)
const promptLength = ref(0)
const formError = ref('')

function onPromptChange() {
  promptLength.value = editorRef.value?.serialize().text.length ?? 0
  formError.value = ''
}

const resolution = ref('1k')
const aspectRatio = ref('1:1')

/** 画幅默认取最接近主图的比例 */
onMounted(() => {
  const img = new Image()
  img.onload = () => {
    if (!img.naturalWidth || !img.naturalHeight) return
    const target = Math.log(img.naturalWidth / img.naturalHeight)
    let best = '1:1'
    let gap = Infinity
    for (const item of RATIOS) {
      const [w, h] = item.split(':').map(Number) as [number, number]
      const diff = Math.abs(Math.log(w / h) - target)
      if (diff < gap) {
        gap = diff
        best = item
      }
    }
    aspectRatio.value = best
  }
  img.src = props.source.url
})

// ---------------- 提交与轮询 ----------------

const run = useActionRun()
const taskId = ref('')
/** 最近一次失败发生在轮询（任务号已拿到）：重试 = 接着轮询，不重新提交 */
const failedWhilePolling = ref(false)
const resultUrl = ref('')

watch(run.busy, (value) => emit('busy', value), { immediate: true })

function buildRequest(): ICanvasImageEditReq | null {
  const serialized = editorRef.value?.serialize()
  const text = serialized?.text ?? ''
  if (!text.trim()) {
    formError.value = '请先写编辑要求'
    return null
  }
  if (text.length > 4096) {
    formError.value = '编辑要求最多 4096 个字'
    return null
  }
  if (allRegions.value.some((region) => region.status === 'pending')) {
    formError.value = '还有区域在识别，稍等再提交'
    return null
  }
  const list = images.value
  const regions = (serialized?.regions ?? [])
    .filter((region) => region.id && list.includes(region.url))
    .map((region) => ({
      id: region.id as string,
      imageIndex: list.indexOf(region.url),
      bbox: regionBbox(region),
      label: region.label.trim(),
      description: region.description,
    }))
  return {
    imageUrls: list,
    prompt: text,
    ...(regions.length ? { regions } : {}),
    resolution: resolution.value,
    aspectRatio: aspectRatio.value,
  }
}

async function submit() {
  if (run.busy.value) return
  const req = buildRequest()
  if (!req) return
  run.error.value = ''
  resultUrl.value = ''
  failedWhilePolling.value = false
  run.phase.value = 'submitting'
  try {
    const res = await canvasImageEdit(req, run.idempotencyKey())
    run.releaseKey()
    if (!res.data?.taskId) throw new Error('提交成功但没有拿到任务号')
    taskId.value = res.data.taskId
  } catch (err) {
    const info = describeError(err, '提交失败，请重试')
    if (!info.unknown) run.releaseKey()
    run.fail(info.message)
    return
  }
  await poll()
}

async function poll() {
  run.phase.value = 'polling'
  failedWhilePolling.value = false
  run.startClock()
  try {
    const view = await pollCompatTask(taskId.value, { signal: run.signal() })
    const url = view.result?.url as string
    addResultNodes(props.source, [url], 'edit', '编辑结果')
    resultUrl.value = url
    run.stopClock()
    run.phase.value = 'done'
  } catch (err) {
    if (isAbort(err)) {
      run.stopClock()
      run.phase.value = 'stopped'
      return
    }
    // 查询接口连续失败 = 网络问题，任务本身可能还在跑：重试接着查
    failedWhilePolling.value = Boolean(toApiError(err))
    run.fail(failedWhilePolling.value ? POLL_BROKEN : describeError(err, '编辑失败').message)
  }
}

function retry() {
  if (failedWhilePolling.value && taskId.value) void poll()
  else void submit()
}

const canSubmit = computed(() => !run.busy.value && promptLength.value > 0)
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0">
    <div class="flex-1 min-h-0 overflow-y-auto px-12px pb-12px">
      <!-- 参与编辑的图片：主图固定，其它来源图可勾选 -->
      <fieldset v-if="others.length" class="m-0 mb-12px p-0 border-none">
        <legend :class="ACTION_LABEL">参与编辑的图片（{{ images.length }}/{{ MAX_IMAGES }}）</legend>
        <div class="flex flex-wrap gap-6px">
          <label
            v-for="item in others"
            :key="item.key"
            class="relative block w-52px h-52px overflow-hidden rounded-8px border border-solid cursor-pointer focus-within:shadow-focus focus-within:!border-violet"
            :class="extras.includes(item.url) ? 'border-violet' : 'border-line opacity-70 hover:opacity-100'"
            :title="item.label"
          >
            <input
              type="checkbox"
              class="absolute top-3px left-3px m-0 accent-[var(--xq-violet)]"
              :checked="extras.includes(item.url)"
              :disabled="!extras.includes(item.url) && images.length >= MAX_IMAGES"
              :aria-label="`同时使用 ${item.label}`"
              @change="toggleExtra(item.url, ($event.target as HTMLInputElement).checked)"
            />
            <img :src="item.url" alt="" class="block w-full h-full object-cover" />
          </label>
        </div>
      </fieldset>

      <div class="flex items-center gap-8px mb-10px">
        <div class="sx-seg" role="radiogroup" aria-label="选取方式">
          <button
            v-for="item in [
              { key: 'box', label: '框选' },
              { key: 'point', label: '点选' },
            ] as const"
            :key="item.key"
            type="button"
            role="radio"
            class="sx-seg-item sx-focus !px-14px !text-12px"
            :class="{ 'sx-seg-on': mode === item.key }"
            :aria-checked="mode === item.key"
            @click="mode = item.key"
          >
            {{ item.label }}
          </button>
        </div>
        <select
          v-if="images.length > 1"
          v-model="previewUrl"
          :class="ACTION_FIELD"
          class="flex-1 min-w-0 !h-36px"
          aria-label="在哪张图上选区域"
        >
          <option v-for="(url, index) in images" :key="url" :value="url">
            在第 {{ index + 1 }} 张{{ index === 0 ? '（主图）' : '' }}上选区域
          </option>
        </select>
      </div>

      <p
        v-if="!identifiableUrl(previewUrl)"
        class="m-0 mb-10px px-10px py-8px rounded-8px bg-warning-soft text-warning text-12px"
      >
        这张图不是 jpg、png、webp，不能选区域，可以直接写编辑要求
      </p>
      <RegionStage
        :url="previewUrl"
        :regions="previewRegions"
        :mode="mode"
        :active-key="activeKey"
        :disabled="run.busy.value || !identifiableUrl(previewUrl)"
        :number-of="numberOf"
        @draw="onDraw"
        @hover="activeKey = $event"
      />

      <template v-if="allRegions.length">
        <h4 class="m-0 mt-14px mb-8px text-ink text-13px font-600">区域</h4>
        <RegionList
          :regions="allRegions"
          :active-key="activeKey"
          :number-of="numberOf"
          editable
          @hover="activeKey = $event"
          @insert="editorRef?.insertRegion($event)"
        />
      </template>

      <div class="flex items-center justify-between mt-14px mb-6px">
        <span class="text-ink-2 text-12px font-600">编辑要求</span>
        <span class="text-muted text-11px" :class="{ '!text-danger': promptLength > 4096 }"
          >{{ promptLength }}/4096</span
        >
      </div>
      <RegionPromptEditor
        ref="editorRef"
        :regions="allRegions"
        :number-of="numberOf"
        :disabled="run.busy.value"
        @change="onPromptChange"
      />
      <p v-if="formError" class="m-0 mt-6px text-danger text-12px" role="alert">{{ formError }}</p>

      <div class="grid grid-cols-2 gap-10px mt-14px">
        <label class="block">
          <span :class="ACTION_LABEL">分辨率</span>
          <select v-model="resolution" :class="ACTION_FIELD" class="w-full" :disabled="run.busy.value">
            <option v-for="item in RESOLUTIONS" :key="item" :value="item">{{ item.toUpperCase() }}</option>
          </select>
        </label>
        <label class="block">
          <span :class="ACTION_LABEL">画幅</span>
          <select v-model="aspectRatio" :class="ACTION_FIELD" class="w-full" :disabled="run.busy.value">
            <option v-for="item in RATIOS" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
      </div>

      <div v-if="resultUrl" class="mt-14px">
        <span :class="ACTION_LABEL">结果</span>
        <img
          :src="resultUrl"
          alt="编辑结果"
          class="block max-w-full max-h-200px rounded-8px border border-solid border-line"
        />
      </div>
    </div>

    <footer class="shrink-0 flex flex-col gap-8px px-12px py-10px border-t border-t-solid border-line-soft">
      <ActionStatus
        :phase="run.phase.value"
        :error="run.error.value"
        :elapsed="run.elapsed.value"
        running-text="正在编辑图片"
        done-text="已生成，结果已添加到画布并连好线"
        @retry="retry"
        @stop="run.abort()"
        @resume="poll"
      />
      <span class="text-muted text-12px">提交即扣点数，按分辨率计价</span>
      <button type="button" :class="[ACTION_SUBMIT, ACTION_RING]" :disabled="!canSubmit" @click="submit">
        {{ run.phase.value === 'done' ? '再编辑一次' : '开始编辑' }}
      </button>
    </footer>
  </div>
</template>
