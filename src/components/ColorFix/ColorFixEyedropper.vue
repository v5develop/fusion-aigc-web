<script setup lang="ts">
/**
 * 吸取源色（替换颜色用，2026-11-11）：弹窗里铺原图，悬停实时显示指针下的颜色（3×3 平均，避开噪点），单击取色并关闭。
 * 取的是原图像素（不是校色后的），与「源色 = 选区里现在的颜色」口径一致。图读不了像素时提示，不能取。
 * 中性灰吸管（更多调整 · 白平衡）复用本弹窗：传 title / hint。
 * 键盘：方向键移动取色点（Shift 加速），回车取色，Esc 关闭。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { corsAttr, markCorsBlocked } from '@/utils/colorfix.ts'
import { toHex } from '@/utils/colorfix-math.ts'

const { src, title = '吸取源色', hint = '' } = defineProps<{
  src: string
  title?: string
  /** 说明文字（不传 = 吸取源色的那句） */
  hint?: string
}>()
const show = defineModel<boolean>('show', { required: true })
const emit = defineEmits<{ pick: [hex: string] }>()

const imgEl = ref<HTMLImageElement | null>(null)
const error = ref('')
const hoverHex = ref('')
/** 取色点（图片显示坐标 0–1） */
const cursor = ref<{ x: number; y: number } | null>(null)
let pixels: { data: Uint8ClampedArray; w: number; h: number } | null = null

const SAMPLE_SIDE = 1024

function readPixels() {
  const el = imgEl.value
  if (!el || !el.naturalWidth) return
  try {
    const s = Math.min(1, SAMPLE_SIDE / Math.max(el.naturalWidth, el.naturalHeight))
    const w = Math.max(1, Math.round(el.naturalWidth * s))
    const h = Math.max(1, Math.round(el.naturalHeight * s))
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('画布不可用')
    ctx.drawImage(el, 0, 0, w, h)
    pixels = { data: ctx.getImageData(0, 0, w, h).data, w, h }
    c.width = c.height = 0
    error.value = ''
  } catch {
    pixels = null
    error.value = '这张图片不允许读取像素，无法吸取颜色；可以直接在「自动」或色板里选'
  }
}

function sample(x: number, y: number): string {
  const p = pixels
  if (!p) return ''
  const cx = Math.min(p.w - 1, Math.max(0, Math.round(x * p.w)))
  const cy = Math.min(p.h - 1, Math.max(0, Math.round(y * p.h)))
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const xx = cx + dx
      const yy = cy + dy
      if (xx < 0 || yy < 0 || xx >= p.w || yy >= p.h) continue
      const i = (yy * p.w + xx) * 4
      if (p.data[i + 3]! < 8) continue
      r += p.data[i]!
      g += p.data[i + 1]!
      b += p.data[i + 2]!
      n++
    }
  return n ? toHex(r / n, g / n, b / n) : ''
}

function rel(e: PointerEvent | MouseEvent) {
  const r = imgEl.value?.getBoundingClientRect()
  if (!r || !r.width) return null
  return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
}
function onMove(e: PointerEvent) {
  const p = rel(e)
  if (!p) return
  cursor.value = p
  hoverHex.value = sample(p.x, p.y)
}
function onClick(e: MouseEvent) {
  const p = rel(e)
  if (!p) return
  pick(sample(p.x, p.y))
}
function pick(hex: string) {
  if (!hex) return
  emit('pick', hex)
  show.value = false
}
function onKey(e: KeyboardEvent) {
  const step = e.shiftKey ? 0.05 : 0.01
  const c = cursor.value ?? { x: 0.5, y: 0.5 }
  let next = c
  if (e.key === 'ArrowLeft') next = { x: c.x - step, y: c.y }
  else if (e.key === 'ArrowRight') next = { x: c.x + step, y: c.y }
  else if (e.key === 'ArrowUp') next = { x: c.x, y: c.y - step }
  else if (e.key === 'ArrowDown') next = { x: c.x, y: c.y + step }
  else if (e.key === 'Enter') {
    e.preventDefault()
    pick(hoverHex.value || sample(c.x, c.y))
    return
  } else return
  e.preventDefault()
  e.stopPropagation()
  next = { x: Math.min(1, Math.max(0, next.x)), y: Math.min(1, Math.max(0, next.y)) }
  cursor.value = next
  hoverHex.value = sample(next.x, next.y)
}

watch(show, (v) => {
  if (!v) {
    hoverHex.value = ''
    cursor.value = null
  }
})
onBeforeUnmount(() => {
  pixels = null
})

const cursorStyle = computed(() =>
  cursor.value ? { left: `${cursor.value.x * 100}%`, top: `${cursor.value.y * 100}%` } : undefined,
)
</script>

<template>
  <!-- 弹层根节点必须是 div：naive 的焦点圈定按「起始哨兵后第一个 DIV」认内容区，section 会让焦点进不来 -->
  <n-modal v-model:show="show" transform-origin="center">
    <div
      class="w-[min(760px,calc(100vw-32px))] max-h-[calc(100vh-48px)] overflow-y-auto box-border p-16px rounded-14px bg-white shadow-[0_18px_40px_-16px_rgba(30,41,59,0.32)] flex flex-col gap-10px"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
    >
      <header class="flex items-center gap-8px">
        <b class="flex-1 text-14px font-600 leading-20px text-ink">{{ title }}</b>
        <span class="inline-flex items-center gap-6px text-12px text-ink-2 tabular-nums" role="status" aria-live="polite">
          <span
            class="inline-block w-18px h-18px rounded-5px border border-solid border-black/15"
            :style="{ background: hoverHex || 'transparent' }"
            aria-hidden="true"
          />
          {{ hoverHex || '移到图上看颜色' }}
        </span>
        <button type="button" class="sx-btn" @click="show = false">取消</button>
      </header>
      <p class="m-0 text-12px leading-18px text-muted">
        {{ hint || '单击图上要替换的那种颜色（如衣服的主色）。方向键可微调位置，回车取色。' }}
      </p>
      <p v-if="error" class="m-0 px-12px py-8px rounded-12px bg-danger-soft text-12px leading-18px text-danger" role="alert">
        {{ error }}
      </p>
      <div
        class="flex justify-center rounded-12px bg-[repeating-conic-gradient(#f3f4f6_0%_25%,#fff_0%_50%)] bg-[length:16px_16px] p-8px"
      >
        <div
          class="relative inline-block outline-none focus-visible:(outline outline-2 outline-solid outline-violet outline-offset-2)"
          tabindex="0"
          role="application"
          aria-label="图片取色区：方向键移动，回车取色"
          @keydown="onKey"
        >
          <img
            ref="imgEl"
            :src="src"
            :crossorigin="corsAttr(src)"
            :alt="title"
            draggable="false"
            class="block max-w-full max-h-[min(62vh,640px)] cursor-crosshair select-none"
            @load="readPixels"
            @error="markCorsBlocked(src)"
            @pointermove="onMove"
            @pointerleave="hoverHex = cursor ? hoverHex : ''"
            @click="onClick"
          />
          <span
            v-if="cursorStyle"
            class="cfe-cursor"
            :style="[cursorStyle, { background: hoverHex || 'transparent' }]"
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
  </n-modal>
</template>

<style scoped lang="less">
.cfe-cursor {
  position: absolute;
  width: 22px;
  height: 22px;
  box-sizing: border-box;
  border: 2px solid #fff;
  border-radius: 50%;
  box-shadow:
    0 0 0 1px rgba(31, 35, 41, 0.45),
    0 2px 6px rgba(0, 0, 0, 0.3);
  pointer-events: none;
  transform: translate(-50%, -50%);
}
</style>
