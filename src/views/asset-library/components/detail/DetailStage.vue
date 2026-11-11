<script setup lang="ts">
/**
 * 资产详情 · 媒体舞台（左侧大图区）。约定沿用主流图库 / 相册的看图习惯：
 * - 图片 contain 在中性灰台面上（透明图下面是浅棋盘格），两侧圆钮翻上一个 / 下一个（键盘 ← / → 由 DetailModal 监听）；
 * - 右上：「校色调整 / 继续调整」+「全屏调色」（F，ColorFixFullscreen：大图缩放 + 对比分割线 + 停靠参数台）
 *   +「查看大图」（MediaLightbox pannable：滚轮缩放、拖动平移）；
 * - 左上：调过色才出现「校色后 | 原图 | 对比」+「保存为新版本」；
 * - 底部居中：版本胶囊（原图 / 各版本，点即设为当前），对比档让位给对比滑杆。
 * 第一次看到图片资产时，在「校色调整」下方给一句说明（本机记住，点「知道了」或打开参数台后不再出现）。
 */
import { computed, ref } from 'vue'
import IconButton from '@/components/IconButton/index.vue'
import MediaFallback from '@/components/MediaFallback/index.vue'
import MediaLightbox from '@/components/MediaLightbox/index.vue'
import { ColorFixCompare, ColorFixPill, corsAttr } from '@/components/ColorFix'
import { useAssetDetail } from './context.ts'

defineProps<{ hasPrev: boolean; hasNext: boolean }>()
const emit = defineEmits<{ prev: []; next: [] }>()
const lightboxOpen = defineModel<boolean>('lightbox', { default: false })

const d = useAssetDetail()
const { cf } = d

/** 压在图上的毛玻璃底：深浅图上都看得清 */
const GLASS =
  'border border-solid border-white/70 bg-white/90 backdrop-blur-[8px] shadow-[0_4px_14px_rgba(31,35,41,0.16)]'
const SEG_ITEM =
  'h-28px box-border px-12px rounded-full border-none text-12px cursor-pointer whitespace-nowrap sx-focus [transition:background_140ms,color_140ms] motion-reduce:transition-none'
const SEG_ON = 'bg-violet-solid text-white font-600'
const SEG_OFF = 'bg-transparent text-ink-2 hover:(bg-surface3 text-ink)'

const VIEW_MODES = [
  { key: 'result', label: '校色后', title: '显示调色后的效果' },
  { key: 'original', label: '原图', title: '显示调色前的原图' },
  { key: 'compare', label: '对比', title: '左右拖动对比原图与校色后' },
] as const

const fixToolbar = computed(() => d.cf.active.value && d.canColorFix.value)
const comparing = computed(
  () => d.fixMode.value === 'compare' && d.cf.compareAvailable.value && !d.previewFailed.value,
)

// ---------------- 第一次的校色说明 ----------------
const HINT_KEY = 'asset-detail:colorfix-hint-seen'
function readSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1'
  } catch {
    return true
  }
}
const hintSeen = ref(readSeen())
function dismissHint() {
  hintSeen.value = true
  try {
    localStorage.setItem(HINT_KEY, '1')
  } catch {
    /* 隐私模式：本次关掉即可 */
  }
}
const showHint = computed(() => !hintSeen.value && d.canColorFix.value && !d.cf.active.value && !comparing.value)
function openColorFix() {
  dismissHint()
  cf.open()
}
function openFullscreen() {
  dismissHint()
  cf.openFullscreen()
}

// ---------------- 查看大图 ----------------
const lightboxIndex = ref(0)
const lightboxItems = computed(() => {
  const a = d.asset.value
  if (!a) return []
  if (a.media === 'video') return a.videoUrl ? [{ url: a.videoUrl, type: 'video' as const, name: a.title }] : []
  // 校色预览已烘成图时给烘好的那张；只挂了 CSS 滤镜的即时预览灯箱里还原不了，给当前版本原图
  const baked = d.showFixed.value && cf.displaySrc.value && cf.displaySrc.value !== cf.src.value
  const url = baked ? cf.displaySrc.value : a.image
  return url ? [{ url, type: 'image' as const, name: a.title }] : []
})
const lightboxLabel = computed(() =>
  d.showFixed.value && !(cf.displaySrc.value && cf.displaySrc.value !== cf.src.value)
    ? '查看大图（显示原图，校色效果需先保存为新版本）'
    : '查看大图（滚轮缩放、拖动查看细节）',
)
function openLightbox() {
  lightboxIndex.value = 0
  lightboxOpen.value = true
}
</script>

<template>
  <div class="asset-stage relative min-w-0 min-h-0 flex items-center justify-center overflow-hidden">
    <template v-if="d.asset.value">
      <!-- 对比：左原图右校色后，拖动中线 -->
      <!-- 对比档留出上下工具条的位置，左右标签不被遮住 -->
      <div v-if="comparing" class="absolute inset-x-64px top-60px bottom-24px rounded-8px overflow-hidden max-[900px]:(inset-x-12px top-56px bottom-12px)">
        <ColorFixCompare
          :before="cf.src.value"
          :after="cf.displaySrc.value"
          :after-filter="cf.liveFilter.value"
          :labels="['原图', '校色后']"
          :downloads="false"
        />
      </div>
      <video
        v-else-if="d.asset.value.media === 'video' && d.asset.value.videoUrl && !d.previewFailed.value"
        :src="d.asset.value.videoUrl"
        :poster="d.asset.value.image || undefined"
        controls
        class="asset-stage-media"
        @error="d.previewFailed.value = true"
      />
      <img
        v-else-if="d.asset.value.image && !d.previewFailed.value"
        class="asset-stage-media cursor-zoom-in"
        :src="d.mediaSrc.value"
        :crossorigin="corsAttr(d.mediaSrc.value)"
        :style="d.showFixed.value ? cf.previewStyle.value : undefined"
        :alt="d.asset.value.title || '资产预览'"
        @error="d.onMediaError"
        @dblclick="openLightbox"
      />
      <MediaFallback v-else :type="d.asset.value.media === 'video' ? 'video' : 'image'" reason="loadFailed" />

      <!-- 上一个 / 下一个：图库通用位置，垂直居中贴两侧 -->
      <IconButton
        v-if="hasPrev"
        label="上一个（←）"
        size="lg"
        variant="overlay"
        class="asset-stage-nav !absolute left-12px top-1/2 -translate-y-1/2 z-4 !rounded-full"
        @click="emit('prev')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m15 5-7 7 7 7" />
        </svg>
      </IconButton>
      <IconButton
        v-if="hasNext"
        label="下一个（→）"
        size="lg"
        variant="overlay"
        class="asset-stage-nav !absolute right-12px top-1/2 -translate-y-1/2 z-4 !rounded-full"
        @click="emit('next')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m9 5 7 7-7 7" />
        </svg>
      </IconButton>

      <!-- 左上：调过色才有的查看方式 + 保存为新版本 -->
      <div v-if="fixToolbar" class="absolute top-12px left-12px z-7 flex flex-wrap items-center gap-8px max-w-[calc(100%-330px)] max-[640px]:max-w-[calc(100%-24px)] max-[640px]:top-56px">
        <div role="radiogroup" aria-label="查看方式" class="flex items-center gap-2px p-3px rounded-full" :class="GLASS">
          <button
            v-for="m in VIEW_MODES"
            :key="m.key"
            type="button"
            role="radio"
            :aria-checked="d.fixMode.value === m.key"
            :disabled="m.key === 'compare' && !cf.compareAvailable.value"
            :title="m.key === 'compare' && !cf.compareAvailable.value ? '当前选区方式暂不支持对比' : m.title"
            :class="[SEG_ITEM, d.fixMode.value === m.key ? SEG_ON : SEG_OFF, 'disabled:(opacity-45 cursor-not-allowed)']"
            @click="d.fixMode.value = m.key"
          >
            {{ m.label }}
          </button>
        </div>
        <button
          v-if="d.fixMode.value !== 'original'"
          type="button"
          class="inline-flex items-center gap-6px h-34px box-border px-12px rounded-full text-12px font-600 text-violet-ink cursor-pointer whitespace-nowrap hover:bg-white sx-focus disabled:(opacity-60 cursor-not-allowed)"
          :class="GLASS"
          :disabled="d.savingColorFix.value"
          :aria-busy="d.savingColorFix.value || undefined"
          title="把当前校色效果另存为这个资产的新版本，原图不会被覆盖（同参数的版本已存在时直接切过去）"
          @click="d.saveFixVersion"
        >
          <svg class="w-14px h-14px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 4h11l3 3v13H5z" /><path d="M8 4v5h7V4M8 20v-6h8v6" />
          </svg>
          {{ d.savingColorFix.value ? '保存中…' : '保存为新版本' }}
        </button>
      </div>

      <!-- 右上：校色入口 + 查看大图 -->
      <div class="asset-stage-tr absolute top-12px right-12px z-7 flex items-center gap-8px">
        <ColorFixPill
          v-if="d.canColorFix.value"
          class="!h-32px !px-12px !text-12px !rounded-16px"
          :label="cf.active.value ? '继续调整' : '校色调整'"
          :pressed="cf.panelOpen.value"
          title="调整亮度、对比度、色温等，修正偏色；不会改动原图"
          @click="openColorFix"
        />
        <ColorFixPill
          v-if="d.canColorFix.value"
          class="!h-32px !px-12px !text-12px !rounded-16px"
          :icon="false"
          label="全屏调色"
          aria-keyshortcuts="F"
          title="全屏调色（F）：大图对比、缩放查看细节，参数台停靠右侧"
          @click="openFullscreen"
        >
          <svg class="w-13px h-13px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
          全屏调色
        </ColorFixPill>
        <IconButton
          v-if="lightboxItems.length && !comparing && d.isImage.value"
          :label="lightboxLabel"
          variant="overlay"
          @click="openLightbox"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
          </svg>
        </IconButton>
      </div>

      <!-- 第一次看到图片资产：一句话说明「校色」是什么 -->
      <div
        v-if="showHint"
        role="note"
        class="asset-stage-hint absolute top-54px right-12px z-7 w-236px p-12px rounded-14px text-12px leading-18px text-ink-2"
        :class="GLASS"
      >
        <b class="block mb-2px text-ink font-600">图片偏色？试试校色</b>
        调亮度、对比度、色温等修正颜色，原图不会被改动，满意了再保存为新版本。
        <button
          type="button"
          class="block mt-8px ml-auto h-28px px-10px rounded-14px border-none bg-violet-soft text-violet-ink text-12px font-600 cursor-pointer hover:bg-violet-soft-2 sx-focus"
          @click="dismissHint"
        >
          知道了
        </button>
      </div>

      <!-- 底部居中：版本胶囊（原图 / 各版本，点即设为当前） -->
      <div
        v-if="d.versions.value.items.length && !comparing"
        role="radiogroup"
        aria-label="切换当前版本"
        class="absolute bottom-12px left-1/2 -translate-x-1/2 z-5 flex items-center gap-2px p-4px rounded-full max-w-[86%] overflow-x-auto [scrollbar-width:none]"
        :class="GLASS"
      >
        <button
          type="button"
          role="radio"
          :aria-checked="!d.asset.value.currentVersionId"
          :class="[SEG_ITEM, !d.asset.value.currentVersionId ? SEG_ON : SEG_OFF]"
          :disabled="d.saving.value"
          @click="d.setCurrentVersion(0)"
        >
          原图
        </button>
        <button
          v-for="(v, vi) in d.versions.value.items"
          :key="v.id"
          type="button"
          role="radio"
          :aria-checked="v.id === d.asset.value.currentVersionId"
          :class="[SEG_ITEM, v.id === d.asset.value.currentVersionId ? SEG_ON : SEG_OFF]"
          :title="v.prompt || `版本 ${v.versionNo}`"
          :disabled="d.saving.value"
          @click="d.setCurrentVersion(v.id)"
        >
          {{ d.versionLabel(v, vi) }}
        </button>
      </div>
    </template>
    <div v-else class="text-13px text-placeholder">加载中…</div>

    <MediaLightbox v-model:show="lightboxOpen" v-model:index="lightboxIndex" :items="lightboxItems" pannable />
  </div>
</template>

<style scoped lang="less">
.asset-stage {
  /* 中性看图台：浅灰底 + 极淡的点阵，透明图也能看清边界 */
  background-color: var(--xq-checker-b);
  background-image: radial-gradient(rgb(var(--xq-ink-rgb) / 0.07) 1px, transparent 1px);
  background-size: 16px 16px;
}
.asset-stage-media {
  max-width: calc(100% - 112px);
  max-height: calc(100% - 132px);
  object-fit: contain;
  border-radius: 6px;
  box-shadow:
    0 1px 2px rgba(31, 35, 41, 0.08),
    0 12px 32px -12px rgba(31, 35, 41, 0.28);
  /* 透明图：棋盘格衬底 */
  background:
    repeating-conic-gradient(var(--xq-surface3) 0% 25%, var(--xq-checker-a) 0% 50%) 50% / 16px 16px;
}
video.asset-stage-media {
  background: #000;
}
@media (max-width: 900px) {
  .asset-stage-media {
    max-width: calc(100% - 24px);
    max-height: calc(100% - 96px);
  }
  /* 窄屏关闭钮压在舞台右上角，右上工具条让开 */
  .asset-stage-tr,
  .asset-stage-hint {
    right: 60px;
  }
}
</style>
