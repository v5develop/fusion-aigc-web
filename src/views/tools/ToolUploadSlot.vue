<script setup lang="ts">
/**
 * 工具页的上传槽位：图片或视频，按 schema 的 max / maxBytes / accept / 时长在上传前拦截。
 *
 * <p>上传走现有的 api/ossUpload.ts（STS 直传 + confirm，ImageUpload / VideoUpload 同一条通道），不另开通道。
 *
 * <p>长相对齐 s1.1 统一上传态（`layout`，见 schemas.ts 的 UploadLayout）：
 * - batch / single：B3.1 卡最宽 434、高度吃满操作栏余高（原型 .tool-op__uploads > section 的 flex 1 1 auto；1px line、r6、内边距 12），
 *   空态只有 48 云影球、球心在卡正中，不写「原图」；
 *   batch 有图后是 60×100 白边浮片格（5 列、列距按卡内宽分、行距 72，408×616 在卡内垂直居中；卡宽固定，
 *   原型的 min(1, 宽/408, 高/400) 缩放恒为 1，不另做）；
 * - pipe：同款片格 5 列 × 4 行 = 408×512（产品替换底图）；`bare` 时不画卡壳（外层产品替换图台自己是卡）；
 * - anchor：产品替换「替换素材」96 见方单图格（名字在上；点格选图 = 换一张，右上删除、右下资产添加）；
 * - ml / material：78×130 · r12 叠片入口（StudioImageUpload 的 picker 模式只负责长相，选文件 / 校验 / 上传仍在这里）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { upload } from '@/api/oss-upload.ts'
import { toApiError } from '@/api/index.ts'
import StudioImageUpload from '@/views/studio/components/StudioImageUpload/index.vue'
import AssetCornerButton from '@/components/Creation/AssetCornerButton.vue'
import ReferenceStrip from '@/components/Creation/ReferenceStrip.vue'
import ReferenceStripClassic from '@/components/Creation/ReferenceStripClassic.vue'
import StudioMedBtn from '@/views/studio/components/StudioImageUpload/StudioMedBtn.vue'
import AssetPickerModal from '@/views/studio/components/AssetPickerModal/index.vue'
import MediaLightbox, { type LightboxItem } from '@/components/MediaLightbox/index.vue'
import type { UploadLayout, UploadSpec } from './schemas'
import { DROP_PASTE_HINT, ZONE_FULL_TEXT, useFileDropPaste } from '@/composables/useFileDropPaste'

const props = defineProps<{
  spec: UploadSpec
  id: string
  disabled?: boolean
  /** s1.1 版式（纯展示）；不传按 kind / max 推断：视频或单张 = single，多张 = batch */
  layout?: UploadLayout
  /** 显示「从资产库添加」（图片槽按 media=image、视频槽按 media=video 列资产；工具页与工作流页都打开） */
  assetPicker?: boolean
  /**
   * 嵌在提示词一体框里（工具页 ml 版式）：槽头只给读屏（计数由框顶行写），叠片与「从资产库添加」并排一行
   */
  bare?: boolean
  /**
   * 嵌在一体框里的参考图条由它画框顶计数行（计数 + 书本钮；见 ReferenceStrip 的 head）。headText 覆盖计数文案，
   * headTitle 是计数的悬停提示；library 时画书本钮，点了发 open-library（锚点 = 按钮），libraryOpen 给 aria-expanded
   */
  stripHead?: boolean
  headText?: string
  headTitle?: string
  library?: boolean
  libraryOpen?: boolean
  /**
   * 带标题的单槽卡（与提示词框同列分高时用，原型 tool-op.is-ml 上传卡）：卡内顶部居中写槽名，投放区最小高 200、可压缩，
   * 「资产添加」在投放区下方居中；高度随列按 flex 比例分配（flex 1 1 auto）
   */
  titled?: boolean
  /** titled 卡在当前模型不支持这类素材时的说明（写在标题下，投放区保持卡形但禁用） */
  unsupportedHint?: string
  /** 页面上有多个上传区、又没悬停在任何一个上时，粘贴（Ctrl/⌘+V）交给它；一页最多标一个 */
  pastePrimary?: boolean
}>()
const emit = defineEmits<{ 'open-library': [anchor: HTMLElement] }>()
const urls = defineModel<string[]>({ required: true })
/** 正在上传（只往外报）：页面据此在上传未完成时禁止提交；卸载时报回 false */
const busy = defineModel<boolean>('uploading', { default: false })

const message = useMessage()
const inputRef = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
watch(uploading, (v) => (busy.value = v))
let alive = true
onBeforeUnmount(() => {
  alive = false
  if (uploading.value) busy.value = false
})

const isVideo = computed(() => props.spec.kind === 'video')
const room = computed(() => props.spec.max - urls.value.length)
const exts = computed(() => props.spec.accept.split(',').map((s) => s.trim().toLowerCase()))
const extText = computed(() => exts.value.map((e) => e.replace('.', '').toUpperCase()).join(' / '))
const sizeText = computed(() => {
  const mb = props.spec.maxBytes / 1024 / 1024
  return mb >= 1024 ? `${mb / 1024}G` : `${mb}M`
})
const hint = computed(() => {
  if (props.spec.hint) return `${props.spec.hint}；${DROP_PASTE_HINT}`
  // 原型口径：「支持 JPG / JPEG / PNG / WEBP / GIF，单张不超过 10MB」（校验报错仍用 sizeText）
  const parts = [`支持 ${extText.value}`, `单${isVideo.value ? '段' : '张'}不超过 ${sizeText.value}B`]
  if (props.spec.max > 1) parts.push(`最多 ${props.spec.max} ${isVideo.value ? '段' : '张'}`)
  if (props.spec.minDuration || props.spec.maxDuration)
    parts.push(`时长 ${props.spec.minDuration ?? 0}–${props.spec.maxDuration ?? '∞'} 秒`)
  parts.push(DROP_PASTE_HINT)
  return parts.join('，')
})

function pick() {
  if (props.disabled || uploading.value) return
  inputRef.value?.click()
}

/** 读取视频时长（秒）；读不出来返回 null，不拦截 */
function videoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const el = document.createElement('video')
    const url = URL.createObjectURL(file)
    const done = (v: number | null) => {
      URL.revokeObjectURL(url)
      resolve(v)
    }
    el.preload = 'metadata'
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : null)
    el.onerror = () => done(null)
    el.src = url
  })
}

async function validate(file: File): Promise<string | null> {
  const name = file.name.toLowerCase()
  if (!exts.value.some((ext) => name.endsWith(ext))) {
    return `「${file.name}」格式不支持，仅支持 ${extText.value}`
  }
  if (file.size > props.spec.maxBytes) {
    return `「${file.name}」超过 ${sizeText.value}，请压缩后再上传`
  }
  if (isVideo.value && (props.spec.minDuration || props.spec.maxDuration)) {
    const d = await videoDuration(file)
    if (d !== null) {
      if (props.spec.minDuration && d < props.spec.minDuration) {
        return `「${file.name}」时长不足 ${props.spec.minDuration} 秒`
      }
      if (props.spec.maxDuration && d > props.spec.maxDuration) {
        return `「${file.name}」时长超过 ${props.spec.maxDuration} 秒`
      }
    }
  }
  return null
}

async function onChange(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  await addFiles(files)
}

/** 选文件 / 拖入 / 粘贴共用：名额、格式、体积、时长校验后上传 */
async function addFiles(files: File[]) {
  if (!files.length) return
  // 单槽位（max=1）选新文件 = 换一张
  const replacing = props.spec.max === 1
  const capacity = replacing ? 1 : room.value
  if (capacity <= 0) {
    message.warning(`最多上传 ${props.spec.max} ${isVideo.value ? '段' : '张'}`)
    return
  }
  let picked = files
  if (picked.length > capacity) {
    message.warning(`最多还能添加 ${capacity} 个，多选的 ${picked.length - capacity} 个未添加`)
    picked = picked.slice(0, capacity)
  }
  const valid: File[] = []
  for (const f of picked) {
    const err = await validate(f)
    if (err) message.error(err)
    else valid.push(f)
  }
  if (!valid.length) return

  uploading.value = true
  try {
    const uploaded = await upload(valid)
    // 传的过程中槽位被卸载（切工具 / 换到不支持该槽的模型）：结果作废，不往别处写
    if (!alive) return
    urls.value = replacing ? uploaded.slice(0, 1) : [...urls.value, ...uploaded]
  } catch (err) {
    // 业务失败（取凭证被拒等）请求层已 toast，这里只补传输层 / 对象存储的失败提示
    const apiErr = toApiError(err)
    if (!apiErr || apiErr.code === -1) message.error('上传失败，请检查网络后重试')
  } finally {
    uploading.value = false
  }
}

// 拖入 / 粘贴：整个槽位接（叠片版式由 StudioImageUpload 接住后经 on-drop-files 交回 addFiles）
const rootEl = ref<HTMLElement | null>(null)
const { dragging } = useFileDropPaste(rootEl, {
  accept: () => (isVideo.value ? 'video' : 'image'),
  multiple: () => props.spec.max > 1,
  // 单张槽收到新文件 = 换一张，不算满
  full: () => props.spec.max > 1 && room.value <= 0,
  fullMessage: () => `${ZONE_FULL_TEXT}，最多上传 ${props.spec.max} ${isVideo.value ? '段' : '张'}`,
  disabled: () => !!props.disabled || uploading.value,
  disabledMessage: () => (uploading.value ? '还在上传，请稍候' : undefined),
  pastePrimary: () => !!props.pastePrimary,
  rejectMessage: (file) => `「${file.name}」格式不支持，仅支持 ${extText.value}`,
  onFiles: (files) => void addFiles(files),
})

// ---------------- 从资产库添加 ----------------

const assetShow = ref(false)
/** 图片槽与视频槽都有：视频槽资产库按 media=video 列、选回 video_url，照常按 accept 校验 */
const canPickAsset = computed(() => !!props.assetPicker)

function openAssetPicker() {
  if (props.disabled || uploading.value) return
  assetShow.value = true
}

/**
 * 资产库选回的是已在存储里的 URL，不再走 OSS 上传；入组规则与本地上传 onChange 一致：
 * 单张槽 = 换一张、多张槽按剩余名额截断并给同一句提示、格式按 accept 拦（URL 路径带扩展名时才能判）。
 * 大小 / 时长在 URL 上拿不到，不拦（资产库按槽位只列 media=image 的图片或 media=video 的视频，均为 http(s)）。
 */
function addAssetUrls(picked: string[]) {
  const fresh = picked.filter((u) => /^https?:\/\//i.test(u) && !urls.value.includes(u))
  if (fresh.length < picked.length) message.warning(`已跳过重复或不可用的${isVideo.value ? '视频' : '图片'}`)
  const replacing = props.spec.max === 1
  const capacity = replacing ? 1 : room.value
  if (capacity <= 0) {
    message.warning(`最多上传 ${props.spec.max} ${isVideo.value ? '段' : '张'}`)
    return
  }
  let take = fresh
  if (take.length > capacity) {
    message.warning(`最多还能添加 ${capacity} 个，多选的 ${take.length - capacity} 个未添加`)
    take = take.slice(0, capacity)
  }
  const valid = take.filter((u) => {
    const path = (u.split(/[?#]/)[0] ?? '').toLowerCase()
    const name = path.slice(path.lastIndexOf('/') + 1)
    if (!name.includes('.') || exts.value.some((ext) => name.endsWith(ext))) return true
    message.error(`「${name}」格式不支持，仅支持 ${extText.value}`)
    return false
  })
  if (!valid.length) return
  urls.value = replacing ? valid.slice(0, 1) : [...urls.value, ...valid]
}

// ---------------- 叠片「替换」（StudioImageUpload picker 模式发 replace(index)） ----------------

const replaceInputRef = ref<HTMLInputElement | null>(null)
let replaceTarget = ''
function startReplace(index: number) {
  if (props.disabled || uploading.value) return
  const url = urls.value[index]
  if (url === undefined) return
  replaceTarget = url
  replaceInputRef.value?.click()
}
/** 与新增同一套校验（格式 / 体积 / 时长）后上传，按旧地址找回位置原位换掉；传的过程中那张被删了就不写 */
async function onReplaceChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  const old = replaceTarget
  replaceTarget = ''
  if (!file || !old) return
  const err = await validate(file)
  if (err) {
    message.error(err)
    return
  }
  uploading.value = true
  try {
    const [url] = await upload([file])
    if (!alive || !url) return
    const at = urls.value.indexOf(old)
    if (at < 0) return
    const next = [...urls.value]
    next.splice(at, 1, url)
    urls.value = next
  } catch (err) {
    const apiErr = toApiError(err)
    if (!apiErr || apiErr.code === -1) message.error('上传失败，请检查网络后重试')
  } finally {
    uploading.value = false
  }
}

// ---------------- 片格点开看大图（batch：高清放大等） ----------------

const zoom = ref<{ show: boolean; index: number }>({ show: false, index: 0 })
const zoomItems = computed<LightboxItem[]>(() =>
  urls.value.map((url, i) => ({ url, type: 'image', name: `${props.spec.label} · ${i + 1}` })),
)
function openZoom(i: number) {
  if (!urls.value[i]) return
  zoom.value = { show: true, index: i }
}

function remove(i: number) {
  urls.value = urls.value.filter((_, idx) => idx !== i)
}

// ---------------- 展示（s1.1 统一上传态） ----------------

const mode = computed<UploadLayout>(() => props.layout ?? (isVideo.value || props.spec.max === 1 ? 'single' : 'batch'))
const isPlates = computed(() => mode.value === 'ml' || mode.value === 'material')
/** 一体框里的参考图条：schema 的 strip 设计期选长相（prototype = 5185 原型，其余 = 原来的样子），两个组件同 props / 事件 */
const stripComp = computed(() => (props.spec.strip === 'prototype' ? ReferenceStrip : ReferenceStripClassic))
/** 读屏 / 提示里的图片名：去掉槽名里的括注（「参考图（选填）」→「参考图」） */
const stripName = computed(() => props.spec.label.replace(/（[^）]*）/g, ''))
const unit = computed(() => (isVideo.value ? '段' : '张'))
/** 槽头只在单角色参考图槽（数量写槽头）和产品替换底图显示；其它版式名称只给读屏（s1.1：上传框上方不再写「原图」） */
const showHeader = computed(() => (!props.bare && mode.value === 'ml') || mode.value === 'pipe')

/** 叠片入口点击：满额先给同一句提示，不弹文件框（单张槽 = 换一张，照常弹） */
function pickFromPlates() {
  if (props.spec.max > 1 && room.value <= 0) {
    message.warning(`最多上传 ${props.spec.max} ${unit.value}`)
    return
  }
  pick()
}

/** 空片格（产品替换的底图占位）：只给鼠标，键盘走「待上传」片 */
function pickFromPlaceholder() {
  if (room.value > 0) pick()
}

/** 片格版式里的空位：产品替换空态是 4 个底图占位 + 1 个添加格，正好 5 列 */
const placeholders = computed(() => (mode.value === 'pipe' ? Math.max(0, 4 - urls.value.length) : 0))

/** 悬停预览朝向：后两列往左展开、下两行往上展开，240 宽的预览不出卡 */
function previewPos(i: number) {
  const col = i % (mode.value === 'batch' ? 4 : 5)
  const row = Math.floor(i / (mode.value === 'batch' ? 4 : 5))
  return [col >= 2 ? 'right-0' : 'left-0', mode.value === 'batch' && row >= 2 ? 'bottom-[140px]' : 'top-[140px]']
}

// 云影球：真实弹跳 1300ms，弹跳中再移入不重播（1360ms 锁）
const ballPlaying = ref(false)
let ballTimer: ReturnType<typeof setTimeout> | null = null
function playBall() {
  if (ballPlaying.value) return
  ballPlaying.value = true
  ballTimer = setTimeout(() => {
    ballPlaying.value = false
    ballTimer = null
  }, 1360)
}
onBeforeUnmount(() => {
  if (ballTimer) clearTimeout(ballTimer)
})

const focusRing = 'outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)'
/** titled 卡下方的小按钮（原型 n-button small「资产添加」）：28 高、12px、白→#fbfcfc 板 + 控制线 */
const smallBtnCls =
  'h-28px box-border px-10px rounded-4px border border-solid border-control bg-[linear-gradient(var(--xq-surface),var(--xq-plate-bottom))] ' +
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(31,35,41,0.04),0_1px_2px_rgba(31,35,41,0.05)] ' +
  'text-12px font-500 leading-12px text-ink-2 cursor-pointer hover:(border-control-hover text-ink) disabled:(opacity-50 cursor-not-allowed)'
/**
 * 批量空态投放区（原型 C-35 压沿空态，sx-drop-pressed.css）：本体 1px 透明实线 + r8；虚线单独一层 ::before（inset -1、r9）——
 * border-style 不能补间，悬停时虚线 160ms 淡出、rgba(.16) 实线淡入，上沿 / 左右内影 240ms ease-out；拖入换藤紫实线 + 柔紫底、虚线隐去。
 */
const batchZoneCls =
  'rounded-8px border border-solid [transition:border-color_160ms_ease-out,box-shadow_240ms_ease-out] ' +
  "before:(content-[''] absolute -inset-1px box-border rounded-9px border border-dashed border-[rgb(var(--xq-ink-rgb)/0.1)] pointer-events-none) " +
  'before:[transition:opacity_160ms_ease-out] motion-reduce:before:transition-none'
/**
 * 单图空态（原型 .single-zone 外框）：r8、白→#f9fafb、内影；内框虚线与批量空态同一层 ::before（1px dashed rgba(31,35,41,.1)、inset -1、r9），
 * 本体 1px 透明实线；悬停虚线淡出、柔紫实线 + 白→#fbf7fd，200ms；拖入藤紫线 + 柔紫底、虚线隐去
 */
const singleZoneCls =
  'rounded-8px border border-solid shadow-[inset_0_1px_3px_rgba(31,35,41,0.04)] [transition:border-color_0.2s_ease,background-color_0.2s_ease] ' +
  "before:(content-[''] absolute -inset-1px box-border rounded-9px border border-dashed border-[rgb(var(--xq-ink-rgb)/0.1)] pointer-events-none) " +
  'before:[transition:opacity_160ms_ease-out] motion-reduce:before:transition-none'
/** B3.1 上传卡（原型 v3:2080-2091）：最宽 434、撑满余高的外壳，1px #e5e7eb、圆角 6、内边距 12；内凹 16 柔影 + 顶 1px 内线，边框 / 底色 200ms 过渡 */
const cardCls =
  'relative w-full max-w-[434px] box-border p-12px rounded-6px border border-solid border-line bg-white ' +
  'shadow-[inset_0_0_16px_rgba(31,35,41,0.12),inset_0_1px_0_rgba(31,35,41,0.05)] ' +
  '[transition:border-color_0.2s_ease,background_0.2s_ease]'
/** 白边浮片（2026-11-06 C-37 放大一档）：批量 78×130 · r5 · 1px #fff · 0 1px 3px .16；pipe（产品替换底图）保持 60×100；悬停只把影压深 */
const plateCls =
  'relative w-full h-full box-border rounded-5px border border-solid border-plate-edge bg-white ' +
  'shadow-[0_1px_3px_rgba(31,35,41,0.16)] transition-shadow duration-160 ease-out motion-reduce:transition-none ' +
  'hover:shadow-[0_2px_6px_rgba(31,35,41,0.2)]'
/** 片格尺寸与网格按版式分档：batch 4 列 78 / 行 130 / 列距 27、行距 40；pipe 5 列 60 / 行 100 */
const gridCls = 'm-0 p-0 list-none grid'
const plateSizeCls = computed(() => (mode.value === 'batch' ? 'w-78px h-130px' : 'w-60px h-100px'))
/** 切口：同排两块隔 16，线画在第二块上（9 宽柔影带 α.026 上下渐隐 + 正中 1px 中线 α.09） */
const seamCls = [
  "[.tus-plate+&]:before:content-[''] [.tus-plate+&]:before:absolute [.tus-plate+&]:before:top-0",
  '[.tus-plate+&]:before:left-[-12px] [.tus-plate+&]:before:w-9px [.tus-plate+&]:before:h-130px',
  '[.tus-plate+&]:before:pointer-events-none',
  '[.tus-plate+&]:before:bg-[linear-gradient(90deg,rgb(var(--xq-ink-rgb)/0)_0%,rgb(var(--xq-ink-rgb)/0.026)_35%,rgb(var(--xq-ink-rgb)/0.026)_65%,rgb(var(--xq-ink-rgb)/0)_100%)]',
  '[.tus-plate+&]:before:[mask:linear-gradient(180deg,transparent_0%,#000_12%,#000_88%,transparent_100%)]',
  '[.tus-plate+&]:before:[-webkit-mask:linear-gradient(180deg,transparent_0%,#000_12%,#000_88%,transparent_100%)]',
  "[.tus-plate+&]:after:content-[''] [.tus-plate+&]:after:absolute [.tus-plate+&]:after:top-0",
  '[.tus-plate+&]:after:left-[-8px] [.tus-plate+&]:after:w-1px [.tus-plate+&]:after:h-130px',
  '[.tus-plate+&]:after:pointer-events-none',
  '[.tus-plate+&]:after:bg-[linear-gradient(180deg,rgb(var(--xq-ink-rgb)/0)_0%,rgb(var(--xq-ink-rgb)/0.09)_14%,rgb(var(--xq-ink-rgb)/0.09)_86%,rgb(var(--xq-ink-rgb)/0)_100%)]',
]
</script>

<template>
  <div
    ref="rootEl"
    :class="
      isPlates
        ? bare
          ? 'relative min-w-0'
          : ['tus-plate relative flex-[0_0_auto] min-w-0', seamCls]
        : titled && mode === 'single'
          ? 'w-full flex flex-col flex-[1_1_auto]'
          : mode === 'single' || mode === 'batch'
            ? ['w-full flex justify-center', !(urls.length && mode === 'single') && 'flex-[1_0_auto]']
            : mode === 'video'
              ? 'flex-1 min-h-[300px] flex'
              : mode === 'anchor'
                ? 'relative z-2 flex flex-col items-center gap-4px'
                : ''
    "
  >
    <div :class="showHeader ? 'll-label' : 'sr-only'">
      <span :id="`${id}-label`">
        {{ spec.label }}
        <span v-if="spec.required" class="text-danger" aria-hidden="true">*</span>
      </span>
      <span v-if="spec.max > 1 || mode === 'ml'" class="text-12px text-placeholder">{{
        uploading ? '上传中…' : `${urls.length} / ${spec.max}`
      }}</span>
    </div>
    <input
      :id="id"
      ref="inputRef"
      type="file"
      class="hidden"
      :accept="spec.accept"
      :multiple="spec.max > 1"
      :aria-labelledby="`${id}-label`"
      @change="onChange"
    />
    <input
      v-if="isPlates"
      ref="replaceInputRef"
      type="file"
      class="hidden"
      :accept="spec.accept"
      tabindex="-1"
      aria-hidden="true"
      @change="onReplaceChange"
    />

    <MediaLightbox
      v-if="mode === 'batch' && !isVideo"
      v-model:show="zoom.show"
      v-model:index="zoom.index"
      :items="zoomItems"
      pannable
    />
    <AssetPickerModal
      v-if="canPickAsset"
      v-model:show="assetShow"
      :limit="spec.max === 1 ? 1 : Math.max(room, 1)"
      :media="isVideo ? 'video' : 'image'"
      @select="addAssetUrls"
    />

    <!--
      一体框里的参考图条（bare ml）：ReferenceStrip（原型）/ ReferenceStripClassic（原来的样子），schema 的 strip 选；
      其余叠片入口（material / 非一体框 ml）仍是 StudioImageUpload picker，资产入口一律是叠片右下角云钮（不再旁挂文字钮）
    -->
    <component
      :is="stripComp"
      v-if="isPlates && bare"
      :urls="urls"
      :max="spec.max"
      :label="stripName"
      :disabled="disabled"
      :uploading="uploading"
      :head="stripHead"
      :head-text="headText"
      :head-title="headTitle"
      :library="library"
      :library-open="libraryOpen"
      :asset="canPickAsset"
      :on-drop-files="addFiles"
      @pick="pickFromPlates"
      @replace="startReplace"
      @remove="remove"
      @clear="urls = []"
      @asset="openAssetPicker"
      @open-library="(el: HTMLElement) => emit('open-library', el)"
    />
    <StudioImageUpload
      v-else-if="isPlates"
      :model-value="urls"
      picker
      :max="spec.max"
      :multiple="spec.max > 1"
      :disabled="disabled"
      :label="mode === 'material' ? spec.label : ''"
      :name="spec.label"
      :hint="uploading ? '上传中…' : ''"
      :on-drop-files="addFiles"
      :on-cloud="canPickAsset ? openAssetPicker : undefined"
      @pick="pickFromPlates"
      @remove="(_url: string, index: number) => remove(index)"
      @replace="startReplace"
      @clear="urls = []"
    />

    <!-- 带标题的单槽卡（titled）：卡内顶部居中槽名 → 投放区（最小高 200、可压缩）。空态「从资产库添加」在投放区右上角（不占投放区高度）；已有视频时「换一段 / 资产添加」在下方 -->
    <div
      v-else-if="titled && mode === 'single'"
      :class="[
        'relative flex flex-col flex-[1_1_auto] gap-8px w-full box-border p-12px rounded-6px border border-solid border-line bg-white',
        'shadow-[inset_0_0_16px_rgba(31,35,41,0.12),inset_0_1px_0_rgba(31,35,41,0.05)]',
        dragging && 'sx-drop',
      ]"
    >
      <p class="flex-none m-0 mx-auto text-12px font-500 leading-16px text-center text-ink-2" aria-hidden="true">
        {{ spec.label }}<span v-if="spec.required" class="text-danger"> *</span>
      </p>
      <p v-if="unsupportedHint" class="flex-none m-0 text-center text-12px leading-18px text-muted">
        {{ unsupportedHint }}
      </p>
      <div v-if="!urls.length" class="relative flex flex-col flex-[1_1_auto] min-h-200px">
        <button
          type="button"
          class="relative flex flex-col flex-[1_1_auto] items-center justify-center gap-6px w-full min-h-200px box-border p-12px cursor-pointer motion-reduce:transition-none disabled:(cursor-not-allowed opacity-60)"
          :class="[
            focusRing,
            singleZoneCls,
            dragging
              ? 'border-violet bg-violet-soft before:opacity-0'
              : disabled || uploading
                ? 'border-transparent bg-gradient-to-b from-white to-upload-bottom before:opacity-100'
                : 'border-transparent bg-gradient-to-b from-white to-upload-bottom before:opacity-100 hover:(border-violet-line from-white to-upload-hover-bottom before:opacity-0)',
          ]"
          :disabled="disabled || uploading"
          :aria-describedby="`${id}-hint`"
          @click="pick"
        >
          <span
            class="relative grid flex-none w-64px h-72px place-items-center"
            aria-hidden="true"
            @pointerenter="playBall"
          >
            <span
              class="absolute left-1/2 bottom-2px z-1 w-[38.4px] h-[11.2px] ml-[-19.2px] rounded-full bg-[rgba(31,35,41,0.32)] blur-[7.2px] opacity-75 scale-x-85 scale-y-80 pointer-events-none motion-reduce:animate-none"
              :class="ballPlaying ? 'animate-[tus-ball-ground_1300ms_both]' : ''"
            />
            <span
              class="relative z-2 w-48px h-48px motion-reduce:animate-none"
              :class="ballPlaying ? 'animate-[tus-ball-jump_1300ms_both]' : ''"
            >
              <span
                class="absolute inset-0 box-border border border-solid border-line-strong rounded-full bg-[radial-gradient(circle_at_50%_35%,var(--xq-surface)_0_55%,var(--xq-plate-bottom)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] origin-[50%_100%] motion-reduce:animate-none"
                :class="ballPlaying ? 'animate-[tus-ball-shell_1300ms_both]' : ''"
              />
              <span
                class="absolute inset-0 z-1 grid place-items-center text-ink-2 pointer-events-none -translate-y-2px"
              >
                <svg
                  class="w-[35.2px] h-[35.2px] overflow-visible"
                  viewBox="-0.4 -0.56 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M6.5 18a4.5 4.5 0 0 1-.7-8.95A6 6 0 0 1 17.5 10.5a3.75 3.75 0 0 1 0 7.5z" />
                  <path d="M12 11v7" />
                  <path d="M9.5 13.5 12 11l2.5 2.5" />
                </svg>
              </span>
            </span>
          </span>
          <b class="text-13px font-600 leading-[1.4] text-ink">{{
            uploading ? '上传中…' : (spec.title ?? `拖拽或点击上传${isVideo ? '视频' : '图片'}`)
          }}</b>
          <span v-if="spec.subtitle" class="text-11px leading-[1.5] text-muted">{{ spec.subtitle }}</span>
          <span :id="`${id}-hint`" class="text-11px leading-[1.5] text-muted">{{ hint }}</span>
        </button>
        <!-- 与投放按钮是兄弟节点（按钮里不能再套按钮）；样式与其它上传卡右上角那颗一致 -->
        <button
          v-if="canPickAsset"
          type="button"
          class="absolute right-10px top-10px z-30 h-32px box-border px-12px rounded-4px border border-solid border-control bg-[linear-gradient(var(--xq-surface),var(--xq-plate-bottom))] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(31,35,41,0.04),0_1px_2px_rgba(31,35,41,0.05)] text-13px font-500 leading-13px text-ink-2 cursor-pointer hover:(border-control-hover text-ink) disabled:(opacity-50 cursor-not-allowed)"
          :class="focusRing"
          :disabled="disabled || uploading"
          :aria-label="`从资产库添加${spec.label}`"
          @click="openAssetPicker"
        >
          从资产库添加
        </button>
      </div>
      <div
        v-else
        class="relative grid flex-[1_1_auto] min-h-200px place-items-center overflow-hidden rounded-8px border border-solid border-line bg-surface3"
      >
        <video
          v-if="isVideo"
          :src="urls[0]"
          class="block w-full h-full max-h-[340px] object-contain bg-black"
          controls
          preload="metadata"
        />
        <img v-else :src="urls[0]" :alt="spec.label" class="block max-w-full max-h-[340px] object-contain" />
        <StudioMedBtn
          :label="`删除${spec.label}`"
          class="top-8px right-8px disabled:(opacity-45 cursor-not-allowed)"
          :disabled="disabled"
          @click="remove(0)"
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
      <div v-if="urls.length" class="flex-none flex flex-wrap items-center justify-center gap-8px">
        <button type="button" :class="[smallBtnCls, focusRing]" :disabled="disabled || uploading" @click="pick">
          {{ uploading ? '上传中…' : isVideo ? '换一段' : '换一张' }}
        </button>
        <button
          v-if="canPickAsset"
          type="button"
          :class="[smallBtnCls, focusRing]"
          :disabled="disabled || uploading"
          :aria-label="`从资产库添加${spec.label}`"
          title="从资产库添加"
          @click="openAssetPicker"
        >
          资产添加
        </button>
      </div>
    </div>

    <!-- 空态（batch / single）：B3.1 卡撑满余高，整块可点，48 云影球在卡正中 -->
    <div v-else-if="!urls.length && (mode === 'batch' || mode === 'single')" :class="[cardCls, 'flex-1 min-h-[300px]']">
      <div class="relative w-full h-full">
        <button
          type="button"
          class="relative block w-full h-full box-border p-0 cursor-pointer motion-reduce:transition-none disabled:cursor-not-allowed"
          :class="[
            focusRing,
            mode === 'batch' ? batchZoneCls : singleZoneCls,
            mode === 'batch'
              ? dragging
                ? 'border-violet bg-violet-soft before:opacity-0'
                : 'border-transparent bg-transparent before:opacity-100 hover:(border-[rgb(var(--xq-ink-rgb)/0.16)] before:opacity-0) hover:shadow-[inset_0_12px_22px_-12px_rgba(31,35,41,0.22),inset_8px_0_18px_-14px_rgba(31,35,41,0.1),inset_-8px_0_18px_-14px_rgba(31,35,41,0.1),inset_0_-1px_0_rgba(255,255,255,0.9)]'
              : dragging
                ? 'border-violet bg-violet-soft before:opacity-0'
                : 'border-transparent bg-gradient-to-b from-white to-upload-bottom before:opacity-100 hover:(border-violet-line from-white to-upload-hover-bottom before:opacity-0)',
          ]"
          :disabled="disabled || uploading"
          :aria-describedby="`${id}-hint`"
          @click="pick"
        >
          <span
            class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 grid w-64px h-84px place-items-center"
            aria-hidden="true"
            @pointerenter="playBall"
          >
            <!-- 地面影 38.4×11.2 · blur 7.2，弹跳时同步变深变浅 -->
            <span
              class="absolute left-1/2 bottom-5px z-1 w-[38.4px] h-[11.2px] ml-[-19.2px] rounded-full bg-[rgba(31,35,41,0.32)] blur-[7.2px] opacity-75 scale-x-85 scale-y-80 pointer-events-none motion-reduce:animate-none"
              :class="ballPlaying ? 'animate-[tus-ball-ground_1300ms_both]' : ''"
            />
            <span
              class="relative z-2 w-48px h-48px motion-reduce:animate-none"
              :class="ballPlaying ? 'animate-[tus-ball-jump_1300ms_both]' : ''"
            >
              <span
                class="absolute inset-0 box-border border border-solid border-line-strong rounded-full bg-[radial-gradient(circle_at_50%_35%,var(--xq-surface)_0_55%,var(--xq-plate-bottom)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] origin-[50%_100%] motion-reduce:animate-none"
                :class="ballPlaying ? 'animate-[tus-ball-shell_1300ms_both]' : ''"
              />
              <span
                class="absolute inset-0 z-1 grid place-items-center text-ink-2 pointer-events-none -translate-y-2px"
              >
                <svg
                  class="w-[35.2px] h-[35.2px] overflow-visible"
                  viewBox="-0.4 -0.56 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M6.5 18a4.5 4.5 0 0 1-.7-8.95A6 6 0 0 1 17.5 10.5a3.75 3.75 0 0 1 0 7.5z" />
                  <path d="M12 11v7" />
                  <path d="M9.5 13.5 12 11l2.5 2.5" />
                </svg>
              </span>
            </span>
          </span>
          <span class="absolute inset-x-12px top-[calc(50%+46px)] flex flex-col items-center gap-6px text-center">
            <b class="text-13px font-600 leading-[1.4] text-ink">{{
              uploading ? '上传中…' : (spec.title ?? `拖拽或点击上传${isVideo ? '视频' : '图片'}`)
            }}</b>
            <span v-if="spec.subtitle" class="text-11px leading-[1.5] text-muted">{{ spec.subtitle }}</span>
            <span :id="`${id}-hint`" class="text-11px leading-[1.5] text-muted">{{ hint }}</span>
            <span v-if="mode === 'batch'" class="text-11px leading-[1.5] text-muted">已选 0 / {{ spec.max }}</span>
          </span>
        </button>
        <!--
        从资产库添加（文字）：与视频空态同一写法，放在上传区右上角；与整卡上传按钮是兄弟节点（按钮里不能再套按钮）
      -->
        <button
          v-if="canPickAsset"
          type="button"
          class="absolute right-12px top-12px z-30 h-32px box-border px-12px rounded-4px border border-solid border-control bg-[linear-gradient(var(--xq-surface),var(--xq-plate-bottom))] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(31,35,41,0.04),0_1px_2px_rgba(31,35,41,0.05)] text-13px font-500 leading-13px text-ink-2 cursor-pointer hover:(border-control-hover text-ink) disabled:(opacity-50 cursor-not-allowed)"
          :class="focusRing"
          :disabled="disabled || uploading"
          :aria-label="`从资产库添加${spec.label}`"
          @click="openAssetPicker"
        >
          从资产库添加
        </button>
      </div>
    </div>

    <!--
      空态（video）：新版原型视频高清——卡片撑满余高（操作栏 833 高时为 434×607）、1px line 描边、圆角 6、内边距 12；
      文案块靠上居中：大字 13/18.2·600 距卡顶 43，说明与格式行 11/16.5，间距 6；格式行下 8 是「从资产库添加」。
      整卡是上传按钮（铺满的透明按钮），「从资产库添加」是它的兄弟节点（按钮里不能再套按钮）。
    -->
    <div
      v-else-if="!urls.length && mode === 'video'"
      class="group relative flex-1 min-w-0 box-border p-12px rounded-6px border border-solid border-line bg-white shadow-[inset_0_0_16px_rgba(31,35,41,0.12),inset_0_1px_0_rgba(31,35,41,0.05)] [transition:border-color_0.2s_ease,background-color_0.2s_ease] motion-reduce:transition-none hover:border-violet-line"
      :class="dragging && 'sx-drop'"
    >
      <button
        type="button"
        class="absolute inset-0 w-full h-full p-0 rounded-6px border-none bg-transparent cursor-pointer disabled:cursor-not-allowed"
        :class="focusRing"
        :disabled="disabled || uploading"
        :aria-label="uploading ? '上传中…' : (spec.title ?? `拖拽或点击上传${isVideo ? '视频' : '图片'}`)"
        :aria-describedby="`${id}-hint`"
        @click="pick"
      />
      <div class="relative flex flex-col items-center gap-6px pt-30px text-center pointer-events-none">
        <b class="text-13px font-600 leading-[1.4] text-ink">{{
          uploading ? '上传中…' : (spec.title ?? `拖拽或点击上传${isVideo ? '视频' : '图片'}`)
        }}</b>
        <span v-if="spec.subtitle" class="text-11px leading-[1.5] text-muted">{{ spec.subtitle }}</span>
        <span :id="`${id}-hint`" class="text-11px leading-[1.5] text-muted">{{ hint }}</span>
        <button
          v-if="canPickAsset"
          type="button"
          class="mt-2px h-32px box-border px-12px rounded-4px border border-solid border-control bg-[linear-gradient(var(--xq-surface),var(--xq-plate-bottom))] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(31,35,41,0.04),0_1px_2px_rgba(31,35,41,0.05)] text-13px font-500 leading-13px text-ink-2 cursor-pointer pointer-events-auto [transition:color_0.3s_cubic-bezier(0.4,0,0.2,1),background-color_0.3s_cubic-bezier(0.4,0,0.2,1),opacity_0.3s_cubic-bezier(0.4,0,0.2,1),border-color_0.3s_cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none hover:(border-control-hover text-ink) disabled:(opacity-50 cursor-not-allowed)"
          :class="focusRing"
          :disabled="disabled || uploading"
          :aria-label="`从资产库添加${spec.label}`"
          @click="openAssetPicker"
        >
          从资产库添加
        </button>
      </div>
    </div>

    <!-- 有图（batch / pipe）：60×100 白边浮片格；pipe 空态也走这里（4 个底图占位 + 添加格） -->
    <div
      v-else-if="mode === 'batch' || mode === 'pipe'"
      :class="[
        bare && mode === 'pipe' ? 'relative w-full' : cardCls,
        mode === 'batch' ? 'flex-1 min-h-[640px]' : '',
        dragging && 'sx-drop',
      ]"
    >
      <span :id="`${id}-hint`" class="sr-only">{{ hint }}</span>
      <button
        v-if="canPickAsset && room > 0 && mode === 'batch'"
        type="button"
        class="absolute right-12px top-12px z-30 h-32px box-border px-12px rounded-4px border border-solid border-control bg-[linear-gradient(var(--xq-surface),var(--xq-plate-bottom))] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(31,35,41,0.04),0_1px_2px_rgba(31,35,41,0.05)] text-13px font-500 leading-13px text-ink-2 cursor-pointer hover:(border-control-hover text-ink) disabled:(opacity-50 cursor-not-allowed)"
        :class="focusRing"
        :disabled="disabled || uploading"
        :aria-label="`从资产库添加${spec.label}`"
        @click="openAssetPicker"
      >
        从资产库添加
      </button>
      <ul
        :class="[
          gridCls,
          mode === 'batch'
            ? 'h-full grid-cols-[repeat(4,78px)] grid-rows-[repeat(4,130px)] gap-x-27px gap-y-40px content-center'
            : 'grid-cols-[repeat(5,60px)] auto-rows-[100px] justify-between gap-y-[37.33px]',
        ]"
        :aria-labelledby="`${id}-label`"
      >
        <li
          v-for="(url, i) in urls"
          :key="url + i"
          class="group relative z-2"
          :class="plateSizeCls"
          :data-pr-base="mode === 'pipe' ? '' : undefined"
        >
          <!-- 点片（或回车 / 空格）开共用灯箱看原图：滚轮缩放 0.5–4×、放大后拖动平移、双击复位 -->
          <div
            :class="[plateCls, focusRing, mode === 'batch' ? 'cursor-zoom-in' : '']"
            tabindex="0"
            :role="mode === 'batch' ? 'button' : undefined"
            :aria-label="
              mode === 'batch'
                ? `${spec.label} 第 ${i + 1} 张，按回车放大查看，按 Delete 删除`
                : `${spec.label} 第 ${i + 1} 张，按 Delete 删除`
            "
            @click="mode === 'batch' && openZoom(i)"
            @keydown.enter.prevent="mode === 'batch' && openZoom(i)"
            @keydown.space.prevent="mode === 'batch' && openZoom(i)"
            @keydown.delete.prevent="!disabled && remove(i)"
          >
            <img :src="url" alt="" class="block w-full h-full object-cover rounded-4px" />
          </div>
          <!--
            悬停 / 聚焦看大图（原型 HoverPreview）：触发元素 ≤80 宽 → 媒体 240；卡内边距 4、r8；媒体最大高 312；
            延迟 320ms 出现、入场 120ms + 4px 上浮；阴影 0 12px 28px .16 + 0 2px 6px .06；纯看不挡点击
          -->
          <div
            class="hidden group-hover:block group-focus-within:block absolute z-30 w-248px box-border p-4px rounded-8px border border-solid border-line bg-overlay shadow-preview pointer-events-none animate-[tus-preview-in_120ms_ease_320ms_both] motion-reduce:animate-none"
            :class="previewPos(i)"
            aria-hidden="true"
          >
            <div class="grid place-items-center w-240px h-[312px] overflow-hidden rounded-6px bg-surface2">
              <img :src="url" alt="" class="block max-w-full max-h-[312px] object-contain" />
            </div>
          </div>
          <StudioMedBtn
            :label="`删除${spec.label}第 ${i + 1} 个`"
            class="-top-8px -right-8px z-12 disabled:(opacity-45 cursor-not-allowed)"
            :disabled="disabled"
            @click="remove(i)"
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
        </li>

        <li
          v-for="n in placeholders"
          :key="`ph-${n}`"
          class="relative z-2 w-60px h-100px box-border rounded-5px border border-dashed border-line bg-surface2 cursor-pointer"
          data-pr-base
          data-pr-hint
          aria-hidden="true"
          @click="pickFromPlaceholder"
        />

        <!-- 待上传：同尺寸白边浮片，图标 18 + 文案 9/13（间距 4），已选数写在片里 -->
        <li
          v-if="room > 0"
          class="relative z-2"
          :class="plateSizeCls"
          :data-pr-base="mode === 'pipe' ? '' : undefined"
          :data-pr-hint="mode === 'pipe' ? '' : undefined"
        >
          <button
            type="button"
            :class="[
              plateCls,
              focusRing,
              'flex flex-col items-center justify-center gap-4px p-0 text-placeholder cursor-pointer disabled:(cursor-not-allowed opacity-60)',
            ]"
            :disabled="disabled || uploading"
            :aria-label="`${uploading ? '上传中' : `继续添加${spec.label}`}，已选 ${urls.length} / ${spec.max}`"
            :aria-describedby="`${id}-hint`"
            @click="pick"
          >
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
            <span class="text-12px leading-16px">{{ uploading ? '上传中…' : '待上传' }}</span>
            <span class="absolute inset-x-0 bottom-10px text-11px leading-14px text-center text-muted"
              >已选 {{ urls.length }}/{{ spec.max }}</span
            >
          </button>
        </li>
      </ul>
    </div>

    <!--
      产品替换「替换素材」（原型 ProductPipeSlots 定稿）：名字 11/16 在上，96 见方格 r12 白边浮片；空态 + 图标与「上传替换素材」；
      点格 = 选图（单张槽 = 换一张）；有图时右上删除（悬停 / 聚焦出现，触屏常显），右下资产添加；data-pr-anchor 供连线定位
    -->
    <template v-else-if="mode === 'anchor'">
      <span class="relative z-2 px-6px bg-white text-11px leading-16px text-ink-2" aria-hidden="true">
        {{ spec.label }}<span v-if="spec.required" class="text-danger" aria-hidden="true"> *</span>
      </span>
      <span :id="`${id}-hint`" class="sr-only">{{ hint }}</span>
      <div class="group relative w-96px h-96px" data-pr-anchor>
        <button
          type="button"
          class="sx-squircle relative block w-full h-full box-border p-0 overflow-hidden rounded-12px border border-solid cursor-pointer disabled:cursor-not-allowed [transition:border-color_160ms_ease,box-shadow_160ms_ease] motion-reduce:transition-none"
          :class="[
            focusRing,
            urls.length
              ? 'border-white bg-white shadow-[0_1px_3px_rgba(31,35,41,0.16)] hover:shadow-[0_2px_6px_rgba(31,35,41,0.2)]'
              : 'border-line-strong bg-[linear-gradient(var(--xq-surface),var(--xq-upload-bottom))] text-placeholder hover:border-violet-line',
            dragging && 'sx-drop-ring',
          ]"
          :disabled="disabled || uploading"
          :aria-label="urls.length ? `更换${spec.label}` : `上传${spec.label}`"
          :aria-describedby="`${id}-hint`"
          @click="pick"
        >
          <img
            v-if="urls[0]"
            :src="urls[0]"
            :alt="spec.label"
            class="block w-full h-full object-cover rounded-11px"
            draggable="false"
          />
          <span v-else class="flex flex-col items-center justify-center gap-4px w-full h-full">
            <svg
              class="w-18px h-18px text-muted"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span class="text-11px leading-14px">{{ uploading ? '上传中…' : `上传${spec.label}` }}</span>
          </span>
          <span
            v-if="urls.length && uploading"
            class="absolute inset-0 grid place-items-center bg-white/60 text-11px text-ink-2"
            >上传中…</span
          >
        </button>
        <StudioMedBtn
          v-if="urls.length"
          :label="`移除${spec.label}`"
          class="top-4px right-4px opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity duration-160 motion-reduce:transition-none disabled:(opacity-45 cursor-not-allowed)"
          :disabled="disabled"
          @click="remove(0)"
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
        <AssetCornerButton
          v-if="canPickAsset"
          :label="`从资产库添加${spec.label}`"
          :corner="false"
          class="right-4px bottom-4px"
          :disabled="disabled || uploading"
          @click="openAssetPicker"
        />
      </div>
    </template>

    <!-- 有图（single）：在上传卡里看图，图高封顶 340；右上删除，下方换一张 -->
    <div v-else :class="[cardCls, dragging && 'sx-drop']">
      <div
        v-for="(url, i) in urls"
        :key="url + i"
        class="relative grid place-items-center overflow-hidden rounded-8px border border-solid border-line bg-surface3"
      >
        <video
          v-if="isVideo"
          :src="url"
          class="block w-full max-h-[340px] object-contain bg-black"
          controls
          preload="metadata"
        />
        <img
          v-else
          :src="url"
          :alt="`${spec.label} 第 ${i + 1} 张`"
          class="block max-w-full max-h-[340px] object-contain"
        />
        <StudioMedBtn
          :label="`删除${spec.label}第 ${i + 1} 个`"
          class="top-8px right-8px disabled:(opacity-45 cursor-not-allowed)"
          :disabled="disabled"
          @click="remove(i)"
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
      <button
        v-if="spec.max === 1"
        type="button"
        class="ll-pill !min-h-32px !text-13px mt-10px"
        :class="focusRing"
        :disabled="disabled || uploading"
        @click="pick"
      >
        {{ uploading ? '上传中…' : '换一张' }}
      </button>
    </div>

    <!-- pipe 版式（产品替换底图）网格顶格排布，「从资产库添加」放卡内右上角会压住第一行第 5 列的「待上传」格，
         改为卡片下方右对齐（与叠片版式同一处理）；宽度与上传卡对齐。放在整条展示分支之后，不打断 v-if / v-else 链 -->
    <div v-if="canPickAsset && mode === 'pipe' && room > 0" class="flex justify-end mt-6px w-full max-w-[434px]">
      <button
        type="button"
        class="h-32px box-border px-12px rounded-4px border border-solid border-control bg-[linear-gradient(var(--xq-surface),var(--xq-plate-bottom))] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(31,35,41,0.04),0_1px_2px_rgba(31,35,41,0.05)] text-13px font-500 leading-13px text-ink-2 cursor-pointer hover:(border-control-hover text-ink) disabled:(opacity-50 cursor-not-allowed)"
        :class="focusRing"
        :disabled="disabled || uploading"
        :aria-label="`从资产库添加${spec.label}`"
        @click="openAssetPicker"
      >
        从资产库添加
      </button>
    </div>
  </div>
</template>

<style>
/*
 * 只留 @keyframes：UnoCSS 的 animate-[…] 只引用名字，关键帧本身写不成原子类。
 * 不加 scoped——scoped 会给关键帧名加哈希，模板里的原子类就对不上了；名字带 tus- 前缀避免撞名。
 * 数值照抄 s1.1 BounceBallIcon（1300ms · 18px · 落地 1.10/.90 · 起跳 1.08/.92）与 .sx-preview-in（120ms + 4px）。
 */
@keyframes tus-ball-jump {
  0% {
    transform: translateY(0);
    animation-timing-function: ease-in;
  }
  10% {
    transform: translateY(2px);
    animation-timing-function: cubic-bezier(0.16, 0.84, 0.44, 1);
  }
  20% {
    transform: translateY(-8px);
    animation-timing-function: ease-out;
  }
  40% {
    transform: translateY(-18px);
    animation-timing-function: cubic-bezier(0.55, 0, 0.85, 0.36);
  }
  60% {
    transform: translateY(-10px);
    animation-timing-function: ease-in;
  }
  72% {
    transform: translateY(-2px);
    animation-timing-function: cubic-bezier(0.55, 0, 0.85, 0.36);
  }
  78% {
    transform: translateY(0);
    animation-timing-function: cubic-bezier(0.16, 0.84, 0.44, 1);
  }
  88% {
    transform: translateY(-4px);
    animation-timing-function: ease-in;
  }
  95% {
    transform: translateY(0);
    animation-timing-function: ease-out;
  }
  100% {
    transform: translateY(0);
  }
}
@keyframes tus-ball-shell {
  0% {
    transform: scale(1, 1);
  }
  10% {
    transform: scale(1.08, 0.92);
  }
  20% {
    transform: scale(0.97, 1.05);
  }
  40% {
    transform: scale(1, 1);
  }
  60% {
    transform: scale(0.99, 1.02);
  }
  78% {
    transform: scale(1.1, 0.9);
  }
  88% {
    transform: scale(0.98, 1.03);
  }
  95% {
    transform: scale(1.05, 0.96);
  }
  100% {
    transform: scale(1, 1);
  }
}
@keyframes tus-ball-ground {
  0% {
    transform: scale(0.85, 0.8);
    opacity: 0.75;
  }
  10% {
    transform: scale(0.82, 0.9);
    opacity: 0.98;
  }
  20% {
    transform: scale(0.95, 0.75);
    opacity: 0.55;
  }
  40% {
    transform: scale(1.15, 0.75);
    opacity: 0.3;
  }
  60% {
    transform: scale(1.02, 0.8);
    opacity: 0.55;
  }
  78% {
    transform: scale(0.78, 0.95);
    opacity: 1;
  }
  88% {
    transform: scale(0.9, 0.8);
    opacity: 0.65;
  }
  95% {
    transform: scale(0.82, 0.9);
    opacity: 0.95;
  }
  100% {
    transform: scale(0.85, 0.8);
    opacity: 0.75;
  }
}
@keyframes tus-preview-in {
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
