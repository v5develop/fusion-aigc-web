<script setup lang="ts">
/**
 * 校色前 / 校色后滑动对比（复用 tools/ToolImageCompare），右下角「下载校色前 / 下载校色后」两枚胶囊，右上角插槽
 * `actions` 放「校色调整」胶囊等。组件铺满父容器：父级给定位与高度（如 relative h-[min(62vh,640px)]）。
 *
 * <p>after 传 useResultColorFix 的 displaySrc、after-filter 传 liveFilter（整图校色烘好前的即时预览）。
 */
import ToolImageCompare from '@/views/tools/ToolImageCompare.vue'
import ColorFixPill from './ColorFixPill.vue'

const {
  before,
  after,
  afterFilter,
  labels = ['校色前', '校色后'],
  downloads = true,
} = defineProps<{
  /** 原图 */
  before: string
  /** 校色后（烘好的图或原图 + afterFilter） */
  after: string
  afterFilter?: string
  labels?: [string, string]
  /** 显示两枚下载胶囊 */
  downloads?: boolean
}>()

defineEmits<{ downloadBefore: []; downloadAfter: [] }>()
</script>

<template>
  <div class="absolute inset-0 [border-radius:inherit]">
    <ToolImageCompare
      :before="before"
      :after="after || before"
      :after-filter="afterFilter"
      :labels="labels"
      :aria-label="`${labels[0]}与${labels[1]}对比`"
      cors
    />
    <span v-if="downloads" class="absolute right-10px bottom-10px z-6 flex items-center gap-8px">
      <ColorFixPill :icon="false" variant="muted" :label="`下载${labels[0]}`" @click="$emit('downloadBefore')" />
      <ColorFixPill :icon="false" :label="`下载${labels[1]}`" @click="$emit('downloadAfter')" />
    </span>
    <span v-if="$slots.actions" class="absolute top-10px right-10px z-6 flex items-center gap-8px">
      <slot name="actions" />
    </span>
  </div>
</template>
