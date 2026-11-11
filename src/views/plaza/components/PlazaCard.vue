<script setup lang="ts">
/**
 * 素材广场竖卡：材质与模板横卡一致（原型 5185 TemplateCard：r18 squircle、1px #c9cdd0、白→#f8f9fa 渐变、
 * 悬停藤紫细线），封面 4:3、悬停放大 1.03。
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
    :class="[
      'group sx-squircle flex flex-col min-w-0 overflow-hidden rounded-18px border border-solid border-soft-line bg-[linear-gradient(var(--xq-surface),var(--xq-soft-bottom))]',
      'shadow-[0_6px_16px_rgba(31,35,41,0.08),inset_0_1px_0_#fff,inset_0_-3px_6px_rgba(31,35,41,0.04)]',
      '[transition:border-color_0.12s_ease,box-shadow_0.12s_ease] motion-reduce:transition-none',
      'hover:(border-violet-line shadow-[0_6px_18px_rgba(31,35,41,0.08),0_1px_2px_rgba(31,35,41,0.05)])',
    ]"
    :aria-label="title || undefined"
  >
    <div class="relative aspect-[4/3] overflow-hidden bg-surface3">
      <n-image
        v-if="cover && previewSrc && !failed"
        :src="cover"
        :preview-src="previewSrc"
        :alt="title || ''"
        object-fit="cover"
        lazy
        class="block w-full h-full cursor-zoom-in [&_img]:(block w-full h-full) [transition:transform_0.4s_ease] group-hover:scale-103 motion-reduce:transition-none"
        @error="failed = true"
      />
      <img
        v-else-if="cover && !failed"
        class="block w-full h-full object-cover [transition:transform_0.4s_ease] group-hover:scale-103 motion-reduce:transition-none"
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

    <div class="flex flex-col gap-4px px-12px pt-10px pb-12px">
      <div
        class="text-14px font-600 leading-20px text-ink whitespace-nowrap overflow-hidden text-ellipsis"
        :title="title || ''"
      >
        {{ title || '未命名' }}
      </div>
      <div v-if="desc" class="text-12px leading-18px text-muted line-clamp-2" :title="desc">{{ desc }}</div>
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
