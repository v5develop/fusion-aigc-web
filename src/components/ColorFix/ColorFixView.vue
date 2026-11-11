<script setup lang="ts">
/**
 * 校色舞台的画面部分（ColorFixStage 内嵌舞台与 ColorFixDialog 弹窗共用）：大图（校色预览）+ 右上「校色调整」胶囊
 * + 参数台（含局部选区 / 涂抹弹窗，相对本组件定位）；`mode='compare'` 且可对比时换成「校色对比」滑杆，
 * 图上两枚下载胶囊。铺满父容器：父级给尺寸（高度类）。
 *
 * <p>`compare-pills`：在图上放「校色对比 / 退出对比」切换胶囊（弹窗用）；内嵌舞台用下方分段按钮切换，不传。
 *
 * <p>右上另有「全屏调色」胶囊（`fullscreen=false` 关掉）：打开 ColorFixFullscreen（同一份 cf），插槽
 * `fullscreen-actions` 放到全屏顶栏（如弹窗的「下载校色图」「生成校色节点」）。
 */
import { computed, ref, watch } from 'vue'
import { corsAttr, markCorsBlocked } from '@/utils/colorfix.ts'
import ColorFixCompare from './ColorFixCompare.vue'
import ColorFixPill from './ColorFixPill.vue'
import ColorFixResultPanel from './ColorFixResultPanel.vue'
import ColorFixFullscreen from './ColorFixFullscreen.vue'
import type { ResultColorFix } from './useResultColorFix.ts'
import type { ColorFixViewMode } from './types.ts'

const {
  cf,
  labels = ['原图', '校色后'],
  alt = '校色预览',
  comparePills = false,
  fullscreen = true,
  fullscreenTitle = '图片校色',
} = defineProps<{
  cf: ResultColorFix
  /** 对比两侧的名字（下载胶囊写「下载{label}」） */
  labels?: [string, string]
  alt?: string
  comparePills?: boolean
  /** 提供「全屏调色」入口 */
  fullscreen?: boolean
  /** 全屏层标题 */
  fullscreenTitle?: string
}>()

defineSlots<{
  /** 全屏调色顶栏右侧的宿主动作 */
  'fullscreen-actions'?: () => unknown
}>()

const mode = defineModel<'result' | 'compare'>('mode', { default: 'result' })
const emit = defineEmits<{ downloadBefore: []; downloadAfter: [] }>()

const canCompare = computed(() => cf.compareAvailable.value)
const showCompare = computed(() => mode.value === 'compare' && canCompare.value)
watch(canCompare, (ok) => {
  if (!ok) mode.value = 'result'
})

/** 全屏的查看方式：进入时沿用舞台的（结果 / 对比），退出时对比档带回舞台 */
const fsMode = ref<ColorFixViewMode>('result')
watch(
  () => cf.fullscreen.value,
  (on) => {
    if (on) fsMode.value = mode.value === 'compare' ? 'compare' : 'result'
    else if (canCompare.value) mode.value = fsMode.value === 'compare' ? 'compare' : 'result'
  },
)

/** 胶囊开合参数台（aria-pressed 跟着走）；收起时调过的参数照常落存储 */
function togglePanel() {
  if (cf.panelOpen.value) cf.close()
  else cf.open()
}

function openFullscreen() {
  cf.openFullscreen()
}

function onImgError() {
  markCorsBlocked(cf.displaySrc.value)
}
</script>

<template>
  <div class="absolute inset-0 [border-radius:inherit]">
    <ColorFixCompare
      v-if="showCompare"
      :before="cf.src.value"
      :after="cf.displaySrc.value"
      :after-filter="cf.liveFilter.value"
      :labels="labels"
      @download-before="emit('downloadBefore')"
      @download-after="emit('downloadAfter')"
    >
      <template #actions>
        <ColorFixPill v-if="comparePills" :icon="false" variant="muted" label="退出对比" @click="mode = 'result'" />
        <ColorFixPill
          v-if="fullscreen && cf.src.value"
          :icon="false"
          variant="muted"
          label="全屏调色"
          title="全屏调色：大图对比、缩放查看细节，参数台停靠右侧"
          @click="openFullscreen"
        >
          <svg class="w-12px h-12px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
          全屏调色
        </ColorFixPill>
        <ColorFixPill :pressed="cf.panelOpen.value" @click="togglePanel" />
      </template>
    </ColorFixCompare>
    <template v-else>
      <div class="absolute inset-0 grid place-items-center p-12px">
        <img
          v-if="cf.src.value"
          :src="cf.displaySrc.value"
          :style="cf.previewStyle.value"
          :crossorigin="corsAttr(cf.displaySrc.value)"
          :alt="alt"
          draggable="false"
          class="block max-w-full max-h-full object-contain select-none"
          @error="onImgError"
        />
      </div>
      <span class="absolute top-10px right-10px z-6 flex items-center gap-8px">
        <ColorFixPill
          v-if="comparePills && canCompare"
          :icon="false"
          variant="muted"
          label="校色对比"
          @click="mode = 'compare'"
        />
        <ColorFixPill
          v-if="fullscreen && cf.src.value"
          :icon="false"
          variant="muted"
          label="全屏调色"
          title="全屏调色：大图对比、缩放查看细节，参数台停靠右侧"
          @click="openFullscreen"
        >
          <svg class="w-12px h-12px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
          全屏调色
        </ColorFixPill>
        <ColorFixPill :pressed="cf.panelOpen.value" @click="togglePanel" />
      </span>
    </template>
    <ColorFixResultPanel :cf="cf" />
    <ColorFixFullscreen
      v-if="fullscreen"
      v-model:mode="fsMode"
      :cf="cf"
      :title="fullscreenTitle"
      :labels="labels"
    >
      <template v-if="$slots['fullscreen-actions']" #actions>
        <slot name="fullscreen-actions" />
      </template>
    </ColorFixFullscreen>
  </div>
</template>
