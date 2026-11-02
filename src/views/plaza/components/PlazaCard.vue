<script setup lang="ts">
/**
 * 广场卡片（样式同资产库 AssetCard）：封面 + 标题 + 描述 + 标签。
 * 不可点击跳转；previewSrc 有值时封面用 n-image 自带的大图预览。
 */
import { ref, watch } from 'vue'
import { NImage } from 'naive-ui'

const props = defineProps<{
  cover?: string
  /** 有值时点封面看大图（n-image 预览）；空则只展示 */
  previewSrc?: string
  title?: string | null
  desc?: string
  tags?: string[]
  /** 封面左上角徽标 */
  badge?: string
  isVideo?: boolean
}>()

// 封面裂图降级为占位；换数据（同一实例复用）时重置
const failed = ref(false)
watch(
  () => props.cover,
  () => (failed.value = false),
)
</script>

<template>
  <article
    class="flex flex-col min-w-0 bg-white border border-solid border-line rounded-12px overflow-hidden transition-[border-color,box-shadow] duration-200 hover:shadow-[0_4px_12px_0_rgba(31,35,41,0.1)]"
    :aria-label="title || undefined"
  >
    <div class="relative aspect-[4/5] bg-surface2">
      <n-image
        v-if="cover && previewSrc && !failed"
        :src="cover"
        :preview-src="previewSrc"
        :alt="title || ''"
        object-fit="cover"
        lazy
        class="block w-full h-full cursor-zoom-in [&_img]:(block w-full h-full)"
        @error="failed = true"
      />
      <img
        v-else-if="cover && !failed"
        class="block w-full h-full object-cover"
        :src="cover"
        alt=""
        loading="lazy"
        @error="failed = true"
      />
      <div v-else class="flex items-center justify-center w-full h-full text-12px text-muted">
        {{ cover ? '图片加载失败' : '暂无预览' }}
      </div>

      <span
        v-if="badge"
        class="absolute top-8px left-8px max-w-[60%] px-6px py-2px rounded-4px bg-[rgba(31,35,41,0.72)] text-white text-11px leading-[1.4] whitespace-nowrap overflow-hidden text-ellipsis pointer-events-none"
        >{{ badge }}</span
      >
      <span
        v-if="isVideo"
        class="absolute left-8px bottom-8px px-6px py-2px rounded-4px bg-[rgba(31,35,41,0.6)] text-white text-11px leading-[1.4] pointer-events-none"
        >视频</span
      >
    </div>

    <div class="flex flex-col gap-6px px-10px pt-8px pb-10px">
      <div class="text-13px font-500 text-ink whitespace-nowrap overflow-hidden text-ellipsis" :title="title || ''">
        {{ title || '未命名' }}
      </div>
      <div v-if="desc" class="text-12px leading-[1.5] text-muted line-clamp-2" :title="desc">{{ desc }}</div>
      <div v-if="tags?.length" class="flex flex-wrap items-center gap-6px text-11px text-muted">
        <span
          v-for="t in tags.slice(0, 3)"
          :key="t"
          class="px-5px py-1px rounded-4px border border-solid border-line text-10px whitespace-nowrap"
          >{{ t }}</span
        >
        <span v-if="tags.length > 3" class="text-placeholder">+{{ tags.length - 3 }}</span>
      </div>
    </div>
  </article>
</template>
