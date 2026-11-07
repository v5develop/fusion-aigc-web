<script setup lang="ts">
/**
 * 全屏媒体灯箱（图片 / 视频），对齐 5185 原型 MediaPreview。
 *
 *   <MediaLightbox v-model:show="open" v-model:index="idx" :items="[{ url, type: 'image', name }]" />
 *
 * - items[].type 缺省按 image；video 带 controls 播放，缩放 / 旋转按钮对视频隐藏。
 * - 键盘：Esc 关闭，←/→ 切换，+/- 缩放，0 重置，R 旋转；Tab 焦点锁在灯箱内，关闭后还原到打开前的元素。
 * - 打开时锁 body 滚动；尊重 prefers-reduced-motion；工具钮视觉 32、触屏 44。
 * - 下载原件用 <a download>，跨域时浏览器会忽略 download 直接导航，所以统一 target=_blank 兜底成新标签页打开。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

export interface LightboxItem {
  url: string
  type?: 'image' | 'video'
  name?: string
}

const props = defineProps<{ items: LightboxItem[]; show: boolean; index: number }>()
const emit = defineEmits<{ 'update:show': [value: boolean]; 'update:index': [value: number] }>()

const MIN = 0.5
const MAX = 4
const STEP = 0.25

const root = ref<HTMLElement | null>(null)
const closeBtn = ref<HTMLElement | null>(null)
const scale = ref(1)
const rotate = ref(0)
const broken = ref(false)

const total = computed(() => props.items.length)
const at = computed(() => (total.value ? Math.min(Math.max(props.index, 0), total.value - 1) : 0))
const item = computed<LightboxItem | null>(() => props.items[at.value] ?? null)
const isVideo = computed(() => item.value?.type === 'video')
const dirty = computed(() => scale.value !== 1 || rotate.value !== 0)
const imgStyle = computed(() => ({ transform: `scale(${scale.value}) rotate(${rotate.value}deg)` }))
const downloadName = computed(() => item.value?.name || item.value?.url.split('?')[0]?.split('/').pop() || 'download')

function close() {
  emit('update:show', false)
}
function go(delta: number) {
  if (total.value < 2) return
  emit('update:index', (at.value + delta + total.value) % total.value)
}
function zoom(delta: number) {
  scale.value = Math.min(MAX, Math.max(MIN, Math.round((scale.value + delta) * 100) / 100))
}
function reset() {
  scale.value = 1
  rotate.value = 0
}

function focusables(): HTMLElement[] {
  if (!root.value) return []
  return Array.from(root.value.querySelectorAll<HTMLElement>('button, a[href], video[controls]')).filter(
    (el) => !el.hasAttribute('disabled'),
  )
}
function onKeydown(e: KeyboardEvent) {
  if (!props.show) return
  if (e.key === 'Tab') {
    const list = focusables()
    if (!list.length) return
    const first = list[0]!
    const last = list[list.length - 1]!
    const active = document.activeElement
    const inside = active instanceof HTMLElement && !!root.value?.contains(active)
    if (e.shiftKey && (active === first || !inside)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || !inside)) {
      e.preventDefault()
      first.focus()
    }
    return
  }
  // 焦点在 <video> 上时 ←/→ 留给原生快进快退，不拿来切换上一张 / 下一张（Esc 照常关闭）
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && document.activeElement instanceof HTMLVideoElement) return
  let handled = true
  switch (e.key) {
    case 'Escape':
      close()
      break
    case 'ArrowLeft':
      go(-1)
      break
    case 'ArrowRight':
      go(1)
      break
    case '+':
    case '=':
      if (!isVideo.value) zoom(STEP)
      break
    case '-':
      if (!isVideo.value) zoom(-STEP)
      break
    case '0':
      reset()
      break
    case 'r':
    case 'R':
      if (!isVideo.value) rotate.value = (rotate.value + 90) % 360
      break
    default:
      handled = false
  }
  if (handled) {
    e.preventDefault()
    e.stopPropagation()
  }
}

let opener: HTMLElement | null = null
// 只在本实例真的锁过 body 时才还原：immediate watcher 首次以 show=false 进 else 分支时
// 不能把 body.overflow 写成 ''（会解开别的弹层/抽屉加的锁）
let locked = false
let prevOverflow = ''
function lockBody() {
  if (locked) return
  prevOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  locked = true
}
function unlockBody() {
  if (!locked) return
  document.body.style.overflow = prevOverflow
  locked = false
}
watch(
  () => props.show,
  (open) => {
    if (open) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
      lockBody()
      document.addEventListener('keydown', onKeydown, true)
      reset()
      void nextTick(() => closeBtn.value?.focus())
    } else {
      document.removeEventListener('keydown', onKeydown, true)
      unlockBody()
      opener?.focus?.()
      opener = null
    }
  },
  { immediate: true },
)
watch(
  () => item.value?.url,
  () => {
    reset()
    broken.value = false
  },
)
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown, true)
  unlockBody()
})

const ICONS = {
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  rotate: 'M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5',
  reset: 'M4 12a8 8 0 0 1 14-5.3M18 3v4h-4M20 12a8 8 0 0 1-14 5.3M6 21v-4h4',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  close: 'M6 6l12 12M18 6L6 18',
  prev: 'M15 5l-7 7 7 7',
  next: 'M9 5l7 7-7 7',
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" ref="root" class="mlb" role="dialog" aria-modal="true" aria-label="媒体预览">
      <header class="mlb-bar">
        <div class="mlb-title">
          <span class="mlb-name">{{ item?.name || '媒体预览' }}</span>
          <span v-if="total > 1" class="mlb-count" role="status">{{ at + 1 }} / {{ total }}</span>
        </div>
        <template v-if="!isVideo">
          <button type="button" class="mlb-tool" aria-label="缩小" title="缩小" :disabled="scale <= MIN" @click="zoom(-STEP)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="ICONS.minus" /></svg>
          </button>
          <span class="mlb-scale" aria-live="polite">{{ Math.round(scale * 100) }}%</span>
          <button type="button" class="mlb-tool" aria-label="放大" title="放大" :disabled="scale >= MAX" @click="zoom(STEP)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="ICONS.plus" /></svg>
          </button>
          <button type="button" class="mlb-tool" aria-label="旋转 90 度" title="旋转" @click="rotate = (rotate + 90) % 360">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="ICONS.rotate" /></svg>
          </button>
          <button type="button" class="mlb-tool" aria-label="重置" title="重置" :disabled="!dirty" @click="reset">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="ICONS.reset" /></svg>
          </button>
        </template>
        <a
          v-if="item"
          class="mlb-tool"
          :href="item.url"
          :download="downloadName"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="下载原件"
          title="下载原件"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="ICONS.download" /></svg>
        </a>
        <button ref="closeBtn" type="button" class="mlb-tool" aria-label="关闭" title="关闭（Esc）" @click="close">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="ICONS.close" /></svg>
        </button>
      </header>

      <div class="mlb-stage" @click.self="close">
        <video
          v-if="item && isVideo"
          :key="item.url"
          :src="item.url"
          controls
          playsinline
          preload="metadata"
          class="mlb-video"
          :aria-label="item.name || '预览视频'"
        />
        <template v-else-if="item">
          <p v-if="broken" class="mlb-hint">图片加载失败，请稍后重试</p>
          <img
            v-else
            :key="item.url"
            :src="item.url"
            :alt="item.name || '预览图'"
            draggable="false"
            class="mlb-img"
            :class="{ 'mlb-img-round': scale === 1 && rotate === 0 }"
            :style="imgStyle"
            @error="broken = true"
            @dblclick="reset"
          />
        </template>
      </div>

      <template v-if="total > 1">
        <button type="button" class="mlb-nav mlb-nav-l" aria-label="上一个" @click="go(-1)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="ICONS.prev" /></svg>
        </button>
        <button type="button" class="mlb-nav mlb-nav-r" aria-label="下一个" @click="go(1)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="ICONS.next" /></svg>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.mlb {
  --mlb-fg: #fff;
  position: fixed;
  inset: 0;
  z-index: 4000; /* 高于 Naive 的 modal（2000）与消息层 */
  display: flex;
  flex-direction: column;
  background: #0b0b0d;
  color: var(--mlb-fg);
  animation: mlb-in 0.16s ease-out;
}
.mlb-bar {
  position: relative;
  z-index: 2;
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
}
.mlb-title {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}
.mlb-name {
  overflow: hidden;
  font-size: 13px;
  line-height: 18px;
  color: color-mix(in srgb, var(--mlb-fg) 90%, transparent);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mlb-count,
.mlb-scale {
  font-size: 11px;
  line-height: 16px;
  color: color-mix(in srgb, var(--mlb-fg) 65%, transparent);
  font-variant-numeric: tabular-nums;
}
.mlb-scale {
  min-width: 44px;
  text-align: center;
}
.mlb-tool {
  display: inline-flex;
  position: relative;
  width: 32px;
  height: 32px;
  flex: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: color-mix(in srgb, var(--mlb-fg) 10%, transparent);
  color: var(--mlb-fg);
  cursor: pointer;
  transition: background 0.12s;
}
.mlb-tool:hover:not(:disabled) {
  background: color-mix(in srgb, var(--mlb-fg) 22%, transparent);
}
.mlb-tool:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.mlb-tool:focus-visible,
.mlb-nav:focus-visible {
  outline: 2px solid #c9a8dc;
  outline-offset: 2px;
}
.mlb-tool svg,
.mlb-nav svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.mlb-stage {
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 0 72px 24px;
  overflow: hidden;
}
.mlb-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  user-select: none;
  transition: transform 0.16s ease-out, border-radius 0.16s;
  will-change: transform;
}
.mlb-img-round {
  border-radius: 22px;
}
.mlb-video {
  max-width: 100%;
  max-height: 100%;
  border-radius: 12px;
  background: #000;
}
.mlb-hint {
  margin: 0;
  font-size: 13px;
  color: color-mix(in srgb, var(--mlb-fg) 70%, transparent);
}
.mlb-nav {
  position: absolute;
  top: 50%;
  z-index: 2;
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: color-mix(in srgb, var(--mlb-fg) 10%, transparent);
  color: var(--mlb-fg);
  cursor: pointer;
  transform: translateY(-50%);
  transition: background 0.12s;
}
.mlb-nav:hover {
  background: color-mix(in srgb, var(--mlb-fg) 22%, transparent);
}
.mlb-nav-l {
  left: 16px;
}
.mlb-nav-r {
  right: 16px;
}
/* 触屏：工具钮放大到 44 */
@media (pointer: coarse) {
  .mlb-tool {
    width: 44px;
    height: 44px;
  }
}
@media (max-width: 640px) {
  .mlb-bar {
    padding: 8px 12px;
  }
  .mlb-stage {
    padding: 0 12px 16px;
  }
  .mlb-nav-l {
    left: 8px;
  }
  .mlb-nav-r {
    right: 8px;
  }
}
@keyframes mlb-in {
  from {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .mlb {
    animation: none;
  }
  .mlb-img,
  .mlb-tool,
  .mlb-nav {
    transition: none;
  }
}
</style>
