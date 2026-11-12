<script setup lang="ts">
/**
 * 多图同步对照（5186 原型 ImageComparePreview「三图对照」）：输入图（1–2 张）+ 生成图并排，缩放 / 平移作用到所有列。
 *
 *   <ImageCompareSync v-model:show="open" v-model:index="idx" title="姿态复刻" :groups="[{ columns: [...] }]" />
 *
 * - groups：一组 = 一次对照（输入列 + 结果列，列数不限）；多组时顶栏出「上一组 / 下一组」（studio 一批多张、工具多产物）。
 * - 同步：缩放 + 平移按「占舞台宽高的比例」存，各列比例不同也落在图上同一相对位置；滚轮以光标处为中心，拖动平移，
 *   双击 / 0 复位，键盘 + / − / 0；Esc 先退出单列再关闭，←/→ 切组。
 * - 缩放范围 0.5–8×；「适应」回到整图适应舞台（= 键盘 0 / 双击）。多组时底部有结果缩略图条，点哪张切到哪一组。
 * - 单列放大：点列（未拖动）或列头「放大」钮 → 只显示该列；再点 / 「返回对照」退出。每列头带下载（走 utils/download，原件）。
 * - 窄屏（< 720px）：不并排，改页签切列，缩放状态在页签间保留。
 * - 与 MediaLightbox / ToolImageCompare 的分工：灯箱看单张、滑动对比看前后两张叠放；这里是并排 + 同步放大看细节。
 * - 顶栏 / 舞台锁定深色（图片内容不随主题变）。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import IconButton from '@/components/IconButton/index.vue'
import { downloadImage, extFromUrl } from '@/utils/download'

export interface CompareColumn {
  url: string
  /** 列头主标签（人物图 / 姿势图 / 生成结果） */
  label: string
  /** 列头副标（可选，如「保留模特与姿态」） */
  meta?: string
  /** 是生成结果列：描边与标签用藤紫强调 */
  generated?: boolean
  /** 下载文件名（不含扩展名）；不写 = label */
  filename?: string
  /** 列脚注（一句话说明这张图在这次生成里的作用，如「姿势参考只贡献动作」）；不写 = 不出 */
  footnote?: string
}
export interface CompareGroup {
  /** 组名（顶栏计数旁，如任务标题） */
  name?: string
  columns: CompareColumn[]
}

const props = defineProps<{ groups: CompareGroup[]; title?: string }>()
const show = defineModel<boolean>('show', { required: true })
const index = defineModel<number>('index', { default: 0 })

const MIN = 0.5
const MAX = 8
const STEP = 0.5

const root = ref<HTMLElement | null>(null)
const closeBtn = ref<HTMLElement | null>(null)

const total = computed(() => props.groups.length)
const at = computed(() => (total.value ? Math.min(Math.max(index.value, 0), total.value - 1) : 0))
const group = computed<CompareGroup | null>(() => props.groups[at.value] ?? null)
const columns = computed(() => group.value?.columns.filter((c) => !!c.url) ?? [])

const zoom = ref(1)
/** 平移：占舞台宽 / 高的比例（0.1 = 向右 10% 舞台宽） */
const pan = ref({ x: 0, y: 0 })
const dragging = ref(false)
const solo = ref<number | null>(null)
const tab = ref(0)
const narrow = ref(false)
const broken = ref<Record<string, boolean>>({})

const keyOf = (i: number) => `${at.value}:${i}`
const shown = computed(() => {
  const cols = columns.value.map((c, i) => ({ c, i }))
  if (solo.value != null) return cols.filter(({ i }) => i === solo.value)
  if (narrow.value) return cols.filter(({ i }) => i === Math.min(tab.value, cols.length - 1))
  return cols
})
const single = computed(() => shown.value.length === 1)

function clampPan(x: number, y: number, z = zoom.value) {
  // 放大后每轴最多平移 (z − 1) / 2 个舞台尺寸，边缘不会拖出空白；缩小到适应以下不平移
  const m = Math.max(0, (z - 1) / 2)
  return { x: Math.min(m, Math.max(-m, x)), y: Math.min(m, Math.max(-m, y)) }
}
function setZoom(next: number, cx = 0, cy = 0) {
  // (cx, cy)：缩放中心相对舞台中心的比例偏移；保持该点下的图像位置不动
  const z = Math.min(MAX, Math.max(MIN, next))
  if (z === zoom.value) return
  const k = z / zoom.value
  const p = z <= 1 ? { x: 0, y: 0 } : clampPan(cx - (cx - pan.value.x) * k, cy - (cy - pan.value.y) * k, z)
  zoom.value = z
  pan.value = p
}
function reset() {
  zoom.value = 1
  pan.value = { x: 0, y: 0 }
  drag = null
  dragging.value = false
}
function resetAll() {
  reset()
  solo.value = null
  tab.value = 0
}

function relPoint(e: { clientX: number; clientY: number }, el: HTMLElement) {
  const r = el.getBoundingClientRect()
  if (!r.width || !r.height) return { x: 0, y: 0 }
  return { x: (e.clientX - r.left - r.width / 2) / r.width, y: (e.clientY - r.top - r.height / 2) / r.height }
}
function onWheel(e: WheelEvent) {
  e.preventDefault()
  const p = relPoint(e, e.currentTarget as HTMLElement)
  setZoom(zoom.value * Math.exp(-e.deltaY * 0.0015), p.x, p.y)
}

let drag: { x: number; y: number; px: number; py: number; w: number; h: number; moved: boolean } | null = null
let clickTimer: ReturnType<typeof setTimeout> | null = null
function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture?.(e.pointerId)
  const r = el.getBoundingClientRect()
  drag = { x: e.clientX, y: e.clientY, px: pan.value.x, py: pan.value.y, w: r.width || 1, h: r.height || 1, moved: false }
}
function onPointerMove(e: PointerEvent) {
  if (!drag) return
  const dx = e.clientX - drag.x
  const dy = e.clientY - drag.y
  if (!drag.moved && Math.hypot(dx, dy) < 4) return
  drag.moved = true
  if (zoom.value > 1) {
    dragging.value = true
    pan.value = clampPan(drag.px + dx / drag.w, drag.py + dy / drag.h)
  }
}
function onPointerUp(e: PointerEvent, i: number) {
  const d = drag
  drag = null
  dragging.value = false
  const el = e.currentTarget as HTMLElement
  if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId)
  if (!d || d.moved) return
  // 轻点 = 单列放大 / 退出；延迟一下，双击（复位）时不触发
  if (clickTimer) clearTimeout(clickTimer)
  clickTimer = setTimeout(() => {
    clickTimer = null
    toggleSolo(i)
  }, 240)
}
function onDblClick() {
  if (clickTimer) {
    clearTimeout(clickTimer)
    clickTimer = null
  }
  reset()
}
function toggleSolo(i: number) {
  solo.value = solo.value === i ? null : i
  reset()
}

const imgStyle = computed(() => ({
  transform: `translate(${pan.value.x * 100}%, ${pan.value.y * 100}%) scale(${zoom.value})`,
  ...(dragging.value ? { transition: 'none' } : {}),
}))

function download(c: CompareColumn) {
  const base = (c.filename || c.label).replace(/[\\/:*?"<>|\s]+/g, '_')
  void downloadImage(c.url, `${base}.${extFromUrl(c.url)}`)
}
function go(delta: number) {
  if (total.value < 2) return
  index.value = (at.value + delta + total.value) % total.value
}
function close() {
  show.value = false
}

function focusables(): HTMLElement[] {
  return Array.from(root.value?.querySelectorAll<HTMLElement>('button, a[href], [role="tab"]') ?? []).filter(
    (el) => !el.hasAttribute('disabled'),
  )
}
function onKeydown(e: KeyboardEvent) {
  if (!show.value) return
  if ((e.metaKey || e.ctrlKey || e.altKey) && e.key.length === 1) return
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
  // 焦点在页签上时 ←/→ 留给页签自己切换
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && document.activeElement?.getAttribute('role') === 'tab') return
  let handled = true
  switch (e.key) {
    case 'Escape':
      if (solo.value != null) {
        solo.value = null
        reset()
      } else close()
      break
    case 'ArrowLeft':
      go(-1)
      break
    case 'ArrowRight':
      go(1)
      break
    case '+':
    case '=':
      setZoom(zoom.value + STEP)
      break
    case '-':
    case '_':
      setZoom(zoom.value - STEP)
      break
    case '0':
      reset()
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
let locked = false
let prevOverflow = ''
let mq: MediaQueryList | null = null
const onMq = () => (narrow.value = !!mq?.matches)
watch(
  show,
  (open) => {
    if (open) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
      if (!locked) {
        prevOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        locked = true
      }
      mq = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 719px)') : null
      onMq()
      mq?.addEventListener('change', onMq)
      document.addEventListener('keydown', onKeydown, true)
      resetAll()
      broken.value = {}
      void nextTick(() => closeBtn.value?.focus())
    } else {
      document.removeEventListener('keydown', onKeydown, true)
      mq?.removeEventListener('change', onMq)
      if (locked) {
        document.body.style.overflow = prevOverflow
        locked = false
      }
      opener?.focus?.()
      opener = null
    }
  },
  { immediate: true },
)
watch(at, resetAll)
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown, true)
  mq?.removeEventListener('change', onMq)
  if (clickTimer) clearTimeout(clickTimer)
  if (locked) document.body.style.overflow = prevOverflow
})

const pct = computed(() => `${Math.round(zoom.value * 100)}%`)
/** 底部结果缩略图条：每组的生成结果列（没有就取最后一列） */
const thumbs = computed(() =>
  props.groups.map((g, i) => {
    const cols = g.columns.filter((c) => !!c.url)
    const c = cols.find((x) => x.generated) ?? cols[cols.length - 1]
    return { i, url: c?.url ?? '', name: g.name || `第 ${i + 1} 组` }
  }),
)
const ICONS = {
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  reset: 'M4 12a8 8 0 0 1 14-5.3M18 3v4h-4M20 12a8 8 0 0 1-14 5.3M6 21v-4h4',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  close: 'M6 6l12 12M18 6L6 18',
  prev: 'M15 5l-7 7 7 7',
  next: 'M9 5l7 7-7 7',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  back: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="show"
      ref="root"
      data-theme="dark"
      class="fixed inset-0 z-4000 flex flex-col bg-page text-ink"
      role="dialog"
      aria-modal="true"
      :aria-label="title ? `${title}对照` : '图片对照'"
    >
      <header class="flex flex-none items-center gap-8px min-h-52px px-12px box-border border-0 border-b border-solid border-line">
        <div class="flex min-w-0 flex-1 items-center gap-8px">
          <span class="truncate text-14px font-600">{{ title || '图片对照' }}</span>
          <span v-if="group?.name" class="truncate text-12px text-muted">{{ group.name }}</span>
          <span v-if="total > 1" class="flex-none text-12px text-muted" role="status">{{ at + 1 }} / {{ total }}</span>
        </div>
        <IconButton v-if="total > 1" label="上一组（←）" variant="quiet" @click="go(-1)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path :d="ICONS.prev" /></svg>
        </IconButton>
        <IconButton v-if="total > 1" label="下一组（→）" variant="quiet" @click="go(1)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path :d="ICONS.next" /></svg>
        </IconButton>
        <span class="mx-4px h-16px w-1px bg-[var(--xq-line)]" aria-hidden="true" />
        <IconButton label="缩小（-）" variant="quiet" :disabled="zoom <= MIN" @click="setZoom(zoom - STEP)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path :d="ICONS.minus" /></svg>
        </IconButton>
        <span class="w-44px text-center text-12px tabular-nums text-ink-2" role="status" aria-live="polite">{{ pct }}</span>
        <IconButton label="放大（+）" variant="quiet" :disabled="zoom >= MAX" @click="setZoom(zoom + STEP)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path :d="ICONS.plus" /></svg>
        </IconButton>
        <button
          type="button"
          class="inline-flex h-32px flex-none cursor-pointer items-center gap-4px rounded-6px border border-solid border-line bg-surface2 px-10px text-12px font-500 text-ink-2 hover:(border-violet-line text-ink) disabled:(cursor-not-allowed opacity-50) motion-reduce:transition-none"
          title="适应窗口（0 / 双击）"
          aria-label="适应窗口"
          :disabled="zoom === 1 && pan.x === 0 && pan.y === 0"
          @click="reset"
        >
          <svg class="h-14px w-14px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="ICONS.reset" /></svg>
          适应
        </button>
        <span class="mx-4px h-16px w-1px bg-[var(--xq-line)]" aria-hidden="true" />
        <button ref="closeBtn" type="button" class="sx-iconbtn sx-iconbtn-quiet" aria-label="关闭（Esc）" title="关闭（Esc）" @click="close">
          <span class="inline-flex text-16px leading-none [&>svg]:(w-1em h-1em)" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path :d="ICONS.close" /></svg>
          </span>
        </button>
      </header>

      <!-- 窄屏页签（单列放大时不出） -->
      <div
        v-if="narrow && solo == null && columns.length > 1"
        class="flex flex-none gap-6px px-12px py-8px overflow-x-auto"
        role="tablist"
        aria-label="对照图"
      >
        <button
          v-for="(c, i) in columns"
          :key="keyOf(i)"
          type="button"
          role="tab"
          :aria-selected="tab === i"
          class="flex-none h-32px px-12px rounded-full border border-solid text-12px cursor-pointer"
          :class="tab === i ? 'bg-violet-solid text-on-accent border-transparent' : 'bg-surface2 text-ink-2 border-line'"
          @click="tab = i"
        >
          {{ c.label }}
        </button>
      </div>

      <div class="flex min-h-0 flex-1 gap-8px p-8px box-border" :class="narrow ? 'flex-col' : 'flex-row'">
        <section
          v-for="{ c, i } in shown"
          :key="keyOf(i)"
          class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-8px border border-solid bg-surface"
          :class="c.generated ? 'border-violet' : 'border-line'"
        >
          <div class="flex flex-none items-center gap-6px h-40px pl-10px pr-4px box-border">
            <span
              class="flex-none inline-flex items-center h-20px px-8px rounded-full text-11px font-500"
              :class="c.generated ? 'bg-violet-solid text-on-accent' : 'bg-surface3 text-ink-2'"
              >{{ c.label }}</span
            >
            <span v-if="c.meta" class="min-w-0 flex-1 truncate text-12px text-muted">{{ c.meta }}</span>
            <span v-else class="flex-1" />
            <IconButton
              :label="single && solo != null ? '返回对照' : `单独放大${c.label}`"
              variant="quiet"
              size="md"
              @click="toggleSolo(i)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path :d="solo != null ? ICONS.back : ICONS.expand" />
              </svg>
            </IconButton>
            <IconButton :label="`下载${c.label}`" variant="quiet" size="md" @click="download(c)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path :d="ICONS.download" /></svg>
            </IconButton>
          </div>
          <div
            class="relative min-h-0 flex-1 overflow-hidden bg-surface2 select-none touch-none"
            :class="dragging ? 'cursor-grabbing' : zoom > 1 ? 'cursor-grab' : single ? 'cursor-zoom-out' : 'cursor-zoom-in'"
            :title="solo != null ? '轻点返回对照' : '轻点单独放大，滚轮缩放，拖动平移，双击复位'"
            @wheel="onWheel"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp($event, i)"
            @pointercancel="onPointerUp($event, i)"
            @dblclick="onDblClick"
          >
            <img
              v-if="!broken[keyOf(i)]"
              :src="c.url"
              :alt="c.label"
              draggable="false"
              class="absolute inset-0 block w-full h-full object-contain pointer-events-none [transition:transform_120ms_ease] motion-reduce:transition-none"
              :style="imgStyle"
              @error="broken[keyOf(i)] = true"
            />
            <div v-else class="absolute inset-0 grid place-items-center text-12px text-muted">图片加载失败</div>
          </div>
          <p v-if="c.footnote" class="m-0 flex-none px-10px py-6px text-11px leading-16px text-muted">{{ c.footnote }}</p>
        </section>
      </div>

      <!-- 多组：底部结果缩略图条，点哪张切到哪一组（← / → 同样可切） -->
      <div
        v-if="total > 1"
        class="flex flex-none items-center gap-8px overflow-x-auto px-12px py-8px box-border border-0 border-t border-solid border-line"
        role="group"
        aria-label="切换结果"
      >
        <button
          v-for="t in thumbs"
          :key="t.i"
          type="button"
          class="relative h-48px w-48px flex-none cursor-pointer overflow-hidden rounded-6px border border-solid bg-surface2 p-0 motion-reduce:transition-none"
          :class="t.i === at ? 'border-violet shadow-[0_0_0_1px_var(--xq-violet)]' : 'border-line hover:border-control'"
          :aria-label="`第 ${t.i + 1} 组：${t.name}`"
          :aria-pressed="t.i === at"
          :title="t.name"
          @click="index = t.i"
        >
          <img v-if="t.url" :src="t.url" alt="" class="block h-full w-full object-cover" draggable="false" />
        </button>
      </div>
    </div>
  </Teleport>
</template>
