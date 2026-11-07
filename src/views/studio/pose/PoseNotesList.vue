<script setup lang="ts">
/**
 * 姿态复刻 · 各姿势补充（对齐线上原型 WorkflowNotesList two-column）。
 *
 * <p>两列「32 缩略图 + 30 高 / 11px 单行输入（200 字）」；缩略图右上角悬停出删除，
 * 缩略图悬停 150ms 出小预览（200×240 封顶，fixed 贴在缩略图下方，放不下翻到上方）。
 * 说明按图片地址记（v-model:notes），删中间一张不串位。
 */
import { onBeforeUnmount, ref } from 'vue'
import StudioMedBtn from '../components/StudioImageUpload/StudioMedBtn.vue'

const { items, disabled = false } = defineProps<{
  /** 姿势图地址（按提交顺序） */
  items: string[]
  disabled?: boolean
}>()

const notes = defineModel<Record<string, string>>('notes', { required: true })

const emit = defineEmits<{ remove: [url: string] }>()

/** 缩略图 hover 预览 */
type Peek = { url: string; left: number; top: number; width: number; height: number }
const peek = ref<Peek | null>(null)
let peekTimer: ReturnType<typeof setTimeout> | undefined

function clearPeek() {
  if (peekTimer) clearTimeout(peekTimer)
  peekTimer = undefined
  peek.value = null
}

function schedulePeek(url: string, event: MouseEvent) {
  clearPeek()
  const host = event.currentTarget as HTMLElement | null
  if (!host) return
  peekTimer = setTimeout(() => {
    peekTimer = undefined
    const img = host.querySelector('img')
    const rect = host.getBoundingClientRect()
    const nw = img?.naturalWidth || 4
    const nh = img?.naturalHeight || 3
    const maxH = Math.min(240, Math.max(160, window.innerHeight - 160))
    const scale = Math.min(200 / nw, maxH / nh, 1)
    const width = Math.round(nw * scale)
    const height = Math.round(nh * scale)
    const margin = 12
    const left = Math.min(
      Math.max(margin, Math.round(rect.left + rect.width / 2 - width / 2)),
      window.innerWidth - width - margin,
    )
    let top = Math.round(rect.bottom + 8)
    if (top + height > window.innerHeight - margin) {
      const above = Math.round(rect.top - height - 8)
      top = above >= margin ? above : Math.max(margin, window.innerHeight - height - margin)
    }
    peek.value = { url, left, top, width, height }
  }, 150)
}

onBeforeUnmount(clearPeek)
</script>

<template>
  <section v-if="items.length" class="flex flex-[0_0_auto] flex-col gap-8px" aria-label="各姿势补充">
    <header class="flex items-baseline gap-8px">
      <span class="text-12px font-600 leading-18px text-ink-2">各姿势补充</span>
    </header>
    <!-- 行缩略图的删除钮探出上沿 9px：第一行别顶到标题 -->
    <div class="grid grid-cols-2 gap-x-12px gap-y-8px items-start mt-5px">
      <label v-for="(url, i) in items" :key="url" class="group relative flex items-center gap-8px min-w-0">
        <span
          class="block w-32px h-32px flex-[0_0_32px] box-border overflow-hidden border border-solid border-line rounded-4px bg-surface3"
          @mouseenter="schedulePeek(url, $event)"
          @mouseleave="clearPeek()"
        >
          <img class="block w-full h-full object-cover" :src="url" :alt="`姿势${i + 1}`" />
        </span>
        <StudioMedBtn
          v-if="!disabled"
          label="移除这张图"
          class="top-[-9px] left-21px z-2 opacity-0 pointer-events-none transition-opacity duration-120 group-hover:(opacity-100 pointer-events-auto) group-focus-within:(opacity-100 pointer-events-auto) [@media(hover:none)]:(opacity-100 pointer-events-auto) motion-reduce:transition-none"
          @mousedown.prevent
          @click.prevent.stop="emit('remove', url)"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5M10.5 11v5M13.5 11v5" />
          </svg>
        </StudioMedBtn>
        <input
          v-model="notes[url]"
          type="text"
          class="flex-[1_1_0] w-0 min-w-0 h-30px box-border px-10px border border-solid border-line rounded-6px bg-white text-11px leading-18px text-ink outline-none shadow-inset-input placeholder:text-placeholder focus:(border-violet shadow-[0_0_0_3px_rgba(135,95,154,0.12),inset_0_1px_2px_rgba(31,35,41,0.055),inset_0_0_0_1px_rgba(255,255,255,0.7)]) disabled:opacity-55"
          maxlength="200"
          placeholder="这张的动作补充（选填）"
          :aria-label="`姿势${i + 1}：动作补充`"
          :disabled="disabled"
        />
      </label>
    </div>
  </section>

  <Teleport to="body">
    <div
      v-if="peek"
      class="fixed z-1200 overflow-hidden rounded-8px bg-white pointer-events-none shadow-[0_10px_30px_rgba(31,35,41,0.2),0_2px_8px_rgba(31,35,41,0.12)] animate-[stu-preview-in_120ms_ease_both] motion-reduce:animate-none"
      :style="{ left: `${peek.left}px`, top: `${peek.top}px`, width: `${peek.width}px`, height: `${peek.height}px` }"
      aria-hidden="true"
    >
      <img class="block w-full h-full bg-white object-contain" :src="peek.url" alt="" />
    </div>
  </Teleport>
</template>
