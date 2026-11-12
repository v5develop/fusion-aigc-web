<script setup lang="ts">
/**
 * 校色参考浮卡（2026-11-12，5186「校色浮卡」定稿）：把原服装图（商拍换装的参考图）浮在校色画面上，边调边肉眼对色。
 *
 * <ul>
 *   <li>288px 宽（父容器窄时收到「父宽 − 24」），`position: absolute`，相对最近的定位祖先；按住标题栏拖动，限制在父容器内，
 *       位置与折叠状态按浏览器记住（localStorage，`storage-key` 区分内嵌 / 全屏两处）。</li>
 *   <li>折叠：只留标题栏与单品页签；点图放大看全图（MediaLightbox，同一件单品的其它角度一并可翻）。</li>
 *   <li>多件单品出页签「上装 / 下装 …」，选中 = 切换图层（见 ./references.ts）；调过的单品页签带小圆点。</li>
 * </ul>
 * 「自动校色」（宿主给了 cf.autoColor 且参考图带部位时出现，见 ./auto-color.ts）：按参考图求每件单品的五个滑杆值，灌进各单品图层当初值，
 * 一步可撤销；成功 / 失败 / 分数偏低的提示就在按钮下面一行。折叠时按钮仍在。
 * 参考图为空时不渲染。颜色全部走主题令牌，深色可用。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import IconButton from '@/components/IconButton/index.vue'
import MediaLightbox from '@/components/MediaLightbox/index.vue'
import type { ResultColorFix } from './useResultColorFix.ts'
import { useColorFixPieces } from './references.ts'
import { useColorFixAutoColor } from './auto-color.ts'

const { cf, storageKey = 'colorfix:ref-card' } = defineProps<{
  cf: ResultColorFix
  /** 位置 / 折叠的本机存储键（内嵌与全屏两处版面不同，各记各的） */
  storageKey?: string
}>()

const CARD_W = 288
const MARGIN = 12

const pieces = useColorFixPieces(cf)
const auto = useColorFixAutoColor(cf)
const root = ref<HTMLElement | null>(null)

// ---------------- 位置 / 折叠（按浏览器记住） ----------------

interface Saved {
  x: number
  y: number
  folded: boolean
}
function read(): Saved {
  try {
    const o = JSON.parse(localStorage.getItem(storageKey) || 'null') as Partial<Saved> | null
    if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) return { x: o.x!, y: o.y!, folded: o.folded === true }
    if (o && typeof o.folded === 'boolean') return { x: MARGIN, y: MARGIN, folded: o.folded }
  } catch {
    /* 隐私模式 / 数据坏了：用默认 */
  }
  return { x: MARGIN, y: MARGIN, folded: false }
}
function write() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ x: pos.value.x, y: pos.value.y, folded: folded.value }))
  } catch {
    /* 隐私模式：本次有效即可 */
  }
}
const init = read()
const pos = ref({ x: init.x, y: init.y })
const folded = ref(init.folded)
const width = ref(CARD_W)
const dragging = ref(false)

function parentEl(): HTMLElement | null {
  return (root.value?.offsetParent as HTMLElement | null) ?? null
}
function clampPos(x: number, y: number) {
  const el = root.value
  const parent = parentEl()
  if (!el || !parent) return { x, y }
  const maxX = Math.max(0, parent.clientWidth - el.offsetWidth)
  const maxY = Math.max(0, parent.clientHeight - el.offsetHeight)
  return { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) }
}
function fit() {
  const parent = parentEl()
  if (parent) width.value = Math.max(160, Math.min(CARD_W, parent.clientWidth - MARGIN * 2))
  void nextTick(() => (pos.value = clampPos(pos.value.x, pos.value.y)))
}

let observer: ResizeObserver | null = null
function observe() {
  observer?.disconnect()
  const parent = parentEl()
  if (!parent || typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver(fit)
  observer.observe(parent)
}
onMounted(() => {
  fit()
  observe()
})
onBeforeUnmount(() => observer?.disconnect())

let from: { px: number; py: number; x: number; y: number } | null = null
function onDown(e: PointerEvent) {
  if (e.button !== 0 && e.pointerType === 'mouse') return
  if ((e.target as HTMLElement).closest('[data-no-drag]')) return
  from = { px: e.clientX, py: e.clientY, x: pos.value.x, y: pos.value.y }
  dragging.value = true
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
}
function onMove(e: PointerEvent) {
  if (!from) return
  pos.value = clampPos(from.x + e.clientX - from.px, from.y + e.clientY - from.py)
}
function onUp() {
  if (!from) return
  from = null
  dragging.value = false
  write()
}
/** 键盘也能挪：聚焦标题栏后方向键（Shift 加大步长） */
function onKey(e: KeyboardEvent) {
  const step = e.shiftKey ? 40 : 10
  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
  if (!d) return
  e.preventDefault()
  pos.value = clampPos(pos.value.x + d[0]!, pos.value.y + d[1]!)
  write()
}
function toggleFold() {
  folded.value = !folded.value
  write()
  void nextTick(() => {
    pos.value = clampPos(pos.value.x, pos.value.y)
  })
}

// ---------------- 内容 ----------------

const list = pieces.references
const act = pieces.active
/** 当前单品选了第几张图（0 = 主图，其后是 details）；换单品回到主图 */
const shot = ref(0)
watch(pieces.activeKey, () => (shot.value = 0))

interface Shot {
  key: string
  label: string
  url: string
}
const shots = computed<Shot[]>(() => {
  const r = act.value
  if (!r) return []
  return [{ key: r.key, label: r.label, url: r.url }, ...(r.details ?? [])]
})
const shown = computed(() => shots.value[Math.min(shot.value, shots.value.length - 1)] ?? null)
const failed = ref(false)
watch(
  () => shown.value?.url,
  () => (failed.value = false),
)

const preview = ref({ show: false, index: 0 })
const previewItems = computed(() => shots.value.map((s) => ({ url: s.url, type: 'image' as const, name: `${act.value?.label ?? ''}${s.label && s.label !== act.value?.label ? ` · ${s.label}` : ''}` })))
function openLarge() {
  preview.value = { show: true, index: Math.min(shot.value, shots.value.length - 1) }
}

const multi = computed(() => list.value.length > 1)
const title = computed(() => (act.value && !multi.value ? `参考图 · ${act.value.label}` : '参考图'))
</script>

<template>
  <section
    v-if="pieces.hasReferences.value"
    ref="root"
    class="cfref absolute z-8 box-border flex flex-col rounded-12px bg-surface text-ink border border-solid border-line shadow-pop overflow-hidden"
    :class="{ 'is-dragging': dragging }"
    :style="{ left: `${pos.x}px`, top: `${pos.y}px`, width: `${width}px` }"
    aria-label="校色参考图"
    @pointerdown.stop
    @dblclick.stop
    @wheel.stop
  >
    <header
      class="cfref__head flex items-center gap-8px pl-10px pr-6px h-36px flex-none select-none touch-none sx-focus"
      :class="dragging ? 'cursor-grabbing' : 'cursor-grab'"
      tabindex="0"
      role="group"
      aria-roledescription="可拖动"
      aria-label="参考图标题栏，方向键移动位置"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @keydown="onKey"
    >
      <span class="grid grid-cols-3 gap-2px flex-none text-muted" aria-hidden="true"><i v-for="n in 6" :key="n" class="block w-3px h-3px rounded-full bg-current opacity-60" /></span>
      <b class="min-w-0 flex-1 truncate text-12px font-600 leading-18px">{{ title }}</b>
      <span data-no-drag class="flex items-center gap-8px flex-none">
        <IconButton v-if="shown && !folded" size="sm" variant="quiet" label="放大查看" @click="openLarge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
        </IconButton>
        <IconButton size="sm" variant="quiet" :label="folded ? '展开参考图' : '收起参考图'" :pressed="!folded" @click="toggleFold">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path :d="folded ? 'M6 9l6 6 6-6' : 'M6 15l6-6 6 6'" />
          </svg>
        </IconButton>
      </span>
    </header>

    <div v-if="multi" role="tablist" aria-label="单品" class="cfref__tabs flex flex-wrap gap-6px px-10px pb-8px flex-none">
      <button
        v-for="r in list"
        :key="r.key"
        type="button"
        role="tab"
        :aria-selected="r.key === pieces.activeKey.value"
        :title="pieces.adjusted(r.key) ? `${r.label}（已调整）` : r.label"
        class="cfref__tab sx-hit relative h-26px box-border px-10px rounded-full border border-solid text-12px leading-none cursor-pointer whitespace-nowrap sx-focus [transition:background_120ms,color_120ms] motion-reduce:transition-none"
        :class="
          r.key === pieces.activeKey.value
            ? 'bg-violet-solid text-white border-transparent font-600'
            : 'bg-surface2 text-ink-2 border-line hover:text-ink'
        "
        @click="pieces.select(r.key)"
      >
        {{ r.label }}
        <i
          v-if="pieces.adjusted(r.key)"
          class="absolute top--2px right--2px w-8px h-8px rounded-full bg-violet border border-solid border-surface"
          aria-hidden="true"
        />
        <span v-if="pieces.adjusted(r.key)" class="sr-only">（已调整）</span>
      </button>
    </div>

    <div v-if="auto.supported.value" class="cfref__auto flex flex-col gap-6px px-10px pb-10px flex-none">
      <button
        type="button"
        class="cfref__autobtn sx-hit sx-focus h-30px box-border px-12px rounded-8px border border-solid border-line bg-surface2 text-ink text-12px font-600 leading-none cursor-pointer inline-flex items-center justify-center gap-6px hover:border-violet disabled:cursor-progress disabled:opacity-80"
        :disabled="auto.busy.value"
        :aria-busy="auto.busy.value"
        title="按参考图自动算出每件单品的校色参数，作为各图层的初值；可继续手调，可撤销"
        @click="auto.run()"
      >
        <svg
          v-if="auto.busy.value"
          class="cfref__spin flex-none"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.4"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M21 12a9 9 0 1 1-6.2-8.55" />
        </svg>
        <svg v-else class="flex-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
        </svg>
        {{ auto.busy.value ? '正在自动校色…' : '自动校色' }}
      </button>
      <p
        v-if="auto.hint.value"
        class="cfref__autohint m-0 text-12px leading-18px"
        :class="auto.hintKind.value === 'error' ? 'text-danger' : auto.hintKind.value === 'warn' ? 'text-ink' : 'text-muted'"
        role="status"
        aria-live="polite"
      >
        {{ auto.hint.value }}
      </p>
    </div>

    <template v-if="!folded && shown">
      <button
        type="button"
        class="cfref__img relative mx-10px mb-10px p-0 rounded-8px border border-solid border-line bg-surface2 overflow-hidden cursor-zoom-in sx-focus"
        :aria-label="`放大查看${act?.label ?? ''}参考图`"
        @click="openLarge"
      >
        <img
          v-if="!failed"
          :src="shown.url"
          :alt="`${act?.label ?? ''}参考图`"
          draggable="false"
          decoding="async"
          class="block w-full h-auto max-h-300px object-contain select-none"
          @error="failed = true"
        />
        <span v-else class="grid place-items-center h-120px text-12px text-muted">参考图加载失败</span>
      </button>
      <div v-if="shots.length > 1" class="flex gap-8px px-10px pb-10px overflow-x-auto flex-none" role="group" aria-label="其它视角">
        <button
          v-for="(s, i) in shots"
          :key="s.key"
          type="button"
          :title="s.label"
          :aria-label="`查看${s.label}`"
          :aria-pressed="i === shot"
          class="sx-hit flex-none w-44px h-44px p-0 rounded-8px border-2 border-solid overflow-hidden bg-surface2 cursor-pointer sx-focus"
          :class="i === shot ? 'border-violet' : 'border-transparent'"
          @click="shot = i"
        >
          <img :src="s.url" alt="" draggable="false" loading="lazy" class="block w-full h-full object-cover" />
        </button>
      </div>
    </template>

    <MediaLightbox v-model:show="preview.show" v-model:index="preview.index" :items="previewItems" pannable />
  </section>
</template>

<style scoped lang="less">
.cfref {
  /* 拖动时不要把文字选中；落下后恢复阴影 */
  &.is-dragging {
    user-select: none;
  }
}
@media (prefers-reduced-motion: no-preference) {
  .cfref {
    transition: box-shadow 140ms;
  }
  .cfref__spin {
    animation: cfref-spin 0.9s linear infinite;
  }
}
@keyframes cfref-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
