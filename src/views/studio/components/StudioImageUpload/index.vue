<script setup lang="ts">
/**
 * 商拍工作室图片入口 · s1.1 白边浮片叠片。
 *
 * <p>对齐 s1.1 交付包 AiDigitalModel / AiPostureFission / MlReferenceSlots 的入口：
 * - 入口本身就是一叠 78×130 白边浮片（2026-11-07 对齐 5185 MlReferenceSlots：r12 + squircle、图内圆角 11 同心、1px #fff、
 *   0 1px 3px .16），每张只露 8px，新的在最右、压在最上；最后一张右上角 16 高深色张数徽标（1 张也显示），悬停 / 摊开时隐去；
 * - 悬停 500ms 摊开、离开 2s 收回（键盘聚焦立即摊开）：步长 81，放不下按同排可用宽度压缩（最密 8），width / margin 走
 *   220ms cubic-bezier(.25,.8,.25,1)（减少动态效果时瞬时），不动透明度；
 * - 摊开时行尾多一格 78×130 虚线「+ 点击添加」（有云钮时格内右下角放「资产添加」小圆钮）；每张悬停出 22 圆「替换」钮（命中 ≥32，
 *   只换这一张；picker 模式只发 replace(index)，由页面按自己的校验上传后原位替换）；
 * - 空态是同一张白边浮片：图标 18 + 文案 12/16；
 * - 右上角删除钮只删最上面（最后）一张，与徽标同位、悬停才出现；清空整组改为面板头部 / 行尾的「清空」文字钮并二次确认；
 *   右下角外沿 -12/-12 是云钮（在调用方传 cloud / onCloud 时出现）；
 * - 下方悬停面板（12 高透明桥 + 180ms 接力）：大图预览（contain，不撑卡）+ 3 列逐张删除。
 *   panelMin：张数到这个数才出面板（商拍模特 4 位起），不到时只摊开，逐张删除钮落在每张片子右下角；
 *   panelFill：面板从本块左缘拉到同排右缘（s1.1 姿势 / 模特面板「左缘压切口、右缘到卡右缘」）。
 * 同排多个入口（父容器 flex gap-16px）之间自动画「切口」细线。
 * 入口外面还包了一层（如工具页 ToolUploadSlot）时，同排容器打 `data-plate-row`，摊开压缩按整排量。
 *
 * <p>上传仍走 goUploadImage（见 useStudioUploader）。picker 模式下点入口只发 pick 事件，
 * 增删由页面处理（商拍服装图走角度弹窗）；remove / clear 事件任何模式都会发。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useDialog, useMessage } from 'naive-ui'
import { ACCEPT_IMAGE } from '@/utils/utils.ts'
import AssetPickerModal from '../AssetPickerModal/index.vue'
import StudioMedBtn from './StudioMedBtn.vue'
import AssetCornerButton from '@/components/Creation/AssetCornerButton.vue'
import { useStudioUploader } from './useStudioUploader.ts'
import { DROP_PASTE_HINT, useFileDropPaste } from '@/composables/useFileDropPaste'

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
  panelMin = 1,
  panelFill = false,
  onDropFiles,
  pastePrimary = false,
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
  /** 至少几张才出悬停面板；不到时只摊开，片子上直接逐张删 */
  panelMin?: number
  /** 面板宽度拉到同排右缘（左缘对齐本块） */
  panelFill?: boolean
  /** picker 模式下拖入 / 粘贴的文件交给页面（页面按自己的校验上传）；不传则照旧发 pick 打开页面的弹窗 */
  onDropFiles?: (files: File[]) => void
  /** 页面上有多个上传区、又没悬停在任何一个上时，粘贴（Ctrl/⌘+V）交给它；一页最多标一个 */
  pastePrimary?: boolean
}>()

const emit = defineEmits<{
  pick: []
  remove: [url: string, index: number]
  clear: []
  /** picker 模式点某张的「替换」：页面选文件、校验、上传后原位换掉第 index 张 */
  replace: [index: number]
}>()

/** 图片地址列表（v-model） */
const urls = defineModel<string[]>({ required: true })

const message = useMessage()
const dialog = useDialog()
const { uploading, uploadFiles, invalidate: invalidateUploads, invalidateOnReplace } = useStudioUploader()
// 页面整组换掉 / 清空图片（回填、重置）：还在路上的上传作废
invalidateOnReplace(() => urls.value)
const fileInput = ref<HTMLInputElement | null>(null)
const rootEl = ref<HTMLElement | null>(null)
const entryEl = ref<HTMLElement | null>(null)

const PLATE_W = 78
/** 行尾「点击添加」格占的宽：78 + 3 缝 */
const ADD_W = 81
/** 悬停多久摊开 / 离开多久收回（5185 MlReferenceSlots inline：0.5s / 2s） */
const OPEN_DELAY = 500
const CLOSE_DELAY = 2000
const STACK = 8
const MAX_PLATES = 9
const PANEL_W = 252

const count = computed(() => urls.value.length)
const full = computed(() => !disabled && count.value >= max)
const plates = computed(() => urls.value.slice(-MAX_PLATES))
const n = computed(() => Math.max(1, plates.value.length))
/** 还能加：摊开时行尾出「点击添加」格 */
const canAddMore = computed(() => !disabled && count.value > 0 && count.value < max)

// ---------------- 悬停摊开 + 面板接力 ----------------

const expanded = ref(false)
/** 摊开步长：3px 缝放得下用 63，放不下按同排可用宽度压缩，最密 8 */
const step = ref(63)
const panelLeft = ref(0)
const panelWidth = ref(PANEL_W)
/** 面板大图：悬停 / 聚焦到哪张就看哪张 */
const active = ref('')
let leaveTimer: ReturnType<typeof setTimeout> | null = null
let openTimer: ReturnType<typeof setTimeout> | null = null

function clearLeave() {
  if (leaveTimer) {
    clearTimeout(leaveTimer)
    leaveTimer = null
  }
  if (openTimer) {
    clearTimeout(openTimer)
    openTimer = null
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
  const addW = canAddMore.value ? ADD_W : 0
  step.value = gaps ? Math.min(81, Math.max(8, (room - PLATE_W - addW) / gaps)) : 81
  // 面板默认左对齐入口，放不下就往左挪，右缘不越过同排容器
  const rootRect = root.getBoundingClientRect()
  if (panelFill) {
    panelWidth.value = Math.max(PANEL_W, parentRect.right - rootRect.left)
    panelLeft.value = Math.min(0, parentRect.right - rootRect.left - panelWidth.value)
    return
  }
  panelWidth.value = Math.min(PANEL_W, parentRect.width)
  panelLeft.value = Math.min(0, parentRect.right - rootRect.left - panelWidth.value)
}

function openNow() {
  clearLeave()
  if (!expanded.value) measure()
  expanded.value = true
}

/** 鼠标悬停 500ms 才摊开（路过不抖）；已摊开时回来只取消收回 */
function onEnter() {
  clearLeave()
  if (expanded.value) return
  openTimer = setTimeout(() => {
    openTimer = null
    openNow()
  }, OPEN_DELAY)
}

/** 离开等 2s 再收：走进下方面板（顶上 12 高透明桥）/ 删除钮 / 行尾添加格，中间不收 */
function onLeave() {
  clearLeave()
  if (!expanded.value) return
  leaveTimer = setTimeout(() => {
    leaveTimer = null
    collapse()
  }, CLOSE_DELAY)
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
/** 最上面一张的删除钮：最后一张片内右上角 4/4（与张数徽标同位） */
const delLeft = computed(() => `${PLATE_W + (n.value - 1) * (expanded.value ? step.value : STACK) - 24}px`)
/** 摊开时每张片子左上角的「替换」钮（picker 模式发 replace 事件，由页面换图） */
const plateReplaces = computed(() =>
  expanded.value && count.value && !disabled
    ? plates.value.map((url, i) => ({
        url,
        index: count.value - plates.value.length + i,
        left: `${i * step.value + 4}px`,
      }))
    : [],
)
const panelOpen = computed(() => expanded.value && count.value > 0 && count.value >= panelMin)
/** 不出面板时（张数 < panelMin）片子上的逐张删除钮：片内右下角 3/3，跟着摊开走 */
const plateDels = computed(() =>
  count.value && count.value < panelMin && !disabled
    ? plates.value.map((url, i) => ({
        url,
        index: count.value - plates.value.length + i,
        left: `${i * (expanded.value ? step.value : STACK) + PLATE_W - 23}px`,
      }))
    : [],
)

// ---------------- 增删 ----------------

function onEntryClick() {
  if (disabled || uploading.value) return
  replaceIndex = -1
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

/** 右上角删除：只删最上面（最后）一张 */
function removeLast() {
  removeAt(count.value - 1)
}

/** 清空整组：显式操作 + 二次确认（原来右上角一点就清空，容易误删） */
function confirmClear() {
  if (disabled || !count.value) return
  const title = label || name || '图片'
  dialog.warning({
    title: `清空${title}`,
    content: `这 ${count.value} 张${title}会全部移除，确定清空？`,
    positiveText: '清空',
    negativeText: '取消',
    onPositiveClick: () => clearAll(),
  })
}

function clearAll() {
  if (disabled) return
  const total = count.value
  invalidateUploads()
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

/** 替换：选中的那一张位置不变，只换图 */
let replaceIndex = -1
function startReplace(index: number) {
  if (disabled || uploading.value) return
  if (picker) {
    emit('replace', index)
    return
  }
  replaceIndex = index
  fileInput.value?.click()
}

async function replaceWith(index: number, files: File[]) {
  const old = urls.value[index]
  if (old === undefined) return
  await uploadFiles(files.slice(0, 1), 1, 1, (url) => {
    const at = urls.value.indexOf(old)
    if (at >= 0) urls.value.splice(at, 1, url)
    if (active.value === old) active.value = url
  })
}

function onFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  const at = replaceIndex
  replaceIndex = -1
  if (at >= 0) void replaceWith(at, files)
  else void addFiles(files)
}

/** 行尾「点击添加」格：与点叠片同一条路径（picker 模式交给页面） */
function onAddClick() {
  if (disabled || uploading.value) return
  replaceIndex = -1
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

/** 拖入 / 粘贴进来的文件（数量、余量、非图片的提示都在 addFiles → useStudioUploader 里，与选文件同口径） */
function onIncoming(files: File[]) {
  if (disabled || uploading.value) return
  if (!files.length) return
  // picker 模式由页面按自己的规则入组：页面接了文件就交给它，否则打开页面的弹窗，不静默丢
  if (picker) {
    if (onDropFiles) onDropFiles(files)
    else emit('pick')
    return
  }
  // 满额拖入与点入口同一句提示，不发上传
  if (full.value) {
    message.warning(`满了，最多 ${max} 张；要换先删一张`)
    return
  }
  void addFiles(files)
}

const { dragging } = useFileDropPaste(entryEl, {
  accept: 'image',
  multiple: () => multiple,
  disabled: () => disabled || uploading.value,
  disabledMessage: () => (uploading.value ? '图片还在上传，请稍候' : undefined),
  // picker 模式由页面按自己的规则入组，满额提示也归页面
  full: () => !picker && full.value,
  fullMessage: () => `满了，最多 ${max} 张；要换先删一张`,
  pastePrimary: () => pastePrimary,
  // 与 useStudioUploader 过滤非图片时同一句
  rejectMessage: () => '已跳过非图片文件',
  onFiles: onIncoming,
})

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
  '[.stu-slot+&]:before:h-130px',
  '[.stu-slot+&]:before:pointer-events-none',
  '[.stu-slot+&]:before:bg-[linear-gradient(90deg,rgba(31,35,41,0)_0%,rgba(31,35,41,0.026)_35%,rgba(31,35,41,0.026)_65%,rgba(31,35,41,0)_100%)]',
  '[.stu-slot+&]:before:[mask:linear-gradient(180deg,transparent_0%,#000_12%,#000_88%,transparent_100%)]',
  '[.stu-slot+&]:before:[-webkit-mask:linear-gradient(180deg,transparent_0%,#000_12%,#000_88%,transparent_100%)]',
  "[.stu-slot+&]:after:content-['']",
  '[.stu-slot+&]:after:absolute',
  '[.stu-slot+&]:after:top-0',
  '[.stu-slot+&]:after:left-[-8px]',
  '[.stu-slot+&]:after:w-1px',
  '[.stu-slot+&]:after:h-130px',
  '[.stu-slot+&]:after:pointer-events-none',
  '[.stu-slot+&]:after:bg-[linear-gradient(180deg,rgba(31,35,41,0)_0%,rgba(31,35,41,0.09)_14%,rgba(31,35,41,0.09)_86%,rgba(31,35,41,0)_100%)]',
]
</script>

<template>
  <div
    ref="rootEl"
    class="stu-slot group/slot relative flex flex-col items-center flex-[0_0_auto] min-w-0"
    :class="seamCls"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
    @focusin="openNow"
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

    <div class="relative flex items-start">
      <!-- 入口就是一叠片：后一张盖住前一张只露 6px，悬停摊开 -->
      <button
        ref="entryEl"
        type="button"
        class="relative flex flex-[0_0_auto] flex-col items-center justify-center gap-4px box-border h-130px p-0 overflow-visible rounded-12px sx-squircle cursor-pointer transition-[width] duration-220 ease-[cubic-bezier(0.25,0.8,0.25,1)] motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-violet focus-visible:outline-offset-2 disabled:cursor-not-allowed"
        :class="[
          count
            ? 'border-0 bg-transparent'
            : 'border border-solid border-white bg-white text-placeholder shadow-[0_1px_3px_rgba(31,35,41,0.16)] hover:shadow-[0_2px_6px_rgba(31,35,41,0.2)]',
          full && !picker ? '!cursor-default' : '',
          expanded ? 'z-5' : 'z-1',
          dragging && 'sx-drop-ring',
        ]"
        :style="{ width: entryWidth }"
        :disabled="disabled"
        :aria-disabled="(full && !picker) || undefined"
        :aria-label="entryLabel"
        :title="DROP_PASTE_HINT"
        @click="onEntryClick"
      >
        <span v-if="count" class="absolute left-0 top-0 flex" aria-hidden="true">
          <span
            v-for="(url, index) in plates"
            :key="url"
            class="relative block flex-[0_0_78px] w-78px h-130px box-border overflow-hidden border border-solid border-white rounded-12px sx-squircle bg-surface3 shadow-[0_1px_3px_rgba(31,35,41,0.16)] transition-[margin-left] duration-220 ease-[cubic-bezier(0.25,0.8,0.25,1)] motion-reduce:transition-none"
            :style="{ zIndex: index, marginLeft: index ? plateGap : '0px' }"
            @mouseenter="active = url"
          >
            <img class="block w-full h-full rounded-11px sx-squircle object-cover" :src="url" alt="" />
            <!-- 张数徽标：最后一张右上角，1 张也显示；悬停 / 摊开时让位给删除钮 -->
            <span
              v-if="index === plates.length - 1"
              class="absolute top-4px right-4px z-2 grid place-items-center min-w-16px h-16px box-border px-4px border border-solid border-white rounded-full bg-ink text-white text-10px font-600 leading-none tabular-nums shadow-[0_1px_2px_rgba(31,35,41,0.2)] transition-[opacity,transform] duration-160 group-hover/slot:(opacity-0 scale-80) [@media(hover:none)]:opacity-0 motion-reduce:transition-none"
              :class="expanded ? 'opacity-0 scale-70' : ''"
              >{{ count }}</span
            >
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
            <span class="px-4px text-12px leading-16px text-center">{{ emptyText }}</span>
          </template>
        </template>
        <!-- 有图时继续上传：叠片上盖一层转圈 -->
        <span
          v-if="count && uploading"
          class="absolute inset-0 z-20 grid place-items-center rounded-12px bg-[rgba(255,255,255,0.6)]"
        >
          <n-spin :size="16" />
        </span>
      </button>

      <!-- 云钮：片外右下角 -12/-12；摊开时片子会盖到它，收掉（空块不藏） -->
      <AssetCornerButton
        v-if="cloudVisible"
        :label="label ? `从资产库添加${label}` : '从资产库添加'"
        class="transition-opacity duration-120 motion-reduce:transition-none"
        :class="expanded && count ? 'opacity-0 pointer-events-none' : ''"
        :disabled="disabled"
        @click="onCloudClick"
      />

      <!-- 不出面板时：逐张删除钮落在每张片子右下角，摊开时才可点 -->
      <StudioMedBtn
        v-for="d in plateDels"
        :key="d.url"
        :label="`删除第 ${d.index + 1} 张${label}`"
        class="top-107px z-13 transition-[left,opacity] duration-220 ease-[cubic-bezier(0.25,0.8,0.25,1)] motion-reduce:transition-none"
        :class="expanded ? '' : 'opacity-0 pointer-events-none'"
        :style="{ left: d.left }"
        @click.stop="removeAt(d.index)"
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

      <!-- 摊开时每张左上角「替换」：视觉 22、::after 外扩到 ≥32；悬停到这张 / 键盘聚焦才出现 -->
      <StudioMedBtn
        v-for="r in plateReplaces"
        :key="`rp-${r.url}`"
        :label="`替换第 ${r.index + 1} 张${label}`"
        class="top-4px z-13 !w-22px !h-22px !min-w-22px transition-[left,opacity] duration-220 ease-[cubic-bezier(0.25,0.8,0.25,1)] motion-reduce:transition-none [@media(hover:none)]:opacity-100"
        :class="
          active === r.url
            ? ''
            : 'opacity-0 pointer-events-none focus-visible:(opacity-100 pointer-events-auto) [@media(hover:none)]:pointer-events-auto'
        "
        :style="{ left: r.left }"
        @mouseenter="active = r.url"
        @focus="active = r.url"
        @click.stop="startReplace(r.index)"
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
          <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 20v-4.5h4.5" />
        </svg>
      </StudioMedBtn>

      <!-- 删除钮：最后一张片内右上角（与张数徽标同位），悬停 / 摊开 / 聚焦才出现；只删最上面这一张 -->
      <StudioMedBtn
        v-if="count && !disabled"
        :label="`删除最上面一张${label}`"
        class="top-4px z-14 transition-[left,opacity] duration-220 ease-[cubic-bezier(0.25,0.8,0.25,1)] motion-reduce:transition-none group-hover/slot:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
        :class="expanded ? '' : 'opacity-0'"
        :style="{ left: delLeft }"
        @click.stop="removeLast"
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

      <!-- 摊开时行尾「+ 点击添加」虚线格（有云钮时格内右下角放「资产添加」）；不出面板时「清空」也放在行尾 -->
      <div v-if="expanded && canAddMore" class="relative flex-[0_0_78px] w-78px h-130px ml-3px">
        <button
          type="button"
          class="flex flex-col items-center justify-center gap-4px w-full h-full box-border p-0 rounded-12px sx-squircle border border-dashed border-line bg-white/70 text-placeholder text-12px leading-16px cursor-pointer hover:(border-violet text-violet-ink) sx-focus"
          :aria-label="label ? `添加${label}` : '添加图片'"
          @click.stop="onAddClick"
        >
          <span class="text-16px leading-none" aria-hidden="true">＋</span>
          <span>点击添加</span>
        </button>
        <AssetCornerButton
          v-if="cloudVisible"
          :label="label ? `从资产库添加${label}` : '从资产库添加'"
          :corner="false"
          class="right-4px bottom-4px"
          @click="onCloudClick"
        />
      </div>
      <button
        v-if="expanded && count && !disabled && !panelOpen"
        type="button"
        class="sx-btn-ghost self-center ml-8px !h-28px !px-8px !text-12px"
        @click.stop="confirmClear"
      >
        清空
      </button>
    </div>

    <AssetPickerModal v-if="cloud && !onCloud" v-model:show="assetShow" :limit="room" @select="addAssetUrls" />

    <p
      v-if="label"
      class="flex flex-col items-center gap-2px w-78px mt-8px mb-0 text-11px leading-15px text-center text-placeholder"
    >
      <b class="text-12px leading-16px font-500 text-ink-2">{{ label }}</b>
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
      <div class="flex items-baseline gap-6px mb-6px text-11px text-muted">
        <b class="text-11px font-600 text-ink-2">{{ label || '图片' }}</b>
        <span>{{ count }} 张</span>
        <em class="ml-auto not-italic text-9px text-placeholder">{{ picker ? '点叠片编辑' : '悬停看大图' }}</em>
        <button
          v-if="!disabled"
          type="button"
          class="sx-btn-ghost !h-28px !px-8px !text-12px !text-danger"
          @click.stop="confirmClear"
        >
          清空
        </button>
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
