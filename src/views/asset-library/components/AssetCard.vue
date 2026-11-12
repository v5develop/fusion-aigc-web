<script setup lang="ts">
/**
 * 资产卡（原型 5185 relay-card：8 列密排、浮起卡 r8）。
 * 封面按原图比例（夹在 1:2 ~ 9:5）；左上多选框、右上收藏、右下下载、左下分类 / 视频徽标；
 * 下方标题、日期 · 来源、首个标签（点击按标签筛选）+ 标签按钮（唤起单卡打标签浮层）。
 * selecting = 多选态：点卡片切换勾选，不开详情。
 */
import { computed, ref } from 'vue'
import { NCheckbox } from 'naive-ui'
import IconButton from '@/components/IconButton/index.vue'
import type { IAssetLibAsset } from '@/api/asset-library.ts'
import { downloadName } from '../ui.ts'
import { ossResize, thumbFallback } from '@/utils/oss'

const props = defineProps<{
  asset: IAssetLibAsset
  checked: boolean
  /** 多选态：点卡片 = 勾选 */
  selecting: boolean
  /** 分类中文名（空 = 不显示徽标） */
  kindLabel: string
}>()

const emit = defineEmits<{
  'toggle-select': [id: number]
  'toggle-favorite': [asset: IAssetLibAsset]
  open: [asset: IAssetLibAsset]
  'filter-tag': [name: string]
  /** 标签按钮：唤起单卡快捷打标签浮层，anchor 为按钮本身（定位 + 关闭后还焦点） */
  'edit-tags': [asset: IAssetLibAsset, anchor: HTMLElement]
}>()

const isVideoAsset = computed(() => props.asset.media === 'video')
const isVideo = computed(() => isVideoAsset.value && !!props.asset.videoUrl)

// 封面加载失败降级：video 播不了先退回封面图，图也裂了才上占位
const videoFailed = ref(false)
const imageFailed = ref(false)
// 重试只给一次机会：通过 key 让 img 重新创建并再请求同一地址，不改 URL（签名链接加参数会失效）
const retried = ref(false)
const retryStamp = ref(0)
function retryImage() {
  retried.value = true
  retryStamp.value = Date.now()
  imageFailed.value = false
}
// 缩略图解码完再淡入（原型 is-loaded）
const loaded = ref(false)

const SOURCE_LABELS: Record<string, string> = { official: '官方', upload: '上传', generated: 'AI 生成' }
const sourceLabel = computed(() => SOURCE_LABELS[props.asset.source] ?? '')
const dateText = computed(() => {
  const ms = props.asset.createdAt
  if (!ms) return ''
  const d = new Date(ms)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
})
/**
 * 封面统一 4:3 画框（对齐原型 5185 资产卡 .relay-thumb）：原图完整 contain 在中性底上，不裁切；
 * 每张卡等高，网格一行齐平。原来按原图比例撑高，横竖图混排时一行高高低低。
 */
const COVER_RATIO = '4 / 3'
const downloadHref = computed(() => (isVideoAsset.value ? props.asset.videoUrl : props.asset.image) || '')
const title = computed(() => props.asset.title || '未命名资产')

function onCard() {
  if (props.selecting) emit('toggle-select', props.asset.id)
  else emit('open', props.asset)
}
</script>

<template>
  <div
    role="button"
    tabindex="0"
    data-asset-card
    class="group relative flex flex-col min-w-0 overflow-hidden sx-card-raised cursor-pointer sx-focus"
    :class="checked && '!border-violet shadow-[0_0_0_1px_#875f9a]'"
    :aria-label="selecting ? `${checked ? '取消选择' : '选择'} ${title}` : title"
    :aria-pressed="selecting ? checked : undefined"
    @click="onCard"
    @keydown.enter.self.prevent="onCard"
    @keydown.space.self.prevent="onCard"
  >
    <div class="relative overflow-hidden bg-surface3" :style="{ aspectRatio: COVER_RATIO }">
      <video
        v-if="isVideo && !videoFailed"
        :src="asset.videoUrl"
        :poster="asset.image ? ossResize(asset.image, 240) : undefined"
        class="block w-full h-full object-contain"
        muted
        :preload="asset.image ? 'none' : 'metadata'"
        @error="videoFailed = true"
      />
      <img
        v-else-if="asset.image && !imageFailed"
        :key="retryStamp"
        class="block w-full h-full object-contain transition-[opacity,transform] duration-240 ease-sx group-hover:scale-102 motion-reduce:transition-none"
        :class="loaded ? 'opacity-100' : 'opacity-0'"
        :src="ossResize(asset.image, 240)"
        alt=""
        loading="lazy"
        decoding="async"
        @load="loaded = true"
        @error="(e: Event) => thumbFallback(e, asset.image) || (imageFailed = true)"
      />
      <div v-else class="flex flex-col items-center justify-center gap-6px w-full h-full text-muted">
        <span v-if="isVideoAsset" class="text-24px leading-none text-placeholder" aria-hidden="true">▶</span>
        <template v-if="asset.image">
          <span class="text-12px">图片加载失败</span>
          <button
            v-if="!retried"
            type="button"
            class="h-28px px-10px rounded-14px border border-solid border-line bg-white text-12px text-muted cursor-pointer hover:text-violet-ink sx-focus"
            @click.stop="retryImage"
          >
            重试
          </button>
        </template>
        <span v-else-if="!isVideoAsset" class="text-12px">暂无预览</span>
      </div>

      <span
        v-if="isVideo && !videoFailed"
        class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 grid place-items-center w-30px h-30px rounded-full bg-[rgba(31,35,41,0.45)] text-white text-11px pointer-events-none"
        aria-hidden="true"
        >▶</span
      >

      <div class="absolute left-6px bottom-6px flex gap-4px max-w-[calc(100%-48px)] pointer-events-none">
        <span
          v-if="kindLabel"
          class="px-5px py-1px rounded-4px bg-[rgba(31,35,41,0.66)] text-white text-11px leading-[1.4] whitespace-nowrap overflow-hidden text-ellipsis"
          >{{ kindLabel }}</span
        >
        <span
          v-if="isVideoAsset"
          class="shrink-0 px-5px py-1px rounded-4px bg-[rgba(31,35,41,0.6)] text-white text-11px leading-[1.4]"
          >视频</span
        >
      </div>

      <!-- 多选框：悬停 / 聚焦 / 多选态 / 已勾选时出现；外层 32×32 命中区 -->
      <div
        class="absolute top-0 left-0 grid place-items-center w-32px h-32px leading-none transition-opacity duration-fast [@media(hover:none)]:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
        :class="checked || selecting ? 'opacity-100' : 'opacity-0'"
        @click.stop
      >
        <n-checkbox
          :checked="checked"
          :aria-label="`选择 ${title}`"
          @update:checked="emit('toggle-select', asset.id)"
        />
      </div>

      <IconButton
        variant="overlay"
        :label="asset.favorite ? '取消收藏' : '收藏'"
        :pressed="asset.favorite"
        :reveal="!asset.favorite"
        class="absolute top-4px right-4px"
        @click.stop="emit('toggle-favorite', asset)"
      >
        <svg
          viewBox="0 0 24 24"
          :fill="asset.favorite ? 'currentColor' : 'none'"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linejoin="round"
        >
          <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
        </svg>
      </IconButton>

      <IconButton
        v-if="downloadHref && !selecting"
        variant="overlay"
        label="下载"
        :href="downloadHref"
        :download="downloadName(asset.title, isVideoAsset)"
        target="_blank"
        reveal
        class="absolute right-4px bottom-4px"
        @click.stop
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.9"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" />
        </svg>
      </IconButton>
    </div>

    <div class="flex flex-col min-w-0 px-8px pt-6px pb-4px">
      <strong
        class="block text-12px font-500 leading-18px text-ink-2 whitespace-nowrap overflow-hidden text-ellipsis"
        :title="title"
      >
        {{ title }}
      </strong>
      <small class="block text-11px leading-16px text-placeholder whitespace-nowrap overflow-hidden text-ellipsis">
        {{ dateText }}<template v-if="sourceLabel"> · {{ sourceLabel }}</template>
      </small>
      <div class="flex items-center gap-4px min-w-0 mt-2px">
        <button
          v-if="asset.tags.length"
          type="button"
          class="min-w-0 inline-flex items-center h-28px px-0 border-none bg-transparent text-12px text-muted whitespace-nowrap overflow-hidden text-ellipsis cursor-pointer hover:text-ink-2 sx-focus"
          :title="`按标签「${asset.tags[0]}」筛选`"
          @click.stop="emit('filter-tag', asset.tags[0]!)"
        >
          <span class="overflow-hidden text-ellipsis">{{ asset.tags[0] }}</span>
        </button>
        <span v-else class="text-12px leading-28px text-placeholder">未打标签</span>
        <span v-if="asset.tags.length > 1" class="shrink-0 text-11px text-placeholder"
          >+{{ asset.tags.length - 1 }}</span
        >
        <IconButton
          data-tag-trigger
          variant="quiet"
          size="sm"
          aria-haspopup="dialog"
          :label="asset.tags.length ? `标签：${asset.tags.join('、')}` : '打标签'"
          class="ml-auto -mr-2px"
          @click.stop="emit('edit-tags', asset, $event.currentTarget as HTMLElement)"
        >
          <svg viewBox="0 0 512 512">
            <path
              d="M435.25 48h-122.9a14.46 14.46 0 0 0-10.2 4.2L56.45 297.9a28.85 28.85 0 0 0 0 40.7l117 117a28.85 28.85 0 0 0 40.7 0L459.75 210a14.46 14.46 0 0 0 4.2-10.2v-123a28.66 28.66 0 0 0-28.7-28.8z"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="32"
            />
            <path d="M384 160a32 32 0 1 1 32-32a32 32 0 0 1-32 32z" fill="currentColor" />
          </svg>
        </IconButton>
      </div>
    </div>
  </div>
</template>
