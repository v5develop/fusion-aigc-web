<script setup lang="ts">
/**
 * 图层：POST /agent/canvas/image-layer {imageUrl}（异步计费，带幂等键）→ pollCanvasImageLayer 轮询
 * GET /agent/canvas/image-layer/{taskId}（PENDING / SUCCEED / FAILED，可停止等待）→ content 里的图层图片
 * 逐张写回为结果图节点。图层列表样式取原型 styles/scoped/CanvasLayerPanel.css（.canvas-layers 行 r8、32px 缩略图、
 * 选中行主色 12% 浅底）与 ImageLayerPanel.css（选中行主色描边）。
 */
import { computed, ref, watch } from 'vue'
import { canvasImageLayer, pollCanvasImageLayer } from '@/api/agent.ts'
import { toApiError } from '@/api/index.ts'
import ActionStatus from './ActionStatus.vue'
import { useActionRun } from './useActionRun.ts'
import type { IImageSource, ILayerItem } from './image-actions.ts'
import { addResultNodes, POLL_BROKEN, describeError, extractLayers, isAbort } from './image-actions.ts'
import { ACTION_LABEL, ACTION_RING, ACTION_SUBMIT } from './action-ui.ts'

const props = defineProps<{ source: IImageSource }>()
const emit = defineEmits<{ busy: [value: boolean] }>()

const run = useActionRun()
const taskId = ref('')
const failedWhilePolling = ref(false)
const layers = ref<ILayerItem[]>([])
const activeIndex = ref(0)

watch(run.busy, (value) => emit('busy', value), { immediate: true })

const preview = computed(() => layers.value[activeIndex.value]?.url ?? props.source.url)

async function submit() {
  if (run.busy.value) return
  run.error.value = ''
  layers.value = []
  activeIndex.value = 0
  failedWhilePolling.value = false
  run.phase.value = 'submitting'
  try {
    const res = await canvasImageLayer(props.source.url, run.idempotencyKey())
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
    const result = await pollCanvasImageLayer(taskId.value, { signal: run.signal() })
    if (result.status !== 'SUCCEED') throw new Error('图层拆分失败，可以重试')
    const list = extractLayers(result.content, props.source.url)
    if (!list.length) throw new Error('拆分完成，但没有读到图层图片')
    layers.value = list
    list.forEach((layer, index) => {
      addResultNodes(props.source, [layer.url], 'layer', layer.name || `图层 ${index + 1}`)
    })
    run.stopClock()
    run.phase.value = 'done'
  } catch (err) {
    if (isAbort(err)) {
      run.stopClock()
      run.phase.value = 'stopped'
      return
    }
    failedWhilePolling.value = Boolean(toApiError(err))
    run.fail(failedWhilePolling.value ? POLL_BROKEN : describeError(err, '图层拆分失败').message)
  }
}

function retry() {
  if (failedWhilePolling.value && taskId.value) void poll()
  else void submit()
}

function onRowKey(event: KeyboardEvent, index: number) {
  const next = event.key === 'ArrowDown' ? index + 1 : event.key === 'ArrowUp' ? index - 1 : -1
  if (next < 0 || next >= layers.value.length) return
  event.preventDefault()
  activeIndex.value = next
  const rows = (event.currentTarget as HTMLElement).parentElement?.children
  ;(rows?.[next] as HTMLElement | undefined)?.focus()
}
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0">
    <div class="flex-1 min-h-0 overflow-y-auto px-12px pb-12px">
      <p class="m-0 mb-10px text-muted text-12px leading-18px">把图片拆成可以单独使用的图层，每层生成一个图片节点</p>
      <div
        class="grid place-items-center h-220px p-8px rounded-8px border border-solid border-line [background:repeating-conic-gradient(#e9ecef_0%,#e9ecef_25%,transparent_0%,transparent_50%)_0_0/16px_16px,#f3f4f5]"
      >
        <img :src="preview" alt="" class="block max-w-full max-h-full object-contain" />
      </div>

      <!-- 原型 .canvas-layers -->
      <div
        v-if="layers.length"
        class="mt-12px p-4px rounded-8px border border-solid border-line bg-white shadow-[0_6px_20px_rgba(31,35,41,0.10)]"
      >
        <span :class="ACTION_LABEL" class="!mb-4px px-4px pt-4px">图层（{{ layers.length }}）</span>
        <ul
          class="flex flex-col gap-2px max-h-260px overflow-y-auto m-0 p-0 list-none"
          role="listbox"
          aria-label="图层"
        >
          <li
            v-for="(layer, index) in layers"
            :key="layer.url"
            class="relative flex items-center gap-8px px-8px py-6px rounded-8px border border-solid cursor-pointer"
            :class="[
              ACTION_RING,
              activeIndex === index ? 'border-violet bg-[rgba(135,95,154,0.12)]' : 'border-transparent hover:bg-page',
            ]"
            role="option"
            :aria-selected="activeIndex === index"
            :tabindex="activeIndex === index ? 0 : -1"
            @click="activeIndex = index"
            @keydown="onRowKey($event, index)"
          >
            <span
              class="flex shrink-0 items-center justify-center w-32px h-32px overflow-hidden rounded-8px border border-solid border-line bg-page"
            >
              <img :src="layer.url" alt="" class="block max-w-full max-h-full object-contain" />
            </span>
            <span class="flex-1 min-w-0 overflow-hidden text-ink-2 text-13px whitespace-nowrap text-ellipsis">{{
              layer.name
            }}</span>
          </li>
        </ul>
      </div>
    </div>

    <footer class="shrink-0 flex flex-col gap-8px px-12px py-10px border-t border-t-solid border-line-soft">
      <ActionStatus
        :phase="run.phase.value"
        :error="run.error.value"
        :elapsed="run.elapsed.value"
        running-text="正在拆分图层"
        :done-text="`${layers.length} 个图层已添加到画布并连好线`"
        :retry-text="failedWhilePolling ? '继续查询' : '重试'"
        @retry="retry"
        @stop="run.abort()"
        @resume="poll"
      />
      <span class="text-muted text-12px">提交即扣点数，每次拆分计一次</span>
      <button type="button" :class="[ACTION_SUBMIT, ACTION_RING]" :disabled="run.busy.value" @click="submit">
        {{ run.phase.value === 'done' ? '重新拆分' : '开始拆分图层' }}
      </button>
    </footer>
  </div>
</template>
