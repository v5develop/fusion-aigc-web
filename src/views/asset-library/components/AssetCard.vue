<script setup lang="ts">
/**
 * 资产媒体卡：封面（image 直显 / video 用 video_url + image 封面）、标题、标签小徽标、
 * 收藏星标（父级 PATCH 即点即存）、悬浮多选框；点卡片开详情。
 */
import { computed, ref } from 'vue'
import { NCheckbox } from 'naive-ui'
import MediaFallback from '@/components/MediaFallback/index.vue'
import type { IAssetLibAsset } from '@/api/assetLibrary.ts'

const props = defineProps<{
  asset: IAssetLibAsset
  checked: boolean
  /** 分类中文名（封面左上角徽标） */
  kindLabel: string
}>()

const emit = defineEmits<{
  'toggle-select': [id: number]
  'toggle-favorite': [asset: IAssetLibAsset]
  open: [asset: IAssetLibAsset]
  'filter-tag': [name: string]
}>()

const isVideo = computed(() => props.asset.media === 'video' && !!props.asset.video_url)

// 封面加载失败降级：video 播不了先退回封面图，图也裂了才上占位
const videoFailed = ref(false)
const imageFailed = ref(false)

const SOURCE_LABELS: Record<string, string> = { official: '官方', upload: '上传', generated: 'AI 生成' }
const sourceLabel = computed(() => SOURCE_LABELS[props.asset.source] ?? '')
const dateText = computed(() => {
  const ms = props.asset.created_at
  if (!ms) return ''
  const d = new Date(ms)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
})
const FOCUS = 'focus-visible:(outline outline-2 outline-violet outline-offset-2)'
</script>

<template>
  <div
    role="button"
    tabindex="0"
    class="group flex flex-col min-w-0 bg-white border border-solid rounded-12px overflow-hidden cursor-pointer transition-[border-color,box-shadow] duration-200 hover:shadow-[0_4px_12px_0_rgba(31,35,41,0.1)] focus-visible:(outline outline-2 outline-violet outline-offset-2)"
    :class="checked ? 'border-violet shadow-[0_0_0_2px_rgba(135,95,154,0.18)]' : 'border-line'"
    :aria-label="asset.title || '未命名资产'"
    @click="emit('open', asset)"
    @keydown.enter.self.prevent="emit('open', asset)"
    @keydown.space.self.prevent="emit('open', asset)"
  >
    <div class="relative h-120px bg-surface2">
      <video
        v-if="isVideo && !videoFailed"
        :src="asset.video_url"
        :poster="asset.image || undefined"
        class="block w-full h-full object-contain"
        muted
        preload="metadata"
        @error="videoFailed = true"
      />
      <img
        v-else-if="asset.image && !imageFailed"
        class="block w-full h-full object-contain"
        :src="asset.image"
        alt=""
        loading="lazy"
        @error="imageFailed = true"
      />
      <MediaFallback v-else type="image" reason="loadFailed" />

      <span
        class="absolute top-8px left-8px max-w-[60%] px-6px py-2px rounded-4px bg-[rgba(31,35,41,0.72)] text-white text-11px leading-[1.4] whitespace-nowrap overflow-hidden text-ellipsis"
        >{{ kindLabel }}</span
      >

      <span
        v-if="asset.media === 'video'"
        class="absolute left-8px bottom-8px px-6px py-2px rounded-4px bg-[rgba(31,35,41,0.6)] text-white text-11px leading-[1.4]"
        >视频</span
      >

      <div
        class="absolute top-36px left-8px leading-none transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
        :class="checked ? 'opacity-100' : 'opacity-0'"
        @click.stop
      >
        <n-checkbox
          :checked="checked"
          size="small"
          :aria-label="`选择 ${asset.title || '未命名资产'}`"
          @update:checked="emit('toggle-select', asset.id)"
        />
      </div>

      <button
        type="button"
        class="absolute top-6px right-8px p-0 border-none bg-transparent cursor-pointer text-18px leading-[1.2]"
        :class="[
          asset.favorite
            ? 'text-violet [text-shadow:0_1px_2px_rgba(255,255,255,0.6)]'
            : 'text-placeholder opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
          FOCUS,
        ]"
        :aria-label="asset.favorite ? '取消收藏' : '收藏'"
        :aria-pressed="asset.favorite"
        :title="asset.favorite ? '取消收藏' : '收藏'"
        @click.stop="emit('toggle-favorite', asset)"
      >
        {{ asset.favorite ? '★' : '☆' }}
      </button>
    </div>

    <div class="flex flex-col gap-6px min-h-90px px-10px pt-8px pb-10px">
      <div class="text-13px font-500 text-ink whitespace-nowrap overflow-hidden text-ellipsis" :title="asset.title">
        {{ asset.title || '未命名资产' }}
      </div>
      <div v-if="asset.prompt" class="text-12px leading-[1.5] text-muted line-clamp-2" :title="asset.prompt">
        {{ asset.prompt }}
      </div>
      <small class="text-11px text-placeholder">{{ dateText }}</small>
      <div class="flex flex-wrap items-center gap-6px mt-auto text-11px text-muted">
        <template v-if="asset.tags.length">
          <button
            v-for="t in asset.tags.slice(0, 3)"
            :key="t"
            type="button"
            class="max-w-full px-0 py-0 border-none bg-transparent text-11px text-muted whitespace-nowrap overflow-hidden text-ellipsis cursor-pointer hover:text-violet-ink focus-visible:(outline outline-2 outline-violet outline-offset-2)"
            :title="`按标签「${t}」筛选`"
            @click.stop="emit('filter-tag', t)"
          >
            {{ t }}
          </button>
          <span v-if="asset.tags.length > 3" class="text-placeholder">+{{ asset.tags.length - 3 }}</span>
        </template>
        <span v-else>未分类</span>
        <span
          v-if="sourceLabel"
          class="px-5px py-1px rounded-4px border border-solid border-line text-10px text-muted"
          >{{ sourceLabel }}</span
        >
      </div>
    </div>
  </div>
</template>
