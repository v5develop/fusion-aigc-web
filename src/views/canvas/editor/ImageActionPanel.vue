<script setup lang="ts">
/**
 * 图片动作面板外壳：节点「…」菜单打开，贴画布右侧浮出（sx-pop 浮层投影、r8）。
 * 头部 = 动作名 + 节点名 + 关闭；动作切换页签；图片来源（节点自身的图与直接上游的图）；下面是各动作面板。
 * 动作进行中锁住来源与页签切换（切走会中止轮询）；Esc 关闭。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import EditorIcon from './EditorIcon.vue'
import IdentifyPanel from './IdentifyPanel.vue'
import EditPanel from './EditPanel.vue'
import MultiviewPanel from './MultiviewPanel.vue'
import LayerPanel from './LayerPanel.vue'
import { useCanvasEditor } from './useCanvasEditor.ts'
import type { ImageActionKind } from './imageActions.ts'
import { IMAGE_ACTIONS, actionLabel, activeImageAction, closeImageAction, collectImageSources } from './imageActions.ts'
import { ACTION_LABEL, ACTION_RING } from './actionUi.ts'
import { POP_FADE } from './ui.ts'

const store = useCanvasEditor()
const rootRef = ref<HTMLElement | null>(null)
const busy = ref(false)

const action = computed(() => activeImageAction.value)
const node = computed(() => (action.value ? store.findNode(action.value.nodeId) : undefined))
const sources = computed(() => (action.value ? collectImageSources(action.value.nodeId) : []))

const sourceKey = ref('')
const source = computed(() => sources.value.find((item) => item.key === sourceKey.value) ?? sources.value[0])

// 换节点时回到第一张来源图；节点被删就关掉面板
watch(
  () => action.value?.nodeId,
  () => {
    sourceKey.value = sources.value[0]?.key ?? ''
    busy.value = false
  },
  { immediate: true },
)
watch(node, (value) => {
  if (action.value && !value) closeImageAction()
})

function switchKind(kind: ImageActionKind) {
  if (!action.value || busy.value) return
  activeImageAction.value = { kind, nodeId: action.value.nodeId }
}

function close() {
  closeImageAction()
}

onMounted(() => {
  void nextTick(() => rootRef.value?.focus())
})

// 离开编辑器时一并关掉，避免下次进来面板自己弹出
onBeforeUnmount(() => {
  if (activeImageAction.value && !store.findNode(activeImageAction.value.nodeId)) closeImageAction()
})

const TAB = 'sx-seg-item sx-focus flex-1 !h-32px !text-12px gap-4px'
</script>

<template>
  <aside
    v-if="action && node"
    ref="rootRef"
    class="absolute top-12px right-12px z-16 flex flex-col w-380px max-w-[calc(100%-24px)] max-h-[calc(100%-24px)] overflow-hidden sx-pop !rounded-8px text-ink-2 outline-none"
    :class="POP_FADE"
    role="dialog"
    :aria-label="`${actionLabel(action.kind)}：${node.data.title || '图片'}`"
    tabindex="-1"
    data-canvas-popover
    @pointerdown.stop
    @dblclick.stop
    @wheel.stop
    @keydown.esc="close"
  >
    <header class="flex shrink-0 items-center gap-8px h-44px px-12px border-b border-b-solid border-line-soft">
      <strong class="text-ink text-14px font-600">{{ actionLabel(action.kind) }}</strong>
      <span class="flex-1 min-w-0 overflow-hidden text-muted text-12px whitespace-nowrap text-ellipsis">{{
        node.data.title || '图片'
      }}</span>
      <button
        type="button"
        class="relative grid shrink-0 w-28px h-28px p-0 after:content-empty after:absolute after:-inset-3px place-items-center border border-solid border-transparent rounded-4px bg-transparent text-muted cursor-pointer hover:border-line hover:bg-surface2 hover:text-ink"
        :class="ACTION_RING"
        :aria-label="busy ? '关闭面板（会停止等待，已提交的任务不会撤回）' : '关闭面板'"
        title="关闭"
        @click="close"
      >
        <EditorIcon name="close" :size="14" />
      </button>
    </header>

    <div class="sx-seg flex shrink-0 mx-12px mt-10px" role="tablist" aria-label="图片动作">
      <button
        v-for="item in IMAGE_ACTIONS"
        :key="item.kind"
        type="button"
        role="tab"
        :class="[TAB, { 'sx-seg-on': action.kind === item.kind }]"
        :aria-selected="action.kind === item.kind"
        :disabled="busy && action.kind !== item.kind"
        :title="busy && action.kind !== item.kind ? '当前动作进行中，完成或停止后再切换' : undefined"
        @click="switchKind(item.kind)"
      >
        <EditorIcon :name="item.icon" :size="13" />{{ item.label }}
      </button>
    </div>

    <template v-if="source">
      <fieldset class="shrink-0 m-0 mx-12px mt-10px mb-10px p-0 border-none">
        <legend :class="ACTION_LABEL">图片来源</legend>
        <div class="flex gap-6px overflow-x-auto pb-2px">
          <label
            v-for="item in sources"
            :key="item.key"
            class="relative shrink-0 block w-52px h-52px overflow-hidden rounded-8px border border-solid cursor-pointer focus-within:shadow-focus focus-within:!border-violet"
            :class="[
              item.key === source.key ? 'border-violet border-2' : 'border-line hover:border-violet-line',
              busy && item.key !== source.key ? 'opacity-40 cursor-not-allowed' : '',
            ]"
            :title="item.label"
          >
            <input
              v-model="sourceKey"
              type="radio"
              name="image-action-source"
              class="absolute w-1px h-1px m-0 opacity-0"
              :value="item.key"
              :disabled="busy && item.key !== source.key"
              :aria-label="item.label"
            />
            <img :src="item.url" alt="" class="block w-full h-full object-cover" />
            <span
              v-if="item.upstream"
              class="absolute left-0 right-0 bottom-0 bg-black/50 text-white text-10px leading-14px text-center"
              aria-hidden="true"
              >上游</span
            >
          </label>
        </div>
      </fieldset>

      <IdentifyPanel
        v-if="action.kind === 'identify'"
        :key="`identify:${source.key}`"
        :source="source"
        @switch="switchKind"
      />
      <EditPanel
        v-else-if="action.kind === 'edit'"
        :key="`edit:${source.key}`"
        :source="source"
        :sources="sources"
        @busy="busy = $event"
      />
      <MultiviewPanel
        v-else-if="action.kind === 'multiview'"
        :key="`multiview:${source.key}`"
        :source="source"
        @busy="busy = $event"
      />
      <LayerPanel v-else :key="`layer:${source.key}`" :source="source" @busy="busy = $event" />
    </template>
    <p v-else class="m-0 px-16px py-24px text-muted text-13px text-center">
      这个节点和它的上游都还没有图片，先上传或生成一张
    </p>
  </aside>
</template>
