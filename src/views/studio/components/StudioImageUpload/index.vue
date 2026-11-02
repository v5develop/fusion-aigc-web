<script setup lang="ts">
/**
 * 商拍工作室图片入口 · s1.1 白边浮片叠片。
 *
 * <p>对齐 s1.1 交付包 AiDigitalModel / AiPostureFission / MlReferenceSlots 的入口：
 * - 入口本身就是一叠 60×100 白边浮片（r5、1px #fff、0 1px 3px .16），每张只露 6px，新的在最右、压在最上；
 * - 悬停 / 键盘聚焦摊开：步长 63，放不下按同排可用宽度压缩（最密 8），width / margin 走
 *   220ms cubic-bezier(.25,.8,.25,1)，不动透明度；
 * - 空态是同一张白边浮片：图标 18 + 文案 9/13；
 * - 右上角删除钮（清空这一组）跟着叠片走；右下角外沿 -12/-12 是云钮（在调用方传 cloud / onCloud 时出现）；
 * - 下方悬停面板（12 高透明桥 + 180ms 接力）：大图预览（contain，不撑卡）+ 3 列逐张删除。
 * 同排多个入口（父容器 flex gap-16px）之间自动画「切口」细线。
 * 入口外面还包了一层（如工具页 ToolUploadSlot）时，同排容器打 `data-plate-row`，摊开压缩按整排量。
 *
 * <p>上传仍走 goUploadImage（见 useStudioUploader）。picker 模式下点入口只发 pick 事件，
 * 增删由页面处理（商拍服装图走角度弹窗）；remove / clear 事件任何模式都会发。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { ACCEPT_IMAGE } from '@/utils/utils.ts'
import AssetPickerModal from '../AssetPickerModal/index.vue'
import StudioMedBtn from './StudioMedBtn.vue'
import { useStudioUploader } from './useStudioUploader.ts'

const {
  max = 9,
  multiple = true,
  disabled = false,
  hint = '',
  emptyText = '待上传',
  label = '',
  picker = false,
  cloud = false,
  tagOf,
  onCloud,
  name = '',
} = defineProps<{
  /** 上限张数（1–9 由调用方按契约传入） */
  max?: number
  /** 文件选择器是否允许多选 */
  multiple?: boolean
  disabled?: boolean
  /** 片下说明第二行（不传则显示 已传 n/max）；无 label 时不显示说明 */
  hint?: string
  /** 空态浮片文案 */
  emptyText?: string
  /** 片下说明第一行（名称）；为空则不显示片下说明（单角色页，数量写在分组标题） */
  label?: string
  /** true：点入口只发 pick（由页面打开自己的弹窗），不直接选文件 */
  picker?: boolean
  /** true：云钮从资产库选图，按上传同一条路径入组（非 picker 模式用；picker 模式由页面传 onCloud 自管） */
  cloud?: boolean
  /** 面板里每张图的角标（如服装图的「上衣·正面」） */
  tagOf?: (url: string) => string
  /** 云钮的页面自管处理（picker 模式：页面自己开选图弹窗并按自己的规则入组）。优先于 cloud */
  onCloud?: () => void
  /** 无障碍名称里的图片名；不传用 label（label 为空时兜底「图片」）。单角色页不显示说明时用它 */
  name?: string
}>()

const emit = defineEmits<{
  pick: []
  remove: [url: string, index: number]
  clear: []
}>()

/** 图片地址列表（v-model） */
const urls = defineModel<string[]>({ required: true })

const message = useMessage()
const { uploading, uploadFiles } = useStudioUploader()
const fileInput = ref<HTMLInputElement | null>(null)
const rootEl = ref<HTMLElement | null>(null)

const PLATE_W = 60
const STACK = 6
const MAX_PLATES = 9
const PANEL_W = 252

const count = computed(() => urls.value.length)
const full = computed(() => !disabled && count.value >= max)
const plates = computed(() => urls.value.slice(-MAX_PLATES))
const n = computed(() => Math.max(1, plates.value.length))

// ---------------- 悬停摊开 + 面板接力 ----------------

const expanded = ref(false)
/** 摊开步长：3px 缝放得下用 63，放不下按同排可用宽度压缩，最密 8 */
const step = ref(63)
const panelLeft = ref(0)
const panelWidth = ref(PANEL_W)
/** 面板大图：悬停 / 聚焦到哪张就看哪张 */
const active = ref('')
let leaveTimer: ReturnType<typeof setTimeout> | null = null

function clearLeave() {
  if (leaveTimer) {
    clearTimeout(leaveTimer)
    leaveTimer = null
  }
}

/**
 * 同排其它入口收起时的宽度不变：room = 排宽 − 其它入口宽 − 16 × 缝数。
 * 排 = 最近的 `[data-plate-row]`（入口外面另包了一层时），没有就是父元素。
 */
function measure() {
  const root = rootEl.value
  const parent = (root?.parentElement?.closest('[data-plate-row]') as HTMLElement | null) ?? root?.parentElement
  if (!root || !parent) return
  const parentRect = parent.getBoundingClientRect()
  const others = [...parent.querySelectorAll('.stu-slot')].filter((el) => el !== root)
  const room = parentRect.width - others.reduce((w, el) => w + el.getBoundingClientRect().width, 0) - 16 * others.length
  const gaps = n.value - 1
  step.value = gaps ? Math.min(63, Math.max(8, (room - PLATE_W) / gaps)) : 63
  // 面板默认左对齐入口，放不下就往左挪，右缘不越过同排容器
  const rootRect = root.getBoundingClientRect()
  panelWidth.value = Math.min(PANEL_W, parentRect.width)
  panelLeft.value = Math.min(0, parentRect.right - rootRect.left - panelWidth.value)
}

function onEnter() {
  clearLeave()
  if (!expanded.value) measure()
  expanded.value = true
}

/** 离开先等 180ms：从片子走进下方面板（顶上 12 高透明桥）或删除钮，中间不收 */
function onLeave() {
  clearLeave()
  leaveTimer = setTimeout(() => {
    leaveTimer = null
    collapse()
  }, 180)
}

function onFocusOut(event: FocusEvent) {
  const next = event.relatedTarget as Node | null
  if (next && rootEl.value?.contains(next)) return
  collapse()
}

function collapse() {
  clearLeave()
  expanded.value = false
  active.value = ''
}

watch(count, () => {
  if (!count.value) active.value = ''
  if (expanded.value) nextTick(measure)
})
onBeforeUnmount(clearLeave)

const entryWidth = computed(() => `${PLATE_W + (n.value - 1) * (expanded.value ? step.value : STACK)}px`)
const plateGap = computed(() => `${(expanded.value ? step.value : STACK) - PLATE_W}px`)
const delLeft = computed(() => `${PLATE_W + (n.value - 1) * (expanded.value ? step.value : STACK) - 8}px`)
const panelOpen = computed(() => expanded.value && count.value > 0)

// ---------------- 增删 ----------------

function onEntryClick() {
  if (disabled || uploading.value) return
  if (picker) {
    emit('pick')
    return
  }
  if (full.value) {
    message.warning(`满了，最多 ${max} 张；要换先删一张`)
    return
  }
  fileInput.value?.click()
}

function removeAt(index: number) {
  if (disabled) return
  const url = urls.value[index]
  if (url === undefined) return
  emit('remove', url, index)
  if (!picker) urls.value.splice(index, 1)
  if (active.value === url) active.value = ''
}

function clearAll() {
  if (disabled) return
  const total = count.value
  emit('clear')
  if (!picker) {
    urls.value.splice(0)
    message.info(total ? `已清空 ${total} 张` : '已清空')
  }
  collapse()
}

// ---------------- 从资产库选 ----------------

const assetShow = ref(false)
const cloudVisible = computed(() => cloud || !!onCloud)
const room = computed(() => Math.max(0, max - count.value))

function onCloudClick() {
  if (disabled || uploading.value) return
  if (onCloud) {
    onCloud()
    return
  }
  if (room.value <= 0) {
    message.warning(`满了，最多 ${max} 张；要换先删一张`)
    return
  }
  assetShow.value = true
}

/** 资产图与上传同口径：只收 http(s)、去重、不超过余量，超出给同款提示 */
function addAssetUrls(picked: string[]) {
  const fresh = picked.filter((u) => /^https?:\/\//i.test(u) && !urls.value.includes(u))
  if (fresh.length < picked.length) message.warning('已跳过重复或不可用的图片')
  const take = fresh.slice(0, room.value)
  if (take.length < fresh.length) {
    message.warning(
      `最多还能添加 ${room.value} 张（上限 ${max} 张），多选的其余 ${fresh.length - take.length} 张未添加`,
    )
  }
  urls.value.push(...take)
  if (expanded.value) nextTick(measure)
}

async function addFiles(files: File[]) {
  await uploadFiles(files, max - count.value, max, (url) => urls.value.push(url))
  if (expanded.value) measure()
}

function onFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  void addFiles(files)
}

function onDrop(event: DragEvent) {
  if (picker || disabled || uploading.value) return
  const files = [...(event.dataTransfer?.files ?? [])]
  if (files.length) void addFiles(files)
}

const entryLabel = computed(() => {
  const title = name || label || '图片'
  if (picker) return count.value ? `${title}，${count.value} 张，点击编辑` : `上传${title}`
  if (full.value) return `${title}已满 ${max} 张`
  return count.value ? `${title}，${count.value} 张，点击继续添加` : `上传${title}`
})

const capText = computed(() => hint || (count.value ? `${count.value}/${max}` : `最多${max}张`))
/** 同排两块之间的「切口」：两块隔 16，线画在第二块上——9 宽柔影带（上下 12%/88% 渐隐）+ 正中 1px 中线 */
const seamCls = [
  "[.stu-slot+&]:before:content-['']",
  '[.stu-slot+&]:before:absolute',
  '[.stu-slot+&]:before:top-0',
  '[.stu-slot+&]:before:left-[-12px]',
  '[.stu-slot+&]:before:w-9px',
  '[.stu-slot+&]:before:h-100px',
  '[.stu-slot+&]:before:pointer-events-none',
  '[.stu-slot+&]:before:bg-[linear-gradient(90deg,rgba(31,35,41,0)_0%,rgba(31,35,41,0.026)_35%,rgba(31,35,41,0.026)_65%,rgba(31,35,41,0)_100%)]',
  '[.stu-slot+&]:before:[mask:linear-gradient(180deg,transparent_0%,#000_12%,#000_88%,transparent_100%)]',
  '[.stu-slot+&]:before:[-webkit-mask:linear-gradient(180deg,transparent_0%,#000_12%,#000_88%,transparent_100%)]',
  "[.stu-slot+&]:after:content-['']",
  '[.stu-slot+&]:after:absolute',
  '[.stu-slot+&]:after:top-0',
  '[.stu-slot+&]:after:left-[-8px]',
  '[.stu-slot+&]:after:w-1px',
  '[.stu-slot+&]:after:h-100px',
  '[.stu-slot+&]:after:pointer-events-none',
  '[.stu-slot+&]:after:bg-[linear-gradient(180deg,rgba(31,35,41,0)_0%,rgba(31,35,41,0.09)_14%,rgba(31,35,41,0.09)_86%,rgba(31,35,41,0)_100%)]',
]
</script>

<template>
  <div
    ref="rootEl"
    class="stu-slot relative flex flex-col items-center flex-[0_0_auto] min-w-0"
    :class="seamCls"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
    @focusin="onEnter"
    @focusout="onFocusOut"
    @keydown.esc="collapse"
  >
    <input
      ref="fileInput"
      type="file"
      class="hidden"
      :accept="ACCEPT_IMAGE"
      :multiple="multiple"
      tabindex="-1"
      aria-hidden="true"
      @change="onFiles"
    />

    <div class="relative">
      <!-- 入口就是一叠片：后一张盖住前一张只露 6px，悬停摊开 -->
      <button
        type="button"
        class="relative flex flex-col items-center justify-center gap-4px box-border h-100px p-0 overflow-visible rounded-5px cursor-pointer transition-[width] duration-220 ease-[cubic-bezier(0.25,0.8,0.25,1)] motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-violet focus-visible:outline-offset-2 disabled:cursor-not-allowed"
        :class="[
          count
            ? 'border-0 bg-transparent'
            : 'border border-solid border-white bg-white text-placeholder shadow-[0_1px_3px_rgba(31,35,41,0.16)] hover:shadow-[0_2px_6px_rgba(31,35,41,0.2)]',
          full && !picker ? '!cursor-default' : '',
          expanded ? 'z-5' : 'z-1',
        ]"
        :style="{ width: entryWidth }"
        :disabled="disabled"
        :aria-disabled="(full && !picker) || undefined"
        :aria-label="entryLabel"
        @click="onEntryClick"
        @dragover.prevent
        @drop.prevent="onDrop"
      >
        <span v-if="count" class="absolute left-0 top-0 flex" aria-hidden="true">
          <span
            v-for="(url, index) in plates"
            :key="url"
            class="relative block flex-[0_0_60px] w-60px h-100px box-border overflow-hidden border border-solid border-white rounded-5px bg-surface3 shadow-[0_1px_3px_rgba(31,35,41,0.16)] transition-[margin-left] duration-220 ease-[cubic-bezier(0.25,0.8,0.25,1)] motion-reduce:transition-none"
            :style="{ zIndex: index, marginLeft: index ? plateGap : '0px' }"
            @mouseenter="active = url"
          >
            <img class="block w-full h-full object-cover" :src="url" alt="" />
          </span>
        </span>
        <template v-else>
          <n-spin v-if="uploading" :size="16" />
          <template v-else>
            <svg
              class="w-18px h-18px text-muted"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
              <circle cx="9" cy="10" r="1.6" />
              <path d="M20.5 16l-5-5L6 19.5" />
            </svg>
            <span class="px-4px text-9px leading-13px text-center">{{ emptyText }}</span>
          </template>
        </template>
        <!-- 有图时继续上传：叠片上盖一层转圈 -->
        <span
          v-if="count && uploading"
          class="absolute inset-0 z-20 grid place-items-center rounded-5px bg-[rgba(255,255,255,0.6)]"
        >
          <n-spin :size="16" />
        </span>
      </button>

      <!-- 云钮：片外右下角 -12/-12；摊开时片子会盖到它，收掉（空块不藏） -->
      <StudioMedBtn
        v-if="cloudVisible"
        :label="label ? `从资产库选${label}` : '从资产库选'"
        class="-right-12px -bottom-12px transition-opacity duration-120 motion-reduce:transition-none"
        :class="expanded && count ? 'opacity-0 pointer-events-none' : ''"
        :disabled="disabled"
        @click.stop="onCloudClick"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path
            d="M7 18.5h10.5a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.4 9.1 4.75 4.75 0 0 0 7 18.5z"
            stroke-linejoin="round"
            transform="translate(0 -0.5)"
          />
        </svg>
      </StudioMedBtn>

      <!-- 删除钮：右上角 -8，跟着叠片收起 / 摊开走（清空这一组；逐张删在下方面板） -->
      <StudioMedBtn
        v-if="count && !disabled"
        :label="label ? `清空${label}` : '清空图片'"
        class="-top-8px z-14 transition-[left] duration-220 ease-[cubic-bezier(0.25,0.8,0.25,1)] motion-reduce:transition-none"
        :style="{ left: delLeft }"
        @click.stop="clearAll"
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
    </div>

    <AssetPickerModal v-if="cloud && !onCloud" v-model:show="assetShow" :limit="room" @select="addAssetUrls" />

    <p
      v-if="label"
      class="flex flex-col items-center gap-2px w-60px mt-8px mb-0 text-10px leading-15px text-center text-placeholder"
    >
      <b class="text-11px font-500 text-ink-2">{{ label }}</b>
      <span>{{ capText }}</span>
    </p>

    <!-- 悬停面板：贴片子下沿（top 108），顶上 12 高透明桥；大图 contain 不撑卡，3 列逐张删除 -->
    <div
      v-if="panelOpen"
      class="absolute z-20 top-108px box-border p-10px border border-solid border-line rounded-8px bg-white text-left shadow-[0_12px_32px_rgba(31,35,41,0.18),0_2px_8px_rgba(31,35,41,0.08)] animate-[stu-preview-in_120ms_ease_both] motion-reduce:animate-none before:content-[''] before:absolute before:-top-12px before:inset-x-0 before:h-12px"
      :style="{ left: `${panelLeft}px`, width: `${panelWidth}px` }"
      role="group"
      :aria-label="`${label || '图片'}，共 ${count} 张`"
    >
      <div class="flex items-baseline gap-6px mb-6px text-10px text-muted">
        <b class="text-11px font-600 text-ink-2">{{ label || '图片' }}</b>
        <span>{{ count }} 张</span>
        <em class="ml-auto not-italic text-9px text-placeholder">{{ picker ? '点叠片编辑' : '悬停看大图' }}</em>
      </div>
      <div
        v-if="active"
        class="grid place-items-center h-260px mb-8px overflow-hidden rounded-6px bg-surface2"
        aria-hidden="true"
      >
        <img class="block max-w-full max-h-260px object-contain" :src="active" alt="" />
      </div>
      <div class="grid grid-cols-3 gap-8px">
        <div
          v-for="(url, index) in urls"
          :key="url"
          class="relative aspect-[3/4] overflow-hidden border border-solid rounded-5px"
          :class="active === url ? 'border-violet-line' : 'border-line'"
          @mouseenter="active = url"
        >
          <img class="block w-full h-full object-cover" :src="url" alt="" />
          <span
            v-if="tagOf"
            class="absolute left-4px bottom-4px px-5px rounded-full bg-[rgba(31,35,41,0.72)] text-white text-9px leading-16px whitespace-nowrap"
            >{{ tagOf(url) }}</span
          >
          <StudioMedBtn
            v-if="!disabled"
            :label="`删除第 ${index + 1} 张${tagOf ? `（${tagOf(url)}）` : ''}`"
            class="top-3px right-3px z-2"
            @focus="active = url"
            @click.stop="removeAt(index)"
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
        </div>
      </div>
    </div>
  </div>
</template>

<style>
/*
 * 只留 @keyframes：UnoCSS 的 animate-[…] 只引用名字，关键帧本身写不成原子类。
 * 不加 scoped——scoped 会给关键帧名加哈希，模板里的原子类就对不上了；名字带 stu- 前缀避免撞名。
 * 用法：悬停面板 animate-[stu-preview-in_120ms_ease_both]（120ms + 4px 上浮，v-if 每次挂载重播）。
 */
@keyframes stu-preview-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
</style>
