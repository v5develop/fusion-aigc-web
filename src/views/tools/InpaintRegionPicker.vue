<script setup lang="ts">
/**
 * 局部重绘的框选区域：在原图上按住拖出一个矩形，标出要重绘的地方。
 *
 * <p>矩形按原图显示区域换成 0–1 比例存（与原图像素尺寸无关，不读像素，跨域图也不受影响），
 * 出网时由 inpaint.ts 换成 Java 要的 4 个比例点。最多 2 张图（契约 images 1–2 项），每张图各框一个区域：
 * 两张图时上方是「图 1 / 图 2」分段切换，点哪张就在哪张上框。再拖一次 = 重新框选，「清除」= 去掉当前图的区域。
 *
 * <p>键盘：画面获得焦点后，Enter 放一个居中区域，方向键移动、Shift + 方向键调整大小，Delete / Backspace 清除。
 */
import { computed, ref, useId, watch } from 'vue'
import { boxFromCorners, type InpaintBox, type InpaintBoxes, type RatioPoint } from './inpaint'

const props = defineProps<{
  /** 已上传的原图（按上传顺序） */
  urls: string[]
  disabled?: boolean
  required?: boolean
  label?: string
}>()
const boxes = defineModel<InpaintBoxes>({ required: true })

const uid = useId()
const hintId = `inpaint-hint-${uid}`
const labelId = `inpaint-label-${uid}`

/** 小于这个比例的拖动当作误触，不改原来的区域 */
const MIN_SIZE = 0.02
/** 键盘一步 2%；Enter 放的居中区域占一半 */
const STEP = 0.02
const DEFAULT_SIZE = 0.5

const active = ref(0)
const activeUrl = computed(() => props.urls[active.value] ?? props.urls[0] ?? '')
const activeBox = computed(() => (activeUrl.value ? boxes.value[activeUrl.value] : undefined))
const doneCount = computed(() => props.urls.filter((u) => boxes.value[u]).length)

// 删图 / 换图后：当前序号落回范围内，对不上地址的区域作废
watch(
  () => props.urls,
  (urls) => {
    if (active.value >= urls.length) active.value = Math.max(0, urls.length - 1)
    const stale = Object.keys(boxes.value).filter((u) => !urls.includes(u))
    if (stale.length) {
      const next = { ...boxes.value }
      for (const u of stale) delete next[u]
      boxes.value = next
    }
  },
  { deep: true },
)

function setBox(box: InpaintBox | undefined) {
  const url = activeUrl.value
  if (!url) return
  const next = { ...boxes.value }
  if (box) next[url] = box
  else delete next[url]
  boxes.value = next
}

// ---------------- 拖拽框选 ----------------

const surfaceRef = ref<HTMLElement | null>(null)
const loaded = ref(false)
watch(activeUrl, () => (loaded.value = false))

/** 拖动中的矩形（松手才写回 v-model，拖到一半不触发表单校验） */
const draft = ref<InpaintBox | null>(null)
let origin: RatioPoint | null = null

function toRatio(e: PointerEvent): RatioPoint {
  const rect = surfaceRef.value!.getBoundingClientRect()
  const clamp = (n: number) => Math.min(1, Math.max(0, n))
  return { x: clamp((e.clientX - rect.left) / rect.width), y: clamp((e.clientY - rect.top) / rect.height) }
}

function onPointerDown(e: PointerEvent) {
  if (props.disabled || !loaded.value || e.button !== 0) return
  surfaceRef.value?.setPointerCapture(e.pointerId)
  origin = toRatio(e)
  draft.value = boxFromCorners(origin, origin)
}

function onPointerMove(e: PointerEvent) {
  if (!origin) return
  draft.value = boxFromCorners(origin, toRatio(e))
}

function onPointerUp() {
  const box = draft.value
  origin = null
  draft.value = null
  if (box && box.right - box.left >= MIN_SIZE && box.bottom - box.top >= MIN_SIZE) setBox(box)
}

const shownBox = computed(() => draft.value ?? activeBox.value ?? null)
const boxStyle = computed(() => {
  const b = shownBox.value
  if (!b) return undefined
  return {
    left: `${b.left * 100}%`,
    top: `${b.top * 100}%`,
    width: `${(b.right - b.left) * 100}%`,
    height: `${(b.bottom - b.top) * 100}%`,
  }
})

const pct = (n: number) => `${Math.round(n * 100)}%`
const readout = computed(() => {
  const b = shownBox.value
  return b ? `区域约占 宽 ${pct(b.right - b.left)} · 高 ${pct(b.bottom - b.top)}` : '尚未框选'
})

// ---------------- 键盘 ----------------

function onKeydown(e: KeyboardEvent) {
  if (props.disabled || !loaded.value) return
  const b = activeBox.value
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    if (!b) {
      const m = (1 - DEFAULT_SIZE) / 2
      setBox({ left: m, top: m, right: 1 - m, bottom: 1 - m })
    }
    return
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && b) {
    e.preventDefault()
    setBox(undefined)
    return
  }
  const delta: Record<string, [number, number]> = {
    ArrowLeft: [-STEP, 0],
    ArrowRight: [STEP, 0],
    ArrowUp: [0, -STEP],
    ArrowDown: [0, STEP],
  }
  const d = delta[e.key]
  if (!d || !b) return
  e.preventDefault()
  const [dx, dy] = d
  if (e.shiftKey) {
    // 调整大小：拖动右下角，不小于最小尺寸、不出图
    setBox({
      ...b,
      right: Math.min(1, Math.max(b.left + MIN_SIZE, b.right + dx)),
      bottom: Math.min(1, Math.max(b.top + MIN_SIZE, b.bottom + dy)),
    })
    return
  }
  // 平移：整体挪动，碰边停住
  const w = b.right - b.left
  const h = b.bottom - b.top
  const left = Math.min(1 - w, Math.max(0, b.left + dx))
  const top = Math.min(1 - h, Math.max(0, b.top + dy))
  setBox({ left, top, right: left + w, bottom: top + h })
}

/** 框的四个角标（纯装饰） */
const CORNERS = ['-left-5px -top-5px', '-right-5px -top-5px', '-right-5px -bottom-5px', '-left-5px -bottom-5px']

const pillCls =
  'll-pill !min-h-32px !text-13px outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)'
</script>

<template>
  <div class="flex flex-col gap-8px">
    <div class="ll-label">
      <span :id="labelId"
        >{{ label ?? '重绘区域' }}<span v-if="required" class="text-danger" aria-hidden="true"> *</span></span
      >
      <span v-if="urls.length" class="text-12px text-placeholder tabular-nums" aria-live="polite">
        已框选 {{ doneCount }} / {{ urls.length }}
      </span>
    </div>

    <p v-if="!urls.length" class="m-0 ll-empty py-12px">先上传原图，再在图上拖出要重绘的区域</p>

    <template v-else>
      <!-- 两张图：分段切换（spec .sx-seg--picker：轨道 3 内边距、选项高 30 / r4） -->
      <div
        v-if="urls.length > 1"
        role="tablist"
        :aria-labelledby="labelId"
        class="flex gap-3px p-3px rounded-6px bg-surface3 shadow-inset-input"
      >
        <button
          v-for="(u, i) in urls"
          :key="u"
          type="button"
          role="tab"
          :aria-selected="i === active"
          class="flex-1 min-w-0 flex items-center justify-center gap-6px h-30px px-14px box-border rounded-4px border border-solid text-12px cursor-pointer transition-colors outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)"
          :class="
            i === active
              ? 'border-violet-line bg-[linear-gradient(var(--xq-surface),var(--xq-violet-tint))] shadow-[0_1px_2px_rgba(31,35,41,0.05)] text-violet-ink font-600'
              : 'border-transparent bg-transparent text-ink-2 hover:text-ink'
          "
          @click="active = i"
        >
          <img :src="u" alt="" class="w-18px h-18px rounded-3px object-cover flex-none" draggable="false" />
          <span>图 {{ i + 1 }}</span>
          <span
            class="w-6px h-6px rounded-full flex-none"
            :class="boxes[u] ? 'bg-violet' : 'bg-control'"
            aria-hidden="true"
          />
          <span class="sr-only">{{ boxes[u] ? '已框选' : '未框选' }}</span>
        </button>
      </div>

      <!-- 画面：深色衬底让任何底色的原图都看得清框；框外压暗，框内保持原样 -->
      <div
        class="flex justify-center rounded-8px border border-solid border-line bg-[#2a2d33] bg-[linear-gradient(45deg,#30333a_25%,transparent_25%,transparent_75%,#30333a_75%),linear-gradient(45deg,#30333a_25%,transparent_25%,transparent_75%,#30333a_75%)] bg-[length:20px_20px] bg-[position:0_0,10px_10px] p-8px box-border overflow-hidden"
      >
        <div class="relative max-w-full">
          <img
            :key="activeUrl"
            :src="activeUrl"
            :alt="urls.length > 1 ? `原图 ${active + 1}` : '原图'"
            class="block max-w-full max-h-420px w-auto h-auto select-none rounded-4px"
            draggable="false"
            @load="loaded = true"
          />
          <div
            v-if="loaded"
            ref="surfaceRef"
            tabindex="0"
            role="group"
            :aria-label="`框选重绘区域：${readout}`"
            :aria-describedby="hintId"
            :aria-disabled="disabled || undefined"
            class="absolute inset-0 overflow-hidden rounded-4px touch-none select-none outline-none focus-visible:shadow-focus focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)"
            :class="disabled ? 'cursor-not-allowed' : 'cursor-crosshair'"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
            @keydown="onKeydown"
          >
            <div
              v-if="boxStyle"
              class="absolute box-border border-2 border-solid border-#fff rounded-2px pointer-events-none shadow-[0_0_0_1px_var(--xq-violet),0_0_0_9999px_rgba(31,35,41,0.48)]"
              :style="boxStyle"
            >
              <span
                class="absolute left-0 top-0 px-6px h-18px flex items-center text-11px font-600 leading-none text-white bg-violet-solid rounded-br-4px whitespace-nowrap"
                >重绘区域</span
              >
              <span
                v-for="c in CORNERS"
                :key="c"
                class="absolute w-8px h-8px box-border rounded-2px bg-#fff border-1.5px border-solid border-violet"
                :class="c"
                aria-hidden="true"
              />
            </div>
            <span
              v-else
              class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 px-12px h-30px flex items-center rounded-full bg-[rgba(31,35,41,0.62)] text-12px text-white whitespace-nowrap pointer-events-none"
              aria-hidden="true"
            >
              按住拖动，框出要重绘的区域
            </span>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-10px text-12px text-ink-2">
        <span class="flex-1 min-w-0 truncate tabular-nums">{{ readout }}</span>
        <button type="button" :class="pillCls" :disabled="disabled || !activeBox" @click="setBox(undefined)">
          清除
        </button>
      </div>
      <p :id="hintId" class="sr-only">
        在画面上按住拖动框出区域，再拖一次即重新框选。键盘：Enter 放一个居中区域，方向键移动，Shift
        加方向键调整大小，Delete 清除。
      </p>
    </template>
  </div>
</template>
