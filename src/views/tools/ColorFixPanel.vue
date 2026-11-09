<script setup lang="ts">
/**
 * 服装校色 · 悬浮参数台（原型 components/tool/ColorFixPanel.vue 2026-11-05 第二版；工具页与商拍工作室共用这一块）。
 *
 * <p>定位：`position: absolute`，相对最近的定位祖先（结果列 / 结果卡，父级需 `relative`）——
 * 打开时贴右缘 12px、垂直居中（避开顶部视图切换与底部候选条）；按住标题栏可拖，位置夹在这一列内，
 * 窗口 / 列尺寸变化时重新夹回。拖动中加深投影；进场 160/200ms 上浮 6px + 0.99 缩放，离场 120ms 淡出，
 * 减少动态效果时不做过渡。
 *
 * <p>数值：宽 364、r13、1px line、柔紫径向渐变 + 97% 白、模糊 10；头部 40 高 + 底部 1px 分隔线、2×3 拖动点、
 * 标题「服装校色」13/600、关闭 26 r6（悬停 #f2eef5，命中区外扩到 34）；滑杆区 gap 5 / 内边距 9 12 2；
 * 底行虚线 #ece7f0 分隔、脚注 11px、「恢复默认 / 完成」视觉 24 高 r12（命中区外扩到 32），完成 #8b64a0 描边 + #966baa→#83598f。
 *
 * <p>参数 v-model 双向；「恢复默认」把参数改回 defaults 并发 reset（与默认相同时禁用）；「完成」与 × 都发 done。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ColorFixSlider from '@/views/studio/colorfix/ColorFixSlider.vue'
import { COLORFIX_DEFAULT, COLORFIX_RANGES, colorFixEquals, type ColorFixParams } from '@/utils/colorfix.ts'

const props = withDefaults(
  defineProps<{
    /** 是否显示（保留过渡动画用；不传 = 显示，兼容外层 v-if 的老写法） */
    open?: boolean
    /** 「恢复默认」恢复到的那组值 */
    defaults?: ColorFixParams
  }>(),
  { open: true, defaults: () => ({ ...COLORFIX_DEFAULT }) },
)

const params = defineModel<ColorFixParams>({ required: true })

const emit = defineEmits<{
  /** 点了「完成」或 × */
  done: []
  /** 点了「恢复默认」（参数已改回 defaults） */
  reset: []
}>()

const R = COLORFIX_RANGES
const root = ref<HTMLElement | null>(null)
const pos = ref({ x: 0, y: 0 })
const placed = ref(false)
const dragging = ref(false)
let dragStart = { x: 0, y: 0, px: 0, py: 0 }
let observer: ResizeObserver | null = null

function parentEl(): HTMLElement | null {
  return (root.value?.offsetParent as HTMLElement | null) ?? null
}

function parentBox(): { w: number; h: number } {
  const parent = parentEl()
  return { w: parent?.clientWidth ?? 0, h: parent?.clientHeight ?? 0 }
}

function clamp(x: number, y: number) {
  const el = root.value
  if (!el) return { x, y }
  const { w, h } = parentBox()
  const maxX = Math.max(0, w - el.offsetWidth)
  const maxY = Math.max(0, h - el.offsetHeight)
  return { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) }
}

/** 默认落点：贴右缘 12、垂直居中（原型 2026-11-06：右下角会盖住候选条） */
function placeDefault() {
  const el = root.value
  if (!el) return
  const { w, h } = parentBox()
  pos.value = clamp(w - el.offsetWidth - 12, Math.max(12, Math.round((h - el.offsetHeight) / 2)))
  placed.value = true
}

function observeParent() {
  observer?.disconnect()
  const parent = parentEl()
  if (!parent || typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver(() => {
    if (props.open && placed.value) pos.value = clamp(pos.value.x, pos.value.y)
  })
  observer.observe(parent)
}

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      // placed 留到离场动画结束（onAfterLeave）再复位：这里清掉会立刻 visibility:hidden，离场淡出看不到
      observer?.disconnect()
      return
    }
    await nextTick()
    placeDefault()
    observeParent()
  },
  { immediate: true },
)

/** 离场动画结束：复位落点标记，下次打开重新量；离场期间又打开了（open 已回 true）就不动 */
function onAfterLeave() {
  if (!props.open) placed.value = false
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  // 头部里的按钮（×）不起拖，否则会吞掉它的 click
  if ((event.target as HTMLElement).closest('button')) return
  dragging.value = true
  dragStart = { x: event.clientX, y: event.clientY, px: pos.value.x, py: pos.value.y }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value) return
  pos.value = clamp(dragStart.px + (event.clientX - dragStart.x), dragStart.py + (event.clientY - dragStart.y))
}

function stopDrag() {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
}

function onPointerUp() {
  if (!dragging.value) return
  dragging.value = false
  stopDrag()
}

function onResize() {
  if (!props.open || !placed.value) return
  pos.value = clamp(pos.value.x, pos.value.y)
}

onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  stopDrag()
  observer?.disconnect()
})

/** 系统给的值就是 defaults；改过之后才允许「恢复默认」 */
const valuesMoved = computed(() => !colorFixEquals(params.value, props.defaults))

function setParam(key: keyof ColorFixParams, value: number) {
  params.value = { ...params.value, [key]: value }
}

function reset() {
  params.value = { ...props.defaults }
  emit('reset')
}

const SLIDERS: { key: keyof ColorFixParams; label: string }[] = [
  { key: 'hue', label: '色相' },
  { key: 'sat', label: '饱和度' },
  { key: 'light', label: '明度' },
  { key: 'bright', label: '亮度' },
  { key: 'contrast', label: '对比度' },
]
</script>

<template>
  <Transition name="cfp" @after-leave="onAfterLeave">
    <section
      v-if="open"
      ref="root"
      class="cfp"
      :class="{ 'is-dragging': dragging, 'is-placed': placed }"
      :style="{ left: `${pos.x}px`, top: `${pos.y}px` }"
      aria-label="服装校色参数"
    >
      <header class="cfp__head" title="拖动调整面板" @pointerdown="onPointerDown">
        <span class="cfp__grip" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>
        <b class="cfp__title">服装校色</b>
        <button type="button" class="cfp__close sx-hit" aria-label="收起校色参数" title="收起校色参数" @click="emit('done')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <path d="m7 7 10 10M17 7 7 17" />
          </svg>
        </button>
      </header>

      <div class="cfp__sliders">
        <ColorFixSlider
          v-for="s in SLIDERS"
          :key="s.key"
          :model-value="params[s.key]"
          :label="s.label"
          :tone="s.key"
          :min="R[s.key].min"
          :max="R[s.key].max"
          @update:model-value="setParam(s.key, $event)"
        />
      </div>

      <footer class="cfp__foot">
        <span class="cfp__hint">参数只作用于当前结果，可随时恢复默认</span>
        <button type="button" class="cfp__btn sx-hit" :disabled="!valuesMoved" @click="reset">恢复默认</button>
        <button type="button" class="cfp__btn sx-hit is-primary" @click="emit('done')">完成</button>
      </footer>
    </section>
  </Transition>
</template>

<style scoped lang="less">
/* 浮层材质 / 过渡 / 拖动态是多状态组合选择器，按原型数值落 scoped 样式 */
.cfp {
  position: absolute;
  z-index: 20;
  display: flex;
  width: 364px;
  max-width: calc(100% - 24px);
  box-sizing: border-box;
  flex-direction: column;
  border: 1px solid #e5e7eb;
  border-radius: 13px;
  background:
    radial-gradient(120% 90% at 100% 0%, rgba(150, 107, 170, 0.1), transparent 62%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.97), rgba(250, 249, 252, 0.97));
  box-shadow:
    0 18px 40px -16px rgba(30, 41, 59, 0.32),
    0 4px 12px rgba(31, 35, 41, 0.1),
    inset 0 1px 0 #fff;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  user-select: none;
  transition: box-shadow 0.16s ease;
}
/* 首帧还没量到落点：先藏起来，免得在左上角闪一下 */
.cfp:not(.is-placed) {
  visibility: hidden;
}
.cfp.is-dragging {
  box-shadow:
    0 24px 50px -18px rgba(30, 41, 59, 0.38),
    0 6px 16px rgba(31, 35, 41, 0.12);
}
.cfp-enter-active {
  transition:
    opacity 0.16s ease,
    transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.cfp-leave-active {
  transition: opacity 0.12s ease;
}
.cfp-enter-from {
  opacity: 0;
  transform: translateY(6px) scale(0.99);
}
.cfp-leave-to {
  opacity: 0;
}

.cfp__head {
  display: flex;
  height: 40px;
  flex: 0 0 40px;
  box-sizing: border-box;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid #e5e7eb;
  cursor: grab;
  touch-action: none;
}
.cfp.is-dragging .cfp__head {
  cursor: grabbing;
}
.cfp__grip {
  display: grid;
  grid-template-columns: repeat(2, 3px);
  gap: 2px;
  margin-right: 1px;
}
.cfp__grip i {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #c9bfd1;
}
.cfp__title {
  min-width: 0;
  flex: 1;
  color: #1f2329;
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
}
.cfp__close {
  display: grid;
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #9aa1aa;
  cursor: pointer;
  transition:
    background 0.12s ease,
    color 0.12s ease;
}
.cfp__close svg {
  width: 14px;
  height: 14px;
}
.cfp__close:hover {
  background: #f2eef5;
  color: #6b487c;
}
.cfp__close:focus-visible,
.cfp__btn:focus-visible {
  outline: 2px solid #875f9a;
  outline-offset: 2px;
}

.cfp__sliders {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 9px 12px 2px;
}

.cfp__foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 12px;
  padding: 8px 0 10px;
  border-top: 1px dashed #ece7f0;
  cursor: default;
}
.cfp__hint {
  min-width: 0;
  flex: 1;
  color: #9aa1aa;
  font-size: 11px;
  line-height: 16px;
}
.cfp__btn {
  height: 24px;
  flex: 0 0 auto;
  box-sizing: border-box;
  padding: 0 10px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: linear-gradient(#fff, #f7f8f9);
  color: #4a5059;
  font: inherit;
  font-size: 11px;
  line-height: 22px;
  white-space: nowrap;
  cursor: pointer;
}
.cfp__btn:hover:not(:disabled) {
  border-color: #c9cfd6;
}
.cfp__btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.cfp__btn.is-primary {
  border-color: #8b64a0;
  background: linear-gradient(180deg, #966baa, #83598f);
  color: #fff;
  font-weight: 600;
}
.cfp__btn.is-primary:hover {
  filter: brightness(1.05);
}
@media (prefers-reduced-motion: reduce) {
  .cfp,
  .cfp__close,
  .cfp-enter-active,
  .cfp-leave-active {
    transition: none;
  }
}
</style>
