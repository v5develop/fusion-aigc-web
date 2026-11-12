<script setup lang="ts">
/**
 * 全屏调色（2026-11-11）：整屏层里左边大图（ColorFixZoomView：校色后 / 原图 / 对比滑杆 + 缩放平移 + 选区示意），
 * 右边停靠完整的校色参数台（ColorFixResultPanel docked：滑杆、选区 整图 / 自动识别 / 手动涂抹 / 点选，涂抹与点选弹窗用大尺寸）。
 *
 * <p>状态全部是传进来的同一份 cf（useResultColorFix）：进入 = cf.openFullscreen()，退出 = cf.closeFullscreen()，
 * 编辑原样留在页面上；全屏开着时页面上那份参数台自动让位（见 ColorFixResultPanel）。参数台「完成」（cf.close()）
 * 或别处收起参数台（如保存为新版本成功）= 一并退出全屏。
 *
 * <p>键盘：Esc / F 退出；+ / − 缩放、0 适应、1 = 100%；对比分割线聚焦后 ← / →。NModal 负责焦点圈定与退出后焦点归还，
 * 涂抹 / 点选弹窗开在它上面，Esc 只关最上层。
 *
 *   <ColorFixFullscreen :cf="cf" title="资产校色" v-model:mode="fixMode">
 *     <template #actions><button class="sx-btn-primary" @click="save">保存为新版本</button></template>
 *   </ColorFixFullscreen>
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { NModal } from 'naive-ui'
import IconButton from '@/components/IconButton/index.vue'
import { COLORFIX_MASK_LOAD_FAILED } from '@/utils/colorfix.ts'
import ColorFixResultPanel from './ColorFixResultPanel.vue'
import ColorFixZoomView from './ColorFixZoomView.vue'
import ColorFixReferenceCard from './ColorFixReferenceCard.vue'
import type { ResultColorFix } from './useResultColorFix.ts'
import type { ColorFixViewMode } from './types.ts'
import { MASK_VIEW_HINTS, MASK_VIEW_LABELS, type MaskViewMode } from './selection-ops.ts'
import { activeTheme } from '@/utils/themePrefs.ts'

const {
  cf,
  title = '图片校色',
  labels = ['原图', '校色后'],
  localAdjust = true,
} = defineProps<{
  cf: ResultColorFix
  title?: string
  /** 对比两侧 / 查看方式的名字：[原图, 校色后] */
  labels?: [string, string]
  /** 显示「选区」（局部调色）区块 */
  localAdjust?: boolean
}>()

const mode = defineModel<ColorFixViewMode>('mode', { default: 'result' })

defineSlots<{
  /** 顶栏右侧的宿主动作（保存为新版本 / 生成校色节点 / 下载等） */
  actions?: () => unknown
}>()

const zoom = ref<InstanceType<typeof ColorFixZoomView> | null>(null)
const show = computed(() => cf.fullscreen.value && !!cf.src.value)

const MODES = computed(() => [
  { key: 'result' as const, label: labels[1], hint: '显示调色后的效果' },
  { key: 'original' as const, label: labels[0], hint: '显示调色前的原图' },
  { key: 'compare' as const, label: '对比', hint: '拖动分割线对比原图与校色后' },
])

// ---------------- 选区示意：新选区出来时亮 1.6s；「显示选区」可常亮 ----------------

const maskPinned = ref(false)
const maskFlash = ref(false)
let flashTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => cf.effectiveMask.value,
  (m, prev) => {
    if (!show.value || !m || m === prev) return
    maskFlash.value = true
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => (maskFlash.value = false), 1600)
  },
)
const hasMask = computed(() => cf.region.value.mode !== 'whole' && !!cf.effectiveMask.value)
const showMask = computed(() => hasMask.value && (maskPinned.value || maskFlash.value))

/** 「显示选区」的查看方式（与智能选区弹窗共用，按浏览器记住）；新选区闪一下时一律用叠加 */
const VIEW_KEY = 'colorfix:mask-view'
const VIEW_MODES: MaskViewMode[] = ['overlay', 'mask', 'only', 'outline']
function readView(): MaskViewMode {
  try {
    const v = localStorage.getItem(VIEW_KEY) as MaskViewMode | null
    return v && VIEW_MODES.includes(v) ? v : 'overlay'
  } catch {
    return 'overlay'
  }
}
const maskView = ref<MaskViewMode>(readView())
function setMaskView(v: MaskViewMode) {
  maskView.value = v
  try {
    localStorage.setItem(VIEW_KEY, v)
  } catch {
    /* 隐私模式 */
  }
}
watch(maskPinned, (on) => {
  if (on) maskView.value = readView()
})
const shownView = computed<MaskViewMode>(() => (maskPinned.value ? maskView.value : 'overlay'))

// ---------------- 状态行 ----------------

const status = computed(() => {
  if (cf.maskBusy.value)
    return cf.maskSlow.value ? '首次识别较慢，约需 1 分钟，可先调整其它参数' : '正在识别选区…'
  if (cf.maskPending.value) return cf.region.value.mode === 'auto' && cf.maskError.value ? cf.maskError.value : '有选区还没准备好（该层暂不生效）'
  if (cf.failed.value) return cf.maskLoadFailed.value ? COLORFIX_MASK_LOAD_FAILED : '校色效果未能生成，已显示原图'
  if (cf.baking.value) return '正在生成校色效果…'
  return ''
})

// ---------------- 进出 ----------------

function exit() {
  cf.closeFullscreen()
}

// 参数台被收起（「完成」/ 保存为新版本成功 / 切了资产）= 退出全屏
watch(
  () => cf.panelOpen.value,
  (open) => {
    if (!open && cf.fullscreen.value) exit()
  },
)
watch(show, (v) => {
  if (!v) {
    maskFlash.value = false
    if (cf.fullscreen.value) exit()
  }
})
onBeforeUnmount(() => {
  if (flashTimer) clearTimeout(flashTimer)
})

/** 不吃字符键的 input（勾选 / 单选 / 按钮类）：焦点在上面时快捷键照常 */
const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'radio', 'submit', 'reset', 'color', 'file', 'image'])

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el?.tagName) return false
  return (
    el.isContentEditable ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    (el.tagName === 'INPUT' && !NON_TEXT_INPUTS.has((el as HTMLInputElement).type)) ||
    el.getAttribute('role') === 'slider'
  )
}

function onKey(e: KeyboardEvent) {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return
  const k = e.key
  if (k === 'f' || k === 'F') exit()
  else if (k === '+' || k === '=') zoom.value?.zoomIn()
  else if (k === '-' || k === '_') zoom.value?.zoomOut()
  else if (k === '0') zoom.value?.fit()
  else if (k === '1') zoom.value?.actual()
  else return
  e.preventDefault()
  e.stopPropagation()
}

const SEG =
  'h-30px box-border px-12px rounded-full border-none text-12px cursor-pointer whitespace-nowrap sx-focus [transition:background_140ms,color_140ms] motion-reduce:transition-none'
</script>

<template>
  <!-- 弹层根节点必须是 div：naive 的焦点圈定按「起始哨兵后第一个 DIV」认内容区，section 会让焦点进不来 -->
  <n-modal :show="show" :mask-closable="false" :auto-focus="true" transform-origin="center" @update:show="(v: boolean) => !v && exit()">
    <!-- 全屏调色台始终是深色（看图要暗环境）：根节点锁 data-theme="dark"，里面的令牌一律取深色；
         右侧参数台跟随站点外观（浅色时仍是白卡），所以单独把主题还给它 -->
    <div
      data-theme="dark"
      class="cf-fs flex flex-col bg-surface text-white"
      role="dialog"
      aria-modal="true"
      :aria-label="`${title} · 全屏调色`"
      tabindex="-1"
      @keydown="onKey"
    >
      <header class="cf-fs-head flex flex-wrap items-center gap-8px px-16px py-8px bg-overlay border-b border-b-solid border-white/8">
        <b class="min-w-0 max-w-[28vw] truncate text-14px font-600 leading-20px">{{ title }}</b>
        <div role="radiogroup" aria-label="查看方式" class="flex items-center gap-2px p-3px rounded-full bg-white/8">
          <button
            v-for="m in MODES"
            :key="m.key"
            type="button"
            role="radio"
            :aria-checked="mode === m.key"
            :title="m.hint"
            :class="[SEG, mode === m.key ? 'bg-violet-solid text-white font-600' : 'bg-transparent text-white/75 hover:(bg-white/10 text-white)']"
            @click="mode = m.key"
          >
            {{ m.label }}
          </button>
        </div>
        <button
          v-if="hasMask"
          type="button"
          :class="[SEG, maskPinned ? 'bg-white/18 text-white font-600' : 'bg-white/8 text-white/75 hover:(bg-white/12 text-white)']"
          :aria-pressed="maskPinned"
          title="在图上标出当前选区（只是示意，不影响导出）"
          @click="maskPinned = !maskPinned"
        >
          显示选区
        </button>
        <div
          v-if="hasMask && maskPinned"
          role="radiogroup"
          aria-label="选区查看方式"
          class="flex items-center gap-2px p-3px rounded-full bg-white/8"
        >
          <button
            v-for="v in VIEW_MODES"
            :key="v"
            type="button"
            role="radio"
            :aria-checked="maskView === v"
            :title="MASK_VIEW_HINTS[v]"
            :class="[SEG, '!px-10px', maskView === v ? 'bg-white/22 text-white font-600' : 'bg-transparent text-white/75 hover:(bg-white/10 text-white)']"
            @click="setMaskView(v)"
          >
            {{ MASK_VIEW_LABELS[v] }}
          </button>
        </div>
        <span class="min-w-0 flex-1 truncate text-12px leading-18px text-white/65" role="status" aria-live="polite">{{ status }}</span>
        <div class="cf-fs-actions flex flex-wrap items-center gap-8px">
          <slot name="actions" />
        </div>
        <IconButton label="退出全屏（Esc / F）" variant="quiet" class="cf-fs-exit" @click="exit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
          </svg>
        </IconButton>
      </header>
      <div class="cf-fs-body flex-1 min-h-0 flex">
        <!-- 舞台外包一层定位容器：参考图浮卡浮在大图左上（不随图缩放平移） -->
        <div class="cf-fs-stage relative flex flex-1 min-w-0">
          <ColorFixZoomView ref="zoom" class="flex-1 min-w-0" :cf="cf" :mode="mode" :labels="labels" :show-mask="showMask" :mask-view="shownView" />
          <ColorFixReferenceCard v-if="cf.references.value.length" :cf="cf" storage-key="colorfix:ref-card:fullscreen" />
        </div>
        <aside :data-theme="activeTheme" class="cf-fs-dock flex flex-col bg-surface text-ink" aria-label="校色参数">
          <ColorFixResultPanel :cf="cf" :title="title" :local-adjust="localAdjust" docked large />
        </aside>
      </div>
    </div>
  </n-modal>
</template>

<style scoped lang="less">
.cf-fs {
  /* tabindex=-1：点图拖动后焦点落在本层（而不是 body），快捷键仍能收到 */
  outline: none;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
}
.cf-fs-dock {
  width: 380px;
  flex: 0 0 380px;
  min-height: 0;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
}
/* 顶栏在深底上：退出钮换浅色 */
.cf-fs-exit {
  color: rgba(255, 255, 255, 0.85) !important;
}
.cf-fs-exit:hover {
  background: rgba(255, 255, 255, 0.12) !important;
}
@media (max-width: 900px) {
  .cf-fs-body {
    flex-direction: column;
  }
  /* 竖排：图占剩余高度（不设固定下限，免得顶栏折行后整层超出一屏），参数台最多占 46% 屏高、内部滚动 */
  .cf-fs-stage {
    flex: 1 1 0;
    min-height: 0;
  }
  .cf-fs-dock {
    width: auto;
    flex: 0 1 auto;
    max-height: 46vh;
    max-height: 46dvh;
    border-left: none;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }
}
</style>
