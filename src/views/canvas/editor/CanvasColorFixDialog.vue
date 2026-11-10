<script setup lang="ts">
/**
 * 画布结果图校色弹窗：共用 components/ColorFix 的 ColorFixDialog（舞台 + 参数台 + 局部选区 + 对比 + 下载校色图），
 * 节点有多张图（模型候选）时顶部切换；主操作「生成校色节点」= 烘出 PNG → canvasUploadMedia → 在来源节点右侧新建
 * 结果图节点并连过去（不改原节点，原图仍可再校色 / 回退）。
 */
import { computed, ref, watch } from 'vue'
import { bakeForUpload, ColorFixDialog, type ResultColorFix } from '@/components/ColorFix'
import { canvasUploadMedia } from '@/api/canvas-home.ts'
import { addResultNodes, type IImageSource } from './image-actions.ts'
import { activeColorFix, closeColorFix, colorFixKey, colorFixSources } from './color-fix-action.ts'
import { editorMessage, useCanvasEditor } from './useCanvasEditor.ts'
import { FOCUS_RING } from './ui.ts'

const store = useCanvasEditor()

const node = computed(() => (activeColorFix.value ? store.findNode(activeColorFix.value.nodeId) : undefined))
const sources = computed(() => (activeColorFix.value ? colorFixSources(activeColorFix.value.nodeId) : []))
const pickedUrl = ref('')

/** 默认：指定的图 → 模型节点当前输出 → 第一张 */
watch(
  () => activeColorFix.value,
  (value) => {
    if (!value) return
    const list = sources.value
    const wanted = value.url || node.value?.data.image || ''
    pickedUrl.value = list.find((s) => s.url === wanted)?.url ?? list[0]?.url ?? ''
  },
  { immediate: true },
)

// 免费档水印：校色来源 = 节点自身的图地址（collectImageSources 取节点 data.image / 候选 / 产物），与节点上
// 「下载」/ 引用同一个地址，画布结果由后端按观看者档位下发；不取上游、不另换原件
const source = computed<IImageSource | undefined>(
  () => sources.value.find((s) => s.url === pickedUrl.value) ?? sources.value[0],
)
const show = computed({
  get: () => !!activeColorFix.value && !!node.value && !!source.value,
  set: (v) => {
    if (!v) closeColorFix()
  },
})
const title = computed(() => node.value?.data.title || '图片')
const colorKey = computed(() => (node.value && source.value ? colorFixKey(node.value.id, source.value.url) : ''))
const sourceIndex = computed(() => sources.value.findIndex((s) => s.url === source.value?.url))

// 节点被删 / 图没了：关掉
watch(show, (value) => {
  if (!value && activeColorFix.value) closeColorFix()
})

/**
 * 结果节点从哪个口连出：模型节点多候选时连对应的 candidate-N（那一口固定指这张图）；其余用节点主输出口
 */
function wireSource(item: IImageSource): IImageSource {
  const owner = store.findNode(item.nodeId)
  const candidates = owner?.type === 'model' ? (owner.data.candidates ?? []) : []
  const index = candidates.indexOf(item.url)
  return candidates.length > 1 && index >= 0 ? { ...item, sourceHandle: `candidate-${index + 1}` } : item
}

const creating = ref(false)

async function createNode(cf: ResultColorFix, bakeFile: (name?: string, maxSide?: number) => Promise<File | null>) {
  const item = source.value
  if (!item || creating.value) return
  if (!cf.active.value) {
    editorMessage.info('还没有校色，先调整参数')
    return
  }
  creating.value = true
  try {
    // 上传口径：长边 3072，超 9.5MB 降到 2048
    const file = await bakeForUpload((side) => bakeFile(`${title.value}-校色`, side))
    if (!file) return
    const url = await canvasUploadMedia(file)
    const created = addResultNodes(wireSource(item), [url], 'colorfix', `${title.value} · 校色`)
    if (!created.length) {
      editorMessage.warning('来源节点已不存在，未能新建节点')
      return
    }
    editorMessage.success('已新建校色结果节点')
    closeColorFix()
  } catch (err) {
    editorMessage.error(err instanceof Error && err.message ? err.message : '校色图上传失败，请重试')
  } finally {
    creating.value = false
  }
}

const CHIP = `relative inline-flex items-center gap-6px h-32px pl-4px pr-10px rounded-8px border border-solid text-12px cursor-pointer bg-white ${FOCUS_RING}`
</script>

<template>
  <ColorFixDialog
    v-model:show="show"
    :src="source?.url || ''"
    :color-key="colorKey"
    :title="sources.length > 1 ? `图片校色 · ${title} · 第 ${sourceIndex + 1} 张` : `图片校色 · ${title}`"
    :file-name="`${title}-校色`"
  >
    <template v-if="sources.length > 1" #sources>
      <div class="flex flex-wrap items-center gap-8px" role="radiogroup" aria-label="选择要校色的图">
        <button
          v-for="(item, i) in sources"
          :key="item.key"
          type="button"
          role="radio"
          :aria-checked="item.url === source?.url"
          :disabled="creating"
          :class="[
            CHIP,
            item.url === source?.url
              ? 'border-violet-line bg-violet-soft text-violet-ink font-600'
              : 'border-line text-ink-2 hover:border-control-hover',
          ]"
          @click="pickedUrl = item.url"
        >
          <img :src="item.url" alt="" class="w-24px h-24px rounded-5px object-cover" />
          第 {{ i + 1 }} 张
        </button>
      </div>
    </template>
    <template #actions="{ cf, bakeFile }">
      <button
        type="button"
        class="sx-btn-primary"
        :disabled="creating || !cf.active.value"
        :title="cf.active.value ? undefined : '先调整校色参数'"
        :aria-busy="creating"
        @click="createNode(cf, bakeFile)"
      >
        {{ creating ? '生成中…' : '生成校色节点' }}
      </button>
    </template>
  </ColorFixDialog>
</template>
