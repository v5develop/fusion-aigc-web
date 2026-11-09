<script setup lang="ts">
/**
 * 校色舞台的画面部分（ColorFixStage 内嵌舞台与 ColorFixDialog 弹窗共用）：大图（校色预览）+ 右上「校色调整」胶囊
 * + 参数台（含局部选区 / 涂抹弹窗，相对本组件定位）；`mode='compare'` 且可对比时换成「校色对比」滑杆，
 * 图上两枚下载胶囊。铺满父容器：父级给尺寸（高度类）。
 *
 * <p>`compare-pills`：在图上放「校色对比 / 退出对比」切换胶囊（弹窗用）；内嵌舞台用下方分段按钮切换，不传。
 */
import { computed, watch } from 'vue'
import { corsAttr, markCorsBlocked } from '@/utils/colorfix.ts'
import ColorFixCompare from './ColorFixCompare.vue'
import ColorFixPill from './ColorFixPill.vue'
import ColorFixResultPanel from './ColorFixResultPanel.vue'
import type { ResultColorFix } from './useResultColorFix.ts'

const {
  cf,
  labels = ['原图', '校色后'],
  alt = '校色预览',
  comparePills = false,
} = defineProps<{
  cf: ResultColorFix
  /** 对比两侧的名字（下载胶囊写「下载{label}」） */
  labels?: [string, string]
  alt?: string
  comparePills?: boolean
}>()

const mode = defineModel<'result' | 'compare'>('mode', { default: 'result' })
const emit = defineEmits<{ downloadBefore: []; downloadAfter: [] }>()

const canCompare = computed(() => cf.compareAvailable.value)
const showCompare = computed(() => mode.value === 'compare' && canCompare.value)
watch(canCompare, (ok) => {
  if (!ok) mode.value = 'result'
})

/** 胶囊开合参数台（aria-pressed 跟着走）；收起时调过的参数照常落存储 */
function togglePanel() {
  if (cf.panelOpen.value) cf.close()
  else cf.open()
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
        <ColorFixPill :pressed="cf.panelOpen.value" @click="togglePanel" />
      </span>
    </template>
    <ColorFixResultPanel :cf="cf" />
  </div>
</template>
