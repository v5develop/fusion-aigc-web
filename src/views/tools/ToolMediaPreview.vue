<script setup lang="ts">
/**
 * 结果灯箱（原型 MediaPreview）：z 3000，深色全屏底；顶部工具栏 px24 py12（名称 + 序号，缩小 / 比例 / 放大 / 重置 /
 * 下载 / 关闭，按钮 32 / r8）；左右切换 44 圆、离边 24；多张时底部缩略条（56 / r8，当前项 2px 藤紫描边）。
 *
 * <p>键盘：Esc 关闭、← → 切换、+ / - 缩放、0 重置、R 右转 / Shift+R 左转。打开时焦点移到关闭钮，关闭后还给打开前的元素；Tab 限制在灯箱内。
 * 下载沿用页面原来的 `<a download target=_blank>` 方式（跨域时浏览器会新开标签页）。
 */
import { computed, nextTick, ref, watch } from 'vue'

export interface PreviewItem {
  type: 'image' | 'video'
  src: string
  name?: string
}

const { items } = defineProps<{ items: PreviewItem[] }>()
const open = defineModel<boolean>('open', { required: true })
const index = defineModel<number>('index', { default: 0 })

const container = ref<HTMLElement | null>(null)
const closeBtn = ref<HTMLButtonElement | null>(null)
const scale = ref(1)
/** 旋转角度（左转 -90 / 右转 +90，不取模以免过渡倒转一整圈） */
const rotate = ref(0)
/** 重置那一帧关掉过渡：角度累计过（如 450°）时直接动画回 0 会倒转好几圈 */
const noAnim = ref(false)
function resetView() {
  noAnim.value = rotate.value !== 0
  scale.value = 1
  rotate.value = 0
  if (noAnim.value) void nextTick(() => requestAnimationFrame(() => (noAnim.value = false)))
}
let restoreFocus: HTMLElement | null = null

const SCALES = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]
const clamped = computed(() => Math.min(Math.max(index.value, 0), Math.max(items.length - 1, 0)))
const current = computed(() => items[clamped.value] ?? null)
const multiple = computed(() => items.length > 1)
const isVideo = computed(() => current.value?.type === 'video')

watch(open, async (v) => {
  if (v) {
    restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    scale.value = 1
    rotate.value = 0
    await nextTick()
    closeBtn.value?.focus()
  } else {
    restoreFocus?.focus()
    restoreFocus = null
  }
})
watch(clamped, () => {
  scale.value = 1
  rotate.value = 0
})

function close() {
  open.value = false
}
function go(i: number) {
  if (i >= 0 && i < items.length) index.value = i
}
function zoom(dir: 1 | -1) {
  const i = SCALES.findIndex((s) => s >= scale.value - 1e-6)
  const next = SCALES[Math.min(SCALES.length - 1, Math.max(0, (i < 0 ? SCALES.length - 1 : i) + dir))]
  if (next) scale.value = next
}

function onKeydown(e: KeyboardEvent) {
  const mod = e.metaKey || e.ctrlKey || e.altKey // Cmd/Ctrl+R/0 等留给浏览器
  if (e.key === 'Escape') close()
  else if (e.key === 'ArrowLeft') go(clamped.value - 1)
  else if (e.key === 'ArrowRight') go(clamped.value + 1)
  else if (!mod && !isVideo.value && (e.key === '+' || e.key === '=')) zoom(1)
  else if (!mod && !isVideo.value && e.key === '-') zoom(-1)
  else if (!mod && !isVideo.value && e.key === '0') resetView()
  // shiftKey 定方向：大写锁定时 e.key 大小写是反的
  else if (!mod && !isVideo.value && e.key.toLowerCase() === 'r') rotate.value += e.shiftKey ? -90 : 90
  else if (e.key === 'Tab') trapTab(e)
  else return
  if (e.key !== 'Tab') e.preventDefault()
}

/** Tab 只在灯箱内循环 */
function trapTab(e: KeyboardEvent) {
  const nodes = container.value?.querySelectorAll<HTMLElement>(
    'button:not([disabled]), a[href], video[controls], [tabindex]:not([tabindex="-1"])',
  )
  if (!nodes?.length) return
  const first = nodes[0]!
  const last = nodes[nodes.length - 1]!
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

const toolCls =
  'grid w-32px h-32px place-items-center p-0 rounded-8px border-none bg-white/10 text-white cursor-pointer no-underline ' +
  'enabled:hover:bg-white/22 disabled:(opacity-40 cursor-not-allowed) outline-none ' +
  'focus-visible:(outline-2 outline-solid outline-#fff outline-offset-2)'
const navCls =
  'absolute top-1/2 -translate-y-1/2 z-2 grid w-44px h-44px place-items-center p-0 rounded-full border-none bg-white/20 ' +
  'text-white cursor-pointer hover:bg-white/32 outline-none focus-visible:(outline-2 outline-solid outline-#fff outline-offset-2)'
const iconAttrs = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '1.8',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': 'true',
} as const
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && current"
      ref="container"
      class="fixed inset-0 z-3000 flex flex-col bg-[#0b0b0d]"
      role="dialog"
      aria-modal="true"
      aria-label="结果预览"
      @keydown="onKeydown"
    >
      <header class="relative flex-none flex items-center gap-12px px-24px py-12px">
        <div class="min-w-0 flex-1">
          <p class="m-0 truncate text-13px leading-20px text-white/90">{{ current.name || '结果预览' }}</p>
          <p v-if="multiple" class="m-0 text-11px leading-16px text-white/65" role="status">
            {{ clamped + 1 }} / {{ items.length }}
          </p>
        </div>
        <div class="flex-none flex items-center gap-4px">
          <template v-if="!isVideo">
            <button type="button" :class="toolCls" aria-label="缩小" :disabled="scale <= SCALES[0]!" @click="zoom(-1)">
              <svg class="w-16px h-16px" v-bind="iconAttrs"><path d="M5 12h14" /></svg>
            </button>
            <span class="w-48px text-center text-11px leading-16px text-white/65 tabular-nums" aria-live="polite"
              >{{ Math.round(scale * 100) }}%</span
            >
            <button
              type="button"
              :class="toolCls"
              aria-label="放大"
              :disabled="scale >= SCALES[SCALES.length - 1]!"
              @click="zoom(1)"
            >
              <svg class="w-16px h-16px" v-bind="iconAttrs"><path d="M12 5v14M5 12h14" /></svg>
            </button>
            <button
              type="button"
              :class="toolCls"
              aria-label="左转 90 度"
              title="左转 90 度（Shift+R）"
              @click="rotate -= 90"
            >
              <svg class="w-16px h-16px -scale-x-100" v-bind="iconAttrs">
                <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
            </button>
            <button
              type="button"
              :class="toolCls"
              aria-label="右转 90 度"
              title="右转 90 度（R）"
              @click="rotate += 90"
            >
              <svg class="w-16px h-16px" v-bind="iconAttrs">
                <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
            </button>
            <button
              type="button"
              :class="toolCls"
              aria-label="重置"
              :disabled="scale === 1 && rotate % 360 === 0"
              @click="resetView"
            >
              <svg class="w-16px h-16px" v-bind="iconAttrs">
                <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </button>
          </template>
          <a
            :href="current.src"
            target="_blank"
            rel="noopener"
            download
            :class="toolCls"
            aria-label="下载原件"
            title="下载原件"
          >
            <svg class="w-16px h-16px" v-bind="iconAttrs">
              <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
            </svg>
          </a>
          <button ref="closeBtn" type="button" :class="toolCls" aria-label="关闭" @click="close">
            <svg class="w-16px h-16px" v-bind="iconAttrs"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
      </header>

      <!-- 舞台：点空白处关闭；图片按比例缩放，超出可滚动查看 -->
      <div class="relative flex-1 min-h-0 overflow-auto grid place-items-center" @click.self="close">
        <video
          v-if="isVideo"
          :key="current.src"
          :src="current.src"
          controls
          playsinline
          class="block max-w-[calc(100%-144px)] max-h-full"
        />
        <img
          v-else
          :key="current.src"
          :src="current.src"
          :alt="current.name || '结果图'"
          class="block max-w-[calc(100%-144px)] max-h-full object-contain origin-center [transition:transform_180ms_cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none"
          :style="{ transform: `scale(${scale}) rotate(${rotate}deg)`, ...(noAnim ? { transition: 'none' } : {}) }"
          draggable="false"
        />
      </div>

      <button
        v-if="multiple && clamped > 0"
        type="button"
        :class="[navCls, 'left-24px']"
        aria-label="上一个"
        @click="go(clamped - 1)"
      >
        <svg class="w-24px h-24px" v-bind="iconAttrs"><path d="m15 6-6 6 6 6" /></svg>
      </button>
      <button
        v-if="multiple && clamped < items.length - 1"
        type="button"
        :class="[navCls, 'right-24px']"
        aria-label="下一个"
        @click="go(clamped + 1)"
      >
        <svg class="w-24px h-24px" v-bind="iconAttrs"><path d="m9 6 6 6-6 6" /></svg>
      </button>

      <div
        v-if="multiple"
        class="relative flex-none flex items-center justify-center gap-8px overflow-x-auto px-24px py-12px"
        role="tablist"
        aria-label="预览列表"
      >
        <button
          v-for="(item, i) in items"
          :key="`${item.src}-${i}`"
          type="button"
          role="tab"
          :aria-selected="i === clamped"
          :aria-label="item.name || `第 ${i + 1} 项`"
          class="relative flex-none w-56px h-56px overflow-hidden p-0 rounded-8px border-none bg-white/12 cursor-pointer outline-2 outline-solid -outline-offset-2 focus-visible:outline-#fff"
          :class="i === clamped ? 'outline-violet' : 'outline-transparent'"
          @click="go(i)"
        >
          <img
            v-if="item.type === 'image'"
            :src="item.src"
            alt=""
            class="block w-full h-full object-cover"
            draggable="false"
          />
          <span
            v-else
            class="absolute inset-0 grid place-items-center bg-[rgba(11,11,13,0.35)] text-white"
            aria-hidden="true"
          >
            <svg class="w-16px h-16px" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          </span>
        </button>
      </div>
    </div>
  </Teleport>
</template>
