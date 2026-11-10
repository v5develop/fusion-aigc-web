<script setup lang="ts">
/**
 * 产品替换图台的连线（原型 ProductPipeSlots 定稿版的「管子」）：每个底图格各拉一条曲线回到上方的替换素材。
 *
 * <p>只按 DOM 标记量位置，不碰上传数据：素材格 `[data-pr-anchor]`，底图格 `[data-pr-base]`（空位 / 添加格再带 `data-pr-hint`，画虚线）。
 * 线 = 淡晕 3.4 + 细芯 1，压在卡壳之上、底图片之下（片子 z-2，线 z-1）；有图的线上一段柔光从素材流向底图，轮流点亮，
 * 系统开了「减少动态效果」时不流动、不轮换，只留静态细线。根容器尺寸变了、格子增删了都会重画。
 */
import { onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{ root: HTMLElement | null }>()

interface Link {
  key: string
  d: string
  hint: boolean
}
const links = ref<Link[]>([])
const size = ref({ w: 0, h: 0 })
const lit = ref(-1)

function build() {
  const root = props.root
  const anchor = root?.querySelector<HTMLElement>('[data-pr-anchor]')
  if (!root || !anchor) {
    links.value = []
    return
  }
  const r = root.getBoundingClientRect()
  const a = anchor.getBoundingClientRect()
  size.value = { w: r.width, h: r.height }
  const ax = a.left + a.width / 2 - r.left
  const ay = a.bottom - r.top
  links.value = [...root.querySelectorAll<HTMLElement>('[data-pr-base]')].map((el, i) => {
    const b = el.getBoundingClientRect()
    const cx = b.left + b.width / 2 - r.left
    const top = b.top - r.top
    const span = Math.max(20, (top - ay) * 0.52)
    const f = (n: number) => n.toFixed(1)
    return {
      key: `${i}`,
      hint: el.hasAttribute('data-pr-hint'),
      d: `M ${f(ax)} ${f(ay)} C ${f(ax)} ${f(ay + span)} ${f(cx)} ${f(top - span)} ${f(cx)} ${f(top)}`,
    }
  })
}

let raf = 0
function schedule() {
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(build)
}

const reduce = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
let timer: ReturnType<typeof setInterval> | undefined
function cycle() {
  if (timer) clearInterval(timer)
  timer = undefined
  lit.value = -1
  if (reduce?.matches) return
  timer = setInterval(() => {
    const real = links.value.map((l, i) => (l.hint ? -1 : i)).filter((i) => i >= 0)
    if (!real.length) {
      lit.value = -1
      return
    }
    const at = real.indexOf(lit.value)
    lit.value = real[(at + 1) % real.length]!
  }, 700)
}
reduce?.addEventListener?.('change', cycle)

let ro: ResizeObserver | null = null
let mo: MutationObserver | null = null
watch(
  () => props.root,
  (el) => {
    ro?.disconnect()
    mo?.disconnect()
    if (!el) return
    ro = new ResizeObserver(schedule)
    ro.observe(el)
    mo = new MutationObserver(schedule)
    mo.observe(el, { childList: true, subtree: true })
    schedule()
    cycle()
  },
  { immediate: true, flush: 'post' },
)
onBeforeUnmount(() => {
  ro?.disconnect()
  mo?.disconnect()
  cancelAnimationFrame(raf)
  if (timer) clearInterval(timer)
  reduce?.removeEventListener?.('change', cycle)
})
</script>

<template>
  <svg
    class="tpl-lines absolute left-0 top-0 z-1 overflow-visible pointer-events-none"
    :width="size.w"
    :height="size.h"
    :viewBox="`0 0 ${size.w} ${size.h}`"
    aria-hidden="true"
  >
    <g v-for="(l, i) in links" :key="l.key" :class="{ 'is-hint': l.hint, 'is-lit': lit === i }">
      <path class="tpl-halo" :d="l.d" />
      <path class="tpl-core" :d="l.d" />
      <path v-if="!l.hint" class="tpl-light" :d="l.d" pathLength="100" />
    </g>
  </svg>
</template>

<style scoped>
.tpl-halo {
  fill: none;
  stroke: rgba(107, 72, 124, 0.07);
  stroke-width: 3.4;
  stroke-linecap: round;
}
.tpl-core {
  fill: none;
  stroke: rgba(40, 34, 46, 0.2);
  stroke-width: 1;
  stroke-linecap: round;
  transition: stroke 0.25s ease;
}
.is-hint .tpl-core {
  stroke: rgba(40, 34, 46, 0.16);
  stroke-dasharray: 4 5;
}
.is-hint .tpl-halo {
  stroke: rgba(107, 72, 124, 0.05);
}
.is-lit .tpl-core {
  stroke: rgba(107, 72, 124, 0.42);
}
.tpl-light {
  fill: none;
  stroke: rgba(138, 99, 168, 0.5);
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-dasharray: 14 86;
  opacity: 0;
  transition: opacity 0.25s ease;
  animation: tpl-flow 2.2s linear infinite;
}
.is-lit .tpl-light {
  opacity: 1;
}
@keyframes tpl-flow {
  from {
    stroke-dashoffset: 0;
  }
  to {
    stroke-dashoffset: -100;
  }
}
@media (prefers-reduced-motion: reduce) {
  .tpl-light {
    display: none;
    animation: none;
  }
  .tpl-core {
    transition: none;
  }
}
</style>
