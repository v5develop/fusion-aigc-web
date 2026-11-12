<script setup lang="ts">
import { modelLabelOf } from '@/utils/model-label'
/**
 * 工具箱共用工具页 /tools/:toolId（各工具按 schemas.ts 渲染）。
 *
 * <p>版式对齐新版原型（工具详情页）：贴边目录栏 160（可收起）/ 操作 426（功能卡固定在顶、上传 + 参数自己滚，
 * 底部固定「模型卡 | 设置」+ 提交栏）/ 历史 249 / 结果卡 + 功能介绍卡。进页不选记录：结果列先放功能介绍，
 * 用户点了某条或本次新建了记录才展示结果。操作栏内边距 13，正好放下 s1.1 的 B3.1 上传卡 434×742。
 * 阴影、渐变、过渡时长照抄原型计算样式。提交打 Java v1 现有路由（schema.javaRoute），请求体按 schema 的
 * javaKey 映射组装；结果与历史都取 GET /api/v1/tools/{toolTitle}/histories（异步工具只回任务号）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, useId, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useDialog, useMessage } from 'naive-ui'
import { toApiError } from '@/api/index.ts'
import { upload } from '@/api/oss-upload.ts'
import {
  bizPoints,
  imageModelConfigs,
  submitCutout,
  submitTool,
  toolOcr,
  videoModelConfigs,
  voiceList,
  type ModelConfig,
  type ToolHistoryItem,
  type VoiceItem,
} from '@/api/tools.ts'
import { useUserInfoStore } from '@/stores/user-info'
import { corsAttr, markCorsBlocked } from '@/utils/colorfix.ts'
import IconButton from '@/components/IconButton/index.vue'
import HistoryActionRow from '@/components/HistoryActionRow/index.vue'
import { formatFullTime, formatShortTime } from '@/utils/time.ts'
import {
  ColorFixCompare,
  ColorFixPill,
  ColorFixResultPanel,
  findTaskAsset,
  saveColorFixVersion,
  useResultColorFix,
} from '@/components/ColorFix'
import {
  findToolSchema,
  isFieldVisible,
  restoreToolForm,
  toJavaValue,
  type ToolField,
  type ToolSchema,
  type ToolUpload,
} from './schemas'
import { tools as toolRegistry } from '@/views/home/tools'
import { useToolAvailability, isRouteDisabled, withoutDisabledGroups } from '@/utils/toolAvailability'
import { catalogFor, catalogKindOf, catalogKinds } from './catalog'
import { isTerminal, useToolHistory } from './useToolHistory'
import { takeRefill } from '@/utils/refill-handoff'
import { downloadImage } from '@/utils/download'
import ToolUploadSlot from './ToolUploadSlot.vue'
import ToolTryonMaterials from './ToolTryonMaterials.vue'
import MaskPainter from './MaskPainter.vue'
import InpaintRegionPicker from './InpaintRegionPicker.vue'
import { inpaintImages, inpaintMissingReason, type InpaintBoxes } from './inpaint'
import { DEFAULT_POSTER_RATIOS, nearestAspectRatio, readImageSize } from './posterRatio'
import PollingOfflineBanner from './PollingOfflineBanner.vue'
import ToolImageCompare from './ToolImageCompare.vue'
import ImageCompareSync, { type CompareColumn, type CompareGroup } from '@/components/ImageCompareSync/index.vue'
import ToolMediaPreview, { type PreviewItem } from './ToolMediaPreview.vue'
import DotWave from '@/components/DotWave.vue'
import CreationSettingsRow from '@/components/Creation/CreationSettingsRow.vue'
import ToolChoiceField, { type ToolChoiceOption } from './ToolChoiceField.vue'
import ToolPipeLinks from './ToolPipeLinks.vue'
import CreationPromptInput from '@/components/Creation/CreationPromptInput.vue'
import BarSlider from '@/components/Creation/BarSlider.vue'
import CreationModelPicker from '@/components/Creation/CreationModelPicker.vue'
import CreationOptionPills from '@/components/Creation/CreationOptionPills.vue'
import NumberStepper from '@/components/Creation/NumberStepper.vue'
import MediaLightbox, { type LightboxItem } from '@/components/MediaLightbox/index.vue'
import type { PromptWriteBizType } from '@/api/prompt-write.ts'
import type { CreationOption, CreationSettingsRowItem } from '@/components/Creation/types'
import VideoClonePanel from './video-clone/VideoClonePanel.vue'
import { useVideoCloneState } from './video-clone/useVideoClone'
import { VC_MAX_REFS } from './video-clone/constants'
import { useWorkflowVideoQuote } from './video-clone/useWorkflowVideoQuote'
import type { VideoCloneAnnotations } from '@/api/video-clone'
import { ossResize, thumbFallback } from '@/utils/oss'

/** Java 同步抠图「等不及」的专用码（ErrorCode.TASK_PROCESSING） */
const TASK_PROCESSING_CODE = 3010

/** 文字替换的一条识别结果：text 是用户改写后的文字，与原文 targetText 不同（去首尾空白）才算「改过」、才会提交 */
interface Region {
  targetText: string
  text: string
  rect: {
    angle: number
    height: number
    left: number
    top: number
    width: number
    pos: { x: number; y: number }[]
  }
}

const route = useRoute()
const router = useRouter()
const message = useMessage()
const dialog = useDialog()
const userInfo = useUserInfoStore()

const toolId = computed(() => String(route.params.toolId ?? ''))
const schema = computed<ToolSchema | undefined>(() => findToolSchema(toolId.value))
/** 左侧目录（原型「AI 图片」分组栏）；当前工具高亮 */
const catalog = computed(() => {
  const c = catalogFor(toolId.value)
  return { ...c, groups: withoutDisabledGroups(c.groups) }
})
useToolAvailability()
/** 当前工具是受控工具且后端已知不可用（绑定被关停）：显示「该功能暂未开放」，不渲染表单 */
const toolUnavailable = computed(() => isRouteDisabled(toolRegistry.find((x) => x.id === toolId.value)?.route))
/** 当前工具在目录里的条目：头卡的图标与短说明取这里 */
// 隐藏工具（不在目录里，如场景生成）回退到注册表定义，头卡图标与说明不丢
const currentEntry = computed<{ icon?: string; tagline?: string } | undefined>(() => {
  const hit = catalog.value.groups.flatMap((g) => g.entries).find((e) => e.id === toolId.value)
  if (hit) return hit
  const t = toolRegistry.find((x) => x.id === toolId.value)
  return t ? { icon: t.icon, tagline: t.description } : undefined
})
// 目录：≥1440 展开 160 / 收起 44（用户切换）；<1440 固定收起 44，展开时以浮层盖在内容上（外点 / Esc / 换路由收起）
const wideViewport = ref(typeof window === 'undefined' || window.matchMedia('(min-width: 1440px)').matches)
const userCollapsed = ref(false)
const overlayOpen = ref(false)
const catalogCollapsed = computed(() => (wideViewport.value ? userCollapsed.value : !overlayOpen.value))
const catalogOverlay = computed(() => !wideViewport.value && overlayOpen.value)
const catalogNav = ref<HTMLElement | null>(null)
function toggleCatalog() {
  if (wideViewport.value) userCollapsed.value = !userCollapsed.value
  else overlayOpen.value = !overlayOpen.value
}
let wideMql: MediaQueryList | undefined
const onWideChange = (e: MediaQueryListEvent) => {
  wideViewport.value = e.matches
  overlayOpen.value = false
}
const onCatalogOutside = (e: PointerEvent) => {
  if (overlayOpen.value && !catalogNav.value?.contains(e.target as Node)) overlayOpen.value = false
}
// Esc 收起浮层后把焦点还给「展开目录」按钮（焦点原本可能在浮层条目上，收起后会掉到 body）
const onCatalogEsc = (e: KeyboardEvent) => {
  if (e.key !== 'Escape' || !overlayOpen.value) return
  overlayOpen.value = false
  void nextTick(() => document.getElementById('tool-catalog-toggle')?.focus())
}
// 浮层里点任一条目（含当前工具——路由不变，换路由的 watch 收不到）都收起浮层
const onCatalogItemClick = () => {
  if (catalogOverlay.value) overlayOpen.value = false
}
onMounted(() => {
  wideMql = window.matchMedia('(min-width: 1440px)')
  wideViewport.value = wideMql.matches
  wideMql.addEventListener('change', onWideChange)
  document.addEventListener('pointerdown', onCatalogOutside, true)
  document.addEventListener('keydown', onCatalogEsc)
})
onBeforeUnmount(() => {
  wideMql?.removeEventListener('change', onWideChange)
  document.removeEventListener('pointerdown', onCatalogOutside, true)
  document.removeEventListener('keydown', onCatalogEsc)
})
watch(
  () => route.fullPath,
  () => (overlayOpen.value = false),
)
/** 功能卡缩略：目录给了封面图（cover）就用封面，否则用图标框 */
const entryCover = computed(() => {
  const cover = (currentEntry.value as { cover?: unknown } | undefined)?.cover
  return typeof cover === 'string' && cover ? cover : ''
})

// 功能卡（原型 FunctionSwitcher ml）：整卡是按钮，点开在卡正下方 8px 展开功能面板（宽 = max(320, 卡宽)、最高 min(680, 视口余高)）；
// 面板头「切换功能」+ AI 图片 / AI 视频分段 + 关闭，下面按目录分组 3 列。点外面、Esc、窗口缩放或页面滚动都会收起；切到别的工具后自动收起
const switcherOpen = ref(false)
const switcherId = `tool-switcher-${useId()}`
const switcherCard = ref<HTMLElement | null>(null)
/** 功能卡 / 功能面板用函数 ref 取单个元素 */
function setSwitcherCard(el: unknown) {
  switcherCard.value = (el as HTMLElement | null) ?? null
}
function setSwitcherPop(el: unknown) {
  switcherPop.value = (el as HTMLElement | null) ?? null
}
const switcherPop = ref<HTMLElement | null>(null)
const switcherStyle = ref<Record<string, string>>({})
const switcherKind = ref<'image' | 'video'>(catalogKindOf(toolId.value))
const switcherCatalog = computed(() => {
  const c = catalogKinds.find((k) => k.key === switcherKind.value)?.catalog
  return c ? { ...c, groups: withoutDisabledGroups(c.groups) } : catalog.value
})
function placeSwitcher() {
  const card = switcherCard.value?.getBoundingClientRect()
  if (!card) return
  const pad = 12
  const width = Math.max(320, Math.round(card.width))
  const left = Math.max(pad, Math.min(card.left, window.innerWidth - width - pad))
  const top = card.bottom + 8
  switcherStyle.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    width: `${width}px`,
    maxHeight: `${Math.min(680, Math.max(240, window.innerHeight - top - pad))}px`,
  }
}
function toggleSwitcher() {
  switcherOpen.value = !switcherOpen.value
  if (!switcherOpen.value) return
  switcherKind.value = catalogKindOf(toolId.value)
  placeSwitcher()
}
function onSwitcherPointer(e: PointerEvent) {
  const t = e.target
  if (!switcherOpen.value || !(t instanceof Node)) return
  if (switcherCard.value?.contains(t) || switcherPop.value?.contains(t)) return
  switcherOpen.value = false
}
function onSwitcherKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && switcherOpen.value) switcherOpen.value = false
}
function onSwitcherViewport(e?: Event) {
  if (!switcherOpen.value) return
  // 面板自己的滚动（滚功能列表）不收起
  if (e?.target instanceof Node && switcherPop.value?.contains(e.target)) return
  switcherOpen.value = false
}
onMounted(() => {
  document.addEventListener('pointerdown', onSwitcherPointer)
  document.addEventListener('keydown', onSwitcherKey)
  window.addEventListener('resize', onSwitcherViewport)
  window.addEventListener('scroll', onSwitcherViewport, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onSwitcherPointer)
  document.removeEventListener('keydown', onSwitcherKey)
  window.removeEventListener('resize', onSwitcherViewport)
  window.removeEventListener('scroll', onSwitcherViewport, true)
})
watch(toolId, () => {
  switcherOpen.value = false
})

// 目录上下渐隐：只在还能往那个方向滚时显示
const catalogScroll = ref<HTMLElement | null>(null)
const fadeTop = ref(false)
const fadeBottom = ref(false)
function updateFades() {
  const el = catalogScroll.value
  if (!el) return
  fadeTop.value = el.scrollTop > 0
  fadeBottom.value = el.scrollTop + el.clientHeight < el.scrollHeight - 1
}
let catalogObserver: ResizeObserver | null = null
watch(catalogScroll, (el) => {
  catalogObserver?.disconnect()
  catalogObserver = null
  if (!el) return
  catalogObserver = new ResizeObserver(updateFades)
  catalogObserver.observe(el)
})
watch([catalog, catalogCollapsed], () => void nextTick(updateFades))
onBeforeUnmount(() => catalogObserver?.disconnect())

/**
 * 收起态的功能名气泡（原型 NextDirectory 收起条）：悬停 300ms 后把整列名字一次性挂出来，从折叠条底下推出
 * （420ms），移走 160ms 宽限后原路缩回（240ms）再卸载；悬停那枚原尺寸 + 选中材质，其余缩到 0.9。
 * 展开目录 / 切工具时立刻收掉。点气泡 = 点它对应的那条功能。
 */
interface RailTip {
  id: string
  label: string
  route?: string
  x: number
  y: number
}
const railTips = ref<RailTip[]>([])
const hoveredRail = ref('')
const tipsClosing = ref(false)
let tipTimer: ReturnType<typeof setTimeout> | undefined
let leaveTimer: ReturnType<typeof setTimeout> | undefined
let closeTimer: ReturnType<typeof setTimeout> | undefined
function clearRailTimer(t: ReturnType<typeof setTimeout> | undefined) {
  if (t) clearTimeout(t)
  return undefined
}
function showRailTips() {
  closeTimer = clearRailTimer(closeTimer)
  tipsClosing.value = false
  const el = catalogScroll.value
  if (!el || !catalogCollapsed.value) return
  const entries = new Map(catalog.value.groups.flatMap((g) => g.entries).map((e) => [e.id, e]))
  railTips.value = [...el.querySelectorAll<HTMLElement>('[data-rail-id]')].flatMap((node) => {
    const e = entries.get(node.dataset.railId ?? '')
    if (!e) return []
    const r = node.getBoundingClientRect()
    return [
      {
        id: e.id,
        label: e.route ? e.name : `${e.name}（即将开放）`,
        route: e.route,
        x: r.right + 8,
        y: r.top + r.height / 2,
      },
    ]
  })
}
function hideRailTips(immediate = false) {
  tipTimer = clearRailTimer(tipTimer)
  leaveTimer = clearRailTimer(leaveTimer)
  closeTimer = clearRailTimer(closeTimer)
  hoveredRail.value = ''
  if (immediate || !railTips.value.length) {
    tipsClosing.value = false
    railTips.value = []
    return
  }
  tipsClosing.value = true
  closeTimer = setTimeout(() => {
    closeTimer = undefined
    tipsClosing.value = false
    railTips.value = []
  }, 240)
}
function scheduleRailTips() {
  leaveTimer = clearRailTimer(leaveTimer)
  tipTimer = clearRailTimer(tipTimer)
  tipTimer = setTimeout(() => {
    tipTimer = undefined
    showRailTips()
  }, 300)
}
function scheduleHideRailTips() {
  leaveTimer = clearRailTimer(leaveTimer)
  if (!railTips.value.length) return hideRailTips(true)
  leaveTimer = setTimeout(() => {
    leaveTimer = undefined
    hideRailTips()
  }, 160)
}
function enterRailTip(tip: RailTip) {
  leaveTimer = clearRailTimer(leaveTimer)
  hoveredRail.value = tip.id
}
function clickRailTip(tip: RailTip) {
  hideRailTips(true)
  if (tip.route) void router.push(tip.route)
}
function onCatalogScroll() {
  updateFades()
  if (railTips.value.length && !tipsClosing.value) showRailTips()
}
watch([catalogCollapsed, toolId], () => hideRailTips(true))
onBeforeUnmount(() => hideRailTips(true))

// ---------------- 表单状态 ----------------

const uploads = reactive<Record<number, string[]>>({})
const values = reactive<Record<string, any>>({})
const maskRef = ref<InstanceType<typeof MaskPainter> | null>(null)
const maskHasStroke = ref(false)
const regions = ref<Region[]>([])
/** 局部重绘：各原图的框选区域（按地址），出网时与上传地址合成 images[{url, bbox}] */
const inpaintBoxes = ref<InpaintBoxes>({})
const ocrLoading = ref(false)
const voices = ref<VoiceItem[]>([])
const voicesLoaded = ref(false)
const submitting = ref(false)
const progressText = ref('')
/** 同步抠图本次直接拿到的结果 */
const syncResultUrl = ref('')
const selectedId = ref<number | null>(null)

const history = useToolHistory(() => schema.value?.historyTitle ?? '')

// ---------------- 服务端下发的模型与价目（视频生成 / 图片生成） ----------------

/** GET /api/v1/features/video-model-configs：视频生成的模型、各档清晰度 / 比例 / 每秒单价、时长区间 */
const videoModels = ref<ModelConfig[]>([])
const videoModelsLoaded = ref(false)
/**
 * GET /api/v1/features/image-model-configs：各分辨率单价；按路由分开存（图片生成与图片复刻是两条绑定、两份清单与单价），
 * 当前工具那一份没拿到 = null（失败时保持原文案）
 */
const imageModelsByRoute = reactive<Record<string, ModelConfig[]>>({})
const imageModels = computed<ModelConfig[] | null>(() => imageModelsByRoute[schema.value?.priceRoute ?? ''] ?? null)

async function loadVideoModels() {
  const res = await videoModelConfigs()
  videoModels.value = (res.data ?? []).filter((m) => m && typeof m.model === 'string' && m.model)
  videoModelsLoaded.value = true
}

/** model-configs 的一项（displayName = 品牌名；refs = 视频模型参考素材上限，见 api/tools.ts） */
type ModelConfigExt = ModelConfig

const currentVideoModel = computed<ModelConfigExt | undefined>(() =>
  videoModels.value.find((m) => m.model === values.model),
)
const VIDEO_RATIO_LABELS: Record<string, string> = { adaptive: '自适应' }
/** 清晰度显示名：超分档（1440p-esr / 2160p-esr / 4k-esr）写成 2K / 4K，其余大写 */
const VIDEO_RESOLUTION_LABELS: Record<string, string> = { '1440p-esr': '2K', '2160p-esr': '4K', '4k-esr': '4K' }
const videoResolutionLabel = (r: string) => VIDEO_RESOLUTION_LABELS[r.toLowerCase()] ?? r.toUpperCase()
const modelName = (m: ModelConfigExt) => modelLabelOf(m.displayName?.trim() || m.model)

/** 当前模型这一档清晰度的配置（清晰度按小写对齐：h3 / happyhorse 下发的是大写 768P、2K） */
function videoSizeOf(m: ModelConfig | undefined, resolution: unknown) {
  if (!m || typeof resolution !== 'string') return undefined
  return m.size?.find((x) => x.resolution?.toLowerCase() === resolution.toLowerCase())
}

/** 视频模型的时长区间；服务端没建模（duration 为空）时只给契约默认的 4 秒 */
const videoDurationRange = computed<[number, number] | null>(() => {
  const m = currentVideoModel.value
  if (!m) return null
  const [min, max] = m.duration ?? []
  return Number.isInteger(min) && Number.isInteger(max) && min! > 0 && max! >= min! ? [min!, max!] : [4, 4]
})

// ---------------- 图片生成的模型（image-model-configs 下发多个模型时才出模型卡） ----------------

/** 「重新编辑」时模型表还没到：先记下，表到了再对回 */
let pendingImageModel = ''
/** 图片模型的界面取值键（不进 schema、不在 values 的普通字段里出网，提交时按需落成 model） */
const IMAGE_MODEL_KEY = '__imageModel'
const imageModelChoices = computed<ModelConfigExt[]>(() =>
  (imageModels.value ?? []).filter((m) => m && typeof m.model === 'string' && m.model && modelAcceptsImages(m)),
)
/**
 * 每个任务要同时喂给模型 schema.minModelImages 张图（图片复刻 = 参考海报 + 资产图 = 2）：模型 refs.maxImages 小于它的
 * 不进清单（选了也出不了图，后端会在扣费前拒）；没下发 refs 视为不限
 */
function modelAcceptsImages(m: ModelConfig): boolean {
  const need = schema.value?.minModelImages
  const cap = m.refs?.maxImages
  return !need || typeof cap !== 'number' || cap >= need
}
/** 多于一个模型才让用户选；只有一个时照旧按它报价、不传 model */
const imageModelSelectable = computed(
  () => schema.value?.price === 'image-model-configs' && imageModelChoices.value.length > 1,
)
/** 默认模型：运营标了 default=true 的那项，没标取第一项 */
const defaultImageModel = computed<ModelConfigExt | undefined>(
  () => imageModelChoices.value.find((m) => m.default === true) ?? imageModelChoices.value[0],
)
const currentImageModel = computed<ModelConfigExt | undefined>(
  () => imageModelChoices.value.find((m) => m.model === values[IMAGE_MODEL_KEY]) ?? defaultImageModel.value,
)
/**
 * 图片生成参考图上限：所选模型 refs.maxImages（缺省 9）；null = 不是图片生成或模型表没到（按 schema 的 max）。
 * 0 = 该模型不支持参考图（槽位换成说明）。
 */
const imageRefCap = computed<number | null>(() => {
  if (schema.value?.price !== 'image-model-configs' || !currentImageModel.value) return null
  const n = currentImageModel.value.refs?.maxImages
  return typeof n === 'number' && n >= 0 ? Math.floor(n) : 9
})
/** 图片生成的参考图槽（ml 版式的图片槽） */
const isImageRefSlot = (u: ToolUpload) =>
  schema.value?.price === 'image-model-configs' &&
  // 图片复刻的资产图不是「参考图」：每件只带一张，模型 refs 管的是单次任务的图数，不卡资产张数
  schema.value.minModelImages === undefined &&
  u.kind === 'image' &&
  u.javaKey === 'imageUrls'
/** 图片生成工具且模型表已到：分辨率 / 比例按所选（默认第一项）模型的 size[] 出 */
const imageModelDriven = computed(
  () => schema.value?.price === 'image-model-configs' && !!currentImageModel.value?.size?.length,
)
/** 所选图片模型的分辨率档（原样大小写）；没建模返回 null = 用 schema 选项 */
const imageModelResolutions = computed<string[] | null>(() => {
  if (!imageModelDriven.value) return null
  const list = (currentImageModel.value?.size ?? []).map((x) => x.resolution).filter(Boolean)
  return list.length ? list : null
})
/** 所选图片模型在当前分辨率下的比例；没建模返回 null */
const imageModelRatios = computed<string[] | null>(() => {
  if (!imageModelDriven.value) return null
  const list = videoSizeOf(currentImageModel.value, values.resolution)?.aspectRatio
  return list?.length ? list : null
})

/** 字段的可选项：静态取 schema.options，dynamic 按当前模型 / 清晰度现算 */
function fieldOptions(f: ToolField): CreationOption<string>[] {
  if (!f.dynamic) {
    let opts = f.options ?? []
    // 图片生成：分辨率 / 比例取所选模型的 size[]（schema 里有同名档就沿用它的写法，回填与出网口径不变）
    if (f.key === 'resolution' && imageModelResolutions.value) {
      opts = imageModelResolutions.value.map(
        (r) => (f.options ?? []).find((o) => o.toLowerCase() === r.toLowerCase()) ?? r.toUpperCase(),
      )
    } else if (f.key === 'aspectRatio' && imageModelRatios.value) {
      opts = imageModelRatios.value.map((r) => (f.options ?? []).find((o) => o === r) ?? r)
    }
    return opts.map((o) => ({ label: o, value: o }))
  }
  const m = currentVideoModel.value
  switch (f.dynamic) {
    case 'videoModel':
      // 模型卡列表：品牌名（没有写 model）+ description 作副标题；不报价（原型 ModelSelect），提交值是 model
      return videoModels.value.map((x: ModelConfigExt) => ({
        label: modelName(x),
        value: x.model,
        description: x.description || undefined,
      }))
    case 'videoResolution':
      return (m?.size ?? [])
        .filter((x) => typeof x.resolution === 'string' && x.resolution)
        .map((x) => ({ label: videoResolutionLabel(x.resolution), value: x.resolution.toLowerCase() }))
    case 'videoRatio':
      return (videoSizeOf(m, values.resolution)?.aspectRatio ?? []).map((r) => ({
        label: VIDEO_RATIO_LABELS[r] ?? r,
        value: r,
      }))
    case 'videoDuration': {
      const range = videoDurationRange.value
      if (!range) return []
      return Array.from({ length: range[1] - range[0] + 1 }, (_, i) => {
        const n = range[0] + i
        return { label: `${n} 秒`, value: String(n) }
      })
    }
  }
}

/** 动态字段换模型后的默认档：时长 4 秒（在区间内）否则最短、清晰度 720P、比例 16:9；都没有就第一档 */
function preferredOption(f: ToolField, opts: CreationOption<string>[]): string {
  const has = (v: string) => opts.some((o) => o.value === v)
  if (f.dynamic === 'videoDuration' && has('4')) return '4'
  if (f.dynamic === 'videoResolution' && has('720p')) return '720p'
  if (f.dynamic === 'videoRatio' && has('16:9')) return '16:9'
  return opts[0]!.value
}

/** 当前视频模型的参考素材上限（refs 没下发 = 不限，按槽位 schema 的 max） */
const videoRefs = computed(() => currentVideoModel.value?.refs ?? null)
/** 参考图上限：refs.maxImages，缺省 9 */
const refImageCap = computed(() => {
  const n = videoRefs.value?.maxImages
  return typeof n === 'number' && n >= 0 ? n : 9
})
/** 当前模型明确不支持参考视频（refs.maxVideos === 0）：参考视频槽换成说明、已传的清空 */
const refVideoBlocked = computed(() => videoRefs.value?.maxVideos === 0)
/** 当前模型明确不支持参考图（refs.maxImages === 0）：参考图槽同样换成说明、已传的清空（不能留一个上限 0 的空槽） */
const refImageBlocked = computed(() => videoRefs.value?.maxImages === 0)
/** 上传槽的实际上限：视频模型的参考素材槽（needsMode）按 refs 收紧 */
function slotMax(u: ToolUpload) {
  if (isImageRefSlot(u) && imageRefCap.value !== null) return Math.min(u.max, imageRefCap.value)
  if (!u.needsMode) return u.max
  // 模型表没到（或取失败）：参考图先按缺省 9 张收，别让 schema 天花板 30 张漏到不支持的模型上
  if (!currentVideoModel.value) return u.kind === 'video' ? u.max : Math.min(u.max, refImageCap.value)
  if (u.kind === 'video') {
    const cap = videoRefs.value?.maxVideos
    return typeof cap === 'number' && cap > 0 ? Math.min(u.max, cap) : u.max
  }
  return Math.min(u.max, refImageCap.value)
}
const slotSpecs = computed(() => new Map((schema.value?.uploads ?? []).map((u) => [u.slot, { ...u, max: slotMax(u) }])))
const specOf = (u: ToolUpload) => slotSpecs.value.get(u.slot) ?? u
/** 「当前模型最多 N 张参考图、M 段参考视频」/「…，不支持参考视频」；只在有参考素材槽、且模型下发了 refs 时显示 */
const refLimitText = computed(() => {
  const r = videoRefs.value
  if (!r || !schema.value?.uploads.some((u) => u.needsMode)) return ''
  if (refImageBlocked.value) {
    if (r.maxVideos === 0) return '当前模型不支持参考图和参考视频'
    return typeof r.maxVideos === 'number'
      ? `当前模型不支持参考图，最多 ${r.maxVideos} 段参考视频`
      : '当前模型不支持参考图'
  }
  const images = `${refImageCap.value} 张参考图`
  if (r.maxVideos === 0) return `当前模型最多 ${images}，不支持参考视频`
  if (typeof r.maxVideos === 'number') return `当前模型最多 ${images}、${r.maxVideos} 段参考视频`
  return `当前模型最多 ${images}`
})

/** 视频模型支不支持这个上传槽（supportedModes 为空 = 服务端没建模，按都支持） */
function uploadEnabled(u: ToolUpload) {
  if (isImageRefSlot(u) && imageRefCap.value === 0) return false
  if (!u.needsMode) return true
  if (u.kind === 'video' && refVideoBlocked.value) return false
  if (u.kind !== 'video' && refImageBlocked.value) return false
  const modes = currentVideoModel.value?.supportedModes ?? []
  return !modes.length || modes.includes(u.needsMode)
}

/**
 * 业务失败（HTTP 200 + code≠0）请求层已 toast，这里只补请求层不提示的那几类：
 * 传输层失败（超时 / 断网）、无信封的 HTTP 错误、非请求错误（如蒙版生成失败）。
 */
function reportError(err: unknown, fallback = '操作失败，请重试') {
  const apiErr = toApiError(err)
  if (apiErr && apiErr.code !== -1 && !apiErr.httpStatus) return
  if (apiErr?.isNetwork) message.error('网络异常或请求超时，请稍后在历史记录里确认是否已提交')
  else message.error(err instanceof Error && err.message ? err.message : fallback)
}

/** MaskPainter 在 v-for 里渲染，字符串 ref 会变成数组，用函数 ref 取单个实例 */
function setMaskRef(el: unknown) {
  maskRef.value = (el as InstanceType<typeof MaskPainter> | null) ?? null
}

function setUploads(slot: number, urls: string[]) {
  uploads[slot] = urls
}

/** 各上传入口是否正在上传（键 = 槽位 / 素材板）：任何一个在传就不让提交，免得漏掉还没回来的图 */
const uploadingSlots = reactive<Record<string, boolean>>({})
function setUploading(key: string, busy: boolean) {
  if (busy) uploadingSlots[key] = true
  else delete uploadingSlots[key]
}
const anyUploading = computed(() => Object.keys(uploadingSlots).length > 0)

// ---------------- 视频复刻：解析、标注（/tools/ai-video-clone 主路径；「直接出片」退回原来的简单表单） ----------------

const VIDEO_CLONE_ID = 'ai-video-clone'
/** 用户选了「不解析，直接写描述出片」（或回填了没有标注的老记录） */
const cloneSimple = ref(false)
const cloneMode = computed(() => schema.value?.homeId === VIDEO_CLONE_ID && !cloneSimple.value)
const cloneVideoSlot = computed(() =>
  cloneMode.value ? schema.value?.uploads.find((u) => u.javaKey === 'videoUrl') : undefined,
)
const cloneRefSlot = computed(() =>
  cloneMode.value ? schema.value?.uploads.find((u) => u.javaKey === 'imageUrls') : undefined,
)
/** 参考图上限：@1–@9，再按当前模型 refs.maxImages 收紧 */
const cloneRefMax = computed(() => Math.min(VC_MAX_REFS, refImageCap.value))
const cloneModelMaxSeconds = computed(() => {
  const max = currentVideoModel.value?.duration?.[1]
  return Number.isInteger(max) && max! > 0 ? max! : null
})
const cloneModelResolutions = computed(() => {
  const list = (currentVideoModel.value?.size ?? [])
    .map((x) => x.resolution?.toLowerCase())
    .filter((r): r is string => !!r)
  return list.length ? list : null
})
const vc = useVideoCloneState({
  videoUrl: () => (cloneVideoSlot.value ? (uploads[cloneVideoSlot.value.slot]?.[0] ?? '') : ''),
  refs: () => (cloneRefSlot.value ? (uploads[cloneRefSlot.value.slot] ?? []) : []),
  modelMaxSeconds: () => cloneModelMaxSeconds.value,
  modelResolutions: () => cloneModelResolutions.value,
})
/** 「换一条」：清掉原片回到上传（参考图保留，换片后还能接着用） */
function cloneReplaceVideo() {
  vc.clearRestore()
  if (cloneVideoSlot.value) uploads[cloneVideoSlot.value.slot] = []
}
/** 改用直接出片：原片与参考图原样带过去，描述 / 清晰度等用简单表单 */
function cloneSkip() {
  vc.clearRestore()
  cloneSimple.value = true
}
function cloneBack() {
  cloneSimple.value = false
}

/**
 * 「重新编辑」换上的单图：下面两个 singleImage 监听见到它时不清空回填的识别结果、也不自动识别
 * （识别单独计费，回填不能替用户花钱）。用户换图后照常清空并自动识别。
 */
let restoredImage = ''

function resetForm(s: ToolSchema) {
  restoredImage = ''
  for (const key of Object.keys(uploads)) delete uploads[Number(key)]
  for (const key of Object.keys(values)) delete values[key]
  for (const u of s.uploads) uploads[u.slot] = []
  for (const f of s.fields) if (f.default !== undefined) values[f.key] = f.default
  maskHasStroke.value = false
  regions.value = []
  inpaintBoxes.value = {}
  syncResultUrl.value = ''
  selectedId.value = null
  progressText.value = ''
  cloneSimple.value = false
  vc.clearRestore()
}

watch(
  schema,
  (s) => {
    history.stop()
    if (!s) return
    resetForm(s)
    history.reload().catch((err) => reportError(err, '历史记录加载失败'))
    if (s.fields.some((f) => f.type === 'voice') && !voicesLoaded.value) {
      loadVoices().catch((err) => reportError(err, '音色列表加载失败'))
    }
    if ((s.price === 'video-model-configs' || s.fields.some((f) => f.dynamic)) && !videoModelsLoaded.value) {
      loadVideoModels().catch((err) => reportError(err, '视频模型加载失败'))
    }
    if (s.price === 'image-model-configs' && !imageModelsByRoute[s.priceRoute ?? '']) {
      const key = s.priceRoute ?? ''
      imageModelConfigs(s.priceRoute)
        .then((res) => (imageModelsByRoute[key] = res.data ?? []))
        .catch(() => {})
    }
  },
  { immediate: true },
)

const visibleFields = computed(() =>
  (schema.value?.fields ?? []).filter(
    // 视频复刻解析标注模式：描述 / 清晰度 / 比例 / 时长由标注面板接管（画幅时长跟随原片），只留模型卡
    (f) => isFieldVisible(f, values) && (!cloneMode.value || f.dynamic === 'videoModel'),
  ),
)

/**
 * 服务端下发的选项：模型表到了、换了模型 / 清晰度后，不再合法的取值落到第一档（按 schema 顺序逐个对齐，
 * 先模型、再清晰度、再比例与时长）；不支持的参考素材清空。
 */
watch(
  () => [
    schema.value?.homeId,
    videoModels.value,
    ...(schema.value?.fields ?? []).filter((f) => f.dynamic).map((f) => values[f.key]),
  ],
  () => {
    const s = schema.value
    if (!s) return
    for (const f of s.fields) {
      if (!f.dynamic) continue
      const opts = fieldOptions(f)
      if (opts.length && !opts.some((o) => o.value === values[f.key])) values[f.key] = preferredOption(f, opts)
    }
    for (const u of s.uploads) {
      if (!uploadEnabled(u) && uploads[u.slot]?.length) uploads[u.slot] = []
      // 换到参考素材上限更小的模型：多出来的从后往前裁掉
      if (isImageRefSlot(u)) continue // 图片生成参考图交给下面带提示的裁剪
      const cap = slotMax(u)
      if ((uploads[u.slot]?.length ?? 0) > cap) uploads[u.slot] = uploads[u.slot]!.slice(0, cap)
    }
  },
  { immediate: true },
)
// 图片生成多模型：模型表到了先落默认模型；换模型后不再支持的分辨率 / 比例落到该模型第一档
watch(
  () => [imageModelDriven.value, currentImageModel.value?.model, values.resolution],
  () => {
    const s = schema.value
    if (!s || !imageModelDriven.value) return
    if (pendingImageModel && imageModelChoices.value.some((m) => m.model === pendingImageModel))
      values[IMAGE_MODEL_KEY] = pendingImageModel
    pendingImageModel = ''
    if (!values[IMAGE_MODEL_KEY] && currentImageModel.value) values[IMAGE_MODEL_KEY] = currentImageModel.value.model
    for (const f of s.fields) {
      if (f.dynamic || (f.key !== 'resolution' && f.key !== 'aspectRatio')) continue
      const opts = fieldOptions(f)
      if (opts.length && !opts.some((o) => o.value === values[f.key])) values[f.key] = opts[0]!.value
    }
  },
  { immediate: true },
)

/**
 * 图片生成换模型（或回填）后参考图超过该模型上限：保留前 N 张并明说，不静默带着超额去提交（后端会 400）。
 * 上限 0 = 该模型不支持参考图：清空并提示。
 */
watch(
  () => [
    imageRefCap.value,
    ...(schema.value?.uploads ?? []).filter(isImageRefSlot).map((u) => uploads[u.slot]?.length ?? 0),
  ],
  () => {
    const cap = imageRefCap.value
    if (cap === null) return
    for (const u of schema.value?.uploads ?? []) {
      if (!isImageRefSlot(u)) continue
      const list = uploads[u.slot] ?? []
      if (list.length <= cap) continue
      uploads[u.slot] = list.slice(0, cap)
      message.warning(cap ? `当前模型最多 ${cap} 张参考图，已保留前 ${cap} 张` : '当前模型不支持参考图，已移除参考图')
    }
  },
)

/** 上传槽位的显示顺序：s1.1 产品替换「替换素材」在上、底图片格在下（只换显示顺序，校验与提交仍按 schema 顺序） */
const displayUploads = computed(() =>
  [...(cloneMode.value ? [] : (schema.value?.uploads ?? []))]
    .filter((u) => !mlPromptUploads.value.includes(u))
    .filter((u) => !productStage.value || (u !== productStage.value.anchor && u !== productStage.value.base))
    .sort((a, b) => Number(b.layout === 'material') - Number(a.layout === 'material')),
)
/**
 * 产品替换图台（原型 ProductPipeSlots 定稿）：替换素材（anchor，96 见方）在上、底图片格（pipe）在下，同在一张卡里，
 * 每个底图格一条浅色连线回到素材（ToolPipeLinks）。只是排版，上传 / 校验 / 提交仍走各自的槽位。
 */
const productStage = computed(() => {
  const list = schema.value?.uploads ?? []
  const anchor = list.find((u) => u.layout === 'anchor')
  const base = list.find((u) => u.layout === 'pipe')
  return anchor && base ? { anchor, base } : null
})
const productStageEl = ref<HTMLElement | null>(null)
function setProductStageEl(el: unknown) {
  productStageEl.value = (el as HTMLElement | null) ?? null
}
/**
 * 原型 ml 一体框：有提示词、且有 ml 版式参考图槽的工具，参考图槽收进提示词框顶部（计数「0/9」+ 我的提示词书本钮一行）。
 * 局部重绘 / 消除不收：框选与涂抹要先有图，图槽得留在它们上面。
 */
const mlPromptUploads = computed<ToolUpload[]>(() => {
  const s = schema.value
  if (!s || !s.fields.some((f) => f.type === 'textarea')) return []
  if (s.fields.some((f) => f.type === 'inpaint-region' || f.type === 'mask')) return []
  return s.uploads.filter((u) => u.layout === 'ml')
})
const mlPrompt = computed(() => mlPromptUploads.value.length > 0)
/**
 * 用原型参考图条（schema strip: 'prototype'）的工具：框顶计数行（计数 + 书本钮）由图条自己画，
 * 「当前模型最多 N 张参考图…」收进计数的悬停提示，不再在设置行上方单占一行
 */
const promptStripOwned = computed(() => mlPromptUploads.value.some((u) => u.strip === 'prototype'))
/** 画框顶计数行的那个槽：第一个可用的原型图条；模型不支持参考图时没有，退回一体框自己的顶行（只剩书本钮） */
const stripHeadSlot = computed(() => mlPromptUploads.value.find((u) => u.strip === 'prototype' && uploadEnabled(u)))
/**
 * 本页主粘贴槽：Ctrl/⌘+V 没悬停在哪一槽、焦点也不在提示词框里时进它（useFileDropPaste 路由规则 5）——
 * 显示顺序里第一个可用的槽；商拍换装素材板两块并排，按悬停分，不设主槽
 */
const pastePrimarySlot = computed(() => {
  if (cloneVideoSlot.value) return cloneVideoSlot.value.slot
  if (schema.value?.uploadsView === 'tryon' && tryonSlots.value) return undefined
  const order = [
    ...mlPromptUploads.value,
    ...(productStage.value ? [productStage.value.anchor] : []),
    ...displayUploads.value,
  ]
  return order.find((u) => uploadEnabled(u))?.slot
})
/** 商拍换装素材板的两个槽位：服装图（clothImageUrl）/ 模特图（modelImageUrl）；缺一个就退回通用槽位 */
const tryonSlots = computed(() => {
  const list = schema.value?.uploads ?? []
  const cloth = list.find((u) => u.javaKey === 'clothImageUrl')
  const models = list.find((u) => u.javaKey === 'modelImageUrl')
  return cloth && models ? { cloth, models } : null
})
/** 当前视频模型不支持的参考素材槽，原位换成一行说明（原型文案） */
const unsupportedUploadHint = (u: ToolUpload) =>
  u.kind === 'video' ? '当前模型不支持参考视频，换一个模型即可上传' : '当前模型不支持参考图，换一个模型即可上传'
const singleImage = computed(() => uploads[0]?.[0] ?? '')
/**
 * 新版原型视频高清版式（上传槽用 `video` 版式的工具）：上传卡撑满余高、底部设置行高 44 且取值 11/500、
 * 提交按钮 16px 主文案 +「消耗 N 点」、右栏只放功能介绍（结果改在历史列表里看）。
 */
const compact = computed(() => !!schema.value?.uploads.some((u) => u.layout === 'video'))

/**
 * 底部设置行（原型 OperatePanel ml「模型卡 | 设置」）：
 * - 模型（视频模型 dynamic=videoModel，或图片生成多模型时的模型卡）单独一张 44 高卡，点开 CreationModelPicker；
 * - 其余所有「非模型、非提示词」的参数（分辨率 / 比例 / 张数 / 语言 / 目标语言 / 时长 / 开关 / 下拉 / 预设与自定义尺寸）
 *   一律收进「图片设置 / 视频设置」弹层，按钮上拼摘要（比例 · 分辨率 · N 张 · 语言 · 时长）；
 * - 需要醒目可见的留在表单里：涂抹蒙版、框选区域、识别结果；
 * - 图片翻译 / 视频翻译的必选项（目标语言、配音音色，schema choiceCard）照原型摆成提交按钮正上方的字段卡（ToolChoiceField）。
 * 取值仍写回 values[key]，请求体不变。
 */
const FORM_ONLY_TYPES = new Set(['textarea', 'mask', 'region-list', 'inpaint-region', 'voice'])
/** 「输入润色」开关（原型 .op-prompt__rewrite）：收进提示词框底行，取值仍写回 values[key] */
const rewriteField = computed(
  () => visibleFields.value.find((f) => f.type === 'switch' && f.key === 'rewritePrompt') ?? null,
)
const modelField = computed(() => visibleFields.value.find((f) => f.dynamic === 'videoModel') ?? null)
/** 提交按钮上方的字段卡（原型 ChoiceFieldButton picker）：schema 标了 choiceCard 的字段，配音音色一律走这里 */
const isChoiceField = (f: ToolField) => !!f.choiceCard || f.type === 'voice'
const choiceFields = computed(() => visibleFields.value.filter(isChoiceField))
const isPopoverField = (f: ToolField) =>
  !FORM_ONLY_TYPES.has(f.type) && !isChoiceField(f) && f !== rewriteField.value && f.dynamic !== 'videoModel'
const settingFields = computed(() => visibleFields.value.filter(isPopoverField))
/** 表单里渲染的字段：设置字段改由底部设置行承载，模型改由模型卡承载，润色开关进提示词框 */
const promptFields = computed(() =>
  visibleFields.value.filter(
    (f) => !isPopoverField(f) && !isChoiceField(f) && f !== rewriteField.value && f.dynamic !== 'videoModel',
  ),
)
const rewriteValue = computed({
  get: () => (rewriteField.value ? !!values[rewriteField.value.key] : false),
  set: (v: boolean) => {
    if (rewriteField.value) values[rewriteField.value.key] = v
  },
})
/** 生成类工具：提示词框显示「我的提示词」入口（原型 ImageGenerate / AiVideoGenerator 等四页） */
const libraryEnabled = computed(() => !!schema.value?.promptLibrary)
/** schema.helpBizType → 提示词框「AI帮写」（只认 prompt-write 已有的业务类型） */
const helpBizType = computed(() => schema.value?.helpBizType as PromptWriteBizType | undefined)

/** 比例转换「自定义尺寸」：宽 / 高两个 number 字段合成一行「输出尺寸（像素）」 */
const SIZE_KEYS = ['width', 'height']
const sizePair = computed(() => {
  const w = settingFields.value.find((f) => f.key === 'width' && f.type === 'number')
  const h = settingFields.value.find((f) => f.key === 'height' && f.type === 'number')
  return w && h ? { w, h } : null
})
const SIZE_INVALID = '请填写 64～8192 之间的宽高'
function sizeValid(f: ToolField) {
  const n = Number(values[f.key])
  return Number.isInteger(n) && n >= (f.min ?? 64) && n <= (f.max ?? 8192)
}
/** 设置弹层里逐个渲染的字段（宽高合成一行，由 sizePair 单独渲染） */
const popoverRows = computed(() => settingFields.value.filter((f) => !(sizePair.value && SIZE_KEYS.includes(f.key))))

/** 设置摘要的一段：选项写显示名，张数加「张」，时长加「秒」，开关只在开着时写名字 */
function summaryPart(f: ToolField): string {
  const v = values[f.key]
  if (v === undefined || v === null || v === '') return ''
  if (f.type === 'switch') return v ? f.label : ''
  if (f.key === 'count') return `${v} 张`
  if (f.dynamic === 'videoDuration') return `${v} 秒`
  if (f.type === 'number' || f.type === 'stepper') return String(v)
  return fieldOptions(f).find((o) => o.value === v)?.label ?? String(v)
}
const settingsSummary = computed(() => {
  const order = ['aspectRatio', 'resolution', 'count']
  const fields = [...settingFields.value].sort((a, b) => {
    const ia = order.indexOf(a.key)
    const ib = order.indexOf(b.key)
    return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib)
  })
  const parts: string[] = []
  for (const f of fields) {
    if (sizePair.value && SIZE_KEYS.includes(f.key)) {
      if (f.key === 'width') parts.push(`${values.width ?? '?'}×${values.height ?? '?'}`)
      continue
    }
    if (f.uiOnly) continue // 「尺寸方式」这类界面分支由后面的取值本身说明（比例 · 分辨率，或 宽×高）
    if (f.type === 'switch') continue // 原型：摘要只写档位，开关（生成音频等）不进摘要
    const part = summaryPart(f)
    if (part) parts.push(part)
  }
  if (posterRatioHint.value) parts.unshift(posterRatioHint.value)
  return parts.join(' · ')
})

/**
 * 只有一个档位字段（chips、≤4 档）时照原型 ChoiceFieldButton inline 摆在提交按钮上方，分段片直接点选；取值仍写回 values[key]。
 * ←/→ 循环切换，焦点跟到新选中的那一片（原型 move）。
 */
const inlineSetting = computed(() => {
  const only =
    settingFields.value.length === 1 && !modelField.value && !imageModelSelectable.value
      ? settingFields.value[0]
      : undefined
  return only && only.type === 'chips' && fieldOptions(only).length <= 4 ? only : undefined
})
const inlineOptions = computed(() => (inlineSetting.value ? fieldOptions(inlineSetting.value) : []))
const inlineIndex = computed(() =>
  inlineSetting.value ? inlineOptions.value.findIndex((o) => o.value === values[inlineSetting.value!.key]) : -1,
)
const inlineSegs: (HTMLButtonElement | null)[] = []
function moveInline(step: number) {
  const f = inlineSetting.value
  const n = inlineOptions.value.length
  if (!f || !n || submitting.value) return
  const next = ((((inlineIndex.value < 0 ? 0 : inlineIndex.value) + step) % n) + n) % n
  values[f.key] = inlineOptions.value[next]!.value
  void nextTick(() => inlineSegs[next]?.focus())
}

/** 模型卡的选项与取值（视频模型 / 图片多模型二选一） */
const modelOptions = computed<CreationOption<string>[]>(() => {
  if (modelField.value) return fieldOptions(modelField.value)
  if (imageModelSelectable.value)
    return imageModelChoices.value.map((m) => ({
      label: modelName(m),
      value: m.model,
      description: m.description || undefined,
    }))
  return []
})
const pickedModel = computed({
  get: () => String((modelField.value ? values[modelField.value.key] : currentImageModel.value?.model) ?? ''),
  set: (v: string) => {
    if (modelField.value) values[modelField.value.key] = v
    else values[IMAGE_MODEL_KEY] = v
  },
})
const hasModelCard = computed(() => !!modelField.value || imageModelSelectable.value)

/** 视频生成：模型与视频设置并排一行，两个弹层都铺满整行（左按钮贴左缘弹、右按钮贴右缘弹） */
const isVideoGenerator = computed(() => schema.value?.homeId === 'ai-video-generator')
/** 底部设置行：模型卡（有模型时）+ 设置按钮（有设置字段时）；只有设置时设置按钮占满整行 */
const settingItems = computed<CreationSettingsRowItem[]>(() => {
  const list: CreationSettingsRowItem[] = []
  if (hasModelCard.value) {
    const name = modelOptions.value.find((o) => o.value === pickedModel.value)?.label
    list.push({
      key: 'model',
      icon: 'sparkle',
      label: '模型',
      value: name ?? (videoModelsLoaded.value || imageModels.value ? '暂无可用模型' : '加载中…'),
      ariaLabel: schema.value?.media === 'video' ? '视频模型' : '生图模型',
    })
  }
  if (settingFields.value.length && !inlineSetting.value) {
    list.push({
      key: 'settings',
      icon: 'gear',
      label: schema.value?.media === 'video' ? '视频设置' : '图片设置',
      value: settingsSummary.value || '默认',
      popoverFixedWidth: schema.value?.homeId === 'ai-video-generator' ? undefined : 340,
    })
  }
  return list
})

const reasonId = `tool-submit-reason-${useId()}`
const hintId = `tool-submit-hint-${useId()}`
/** 设置弹层里每一行（原型 SettingsPopover 设置行）：最小高 48、内边距 8 0、纵向 gap 6 */
const setRowCls = 'flex flex-col gap-6px min-h-48px box-border py-8px'
/** 提示词框顶行的参考图计数「0/9」（多个槽时逐个写） */
const mlCountText = computed(() =>
  mlPromptUploads.value
    .filter((u) => uploadEnabled(u))
    .map((u) => `${uploads[u.slot]?.length ?? 0}/${specOf(u).max}`)
    .join(' · '),
)

// 换图后蒙版与识别结果都作废（蒙版画布换图时也会发 change(false)，这里先同步清掉，不等它回报）
watch(singleImage, (url) => {
  maskHasStroke.value = false
  if (url && url === restoredImage) return
  regions.value = []
})

// ---------------- 音色 ----------------

async function loadVoices() {
  const res = await voiceList()
  voices.value = res.data?.data ?? []
  voicesLoaded.value = true
  if (!values.voice && voices.value[0]) values.voice = voices.value[0].voiceId
}

const selectedVoice = computed(() => voices.value.find((v) => v.voiceId === values.voice))

/** 音色 meta 结构未定（待联调）：只认里面形如音频地址的字符串作为试听源 */
function auditionOf(v: VoiceItem | undefined) {
  const meta = v?.meta
  if (!meta || typeof meta !== 'object') return ''
  const hit = Object.values(meta as Record<string, unknown>).find(
    (x) => typeof x === 'string' && /^https?:\/\/.+\.(mp3|wav|m4a|aac|ogg)(\?|$)/i.test(x),
  )
  return (hit as string) ?? ''
}
const auditionUrl = computed(() => auditionOf(selectedVoice.value))
/** schema 声明了「试听」动作才给试听入口 */
const auditionEnabled = computed(() => !!schema.value?.actions.includes('试听'))

let audio: HTMLAudioElement | null = null
function playAudition(voiceId?: string | number) {
  const url = voiceId === undefined ? auditionUrl.value : auditionOf(voices.value.find((v) => v.voiceId === voiceId))
  if (!url) return
  audio?.pause()
  audio = new Audio(url)
  void audio.play().catch(() => message.error('试听播放失败'))
}

/** 音色卡选项：「晓柔 · 女声」（性别从标签里认，认不出只写名字），其余标签作副标题 */
function voiceGender(v: VoiceItem) {
  const tags = v.tags ?? []
  if (tags.some((t) => t.includes('女'))) return '女声'
  if (tags.some((t) => t.includes('男'))) return '男声'
  return ''
}
const voiceOptions = computed<ToolChoiceOption[]>(() =>
  voices.value.map((v) => {
    const gender = voiceGender(v)
    return {
      label: gender ? `${v.voiceName} · ${gender}` : v.voiceName,
      value: v.voiceId,
      description: (v.tags ?? []).filter((t) => !/^(女|男)声?$/.test(t)).join(' · ') || undefined,
      audition: auditionEnabled.value && !!auditionOf(v),
    }
  }),
)
onBeforeUnmount(() => {
  audio?.pause()
  audio = null
})

// ---------------- 文字识别（文字替换） ----------------

/**
 * 识别是同步接口、要几秒：识别中用户换了图，旧图的结果不能落到新图上。
 * 每次识别记下图址，回来时图已换就丢弃；识别中又换了图（自动识别被 loading 挡住）先记一笔，本次结束后对新图补跑。
 */
let ocrQueued = false
async function runOcr() {
  const url = singleImage.value
  if (!url) return
  if (ocrLoading.value) {
    ocrQueued = true
    return
  }
  ocrQueued = false
  ocrLoading.value = true
  try {
    const res = await toolOcr(url)
    if (singleImage.value !== url) return
    const list = res.data?.Results ?? []
    regions.value = list
      .filter((r) => r.Text && r.TextRectangles?.Pos?.length === 4)
      .map((r) => {
        const t = r.TextRectangles!
        return {
          targetText: r.Text!,
          // 改写框初始为空（占位「改成…」）：没改的条目不提交
          text: '',
          rect: {
            angle: t.Angle ?? 0,
            height: Math.round(t.Height ?? 0),
            left: Math.round(t.Left ?? 0),
            top: Math.round(t.Top ?? 0),
            width: Math.round(t.Width ?? 0),
            pos: t.Pos!.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
          },
        }
      })
    if (!regions.value.length) message.warning('没有识别到可替换的文字')
    else message.success(`识别到 ${regions.value.length} 处文字`)
  } catch (err) {
    if (singleImage.value === url) reportError(err, '文字识别失败')
  } finally {
    ocrLoading.value = false
    if (ocrQueued) {
      ocrQueued = false
      const next = singleImage.value
      // 补跑只针对换上来的新图（回填的原图不自动识别，识别单独计费）
      if (next && next !== url && next !== restoredImage && hasRegionField.value) void runOcr()
    }
  }
}

/** 改过的条目：去首尾空白后非空、且与原文不同 */
const isChanged = (r: Region) => !!r.text.trim() && r.text.trim() !== r.targetText.trim()
const changedRegions = computed(() => regions.value.filter(isChanged))

// 文字替换：原图上传后自动识别（复用 runOcr / toolOcr，无需点按钮）
const hasRegionField = computed(() => !!schema.value?.fields.some((f) => f.type === 'region-list'))
watch(singleImage, (url) => {
  if (url && url === restoredImage) return
  if (url && hasRegionField.value) void runOcr()
})

// ---------------- 就绪判定 ----------------

/** 主图槽未上传时的提示（原型各工具页 emptyHint；没列的工具走「还没上传{槽名}」） */
const EMPTY_UPLOAD_HINTS: Record<string, string> = {
  高清放大: '请先上传至少一张需要放大的图片',
  图片翻译: '请先上传至少一张需要翻译的图片',
  比例转换: '请先上传至少一张需要转换比例的图片',
  商品精修: '请先上传至少一张商品图片',
  服装去皱: '请先上传至少一张需要去皱的衣服图片',
  产品替换: '请先上传至少一张底图',
  智能抠图: '请先上传一张需要抠图的图片',
  智能消除: '请先上传一张图片',
  文字替换: '请先上传一张图片',
  视频高清: '请先上传一段视频',
  视频翻译: '请先上传一段视频',
}

/** 前端本地能判的不可提交原因；后端报价给的原因（视频复刻页）见下方 disabledReason */
const localDisabledReason = computed(() => {
  const s = schema.value
  if (!s) return ''
  if (anyUploading.value) return '原图还在上传中，请稍候'
  for (const u of s.uploads) {
    if (u.required && uploadEnabled(u) && !uploads[u.slot]?.length) {
      return (u.slot === 0 && EMPTY_UPLOAD_HINTS[s.title]) || `还没上传${u.label.replace(/（.*）/, '')}`
    }
  }
  // 图片复刻：模型清单到了、但没有任何模型能同时接收参考海报 + 资产图（refs.maxImages ≥ 2）
  if (s.minModelImages !== undefined && imageModels.value && !imageModelChoices.value.length) {
    return '暂无支持图片复刻的模型'
  }
  for (const f of visibleFields.value) {
    if (!f.required || f.uiOnly) continue
    if (f.type === 'mask') {
      if (!maskHasStroke.value) return '请先在图上涂抹要消除的区域'
      continue
    }
    if (f.type === 'region-list') {
      if (!regions.value.length) return ocrLoading.value ? '图片识别中，请稍候' : '请先识别图片中的文字'
      if (!changedRegions.value.length) return '请至少修改一处文案再提交'
      continue
    }
    if (f.type === 'inpaint-region') {
      const reason = inpaintMissingReason(uploads[0] ?? [], inpaintBoxes.value)
      if (reason) return reason
      continue
    }
    if (f.type === 'voice') {
      if (!selectedVoice.value) return voicesLoaded.value && !voices.value.length ? '暂无可用音色' : '请先选择配音音色'
      continue
    }
    if (sizePair.value && SIZE_KEYS.includes(f.key)) {
      if (!sizeValid(sizePair.value.w) || !sizeValid(sizePair.value.h)) return SIZE_INVALID
      continue
    }
    const v = values[f.key]
    if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) {
      if (f.dynamic && !fieldOptions(f).length) {
        return videoModelsLoaded.value ? `暂无可用${f.label}` : `${f.label}加载中…`
      }
      return `请填写${f.label}`
    }
    if (f.minLength && typeof v === 'string' && [...v.trim()].length < f.minLength) {
      return `${f.label}至少 ${f.minLength} 个字`
    }
  }
  if (cloneMode.value) {
    const refCount = cloneRefSlot.value ? (uploads[cloneRefSlot.value.slot]?.length ?? 0) : 0
    if (refCount > cloneRefMax.value) {
      return cloneRefMax.value
        ? `当前模型最多 ${cloneRefMax.value} 张参考图，请先移除多出的`
        : '当前模型不支持参考图，请先移除参考图'
    }
    if (vc.blockReason) return vc.blockReason
  }
  return ''
})

/** 本次会拆成几次提交（单值键多张 = 逐张提交） */
const fanOutCount = computed(() => {
  const s = schema.value
  if (!s) return 0
  // 图片复刻：前端只提交一次，服务端按资产图扇出，任务数 = 资产图张数
  if (s.pricePerUpload !== undefined) return Math.max(uploads[s.pricePerUpload]?.length ?? 0, 1)
  const fan = fanSlot(s)
  return fan ? Math.max(uploads[fan.slot]?.length ?? 0, 1) : 1
})

/**
 * 逐张提交的槽：单值键多张（原逻辑），或 schema.perItemSubmit 时的数组键 imageUrls（比例转换：一张图一个任务，
 * 每次传 imageUrls:[url]）；局部重绘的 images 不拆
 */
function fanSlot(s: ToolSchema) {
  return s.uploads.find(
    (u) => u.javaKey !== 'images' && (u.javaKey !== 'imageUrls' || !!s.perItemSubmit) && u.max > 1 && uploadEnabled(u),
  )
}

/** schema.submitLabel 优先（图片生成「立即生成」），否则 submit.label */
const baseSubmitLabel = computed(() => schema.value?.submitLabel || schema.value?.submit.label || '')

/** 提交按钮主文案：countLabel 的工具有图时写任务数（原型「开始换装（2 张）」）；计费与提交逻辑不看它 */
const submitLabel = computed(() => {
  const s = schema.value
  if (!s) return ''
  const fan = fanSlot(s)
  const n =
    s.pricePerUpload !== undefined ? (uploads[s.pricePerUpload]?.length ?? 0) : fan ? (uploads[fan.slot]?.length ?? 0) : 0
  const label = baseSubmitLabel.value
  if (s.sync && syncResultUrl.value) return '重新抠图'
  return s.submit.countLabel && n ? `${label}（${n} 张）` : label
})

// 预计消耗：GET /api/v1/features/biz-points 进页读一次（切工具不重读）；失败或该工具无报价时保持原文案
const pointsTable = ref<Record<string, unknown> | null>(null)
bizPoints()
  .then((res) => (pointsTable.value = res.data ?? null))
  .catch(() => {})

/** schema.submit.costSource 形如 `features/biz-points.cutout` 或 `features/biz-points.videoEnhance[目标分辨率] × 秒` */
const BIZ_POINTS_SOURCE = /^features\/biz-points\.(\w+)(?:\[([^\]]+)\])?/
const POINT_UNITS: Record<string, string> = { second: '秒', minute: '分钟' }

/**
 * 视频槽（slot 0）当前那段视频的时长（秒）：按秒计价的工具（视频高清 / 视频翻译）据此把单价乘成总价。
 * 地址可能来自本地上传或资产库，统一读远端元数据；读不到（跨域 / 失败）保持 null，退回「N 点/秒」。
 */
const inputVideoSeconds = ref<number | null>(null)
let metaSeq = 0
let metaEl: HTMLVideoElement | null = null
function releaseMetaEl() {
  if (!metaEl) return
  metaEl.onloadedmetadata = null
  metaEl.onerror = null
  metaEl.removeAttribute('src')
  metaEl.load()
  metaEl = null
}
watch(
  () => (schema.value?.uploads[0]?.kind === 'video' ? (uploads[0]?.[0] ?? '') : ''),
  (url) => {
    const seq = ++metaSeq
    releaseMetaEl()
    inputVideoSeconds.value = null
    if (!url || typeof document === 'undefined') return
    const el = document.createElement('video')
    metaEl = el
    el.preload = 'metadata'
    el.muted = true
    el.onloadedmetadata = () => {
      const d = el.duration
      if (seq === metaSeq) inputVideoSeconds.value = Number.isFinite(d) && d > 0 ? d : null
      if (metaEl === el) releaseMetaEl()
    }
    el.onerror = () => {
      if (seq === metaSeq) inputVideoSeconds.value = null
      if (metaEl === el) releaseMetaEl()
    }
    el.src = url
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  metaSeq += 1
  releaseMetaEl()
})

// ---------------- 图片复刻：输出比例跟随参考海报 ----------------

/** 参考海报（schema.ratioFromUpload 槽）的实测宽高；读不出 / 还没读到 = null */
const posterRefSize = ref<{ url: string; width: number; height: number } | null>(null)
watch(
  () => {
    const slot = schema.value?.ratioFromUpload
    return slot === undefined ? '' : (uploads[slot]?.[0] ?? '')
  },
  async (url) => {
    posterRefSize.value = null
    if (!url) return
    const size = await readImageSize(url)
    const slot = schema.value?.ratioFromUpload
    // 读图期间换了图 / 切了工具：丢掉这次结果
    if (size && slot !== undefined && uploads[slot]?.[0] === url) posterRefSize.value = { url, ...size }
  },
  { immediate: true },
)
/** 提示比例：参考海报宽高在所选模型（当前分辨率）比例清单里最近的一档；模型没下发清单时用 13 档默认 */
const posterRatioHint = computed<string | null>(() => {
  const size = posterRefSize.value
  if (!size || schema.value?.ratioFromUpload === undefined) return null
  return nearestAspectRatio(size.width, size.height, imageModelRatios.value ?? DEFAULT_POSTER_RATIOS)
})
/** 提交栏上方的一句话：输出比例由参考海报决定，换模型（比例清单不同）可能随之变化 */
const posterRatioNote = computed(() =>
  posterRatioHint.value ? `输出比例 ${posterRatioHint.value}：跟随参考海报，换模型后会按该模型支持的比例重算` : '',
)

/** 只在价目表给出该工具的数字时返回 { 点数, 计价单位 }（单位空 = 按次）；其余返回 null */
const estimate = computed<{ points: number; unit: string } | null>(() => {
  const s = schema.value
  if (s?.price) return modelEstimate.value
  const table = pointsTable.value
  const m = s && table ? BIZ_POINTS_SOURCE.exec(s.submit.costSource) : null
  if (!s || !table || !m) return null
  const entry = table[m[1]!]
  if (typeof entry === 'number') return { points: entry, unit: '' }
  if (!m[2] || !entry || typeof entry !== 'object') return null
  // 按档位报价：档位取 costSource 方括号里那个字段的当前取值（出网口径，如 1080p）
  const f = s.fields.find((x) => x.label === m[2])
  const tier = f ? toJavaValue(f, values[f.key]) : undefined
  const item = typeof tier === 'string' ? (entry as Record<string, unknown>)[tier] : undefined
  if (!item || typeof item !== 'object') return null
  const { points, unit } = item as { points?: unknown; unit?: unknown }
  if (typeof points !== 'number') return null
  const unitText = typeof unit === 'string' ? (POINT_UNITS[unit] ?? unit) : ''
  return { points, unit: unitText }
})

/**
 * 图片生成 / 视频生成的预计消耗（schema.price）：取该路由自己的 model-configs，
 * 图片 = 所选分辨率单价 × 张数，视频 = 所选模型该档每秒单价（总价按所选时长标估算）；没报价的档返回 null（保持原文案）。
 */
const modelEstimate = computed<{ points: number; unit: string } | null>(() => {
  const s = schema.value
  if (s?.price === 'image-model-configs') {
    const res = s.fields.find((f) => f.key === 'resolution')
    const tier = res ? toJavaValue(res, values[res.key]) : undefined
    // 按所选模型（默认第一项）的单价报
    const unit = videoSizeOf(currentImageModel.value, tier)?.points
    if (typeof unit !== 'number') return null
    // 图片复刻：一张资产图一个任务，总价 = 单价 × 资产图张数（每个任务只出 1 张）；其余 = 单价 × 生成张数
    const count = s.pricePerUpload !== undefined ? (uploads[s.pricePerUpload]?.length ?? 0) : Number(values.count ?? 1)
    return { points: unit * (Number.isFinite(count) && count > 0 ? count : 1), unit: '' }
  }
  if (s?.price === 'video-model-configs') {
    const unit = videoSizeOf(currentVideoModel.value, values.resolution)?.points
    const seconds = Number(values.duration)
    if (typeof unit !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null
    // 视频没有后端报价：只给「N 点/秒」，总数由 secondsEstimate 按所选时长标成估算，不当作精确扣费
    return { points: unit, unit: '秒' }
  }
  return null
})

/** 按秒计价且已读到视频时长：仅作粗略估算（不足 1 秒按 1 秒向上取整），不是实际扣费 */
const secondsEstimate = computed<{ points: number; seconds: number } | null>(() => {
  const e = estimate.value
  if (!e || e.unit !== '秒') return null
  const formSeconds = Number(values.duration)
  const raw = schema.value?.price === 'video-model-configs' ? formSeconds : inputVideoSeconds.value
  if (!raw || !Number.isFinite(raw) || raw <= 0) return null
  const seconds = Math.ceil(raw)
  return { points: e.points * seconds, seconds }
})
const secondsEstimateText = computed(() =>
  secondsEstimate.value ? `约 ${secondsEstimate.value.points} 点（按 ${secondsEstimate.value.seconds} 秒估）` : '',
)

/** 「N 点」/「N 点/分钟」；价目表没给时为空串 */
const estimatedPoints = computed(() => {
  const e = estimate.value
  if (!e) return ''
  return e.unit ? `${e.points} 点/${e.unit}` : `${e.points} 点`
})

const costText = computed(() => {
  const s = schema.value
  if (!s) return ''
  const unit = estimatedPoints.value
    ? `预计消耗 ${estimatedPoints.value}${secondsEstimateText.value ? `（${secondsEstimateText.value}，仅为估算）` : ''}，提交即扣点`
    : `按${s.submit.costUnit}计费，提交即扣点`
  return fanOutCount.value > 1 ? `将提交 ${fanOutCount.value} 个任务 · ${unit}` : unit
})

/**
 * compact 版式按钮第二行：原型「消耗 30 点」（数字 900 粗）。点数取真实价目表；按时长计价的工具价目只有单价，
 * 总价要等视频时长，这里如实写成「消耗 N 点/分钟」。价目表没给 / 正在逐个提交时退回原来的整句。
 */
const costLine = computed<{ num: string; suffix: string; note?: string } | { text: string }>(() => {
  if (progressText.value) return { text: progressText.value }
  // 视频复刻页（解析标注 / 直接出片）：数字取后端报价（= 提交时冻结的点数），报不出来显示「—」
  if (isVideoClonePage.value) {
    const points = videoCloneQuote.points.value
    return { num: points === null ? '—' : String(points), suffix: ' 点' }
  }
  const e = estimate.value
  if (!e || fanOutCount.value > 1) return { text: costText.value }
  return {
    num: String(e.points),
    suffix: e.unit ? ` 点/${e.unit}` : ' 点',
    note: secondsEstimateText.value || undefined,
  }
})

// ---------------- 组装请求体 ----------------

function fieldEntries(f: ToolField): [string, unknown][] {
  if (f.uiOnly) return []
  if (f.type === 'region-list') {
    // 只提交改过的条目（与原文不同且非空）；没改的原样保留，不送去替换
    const info = changedRegions.value.map((r) => ({
      targetText: r.targetText,
      text: r.text.trim(),
      textRectangles: r.rect,
    }))
    return [['textInformation', info]]
  }
  if (f.type === 'voice') {
    const v = selectedVoice.value
    return v
      ? [
          ['voiceModel', v.model],
          ['voiceKey', v.voiceKey],
        ]
      : []
  }
  if (f.type === 'mask') return [] // 提交时先上传蒙版再填 maskUrl
  if (f.type === 'inpaint-region') return [['images', inpaintImages(uploads[0] ?? [], inpaintBoxes.value)]]
  const value = toJavaValue(f, values[f.key])
  return value === undefined || typeof f.javaKey !== 'string' ? [] : [[f.javaKey, value]]
}

/**
 * 表单 → 请求体里同步可得的部分（字段、上传地址、视频复刻标注、图片模型）；fan = 要逐张拆开提交的槽。
 * 蒙版要先导出上传，留给 {@link buildBodies}。视频复刻页的提交前报价用同一份（报价 = 提交时冻结的点数）。
 */
function formBase(s: ToolSchema): {
  base: Record<string, unknown>
  fan: { key: string; urls: string[]; asArray: boolean } | null
} {
  const base: Record<string, unknown> = { ...s.constants }
  for (const f of visibleFields.value) for (const [k, v] of fieldEntries(f)) base[k] = v

  let fan: { key: string; urls: string[]; asArray: boolean } | null = null
  for (const u of s.uploads) {
    const urls = uploads[u.slot] ?? []
    if (!urls.length || !uploadEnabled(u)) continue
    if (u.javaKey === 'images') continue // 局部重绘：地址已随区域进了 images
    if (u.javaKey === 'imageUrls' && s.perItemSubmit && urls.length > 1) fan = { key: u.javaKey, urls, asArray: true }
    else if (u.javaKey === 'imageUrls') base.imageUrls = urls.slice(0, slotMax(u))
    else if (u.max > 1) fan = { key: u.javaKey, urls, asArray: false }
    else base[u.javaKey] = urls[0]
  }
  // 视频复刻标注：videoClone + 选填 content；参考图编号按本次实际提交的 imageUrls（@n = 下标 + 1）
  if (cloneMode.value) {
    const refs = ((base.imageUrls as string[] | undefined) ?? []).slice(0, cloneRefMax.value)
    if (refs.length) base.imageUrls = refs
    else delete base.imageUrls
    Object.assign(base, vc.buildPayload(refs))
  }
  // 图片生成多模型：只有让用户选了模型时才传 model（CoreToolSubmissionRequest.model）；
  // 图片复刻的清单里滤掉了装不下两张图的模型，「默认项」可能已不是服务端的默认模型，所以有清单就明确传所选
  if (
    imageModelSelectable.value &&
    currentImageModel.value &&
    (s.minModelImages !== undefined || currentImageModel.value.model !== defaultImageModel.value?.model)
  )
    base.model = currentImageModel.value.model
  // 图片复刻：输出比例跟随参考海报，服务端按实测宽高再算一遍，这里只带提示值
  if (s.ratioFromUpload !== undefined && posterRatioHint.value) base.aspectRatio = posterRatioHint.value
  return { base, fan }
}

async function buildBodies(s: ToolSchema): Promise<Record<string, unknown>[]> {
  const { base, fan } = formBase(s)
  if (s.fields.some((f) => f.type === 'mask')) {
    const file = await maskRef.value?.exportMask()
    if (!file) throw new Error('蒙版生成失败，请重新涂抹')
    const [maskUrl] = await upload([file], undefined, { compress: false })
    base.maskUrl = maskUrl
  }
  return fan ? fan.urls.map((url) => ({ ...base, [fan!.key]: fan!.asArray ? [url] : url })) : [base]
}

// ---------------- 视频复刻页：提交前报价（POST /api/v1/workflows/video/quote） ----------------

/** 视频复刻页（解析标注与「直接出片」两种模式都用同一个报价接口，请求体与提交相同） */
const isVideoClonePage = computed(() => schema.value?.homeId === VIDEO_CLONE_ID)
const videoCloneQuote = useWorkflowVideoQuote(() => {
  const s = schema.value
  // 本地还不能提交（没传片、解析没完成、没标维度…）就不问：那时的禁用原因由前端给
  if (!s || !isVideoClonePage.value || localDisabledReason.value) return null
  try {
    const { base, fan } = formBase(s)
    return fan ? null : base
  } catch {
    return null
  }
})

/** 提交按钮的禁用原因：前端本地判定优先；视频复刻页再加后端报价判的「此刻提交会被拒」（与提交时同一句） */
const disabledReason = computed(
  () => localDisabledReason.value || (isVideoClonePage.value ? videoCloneQuote.blockReason.value : ''),
)

// ---------------- 提交 ----------------

async function onSubmit() {
  const s = schema.value
  if (!s || submitting.value || disabledReason.value || toolUnavailable.value) return
  submitting.value = true
  progressText.value = ''
  ensureBaseline()
  const submitAt = Date.now()
  let done = 0
  let total = 0
  try {
    if (s.sync) {
      await submitSync(submitAt)
      return
    }
    const bodies = await buildBodies(s)
    total = bodies.length
    // 先按「号未知」记一笔：请求超时 / 断网时任务可能已在服务端建好，靠时间兜底认领
    unknownSubmitAt.value ??= submitAt
    let allKnown = true
    for (const body of bodies) {
      if (total > 1) progressText.value = `正在提交 ${done + 1} / ${total}`
      const res = await submitTool(s.javaRoute, body)
      if (!rememberSubmission(res.data)) allKnown = false
      if (s.pricePerUpload !== undefined) {
        // 服务端按资产图扇出：返回几个任务号就是几张已提交（第 k 件失败时前面的保留、其余没提交也没扣点）
        total = Math.max(uploads[s.pricePerUpload]?.length ?? 0, 1)
        done = Math.min(submittedTaskCount(res.data), total)
        if (done < total) allKnown = false
      } else done += 1
    }
    // 这一轮全部成功且都拿到了号：撤掉本次记的时间兜底（之前没认领完的那笔保留）
    if (allKnown && unknownSubmitAt.value === submitAt) unknownSubmitAt.value = null
  } catch (err) {
    reportError(err, '提交失败，请重试')
  } finally {
    submitting.value = false
    progressText.value = ''
    if (done > 0) {
      message.success(
        done === total
          ? total === 1
            ? '已提交，可在历史记录查看进度'
            : `已提交 ${done} 个${s.title}任务`
          : `已提交 ${done} / ${total} 个任务，其余未提交`,
      )
    }
    if (!s.sync) {
      // 失败也刷新一次：超时 / 断网时任务可能已在服务端创建
      selectedId.value = null
      void userInfo.updateUserInfo()
      history.afterSubmit().catch((err) => reportError(err, '历史记录刷新失败'))
    }
  }
}

/** 同步抠图：成功直接出图；3010 = 任务仍在跑（拦截器已提示），结果会出现在历史里 */
async function submitSync(submitAt: number) {
  syncResultUrl.value = ''
  try {
    const res = await submitCutout(singleImage.value)
    syncResultUrl.value = res.data?.url ?? ''
  } catch (err) {
    // 等不及转异步 / 传输层失败：结果可能出现在历史里，但不带号，按提交时刻认领
    unknownSubmitAt.value ??= submitAt
    if (toApiError(err)?.code !== TASK_PROCESSING_CODE) throw err
  } finally {
    selectedId.value = null
    void userInfo.updateUserInfo()
    history.afterSubmit().catch((err) => reportError(err, '历史记录刷新失败'))
  }
}

// ---------------- 历史与结果 ----------------

/** 删除单条历史（DELETE /api/v1/tools/{toolTitle}/histories）；进行中的记录 Java 会拒绝，界面上不给删除入口 */
function confirmDelete(item: ToolHistoryItem) {
  dialog.warning({
    title: '删除记录',
    content: '确定删除这条历史记录？已下载的结果不受影响。',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await history.remove(item.aiToolHistoryId)
        if (selectedId.value === item.aiToolHistoryId) selectedId.value = null
        message.success('已删除')
      } catch (err) {
        // 删除走 authorizedFetch，不经拦截器：业务失败也要在这里提示
        const apiErr = toApiError(err)
        message.error(apiErr?.isNetwork ? '网络异常，请稍后重试' : (apiErr?.message ?? '删除失败，请重试'))
        return false
      }
    },
  })
}

// ---------------- 重新编辑（历史记录 requestParams → 表单，只回填不提交） ----------------

const RESTORE_DISABLED_TIP = '旧记录不支持重新编辑'
const formRef = ref<HTMLFormElement | null>(null)

/**
 * 表单只认显式提交（底部提交按钮 / 在它上面按回车空格）：单行输入框里按回车会触发浏览器的隐式提交，
 * 文字替换逐条改写时一回车就扣点提交了。这里拦掉所有 input 上的回车（多行 textarea 换行不受影响，
 * 按钮 / 开关不是 input 不受影响）；表单里目前没有「回车即提交」的单行字段。
 */
function blockImplicitSubmit(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement) e.preventDefault()
}

/**
 * 用原始提交体回填整张表单：先回到默认值，再按 restoreToolForm 的映射覆盖；图片 / 视频地址原样放进槽位（不重新上传）。
 * 没有 requestParams 的老记录入口是禁用的，这里也直接返回——不拿 payload 拼半张表单误导用户。
 * 不触发提交：用户确认后自己点提交按钮。
 */
async function restoreFrom(item: ToolHistoryItem) {
  const s = schema.value
  const params = item.requestParams
  if (!s || !params || submitting.value) return
  const r = restoreToolForm(s, params)
  if (r.voice && !voicesLoaded.value) await loadVoices().catch((err) => reportError(err, '音色列表加载失败'))
  if (schema.value !== s) return // 等音色期间切走了工具

  resetForm(s)
  selectedId.value = item.aiToolHistoryId
  for (const [slot, urls] of Object.entries(r.uploads)) uploads[Number(slot)] = urls
  Object.assign(values, r.values)
  // 图片生成：回填当时选的模型（模型表里还有它才回填；没有就保持默认第一项）
  if (s.price === 'image-model-configs' && typeof params.model === 'string') {
    if (imageModelChoices.value.some((m) => m.model === params.model)) values[IMAGE_MODEL_KEY] = params.model
    else pendingImageModel = params.model
  }
  // 视频复刻：带标注的记录回到解析标注（同一原片复用原解析，完成后套上当时的标注）；没有标注的老记录走直接出片
  if (s.homeId === VIDEO_CLONE_ID) {
    const ann = params.videoClone as VideoCloneAnnotations | undefined
    if (ann && typeof ann === 'object' && typeof ann.analysisId === 'string') {
      const refSlot = s.uploads.find((u) => u.javaKey === 'imageUrls')
      vc.queueRestore(
        ann,
        refSlot ? (uploads[refSlot.slot] ?? []) : [],
        typeof params.content === 'string' ? params.content : '',
      )
    } else {
      cloneSimple.value = true
    }
  }
  const lost: string[] = []
  if (r.voice) {
    const hit = voices.value.find((v) => v.model === r.voice!.voiceModel && v.voiceKey === r.voice!.voiceKey)
    if (hit) values.voice = hit.voiceId
    else lost.push('配音音色')
  }
  if (hasRegionField.value) {
    // 文字替换：识别结果随提交体回填；回填的原图不自动重新识别（识别单独计费），要重识别用户自己点
    restoredImage = uploads[0]?.[0] ?? ''
    if (r.regions) regions.value = r.regions.map((x) => ({ ...x }))
    else lost.push('识别结果')
  }
  if (r.needsMask) lost.push('涂抹区域')
  if (r.inpaint) {
    inpaintBoxes.value = r.inpaint
    if ((uploads[0] ?? []).some((u) => !r.inpaint![u])) lost.push('重绘区域')
  }

  await nextTick()
  const form = formRef.value
  if (form) {
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    form.scrollTo({ top: 0, behavior })
    form.scrollIntoView({ block: 'start', behavior })
    form.focus({ preventScroll: true })
  }
  if (r.needsMask && lost.length === 1) message.info('已恢复原图，涂抹区域需要重新画')
  else if (lost.length) message.warning(`已回填原参数，${lost.join('、')}需要重新设置`)
  else message.success(`已回填原参数，确认后点「${s.submit.label}」提交`)
}

/**
 * 任务中心「做同款 / 参数回填」交接（utils/refillHandoff）：进页后按工具历史标题取走一次，
 * 走与「重新编辑」同一条回填路径；做同款（same）清空素材，只留模板与设置。
 */
watch(
  () => schema.value?.historyTitle,
  (title) => {
    if (!title) return
    const h = takeRefill('tool', title)
    if (!h) return
    void restoreFrom({ requestParams: h.params } as unknown as ToolHistoryItem).then(() => {
      if (h.mode !== 'same') return
      for (const slot of Object.keys(uploads)) uploads[Number(slot)] = []
    })
  },
  { immediate: true },
)

/**
 * 进页什么都不选（原型）：用户点了某条、或本标签页刚提交出了记录之后，结果列才展示记录，否则整列是功能介绍。
 *
 * <p>「本页提交的」优先按提交响应里的任务号 / 工作流记录号认（ownTaskIds / ownHistoryIds），别的标签页、别的设备
 * 同时提交的记录不会自己弹出来。响应没带号（同步抠图 3010 转异步、超时 / 断网但服务端可能已建）时退一步：
 * 不在基线里、且创建时间不早于本次提交（留 60 秒时钟偏差）的才算。基线 = 进页时那页记录；进页那次历史没拉成功的，
 * 提交前用当时列表补一份，免得把老记录当成新的。
 */
const baselineIds = ref<Set<number> | null>(null)
const ownTaskIds = ref<Set<string>>(new Set())
const ownHistoryIds = ref<Set<number>>(new Set())
/** 响应没带号的那次提交时刻（ms）；null = 不需要按时间兜底 */
const unknownSubmitAt = ref<number | null>(null)
const CLOCK_SKEW_MS = 60_000
watch(
  () => history.loaded.value,
  (loaded) => {
    if (loaded && !baselineIds.value) baselineIds.value = new Set(history.items.value.map((i) => i.aiToolHistoryId))
  },
  { immediate: true },
)
watch(toolId, () => {
  baselineIds.value = null
  ownTaskIds.value = new Set()
  ownHistoryIds.value = new Set()
  unknownSubmitAt.value = null
})

/** 提交前：进页那次历史没拉到时，用当前列表补基线 */
function ensureBaseline() {
  if (!baselineIds.value) baselineIds.value = new Set(history.items.value.map((i) => i.aiToolHistoryId))
}

/** 记下本次提交响应里的号：taskId / taskIds（工具路由）、workflowHistoryIds（工作流路由）；一个都没有返回 false */
/** 提交返回里的任务号个数（taskId 单值或 taskIds 数组） */
function submittedTaskCount(data: unknown): number {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const ids = [d.taskId, ...(Array.isArray(d.taskIds) ? d.taskIds : [])]
  return ids.filter((x) => typeof x === 'string' && !!x).length
}

function rememberSubmission(data: unknown): boolean {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const tasks = [d.taskId, ...(Array.isArray(d.taskIds) ? d.taskIds : [])].filter(
    (x): x is string => typeof x === 'string' && !!x,
  )
  const histories = (Array.isArray(d.workflowHistoryIds) ? d.workflowHistoryIds : []).filter(
    (x): x is number => typeof x === 'number',
  )
  if (tasks.length) ownTaskIds.value = new Set([...ownTaskIds.value, ...tasks])
  if (histories.length) ownHistoryIds.value = new Set([...ownHistoryIds.value, ...histories])
  return tasks.length + histories.length > 0
}

/** 服务端时间串（无时区，按本地时间解析）→ ms；解析不了返回 NaN */
const createdMs = (v?: string | null) => (v ? new Date(v.replace(' ', 'T')).getTime() : NaN)

function isOwnNew(i: ToolHistoryItem) {
  if (ownHistoryIds.value.has(i.aiToolHistoryId) || (!!i.taskUid && ownTaskIds.value.has(i.taskUid))) return true
  const since = unknownSubmitAt.value
  const base = baselineIds.value
  if (since === null || !base || base.has(i.aiToolHistoryId)) return false
  const t = createdMs(i.createdAt)
  return Number.isFinite(t) && t >= since - CLOCK_SKEW_MS
}

const current = computed<ToolHistoryItem | null>(() => {
  const picked = history.items.value.find((i) => i.aiToolHistoryId === selectedId.value)
  if (picked) return picked
  return history.items.value.find(isOwnNew) ?? null
})

/**
 * 逐条出结果：一次提交拆成多个任务时，中间列默认盯最新那条；它还在跑、而同批别的任务先出了结果，
 * 就把先出的那条选上，不让用户对着转圈等整批。只在「没手动选过、中间列正在转圈」时接管，已在看结果时不跳。
 */
/** 上面自动选上的那条（用户手点的不记）：最新那条到终态时交还给默认跟随，不把中间列钉在先出的那条上 */
let autoPickedId: number | null = null
watch(
  () => history.items.value.find((i) => isOwnNew(i) && i.status === 'SUCCEED')?.aiToolHistoryId ?? null,
  (firstDone) => {
    if (firstDone == null || selectedId.value != null || showSync.value) return
    if (current.value && !isTerminal(current.value.status)) {
      selectedId.value = firstDone
      autoPickedId = firstDone
    }
  },
)
watch(
  () => {
    const newest = history.items.value.find(isOwnNew)
    return newest && isTerminal(newest.status) ? newest.aiToolHistoryId : null
  },
  (newestDone) => {
    if (newestDone == null || autoPickedId == null) return
    if (selectedId.value === autoPickedId) selectedId.value = null
    autoPickedId = null
  },
)

const isVideoUrl = (u: string) => /\.(mp4|webm|mov)(\?|#|$)/i.test(u)

function outputsOf(item: ToolHistoryItem) {
  const images = [...(item.resultImageUrls ?? [])]
  const videos = [...(item.resultVideoUrls ?? [])]
  const url = item.result?.url
  if (url && !images.includes(url) && !videos.includes(url)) (isVideoUrl(url) ? videos : images).push(url)
  return { images, videos }
}

const STATUS: Record<string, { text: string; cls: string }> = {
  PENDING: { text: '排队中', cls: 'll-chip-running' },
  RUNNING: { text: '生成中', cls: 'll-chip-running' },
  WAITING_MANUAL_PROCESS: { text: '处理中', cls: 'll-chip-running' },
  SUCCEED: { text: '已完成', cls: 'll-chip-success' },
  FAILED: { text: '失败', cls: 'll-chip-error' },
  TIMEOUT: { text: '超时', cls: 'll-chip-error' },
  CANCELLED: { text: '已取消', cls: 'll-chip-warning' },
}
const statusOf = (s: string) => STATUS[s] ?? { text: s || '未知', cls: 'll-chip-warning' }
/** 历史卡状态胶囊（原型 .v3-hist__status）：999 胶囊 + 语义 soft 底深字 + 5px 状态点 */
const statusChipCls = (s: string) => {
  const cls = statusOf(s).cls
  if (cls === 'll-chip-success') return 'bg-success-soft text-success'
  if (cls === 'll-chip-error') return 'bg-danger-soft text-danger'
  if (cls === 'll-chip-warning') return 'bg-warning-soft text-warning'
  return 'bg-info-soft text-violet-ink'
}
const statusDotCls = (s: string) => {
  const cls = statusOf(s).cls
  if (cls === 'll-chip-success') return 'bg-success'
  if (cls === 'll-chip-error') return 'bg-danger'
  if (cls === 'll-chip-warning') return 'bg-warning'
  return 'bg-violet'
}

/** 完整时间（YYYY-MM-DD HH:mm:ss）：title / 读屏名 */
const formatTime = (v?: string | null) => formatFullTime(v)
/** 历史卡空间窄：今天 HH:mm / 同年 MM-DD / 跨年 YYYY-MM-DD；完整时间放 title / 读屏名 */
const shortTime = (v?: string | null) => formatShortTime(v)

/** 历史卡第一行：提示词（没有就写工具名） */
const promptOf = (item: ToolHistoryItem) => item.payload?.prompt?.trim() || schema.value?.title || '未命名记录'

/** 历史卡缩略：优先输入图（用户上传的），没有再看结果图；张数用于叠影与角标 */
function stackOf(item: ToolHistoryItem) {
  const inputs = [...(item.inputImageUrls ?? item.payload?.imageUrls ?? [])].filter(Boolean)
  const results = outputsOf(item).images
  return inputs.length ? inputs : results
}

/** 历史卡「下载」：第一张产物（图片优先，其次视频） */
const firstOutput = (item: ToolHistoryItem) => outputsOf(item).images[0] ?? outputsOf(item).videos[0] ?? ''

// 历史列（原型 ml 版）：搜索提示词 + 每页 8 条翻页；只在已加载的这一页记录里筛，不改拉取口径
const HISTORY_PAGE_SIZE = 8
const historyQuery = ref('')
const historyPage = ref(1)
const historyFiltered = computed(() => {
  const q = historyQuery.value.trim().toLowerCase()
  if (!q) return history.items.value
  return history.items.value.filter((i) => promptOf(i).toLowerCase().includes(q))
})
const historyPages = computed(() => Math.max(1, Math.ceil(historyFiltered.value.length / HISTORY_PAGE_SIZE)))
const historyPaged = computed(() =>
  historyFiltered.value.slice((historyPage.value - 1) * HISTORY_PAGE_SIZE, historyPage.value * HISTORY_PAGE_SIZE),
)
watch(historyQuery, () => (historyPage.value = 1))
watch(historyPages, (n) => {
  if (historyPage.value > n) historyPage.value = n
})
watch(toolId, () => {
  historyQuery.value = ''
  historyPage.value = 1
})

// ---------------- 结果列（原型 ToolPreviewPanel） ----------------

/** 同步抠图刚拿到的结果：没在历史里另选记录时，结果列先展示它 */
const showSync = computed(() => !!syncResultUrl.value && selectedId.value === null)
/** 结果列有没有内容可看；都没有时整列只放功能介绍 */
const hasRecord = computed(() => showSync.value || !!current.value)

const products = computed<PreviewItem[]>(() => {
  if (showSync.value) return [{ type: 'image', src: syncResultUrl.value, name: '本次抠图结果' }]
  const item = current.value
  if (!item || item.status !== 'SUCCEED') return []
  const out = outputsOf(item)
  const title = schema.value?.title ?? '生成结果'
  return [
    ...out.images.map((src) => ({ type: 'image' as const, src })),
    ...out.videos.map((src) => ({ type: 'video' as const, src })),
  ].map((p, i) => ({ ...p, name: `${title} · ${i + 1}` }))
})

const resultMode = ref<'result' | 'compare' | 'colorfix'>('result')
const selectedIndex = ref(0)
watch(
  () => (showSync.value ? `sync:${syncResultUrl.value}` : current.value?.aiToolHistoryId),
  () => {
    resultMode.value = 'result'
    selectedIndex.value = 0
  },
)
const selectedProduct = computed(() => products.value[selectedIndex.value] ?? products.value[0] ?? null)
const compareAfter = computed(
  () =>
    (selectedProduct.value?.type === 'image' ? selectedProduct.value.src : '') ||
    products.value.find((p) => p.type === 'image')?.src ||
    '',
)
/**
 * 「前后对比」拿哪张输入图（schema.compare）：false = 不对比（图片生成）；不写 = 第 0 张「输入图」；
 * 商拍换装第 1 张「模特图」、姿态复刻第 1 张「参考姿势图」。指定的那张没有就不给对比，免得标签对不上图。
 */
const compareSpec = computed(() => {
  const c = schema.value?.compare
  if (c === false) return null
  return c ?? { index: 0, label: '输入图' }
})
const compareBefore = computed(() => {
  const spec = compareSpec.value
  if (!spec) return ''
  if (showSync.value) return spec.index === 0 ? singleImage.value : ''
  const item = current.value
  const inputs = (item?.inputImageUrls?.length ? item.inputImageUrls : item?.payload?.imageUrls) ?? []
  return inputs[spec.index] ?? ''
})
const compareLabels = computed<[string, string]>(() => [compareSpec.value?.label ?? '输入图', '生成结果'])
/** 一进一出的处理类工具：有输入图 + 结果图时给「结果 / 前后对比」两档 */
const canCompare = computed(() => !!compareAfter.value && !!compareBefore.value)
/**
 * 校色：所有出图的工具默认开（模型出图常偏色），出视频 / 音频的工具默认关；schema.colorFix 显式写了以它为准。
 * 实际是否出现还要看当前选中的产物是不是图片（视频产物不校色）。
 */
const colorFixEnabled = computed(() => schema.value?.colorFix ?? schema.value?.media === 'image')
/** 头部名称：记录自带标题时用它，否则写工具名 */
const recordTitle = computed(() => {
  const t = (current.value as (ToolHistoryItem & { title?: unknown }) | null)?.title
  return typeof t === 'string' && t.trim() ? t.trim() : (schema.value?.title ?? '')
})

const lightboxOpen = ref(false)
const lightboxIndex = ref(0)
/** 灯箱：选中的那张图给烘好的校色图（还在烘 / 烘失败时给原图） */
const lightboxItems = computed<PreviewItem[]>(() =>
  products.value.map((p, i) =>
    i === selectedIndex.value && p.type === 'image' && canColorCompare.value && !stageFilter.value
      ? { ...p, src: stageSrc.value }
      : p,
  ),
)

// ---------------- 多图同步对照（components/ImageCompareSync，原型「三图对照」） ----------------
/** 对照的输入列：姿态 = 人物图 + 姿势图、商拍 = 模特图 + 服装图、图片复刻 = 资产图 + 参考海报，其它按上传槽名取前两张 */
const syncInputs = computed<CompareColumn[]>(() => {
  const item = current.value
  const urls = (showSync.value ? [singleImage.value] : (item?.inputImageUrls?.length ? item.inputImageUrls : item?.payload?.imageUrls) ?? []).filter(
    (u): u is string => !!u && !u.startsWith('placeholder://') && !isVideoUrl(u),
  )
  if (!urls.length) return []
  const uploads = schema.value?.uploads ?? []
  const cols = urls.slice(0, 2).map<CompareColumn>((url, i) => ({
    url,
    label: urls.length < 2 ? '输入图' : (uploads[i]?.label ?? (i ? '参考图' : '输入图')),
  }))
  const id = schema.value?.homeId
  if (urls.length >= 2) {
    // 商拍换装的上传顺序是 服装图、模特图；对照里模特在前（保留的主体在前、被借用的在后）
    if (id === 'ai-digital-model') cols.reverse()
    const metas: Record<string, [string, string]> = {
      'ai-posture-fission': ['保留身份与场景', '只借动作与神态'],
      'ai-digital-model': ['保留模特与姿态', '要换上的服装'],
      'ai-poster-replicate': ['要放进海报的主体', '只借版式与字体气质'],
    }
    const m = id ? metas[id] : undefined
    cols.forEach((c, i) => (c.meta = m?.[i]))
  }
  return cols
})
/** 一组对照 = 输入列 + 一张图片产物；多产物时顶栏可切换 */
const syncGroups = computed<CompareGroup[]>(() => {
  const inputs = syncInputs.value
  if (!inputs.length) return []
  const title = schema.value?.title ?? '生成结果'
  const out: CompareGroup[] = []
  products.value.forEach((p, i) => {
    if (p.type !== 'image') return
    const url = i === selectedIndex.value && canColorCompare.value && !stageFilter.value ? stageSrc.value : p.src
    out.push({
      name: products.value.length > 1 ? p.name : undefined,
      columns: [...inputs, { url, label: '生成结果', generated: true, filename: `${title}-生成结果${products.value.length > 1 ? `-${i + 1}` : ''}` }],
    })
  })
  return out
})
const syncOpen = ref(false)
const syncIndex = ref(0)
/** 结果图点击：有输入图可对照时开同步对照，否则回到单图灯箱 */
function openResult() {
  const groups = syncGroups.value
  if (!groups.length) return openLightbox()
  const at = products.value.slice(0, selectedIndex.value + 1).filter((p) => p.type === 'image').length - 1
  syncIndex.value = Math.max(0, Math.min(at, groups.length - 1))
  syncOpen.value = true
}

function openLightbox() {
  if (!products.value.length) return
  lightboxIndex.value = Math.min(selectedIndex.value, products.value.length - 1)
  lightboxOpen.value = true
}

// ---------------- 校色闭环（components/ColorFix 套件） ----------------
// 参数 / 选区改动后烘进真像素（按 原图 + 蒙版 + 参数 缓存），舞台 / 前后对比右侧 / 校色对比右侧 / 灯箱 /
// 下载 / 存资产都用烘好的图；整图校色烘好之前 CSS filter 只做即时预览。参数按任务号存 localStorage，
// 切回记录自动还原；资产侧原图 + 校色后两版。选区：整图 / 自动识别 / 手动涂抹（局部调色）。
const colorFixSaving = ref(false)
const colorFixTaskUid = computed(() => (showSync.value ? '' : (current.value?.taskUid ?? '')))

const cf = useResultColorFix({
  key: colorFixTaskUid,
  // 免费档水印：校色来源 = 选中产物的 src，与 downloadSelected 的普通下载同一个地址
  // （工具历史接口已按观看者档位下发：免费档是带水印副本），不要另取原件
  src: computed(() => (selectedProduct.value?.type === 'image' ? selectedProduct.value.src : '')),
  enabled: colorFixEnabled,
})
const colorFixPanelOpen = cf.panelOpen
/** 本条记录是否校色过：面板动过参数 / 选区，或 localStorage 里有这条记录的参数 */
const colorFixTouched = cf.touched
/** 第三档「校色对比」：校色开着（参数台打开过 / 调过参数）的图片结果才有 */
const canColorCompare = cf.compareAvailable

watch(canColorCompare, (ok) => {
  if (!ok && resultMode.value === 'colorfix') resultMode.value = 'result'
})

/** 舞台 / 对比右侧显示的图：校色开着时是烘好的图（整图校色烘好前是原图 + stageFilter 即时预览） */
const stageSrc = cf.displaySrc
/** 只在整图校色、显示原图、还没烘好时挂的 CSS filter */
const stageFilter = cf.liveFilter

/**
 * 存为资产（校色后）：把当前结果烘成 PNG → goUpload 直传 → 按任务号找素材库产物行 →
 * 图片地址对上号的那条资产追加「校色后」版本（params 里带 colorFix JSON，详情页版本胶囊按它标注）。
 */
async function saveAsAsset() {
  const product = selectedProduct.value
  if (!product || product.type !== 'image' || colorFixSaving.value) return
  const uid = colorFixTaskUid.value
  if (!uid) {
    message.warning('这条记录没有任务号，无法写入素材库')
    return
  }
  const withColorFix = canColorCompare.value
  colorFixSaving.value = true
  try {
    // 对号规则见 components/ColorFix findTaskAsset：免费用户在工具页看到的是带水印副本，所以同时比 image 与 watermark
    const imageProducts = products.value.filter((x) => x.type === 'image')
    const target = await findTaskAsset({
      taskUid: uid,
      src: product.src,
      index: imageProducts.findIndex((x) => x.src === product.src),
      total: imageProducts.length,
    })
    if (!target) {
      message.warning(withColorFix ? '这张结果还没有进入素材库，暂不能追加校色版本' : '这张结果还在入库中，稍后再试')
      return
    }
    // 没校色：生成结果完成时已自动入库，这里只确认已在素材库（资产接口只能追加版本，不另建一条）
    if (!withColorFix) {
      message.success('这张结果已在素材库，可到资产库查看')
      return
    }
    const r = await saveColorFixVersion(target.id, cf, {
      sourceImage: product.src,
      fileName: `colorfix-${uid}.png`,
      prompt: promptOf(current.value ?? ({} as ToolHistoryItem)) || undefined,
    })
    if (r.status === 'duplicate') message.info('这组校色参数已经存过了')
    else if (r.status === 'saved') message.success('已存为资产：原图 + 校色后两版')
  } catch (err) {
    reportError(err, '存为资产失败，请重试')
  } finally {
    colorFixSaving.value = false
  }
}

/** 下载当前选中的结果：校色动过时烘成 PNG（含效果），否则按原地址下载 */
async function downloadSelected() {
  const product = selectedProduct.value
  if (!product) return
  if (product.type === 'image' && canColorCompare.value) {
    // 烘图要跨域读像素（依赖 OSS CORS），失败时套件已退回原地址下载，别让用户拿不到图
    if (!(await cf.downloadBaked(`${product.name || 'result'}-校色后.png`)))
      message.warning('校色效果未能写入，已下载原图')
    return
  }
  if (product.type === 'video') window.open(product.src, '_blank', 'noopener')
  else void downloadImage(product.src, product.name)
}

/** 「下载校色前」：原图原地址 */
function downloadBeforeColorFix() {
  const product = selectedProduct.value
  if (product?.type === 'image') cf.downloadOriginal(`${product.name || 'result'}-校色前`)
}

// ---------------- 灯箱（历史缩略图 / 抠图结果卡）：共用 MediaLightbox ----------------
const thumbLightbox = reactive<{ show: boolean; index: number; items: LightboxItem[] }>({
  show: false,
  index: 0,
  items: [],
})
function openThumbs(urls: string[], index = 0, name = '') {
  if (!urls.length) return
  thumbLightbox.items = urls.map((url, i) => ({
    url,
    type: isVideoUrl(url) ? 'video' : 'image',
    name: urls.length > 1 ? `${name} · ${i + 1}` : name,
  }))
  thumbLightbox.index = index
  thumbLightbox.show = true
}

// ---------------- 抠图 / 消除：换一张 ----------------
/** 清掉原图与上次结果（抠图结果、涂抹、识别），回到上传空态 */
function replaceInput() {
  for (const u of schema.value?.uploads ?? []) uploads[u.slot] = []
  syncResultUrl.value = ''
  maskHasStroke.value = false
  regions.value = []
}

// ---------------- 进页聚焦提示词（D22） ----------------
const promptRef = ref<{ focus: () => void } | null>(null)
function setPromptRef(el: unknown) {
  promptRef.value = (el as { focus: () => void } | null) ?? null
}
watch(
  () => schema.value?.homeId,
  () => {
    // 只在精确指针设备上自动聚焦（触屏会直接弹键盘）；preventScroll 不把页面滚走
    if (typeof window === 'undefined' || !window.matchMedia('(pointer: fine)').matches) return
    void nextTick(() => promptRef.value?.focus())
  },
  { immediate: true, flush: 'post' },
)

/** 原型 ToolWorkspaceColumns 历史列 empty-hint 全文（原型展示时切到分号前，按产品要求用全文） */
const HISTORY_EMPTY_HINT = '左边传好素材、点底部按钮提交，每次生成都会在这一列留一条；点一条就能在右边看它的产物'
/** 图标框（原型 .v3-item__icon / .fn-switch__thumb）：1px line、r6、135° 柔紫渐变 + 顶 1px 白内线，图标藤紫 */
const tileCls =
  'flex-none grid place-items-center box-border rounded-6px border border-solid border-line ' +
  'bg-[linear-gradient(135deg,var(--xq-violet-icon-a),var(--xq-violet-icon-b))] shadow-[inset_0_1px_0_#fff]'
/** 结果舞台（原型 `.v3-preview__stage`）：1px line、r8、surface2 + 20px 淡棋盘格、inset-input 内影 */
const stageCls =
  'relative overflow-hidden box-border rounded-8px border border-solid border-line bg-surface2 ' +
  '[background-image:repeating-conic-gradient(var(--xq-checker-b)_0_25%,transparent_0_50%)] bg-[length:20px_20px] ' +
  'shadow-[inset_0_1px_2px_rgba(31,35,41,0.055),inset_0_0_0_1px_rgba(255,255,255,0.7)]'
/** 结果列空态（原型 `.v3-preview__empty`）：最小高 220、内边距 18、gap 5，说明 11/1.55 muted */
const resultEmptyCls =
  'flex-1 min-h-[220px] flex flex-col items-center justify-center gap-5px p-18px text-center text-11px leading-[1.55] text-muted'

/** 用户协议文档地址（协议正文由运营在协议后台维护；条款文本见 Java 仓库 deploy/agreement-clause-poster-replicate.md） */
const AGREEMENT_URL = 'https://aigc.pengqiwl.com/agreements/ai-generate-terms-of-use.pdf'
const focusRing = 'outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)'
/** 输入框（原型 `.sx-input` 材质对齐档）：高 34、1px #c9cfd6、r15、inset-input；hover #aeb6bf；焦点 violet 描边 + 3px 光晕 α.14 */
const inputCls =
  'w-full h-34px box-border rounded-15px border border-solid border-control bg-white px-10px text-13px text-ink ' +
  'shadow-[inset_0_1px_2px_rgba(31,35,41,0.055),inset_0_0_0_1px_rgba(255,255,255,0.7)] ' +
  '[transition:border-color_110ms,box-shadow_110ms] hover:border-control-hover ' +
  'focus:(border-violet outline-none shadow-[inset_0_1px_2px_rgba(31,35,41,0.055),0_0_0_3px_rgba(135,95,154,0.14)]) ' +
  'disabled:(border-line bg-surface3 text-placeholder cursor-not-allowed)'
/** 历史骨架扫光（原型 hist-shimmer）：90° #f1f2f4 25% / #f8f9fa 50% / #f1f2f4 75%、底图 200% 宽，1.2s ease-in-out 循环 */
const shimmerCls =
  'bg-[linear-gradient(90deg,var(--xq-skeleton-a)_25%,var(--xq-skeleton-b)_50%,var(--xq-skeleton-a)_75%)] bg-[length:200%_100%] ' +
  'animate-[tool-hist-shimmer_1.2s_ease-in-out_infinite] motion-reduce:animate-none'
/** 板材小按钮（原型 `.sx-btn`）：#c9cfd6 描边 + 白→#fbfcfc + 内高光；按下 #b9c0c8 + #f3f4f5→#f7f8f9 + inset-press */
const plateBtnCls =
  'border border-solid border-control bg-[linear-gradient(var(--xq-surface),var(--xq-plate-bottom))] text-ink-2 cursor-pointer ' +
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(31,35,41,0.04),0_1px_2px_rgba(31,35,41,0.05)] ' +
  'active:(border-control-press bg-[linear-gradient(var(--xq-surface3),var(--xq-surface2))] shadow-[inset_0_1px_2px_rgba(31,35,41,0.12),inset_0_0_0_1px_rgba(31,35,41,0.03)]) ' +
  '[transition:border-color_110ms,color_110ms,background_110ms] hover:(border-control-hover text-ink bg-[linear-gradient(var(--xq-surface),var(--xq-surface2))])'
</script>

<template>
  <div v-if="!schema" class="h-full flex flex-col items-center justify-center gap-12px bg-page">
    <p class="m-0 text-15px text-ink">没有找到这个工具</p>
    <RouterLink to="/tools" class="ll-link" :class="focusRing">返回工具箱</RouterLink>
  </div>

  <div v-else-if="toolUnavailable" class="h-full flex flex-col items-center justify-center gap-12px bg-page" role="status">
    <p class="m-0 text-15px text-ink">该功能暂未开放</p>
    <RouterLink to="/tools" class="ll-link" :class="focusRing">返回工具箱</RouterLink>
  </div>

  <!-- 原型 .app-main 定高 100%、overflow hidden：三栏各自滚，整页不滚（外层布局随内容长高，这里按视口定高） -->
  <div v-else class="relative flex h-100vh min-h-0 overflow-hidden bg-page">
    <!-- 断网提示条：浏览器离线或连续网络失败暂停轮询时出现（与创作页同一份） -->
    <PollingOfflineBanner :show="history.offline.value" @retry="history.retryPolling()" />
    <!--
      目录（原型 B2 NextDirectory）：展开 160 / 收起 44；头部高 48、内边距 0 8 0 14、图标钮 28 / r4；
      列表区内边距 0 6 10；组标题高 28、内边距 0 8、12px；条目高 48、内边距 0 14 0 8、gap 10、r6，图标 36 / r6。
      没有页面的条目显示「即将开放」。
    -->
    <nav
      ref="catalogNav"
      class="relative z-34 flex-none w-44px basis-44px"
      :class="
        wideViewport
          ? catalogCollapsed
            ? ''
            : '!w-160px !basis-160px [transition:width_0.2s_ease,flex-basis_0.2s_ease] motion-reduce:transition-none'
          : ''
      "
      aria-labelledby="tool-catalog-title"
    >
      <div
        class="flex min-h-0 flex-col box-border overflow-hidden bg-white"
        :class="
          catalogOverlay
            ? 'absolute left-0 top-0 z-40 h-full w-160px border border-solid border-shell-line rounded-10px shadow-[0_12px_32px_rgba(31,35,41,0.18)]'
            : 'h-full w-full border-l border-solid border-shell-line shadow-[10px_0_16px_-12px_rgba(31,35,41,0.22)]'
        "
      >
        <div
          class="flex-none flex items-center gap-8px h-48px"
          :class="catalogCollapsed ? 'justify-center' : 'justify-between pl-14px pr-8px'"
        >
          <h2
            id="tool-catalog-title"
            class="m-0 min-w-0 flex-1 truncate text-16px font-600 leading-[1.55] text-ink"
            :class="catalogCollapsed ? 'sr-only' : ''"
          >
            {{ catalog.title }}
          </h2>
          <!-- 原型 .v3-iconbtn：28 / r4、muted，悬停 #f3f4f5 + ink（无过渡）；展开态是菜单图标、收起态是右箭头 -->
          <IconButton
            id="tool-catalog-toggle"
            variant="quiet"
            :label="catalogCollapsed ? '展开目录' : '收起目录'"
            :aria-expanded="!catalogCollapsed"
            aria-controls="tool-catalog-list"
            @click="toggleCatalog"
          >
            <svg
              viewBox="0 0 512 512"
              fill="none"
              stroke="currentColor"
              stroke-width="32"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path v-if="catalogCollapsed" stroke-width="48" d="M184 112l144 144-144 144" />
              <path v-else stroke-miterlimit="10" d="M80 160h352M80 256h352M80 352h352" />
            </svg>
          </IconButton>
        </div>
        <div class="relative flex-1 min-h-0">
          <!-- 上下渐隐：只在还能往那个方向滚时出现（opacity 160ms） -->
          <span
            class="pointer-events-none absolute inset-x-0 top-0 z-1 h-16px bg-[linear-gradient(var(--xq-surface),rgb(var(--xq-surface-rgb)/0))] [transition:opacity_0.16s_ease]"
            :class="fadeTop ? 'opacity-100' : 'opacity-0'"
            aria-hidden="true"
          />
          <!--
          展开（原型 .v3-dir__body）：内边距 0 6 10、滚动条隐藏；组距上 16 / 下 10，组线 0.8px #efefef + 2px 淡影；
          条目 48、r6，图标 + 56 定宽文字列整簇居中，悬停 #f3f4f5（无过渡）。
          收起（原型 .v3-dir__rail）：内边距 2 0 2 3、gap 2；图标钮 36 / r6、muted，悬停 110ms；组间 11 高分隔线。
        -->
          <div
            id="tool-catalog-list"
            ref="catalogScroll"
            class="h-full overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            :class="catalogCollapsed ? 'flex flex-col items-start gap-2px pt-2px pr-0 pb-2px pl-3px' : 'px-6px pb-10px'"
            @scroll="onCatalogScroll"
            @mouseenter="catalogCollapsed && scheduleRailTips()"
            @mouseleave="catalogCollapsed && scheduleHideRailTips()"
          >
            <template v-for="(g, gi) in catalog.groups" :key="g.label">
              <div
                v-if="catalogCollapsed && gi"
                class="flex self-stretch items-center flex-[0_0_11px] h-11px mt-1px mr-0 mb-1px ml-[-3px] before:(content-[''] w-full h-[0.8px] bg-shell-line shadow-[0_1px_2px_rgba(31,35,41,0.07)])"
                aria-hidden="true"
              />
              <section
                :class="
                  catalogCollapsed
                    ? 'contents'
                    : gi
                      ? 'mt-16px pt-10px shadow-[inset_0_0.8px_0_var(--xq-engrave),inset_0_2px_3px_-2px_rgba(31,35,41,0.1)]'
                      : ''
                "
                :aria-labelledby="`tool-catalog-group-${gi}`"
              >
                <h3
                  :id="`tool-catalog-group-${gi}`"
                  class="m-0 flex items-center h-28px px-8px text-12px font-600 tracking-[0.02em] whitespace-nowrap text-muted"
                  :class="catalogCollapsed ? 'sr-only' : ''"
                >
                  {{ g.label }}
                </h3>
                <ul class="m-0 p-0 list-none flex flex-col" :class="catalogCollapsed ? 'contents' : ''">
                  <li v-for="e in g.entries" :key="e.id" :class="catalogCollapsed ? 'contents' : ''">
                    <component
                      :is="e.route ? RouterLink : 'div'"
                      v-bind="
                        e.route
                          ? { to: e.route, 'aria-current': e.id === toolId ? 'page' : undefined }
                          : { 'aria-disabled': 'true' }
                      "
                      :data-rail-id="e.id"
                      :aria-label="e.route ? `${e.name}，${e.tagline}` : `${e.name}（即将开放）`"
                      :title="catalogCollapsed ? undefined : e.route ? e.tagline : '即将开放'"
                      class="flex items-center box-border rounded-6px border border-solid no-underline"
                      :class="[
                        catalogCollapsed
                          ? 'flex-[0_0_36px] justify-center w-36px h-36px p-0 [transition:background_110ms,color_110ms] motion-reduce:transition-none'
                          : 'justify-start gap-10px w-full h-48px px-8px',
                        e.route ? focusRing : 'cursor-not-allowed',
                        e.id === toolId
                          ? [
                              'border-line bg-[linear-gradient(var(--xq-surface3),var(--xq-sunk-bottom))] shadow-[inset_0_1px_3px_rgba(31,35,41,0.1),inset_0_-1px_0_#fff]',
                              catalogCollapsed ? 'text-ink' : '',
                            ]
                          : [
                              'border-transparent',
                              e.route ? 'hover:bg-surface3' : '',
                              catalogCollapsed ? (e.route ? 'text-muted hover:text-ink' : 'text-muted opacity-60') : '',
                            ],
                      ]"
                      @mouseenter="hoveredRail = e.id"
                      @click="e.route && onCatalogItemClick()"
                      @focus="catalogCollapsed && (showRailTips(), (hoveredRail = e.id))"
                      @blur="catalogCollapsed && hideRailTips()"
                    >
                      <svg
                        v-if="catalogCollapsed && e.icon"
                        class="w-18px h-18px"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.6"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                        :innerHTML="e.icon"
                      />
                      <template v-else-if="!catalogCollapsed">
                        <span
                          :class="[
                            tileCls,
                            'flex-none w-36px h-36px',
                            e.route ? 'text-violet' : 'text-muted opacity-60',
                          ]"
                          aria-hidden="true"
                        >
                          <svg
                            v-if="e.icon"
                            class="w-18px h-18px"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.6"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            :innerHTML="e.icon"
                          />
                        </span>
                        <!-- 单行：名称 14/500/20，说明移到 title 悬停提示 -->
                        <span
                          class="flex-1 min-w-0 truncate text-14px font-500 leading-20px"
                          :class="e.route ? 'text-ink' : 'text-muted'"
                        >
                          {{ e.name }}
                        </span>
                      </template>
                    </component>
                  </li>
                </ul>
              </section>
            </template>
          </div>
          <span
            class="pointer-events-none absolute inset-x-0 bottom-0 z-1 h-16px bg-[linear-gradient(to_top,var(--xq-surface),rgb(var(--xq-surface-rgb)/0))] [transition:opacity_0.16s_ease]"
            :class="fadeBottom ? 'opacity-100' : 'opacity-0'"
            aria-hidden="true"
          />
        </div>
      </div>
    </nav>

    <!--
      收起态功能名气泡（原型 .v3-rail-tip）：fixed、层级 32 压在内容之上、低于目录栏 34（从栏底下推出来）；内边距 5 11、1px line、r6、白底、
      0 6 16 α.12 + 0 1 2 α.06；13/19。静止 scale(.9)，悬停那枚 scale(1) 并换选中材质（白→#f8f3fc、柔紫线、紫字 600），
      transform 140ms cubic-bezier(.4,0,.2,1)。读屏走目录条目自己的 aria-label，气泡只给鼠标。
    -->
    <div
      v-for="tip in railTips"
      :key="tip.id"
      class="fixed z-32 box-border py-5px px-11px rounded-6px border border-solid text-13px leading-19px whitespace-nowrap select-none origin-[left_center] [transition:transform_140ms_cubic-bezier(0.4,0,0.2,1)] motion-reduce:(transition-none [animation-duration:1ms])"
      :class="[
        tipsClosing
          ? 'pointer-events-none animate-[tool-rail-tip-out_240ms_cubic-bezier(0.4,0,1,1)_both]'
          : 'animate-[tool-rail-tip-in_420ms_cubic-bezier(0.22,0.61,0.36,1)_both]',
        tip.route ? 'cursor-pointer' : 'cursor-not-allowed',
        hoveredRail === tip.id || tip.id === toolId
          ? 'border-violet-line bg-[linear-gradient(180deg,var(--xq-surface)_0%,var(--xq-violet-tint)_100%)] shadow-[0_1px_2px_rgba(31,35,41,0.05)] text-violet-ink font-600'
          : 'border-line bg-white shadow-[0_6px_16px_rgba(31,35,41,0.12),0_1px_2px_rgba(31,35,41,0.06)] text-ink',
        hoveredRail === tip.id && !tipsClosing
          ? '[transform:translateY(calc(-50%_-_0.5px))_scale(1)]'
          : '[transform:translateY(calc(-50%_-_0.5px))_scale(0.9)] motion-reduce:[transform:translateY(calc(-50%_-_0.5px))_scale(1)]',
      ]"
      :style="{ left: `${tip.x}px`, top: `${tip.y}px` }"
      aria-hidden="true"
      @mouseenter="enterRailTip(tip)"
      @mouseleave="scheduleHideRailTips"
      @click="clickRailTip(tip)"
    >
      {{ tip.label }}
    </div>

    <!--
      三栏（原型 ToolWorkspaceColumns ml）：≥1440 时 426 / 249 / 1fr、gap 16、内边距 16（左 15），三栏等高、各栏内部滚动；
      <1440 单列堆叠、gap 12，整页滚动：行高按内容（auto-rows max-content），否则定高网格会把各卡压扁、表单在卡里只剩一截。
    -->
    <div
      class="flex-1 min-w-0 min-h-0 grid grid-cols-1 max-[1439px]:auto-rows-max gap-12px p-16px overflow-y-auto border-l border-solid border-shell-line min-[1440px]:(grid-cols-[426px_249px_minmax(0,1fr)] gap-16px pl-15px overflow-hidden)"
    >
      <!--
        操作区：功能卡固定在顶（≥1440 不随表单滚），中间上传 + 参数自己滚，底部固定设置行 + 提交栏
      -->
      <section class="ll-card flex flex-col min-h-0 overflow-hidden" aria-labelledby="tool-title">
        <!--
          功能卡（原型 FunctionSwitcher ml + 材质对齐）：高 64、内边距 12 14、gap 12、1px #e9dff2、r18 squircle、白→#fbf7fe、0 1 2 α.05；
          缩略 56×40（目录有封面图用封面，否则图标框）；名称 16/22·600、说明 11/16；箭头 14 muted。
          整卡可点（铺满的透明按钮），悬停内容 opacity .82（无过渡）。
        -->
        <div class="flex-none pt-12px px-12px">
          <div
            :ref="setSwitcherCard"
            class="sx-squircle group relative flex items-center gap-12px h-64px box-border px-14px py-12px rounded-18px border border-solid border-[var(--xq-violet-soft-line)] bg-[linear-gradient(180deg,var(--xq-surface)_0%,var(--xq-upload-hover-bottom)_100%)] shadow-[0_1px_2px_rgba(31,35,41,0.05)]"
          >
            <div
              class="min-w-0 flex-1 flex items-center gap-12px h-40px pointer-events-none group-hover:opacity-82"
              :class="switcherOpen ? 'opacity-82' : ''"
            >
              <span
                v-if="entryCover"
                class="sx-squircle flex-none w-56px h-40px box-border overflow-hidden rounded-8px border border-solid border-line bg-surface3"
                aria-hidden="true"
              >
                <img :src="entryCover" alt="" class="block w-full h-full object-cover" draggable="false" />
              </span>
              <span v-else :class="[tileCls, 'w-56px h-40px text-violet']" aria-hidden="true">
                <svg
                  v-if="currentEntry?.icon"
                  class="w-20px h-20px"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  :innerHTML="currentEntry.icon"
                />
              </span>
              <div class="min-w-0 flex-1 flex flex-col items-start gap-2px">
                <h1 id="tool-title" class="m-0 max-w-full truncate text-16px font-600 leading-22px text-ink">
                  {{ schema.title }}
                </h1>
                <p
                  v-if="currentEntry?.tagline"
                  class="m-0 max-w-full truncate text-11px leading-16px tracking-[0.01em] text-muted"
                >
                  {{ currentEntry.tagline }}
                </p>
              </div>
              <svg
                class="flex-none ml-auto w-14px h-14px text-muted"
                viewBox="0 0 512 512"
                fill="none"
                stroke="currentColor"
                stroke-width="48"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path :d="switcherOpen ? 'M112 328l144-144 144 144' : 'M112 184l144 144 144-144'" />
              </svg>
            </div>
            <button
              type="button"
              class="absolute inset-0 w-full h-full p-0 rounded-18px border-none bg-transparent cursor-pointer"
              :class="focusRing"
              :aria-expanded="switcherOpen"
              aria-haspopup="dialog"
              :aria-controls="switcherOpen ? switcherId : undefined"
              aria-label="切换功能"
              @click="toggleSwitcher"
            />
          </div>
        </div>
        <!-- 功能面板（原型 .fn-switch__pop.is-ml）：1px line、r10、白底、shadow-pop；出现 / 收起都是淡入 + 4px 上移 120ms（op-pop），减少动效时直接出现 -->
        <Teleport to="body">
          <Transition
            enter-active-class="[transition:opacity_120ms_ease,transform_120ms_ease] motion-reduce:transition-none"
            enter-from-class="opacity-0 translate-y-4px"
            leave-active-class="[transition:opacity_120ms_ease,transform_120ms_ease] motion-reduce:transition-none"
            leave-to-class="opacity-0 translate-y-4px"
          >
            <div
              v-if="switcherOpen"
              :id="switcherId"
              :ref="setSwitcherPop"
              role="dialog"
              aria-label="切换功能"
              class="fixed z-[6000] flex flex-col box-border overflow-hidden rounded-10px border border-solid border-line bg-overlay shadow-pop"
              :style="switcherStyle"
            >
              <div class="flex-none flex items-center gap-8px h-44px pl-14px pr-8px shadow-[inset_0_-0.8px_0_var(--xq-line)]">
                <b class="min-w-0 flex-1 text-13px font-600 text-muted">切换功能</b>
                <div
                  class="inline-flex flex-none gap-2px p-2px box-border rounded-6px border border-solid border-line bg-surface3"
                  role="tablist"
                  aria-label="功能大类"
                >
                  <button
                    v-for="k in catalogKinds"
                    :key="k.key"
                    type="button"
                    role="tab"
                    class="h-28px box-border px-12px rounded-4px border border-solid text-13px cursor-pointer"
                    :class="[
                      focusRing,
                      switcherKind === k.key
                        ? 'border-line bg-[linear-gradient(var(--xq-surface),var(--xq-surface2))] shadow-[0_1px_2px_rgba(31,35,41,0.07),inset_0_1px_0_#fff] text-ink font-600'
                        : 'border-transparent bg-transparent text-muted hover:text-ink',
                    ]"
                    :aria-selected="switcherKind === k.key"
                    @click="switcherKind = k.key"
                  >
                    {{ k.catalog.title }}
                  </button>
                </div>
                <IconButton label="关闭" variant="quiet" @click="switcherOpen = false">
                  <svg
                    viewBox="0 0 512 512"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="32"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M368 368L144 144M368 144L144 368" />
                  </svg>
                </IconButton>
              </div>
              <div class="flex-1 min-h-0 overflow-y-auto pt-4px pb-10px [scrollbar-width:thin]">
                <section
                  v-for="(g, gi) in switcherCatalog.groups"
                  :key="g.label"
                  :class="gi ? 'mt-2px shadow-[inset_0_0.8px_0_var(--xq-line-soft)]' : ''"
                  :aria-labelledby="`${switcherId}-g${gi}`"
                >
                  <p :id="`${switcherId}-g${gi}`" class="m-0 pt-2px px-14px pb-4px text-11px font-500 text-muted">
                    {{ g.label }}
                  </p>
                  <ul class="m-0 p-0 px-8px pb-6px list-none grid grid-cols-3 gap-2px">
                    <li v-for="e in g.entries" :key="e.id" class="min-w-0">
                      <component
                        :is="e.route ? RouterLink : 'div'"
                        v-bind="
                          e.route
                            ? { to: e.route, 'aria-current': e.id === toolId ? 'page' : undefined }
                            : { 'aria-disabled': 'true' }
                        "
                        :title="e.route ? e.tagline : `${e.tagline}（即将开放）`"
                        :aria-label="e.route ? `${e.name}，${e.tagline}` : `${e.name}（即将开放）`"
                        class="flex min-w-0 items-center gap-6px h-30px box-border px-6px rounded-6px border border-solid no-underline"
                        :class="[
                          e.route ? focusRing : 'cursor-not-allowed opacity-60',
                          e.id === toolId
                            ? 'border-violet-line bg-[linear-gradient(var(--xq-surface),var(--xq-violet-soft))] text-violet-ink'
                            : ['border-transparent text-ink-2', e.route ? 'hover:bg-surface3' : ''],
                        ]"
                        @click="e.route && (switcherOpen = false)"
                      >
                        <span
                          class="grid flex-[0_0_22px] w-22px h-22px place-items-center box-border rounded-5px border border-solid border-line bg-[linear-gradient(135deg,var(--xq-violet-icon-a),var(--xq-violet-icon-b))] shadow-[inset_0_1px_0_#fff] text-violet"
                          aria-hidden="true"
                        >
                          <svg
                            v-if="e.icon"
                            class="w-13px h-13px"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.8"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            :innerHTML="e.icon"
                          />
                        </span>
                        <span class="min-w-0 truncate text-12px font-500">{{ e.name }}</span>
                      </component>
                    </li>
                  </ul>
                </section>
              </div>
            </div>
          </Transition>
        </Teleport>

        <!-- tabindex=-1：「重新编辑」回填后把焦点移到表单开头（程序聚焦落点，不进 Tab 序列，故不画焦点环） -->
        <form
          id="tool-form"
          ref="formRef"
          tabindex="-1"
          class="flex-1 min-h-0 overflow-y-auto pt-12px px-12px pb-0 flex flex-col gap-12px [scrollbar-width:thin] [overscroll-behavior:contain] outline-none max-[1439px]:(flex-none overflow-visible)"
          @submit.prevent="onSubmit"
          @keydown.enter="blockImplicitSubmit"
        >
          <!-- 视频复刻：解析、标注（原片上传槽仍是 ToolUploadSlot，从 #upload 插进去） -->
          <VideoClonePanel
            v-if="cloneMode && cloneVideoSlot && cloneRefSlot"
            :refs="uploads[cloneRefSlot.slot] ?? []"
            :state="vc"
            :video-url="uploads[cloneVideoSlot.slot]?.[0] ?? ''"
            :disabled="submitting"
            :ref-max="cloneRefMax"
            :ref-max-bytes="cloneRefSlot.maxBytes"
            :ref-accept="cloneRefSlot.accept"
            :model-resolutions="cloneModelResolutions"
            :model-label="modelOptions.find((o) => o.value === pickedModel)?.label"
            :model-max-seconds="cloneModelMaxSeconds"
            :content-max="schema.fields.find((f) => f.javaKey === 'content')?.maxLength ?? 5000"
            @update:refs="setUploads(cloneRefSlot.slot, $event)"
            @replace="cloneReplaceVideo"
            @skip="cloneSkip"
            @update:uploading="setUploading('vc-refs', $event)"
          >
            <template #upload>
              <ToolUploadSlot
                :id="`tool-upload-${cloneVideoSlot.slot}`"
                :model-value="uploads[cloneVideoSlot.slot] ?? []"
                :spec="specOf(cloneVideoSlot)"
                :layout="cloneVideoSlot.layout"
                :disabled="submitting"
                paste-primary
                asset-picker
                @update:uploading="setUploading(`slot-${cloneVideoSlot.slot}`, $event)"
                @update:model-value="setUploads(cloneVideoSlot.slot, $event)"
              />
            </template>
          </VideoClonePanel>
          <p
            v-else-if="schema.homeId === VIDEO_CLONE_ID"
            class="sx-squircle m-0 flex flex-wrap items-center gap-x-8px gap-y-4px min-h-36px box-border px-10px py-4px rounded-12px border border-solid border-violet-line bg-info-soft text-12px leading-18px text-violet-ink"
          >
            <span>直接出片：不解析原片，按描述生成</span>
            <button
              type="button"
              class="ml-auto inline-flex items-center h-28px px-6px rounded-8px border-none bg-transparent text-12px font-600 text-violet-ink cursor-pointer hover:underline"
              :class="focusRing"
              :disabled="submitting"
              @click="cloneBack"
            >
              改回解析标注（推荐）
            </button>
          </p>
          <!-- 商拍换装：服装图 / 模特图并排在一块素材板里（服装图点开弹窗选单品与角度）；仍写回 slot 0 / slot 1 -->
          <ToolTryonMaterials
            v-if="schema.uploadsView === 'tryon' && tryonSlots"
            :key="`${schema.homeId}-tryon`"
            :cloth="uploads[tryonSlots.cloth.slot] ?? []"
            :models="uploads[tryonSlots.models.slot] ?? []"
            :cloth-spec="tryonSlots.cloth"
            :model-spec="tryonSlots.models"
            :disabled="submitting"
            @update:uploading="setUploading('tryon', $event)"
            @update:cloth="setUploads(tryonSlots.cloth.slot, $event)"
            @update:models="setUploads(tryonSlots.models.slot, $event)"
          />
          <!-- 产品替换图台：素材在上、底图格在下、连线压在卡壳之上底图片之下 -->
          <div
            v-if="productStage"
            :ref="setProductStageEl"
            class="relative isolate w-full max-w-[434px] mx-auto flex flex-col items-center gap-14px box-border p-12px rounded-6px border border-solid border-line bg-white shadow-[inset_0_0_16px_rgba(31,35,41,0.12),inset_0_1px_0_rgba(31,35,41,0.05)]"
          >
            <ToolUploadSlot
              v-for="u in [productStage.anchor, productStage.base]"
              :id="`tool-upload-${u.slot}`"
              :key="`${schema.homeId}-${u.slot}`"
              :model-value="uploads[u.slot] ?? []"
              :spec="specOf(u)"
              :layout="u.layout"
              :disabled="submitting"
              :paste-primary="u.slot === pastePrimarySlot"
              asset-picker
              bare
              class="w-full"
              @update:uploading="setUploading(`slot-${u.slot}`, $event)"
              @update:model-value="setUploads(u.slot, $event)"
            />
            <ToolPipeLinks :root="productStageEl" />
          </div>
          <template
            v-for="u in schema.uploadsView === 'tryon' && tryonSlots ? [] : displayUploads"
            :key="`${schema.homeId}-${u.slot}`"
          >
            <!-- titled 卡（视频生成参考视频）：模型不支持时保持卡形、禁用，标题下写原因 -->
            <ToolUploadSlot
              v-if="uploadEnabled(u) || u.titled"
              :id="`tool-upload-${u.slot}`"
              :model-value="uploads[u.slot] ?? []"
              :spec="specOf(u)"
              :layout="u.layout"
              :titled="u.titled"
              :unsupported-hint="uploadEnabled(u) ? '' : unsupportedUploadHint(u)"
              :disabled="submitting || !uploadEnabled(u)"
              :paste-primary="u.slot === pastePrimarySlot"
              asset-picker
              @update:uploading="setUploading(`slot-${u.slot}`, $event)"
              @update:model-value="setUploads(u.slot, $event)"
            />
            <div v-else>
              <div class="ll-label">
                <span>{{ u.label }}</span>
              </div>
              <p class="m-0 ll-empty py-12px">{{ unsupportedUploadHint(u) }}</p>
            </div>
          </template>
          <!-- 图片复刻：参考海报的使用权提示，条款见用户协议「参考素材与复刻」一节 -->
          <p v-if="schema.rightsNotice" class="m-0 text-12px leading-18px text-muted" role="note">
            请确保你拥有参考图的使用权，复刻仅借鉴版式与风格，不得复制他人文字、商标或标识。详见
            <a
              :href="AGREEMENT_URL"
              target="_blank"
              rel="noopener noreferrer"
              class="text-violet-ink underline"
              :class="focusRing"
              >《用户协议》参考素材与复刻条款</a
            >。
          </p>

          <!-- 智能抠图：同步结果卡（透明棋盘格底、最小高 220、右上下载、点图放大）；「换一张」清掉原图与上次结果 -->
          <section v-if="schema.sync && singleImage" class="flex flex-col gap-8px" aria-labelledby="tool-cutout-title">
            <div class="flex items-center justify-between gap-8px min-h-32px">
              <h2 id="tool-cutout-title" class="m-0 text-13px font-600 leading-18px text-ink">抠图结果</h2>
              <button type="button" class="sx-btn" :disabled="submitting" @click="replaceInput">换一张</button>
            </div>
            <div :class="[stageCls, 'sx-squircle min-h-220px h-[min(36vh,320px)] rounded-12px']">
              <div
                v-if="submitting"
                class="absolute inset-0 flex flex-col items-center justify-center gap-8px text-12px text-muted"
                role="status"
                aria-live="polite"
              >
                <DotWave size="md" />
                正在抠图，请稍候…
              </div>
              <template v-else-if="syncResultUrl">
                <button
                  type="button"
                  class="absolute inset-0 w-full h-full p-8px box-border border-none bg-transparent cursor-zoom-in"
                  :class="focusRing"
                  aria-label="放大查看抠图结果"
                  @click="openThumbs([syncResultUrl], 0, '抠图结果')"
                >
                  <img
                    :src="syncResultUrl"
                    alt="抠图结果"
                    class="block w-full h-full object-contain"
                    draggable="false"
                  />
                </button>
                <IconButton
                  class="!absolute top-8px right-8px z-2"
                  label="下载抠图结果"
                  variant="overlay"
                  @click="downloadImage(syncResultUrl, `${schema.title}-抠图结果`)"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
                  </svg>
                </IconButton>
              </template>
              <p
                v-else
                class="absolute inset-0 m-0 flex items-center justify-center px-18px text-center text-12px leading-18px text-muted"
              >
                点下方「{{ submitLabel }}」，透明底结果会显示在这里
              </p>
            </div>
          </section>

          <template v-for="f in promptFields" :key="`${schema.homeId}-${f.key}`">
            <!-- 涂抹蒙版（画布内部归 MaskPainter；这里只接 props / emits，外加「换一张」与操作说明） -->
            <div v-if="f.type === 'mask'" class="flex flex-col gap-8px">
              <div class="ll-label">
                <span>{{ f.label }}<span class="text-danger" aria-hidden="true"> *</span></span>
                <button v-if="singleImage" type="button" class="sx-btn" :disabled="submitting" @click="replaceInput">
                  换一张
                </button>
              </div>
              <template v-if="singleImage">
                <MaskPainter :ref="setMaskRef" :src="singleImage" @change="maskHasStroke = $event" />
                <p class="m-0 text-12px leading-18px text-muted">
                  在图上涂抹要消除的区域（涂红处会被抹掉）；放大后可切「移动」拖动画面；涂错了用「撤销」退一笔，或「清空」重来。
                </p>
              </template>
              <p v-else class="m-0 ll-empty py-12px">先上传原图，再在图上涂抹要消除的区域</p>
            </div>

            <!-- 框选重绘区域（局部重绘） -->
            <InpaintRegionPicker
              v-else-if="f.type === 'inpaint-region'"
              v-model="inpaintBoxes"
              :urls="uploads[0] ?? []"
              :label="f.label"
              :required="f.required"
              :disabled="submitting"
            />

            <!-- 识别结果（文字替换）：原文在左、改写框在右；只提交改过的条目 -->
            <div v-else-if="f.type === 'region-list'" class="flex flex-col gap-8px">
              <div class="ll-label">
                <span id="tool-regions-label">{{ f.label }}<span class="text-danger" aria-hidden="true"> *</span></span>
                <button
                  type="button"
                  class="ll-pill !min-h-32px !text-13px"
                  :class="focusRing"
                  :disabled="!singleImage || ocrLoading || submitting"
                  @click="runOcr"
                >
                  {{ ocrLoading ? '识别中…' : regions.length ? '重新识别' : '识别文字' }}
                </button>
              </div>
              <ul
                v-if="ocrLoading"
                class="m-0 p-0 list-none flex flex-col gap-8px"
                role="status"
                aria-live="polite"
                aria-label="识别中…"
              >
                <li
                  v-for="n in 4"
                  :key="n"
                  class="tool-skeleton-row h-50px box-border rounded-12px bg-surface2"
                  aria-hidden="true"
                />
              </ul>
              <p v-else-if="!regions.length" class="m-0 ll-empty py-12px">
                {{
                  singleImage ? '没有识别到可替换的文字，可点「重新识别」再试' : '上传后自动识别；结果出来后逐条改写。'
                }}
              </p>
              <template v-else>
                <p class="m-0 text-12px leading-18px text-muted" aria-live="polite">
                  共识别到 {{ regions.length }} 处文字，已修改 {{ changedRegions.length }} 处；只有改过的会被替换。
                </p>
                <ul class="m-0 p-0 list-none flex flex-col gap-6px" aria-labelledby="tool-regions-label">
                  <li
                    v-for="(r, i) in regions"
                    :key="i"
                    class="sx-squircle grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-8px box-border p-8px rounded-12px border border-solid [transition:border-color_110ms,background_110ms] motion-reduce:transition-none"
                    :class="
                      isChanged(r)
                        ? 'border-violet-line bg-[linear-gradient(var(--xq-surface),var(--xq-upload-hover-bottom))] shadow-[inset_3px_0_0_var(--xq-violet)]'
                        : 'border-line bg-white'
                    "
                  >
                    <span
                      class="min-w-0 truncate text-13px leading-18px"
                      :class="isChanged(r) ? 'text-muted line-through decoration-control' : 'text-ink-2'"
                      :title="r.targetText"
                      >{{ r.targetText }}</span
                    >
                    <input
                      v-model="r.text"
                      type="text"
                      maxlength="100"
                      placeholder="改成…"
                      :disabled="submitting"
                      :aria-label="`把「${r.targetText}」改成`"
                      :class="[inputCls, isChanged(r) ? '!border-violet-line' : '']"
                    />
                    <button
                      type="button"
                      class="sx-btn !px-10px"
                      :disabled="!r.text || submitting"
                      :aria-label="`还原「${r.targetText}」`"
                      @click="r.text = ''"
                    >
                      还原
                    </button>
                  </li>
                </ul>
              </template>
            </div>

            <!-- 多行文本（原型 .op-prompt__field 一体框）：生成类工具带「我的提示词」入口与「AI帮写」；
                 ml 版式的参考图槽收进框顶（计数 + 书本钮一行），字段名只给读屏；schema 的 rewritePrompt 开关收进框底行 -->
            <CreationPromptInput
              v-else-if="f.type === 'textarea'"
              :id="`tool-field-${f.key}`"
              :ref="setPromptRef"
              v-model="values[f.key]"
              v-model:rewrite="rewriteValue"
              :label="f.label"
              :required="f.required"
              :rows="5"
              :max-length="f.maxLength"
              :placeholder="f.placeholder ?? `请输入${f.label}`"
              :library="libraryEnabled"
              :help-biz-type="helpBizType"
              :show-rewrite="!!rewriteField"
              :rewrite-hint="rewriteField?.description"
              :variant="mlPrompt ? 'ml' : 'default'"
              :head-in-top="!!stripHeadSlot"
            >
              <template v-if="mlPrompt && !stripHeadSlot" #top-head>
                <span class="text-11px leading-16px tabular-nums text-placeholder">{{ mlCountText }}</span>
              </template>
              <template v-if="mlPrompt" #top="{ libraryOpen, toggleLibrary }">
                <div class="flex flex-col gap-8px">
                  <template v-for="u in mlPromptUploads" :key="`${schema.homeId}-ml-${u.slot}`">
                    <ToolUploadSlot
                      v-if="uploadEnabled(u)"
                      :id="`tool-upload-${u.slot}`"
                      :model-value="uploads[u.slot] ?? []"
                      :spec="specOf(u)"
                      :layout="u.layout"
                      :disabled="submitting"
                      :paste-primary="u.slot === pastePrimarySlot"
                      asset-picker
                      bare
                      :strip-head="u === stripHeadSlot"
                      :head-text="mlCountText"
                      :head-title="refLimitText"
                      :library="libraryEnabled"
                      :library-open="libraryOpen"
                      @open-library="toggleLibrary"
                      @update:uploading="setUploading(`slot-${u.slot}`, $event)"
                      @update:model-value="setUploads(u.slot, $event)"
                    />
                    <p v-else class="m-0 text-12px leading-18px text-muted">{{ unsupportedUploadHint(u) }}</p>
                  </template>
                </div>
              </template>
            </CreationPromptInput>
          </template>
        </form>

        <!--
          底部固定栏（原型参数行 + ToolSubmitBar ml 版）：栏内边距 12（上 12）、gap 8。
          只有一个档位字段时照原型 ChoiceFieldButton inline（r14 卡 + 分段片）；否则「模型卡 | 设置」两列（没有模型时设置占满整行），
          设置弹层宽 = 按钮宽。提交按钮 sx-submit（56 高、r14）；schema.hint 只作按钮悬停提示（title）+ 读屏描述，不再单独占一行。
        -->
        <div class="flex-none flex flex-col gap-8px pt-12px px-12px pb-12px">
          <p
            v-if="hasRegionField && changedRegions.length"
            class="sx-squircle m-0 flex items-center gap-6px min-h-32px box-border px-10px rounded-12px border border-solid border-violet-line bg-info-soft text-12px leading-18px text-violet-ink"
            role="status"
          >
            本次将替换 {{ changedRegions.length }} 处文字
          </p>
          <p v-if="posterRatioNote" class="m-0 text-12px leading-18px text-muted" role="status">
            {{ posterRatioNote }}
          </p>
          <p v-if="refLimitText && !promptStripOwned" class="m-0 text-12px leading-18px text-muted">
            {{ refLimitText }}
          </p>
          <div
            v-if="inlineSetting"
            class="sx-squircle flex items-center gap-6px w-full h-44px box-border pl-11px pr-3px rounded-14px border border-solid border-control bg-[linear-gradient(var(--xq-surface),var(--xq-plate-bottom))] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(31,35,41,0.04),0_1px_2px_rgba(31,35,41,0.05)]"
            :class="submitting ? 'opacity-60' : ''"
          >
            <span class="grid flex-[0_0_16px] w-16px h-16px place-items-center text-violet" aria-hidden="true">
              <svg
                class="w-13px h-13px"
                viewBox="0 0 512 512"
                fill="none"
                stroke="currentColor"
                stroke-width="32"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path
                  d="M336 448h56a56 56 0 0056-56v-56M448 176v-56a56 56 0 00-56-56h-56M176 448h-56a56 56 0 01-56-56v-56M64 176v-56a56 56 0 0156-56h56"
                />
              </svg>
            </span>
            <span :id="`tool-inline-${inlineSetting.key}`" class="flex-none text-12px leading-18px text-muted">
              {{ inlineSetting.label }}
            </span>
            <!-- 分段片（原型 .sx-seg--picker）：轨道 1px line、r6、#f3f4f5、内边距 3、gap 2、inset-input；
                   片高 30、内边距 0 14、r4、11px；选中 = 柔紫线 + 白→#f8f3fc + 紫字 600；切换 300ms cubic-bezier(.4,0,.2,1)；按下内凹短影 -->
            <div
              role="radiogroup"
              :aria-labelledby="`tool-inline-${inlineSetting.key}`"
              class="sx-squircle ml-auto inline-flex flex-none gap-2px p-3px box-border rounded-10px border border-solid border-line bg-surface3 shadow-[inset_0_1px_2px_rgba(31,35,41,0.055),inset_0_0_0_1px_rgba(255,255,255,0.7)]"
              @keydown.left.prevent="moveInline(-1)"
              @keydown.right.prevent="moveInline(1)"
            >
              <button
                v-for="(opt, i) in inlineOptions"
                :key="opt.value"
                :ref="(el) => (inlineSegs[i] = el as HTMLButtonElement | null)"
                type="button"
                role="radio"
                :aria-checked="values[inlineSetting.key] === opt.value"
                :tabindex="values[inlineSetting.key] === opt.value || (inlineIndex < 0 && i === 0) ? 0 : -1"
                :disabled="submitting"
                class="h-32px box-border px-14px rounded-4px border border-solid text-13px tabular-nums cursor-pointer [transition:border-color_300ms_cubic-bezier(0.4,0,0.2,1),background-color_300ms_cubic-bezier(0.4,0,0.2,1),box-shadow_300ms_cubic-bezier(0.4,0,0.2,1),color_300ms_cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none active:enabled:shadow-[inset_0_1px_2px_rgba(80,55,95,0.16)] disabled:(opacity-45 cursor-not-allowed)"
                :class="[
                  focusRing,
                  values[inlineSetting.key] === opt.value
                    ? 'border-violet-line bg-[linear-gradient(180deg,var(--xq-surface)_0%,var(--xq-violet-tint)_100%)] shadow-[0_1px_2px_rgba(31,35,41,0.05)] text-violet-ink font-600'
                    : 'border-transparent bg-transparent text-muted hover:text-ink',
                ]"
                @click="values[inlineSetting.key] = opt.value"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>
          <CreationSettingsRow
            v-else-if="settingItems.length"
            :items="settingItems"
            :disabled="submitting"
            :popover-width="isVideoGenerator ? 'row' : 'trigger'"
            :layout="isVideoGenerator ? 'grid' : schema.media === 'video' ? 'stack' : 'auto'"
          >
            <template #model>
              <CreationModelPicker
                v-if="modelOptions.length"
                v-model="pickedModel"
                :options="modelOptions"
                :label="schema.media === 'video' ? '视频模型' : '生图模型'"
                hide-label
                :disabled="submitting"
              />
              <p v-else class="m-0 py-12px text-center text-12px text-muted">
                {{ videoModelsLoaded || imageModels ? '暂无可用模型' : '模型加载中…' }}
              </p>
            </template>
            <template #settings>
              <div class="flex flex-col">
                <template v-for="f in popoverRows" :key="`${schema.homeId}-set-${f.key}`">
                  <!-- 时长：原型 WakeSlider 浮层档（20 柱、柱高 14、值带「秒」写在右侧、无端点刻度）；区间随模型 -->
                  <div v-if="f.dynamic === 'videoDuration'" :class="setRowCls">
                    <span :id="`tool-set-${f.key}-label`" class="text-12px font-500 leading-18px text-ink-2">{{
                      f.label
                    }}</span>
                    <BarSlider
                      v-if="videoDurationRange"
                      :model-value="Number(values[f.key] ?? videoDurationRange[0])"
                      :min="videoDurationRange[0]"
                      :max="videoDurationRange[1]"
                      unit="秒"
                      :label="f.label"
                      :disabled="submitting"
                      @update:model-value="values[f.key] = String($event)"
                    />
                    <p v-else class="m-0 text-12px text-muted">{{ videoModelsLoaded ? '暂无可用时长' : '加载中…' }}</p>
                  </div>

                  <!-- 数字 / 张数：共用 NumberStepper（值 | − | +） -->
                  <div
                    v-else-if="f.type === 'number' || f.type === 'stepper'"
                    :class="[setRowCls, '!flex-row items-center justify-between !gap-12px']"
                  >
                    <span :id="`tool-set-${f.key}-label`" class="text-12px font-500 leading-18px text-ink-2">
                      {{ f.label }}<span v-if="f.required" class="text-danger" aria-hidden="true"> *</span>
                    </span>
                    <NumberStepper
                      v-model="values[f.key]"
                      class="flex-none"
                      :min="f.min"
                      :max="f.max"
                      :aria-label="f.label"
                      :disabled="submitting"
                    />
                  </div>

                  <!-- 开关 -->
                  <div v-else-if="f.type === 'switch'" :class="[setRowCls, '!flex-row items-center justify-between']">
                    <!-- 原型 SettingsPopover：开关行不写说明句，说明收进悬停提示（读屏仍读） -->
                    <span class="flex min-w-0 flex-col" :title="f.description || undefined">
                      <span :id="`tool-set-${f.key}-label`" class="text-12px font-500 leading-18px text-ink-2">{{
                        f.label
                      }}</span>
                      <span v-if="f.description" :id="`tool-set-${f.key}-desc`" class="sr-only">{{
                        f.description
                      }}</span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      :aria-checked="!!values[f.key]"
                      :aria-labelledby="`tool-set-${f.key}-label`"
                      :aria-describedby="f.description ? `tool-set-${f.key}-desc` : undefined"
                      :disabled="submitting"
                      class="relative after:(content-empty absolute -inset-x-4px -inset-y-6px rounded-[inherit]) [@media(pointer:coarse)]:after:-inset-y-10px flex-none w-34px h-20px box-border p-0 rounded-full border border-solid cursor-pointer [transition:background_180ms_cubic-bezier(0.2,0.7,0.2,1),border-color_180ms_cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none disabled:(opacity-50 cursor-not-allowed)"
                      :class="[
                        focusRing,
                        values[f.key]
                          ? 'border-violet-border bg-[linear-gradient(var(--xq-violet-top),var(--xq-violet-bottom))]'
                          : 'border-control bg-[linear-gradient(var(--xq-surface3),var(--xq-sunk-bottom))] shadow-[inset_0_1px_2px_rgba(31,35,41,0.055)]',
                      ]"
                      @click="values[f.key] = !values[f.key]"
                    >
                      <span
                        class="absolute top-2px w-14px h-14px rounded-full bg-#fff shadow-[0_1px_3px_rgba(31,35,41,0.2)] [transition:left_180ms_cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none"
                        :class="values[f.key] ? 'left-16px' : 'left-2px'"
                        aria-hidden="true"
                      />
                    </button>
                  </div>

                  <!-- 选项多的下拉（如语言）：原生下拉 -->
                  <div v-else-if="f.type === 'select' && fieldOptions(f).length > 6" :class="setRowCls">
                    <label :for="`tool-set-${f.key}`" class="text-12px font-500 leading-18px text-ink-2">
                      {{ f.label }}<span v-if="f.required" class="text-danger" aria-hidden="true"> *</span>
                    </label>
                    <select :id="`tool-set-${f.key}`" v-model="values[f.key]" :class="inputCls" :disabled="submitting">
                      <option v-for="opt in fieldOptions(f)" :key="opt.value" :value="opt.value">
                        {{ opt.label }}
                      </option>
                    </select>
                  </div>

                  <!-- 胶囊 / 少量选项的下拉：分段控件（CreationOptionPills 在设置弹层里自动换分段样式） -->
                  <CreationOptionPills
                    v-else
                    :model-value="values[f.key]"
                    :options="fieldOptions(f)"
                    :label="f.label"
                    :required="f.required"
                    :disabled="submitting"
                    @update:model-value="values[f.key] = $event"
                  />
                  <p
                    v-if="f.description && f.type !== 'switch'"
                    class="m-0 -mt-4px pb-6px text-12px leading-18px text-muted"
                  >
                    {{ f.description }}
                  </p>
                </template>

                <!-- 比例转换「自定义尺寸」：宽 / 高合成一行 -->
                <div v-if="sizePair" :class="setRowCls" role="group" aria-labelledby="tool-set-size-label">
                  <span id="tool-set-size-label" class="text-12px font-500 leading-18px text-ink-2">
                    输出尺寸（像素）<span class="text-danger" aria-hidden="true"> *</span>
                  </span>
                  <div class="flex items-center gap-6px">
                    <input
                      v-model.number="values.width"
                      type="number"
                      inputmode="numeric"
                      :min="sizePair.w.min"
                      :max="sizePair.w.max"
                      :placeholder="sizePair.w.placeholder ?? '宽'"
                      aria-label="输出宽度（像素）"
                      :disabled="submitting"
                      :class="[inputCls, 'min-w-0 tabular-nums', sizeValid(sizePair.w) ? '' : '!border-danger']"
                    />
                    <span class="flex-none text-12px text-muted" aria-hidden="true">×</span>
                    <input
                      v-model.number="values.height"
                      type="number"
                      inputmode="numeric"
                      :min="sizePair.h.min"
                      :max="sizePair.h.max"
                      :placeholder="sizePair.h.placeholder ?? '高'"
                      aria-label="输出高度（像素）"
                      :disabled="submitting"
                      :class="[inputCls, 'min-w-0 tabular-nums', sizeValid(sizePair.h) ? '' : '!border-danger']"
                    />
                  </div>
                  <p
                    class="m-0 text-12px leading-18px"
                    :class="sizeValid(sizePair.w) && sizeValid(sizePair.h) ? 'text-muted' : 'text-danger'"
                    :role="sizeValid(sizePair.w) && sizeValid(sizePair.h) ? undefined : 'alert'"
                  >
                    {{ sizeValid(sizePair.w) && sizeValid(sizePair.h) ? '宽、高各 64～8192' : SIZE_INVALID }}
                  </p>
                </div>
              </div>
            </template>
          </CreationSettingsRow>
          <!-- 提交按钮正上方的字段卡（原型 ChoiceFieldButton picker）：目标语言（长列表三列 + 搜索）、配音音色（带试听） -->
          <template v-for="f in choiceFields" :key="`${schema.homeId}-choice-${f.key}`">
            <div v-if="f.type === 'voice'" class="flex items-center gap-8px">
              <div class="flex-1 min-w-0">
                <ToolChoiceField
                  v-model="values[f.key]"
                  :options="voiceOptions"
                  :label="f.label"
                  icon="voice"
                  layout="list"
                  :required="f.required"
                  :disabled="submitting || !voices.length"
                  :placeholder="voicesLoaded ? '暂无可用音色' : '加载中…'"
                  @audition="playAudition"
                />
              </div>
              <button
                v-if="auditionEnabled && auditionUrl"
                type="button"
                class="sx-btn flex-none !h-44px !px-12px"
                :aria-label="`试听${selectedVoice?.voiceName ?? '音色'}`"
                @click="playAudition()"
              >
                试听
              </button>
            </div>
            <ToolChoiceField
              v-else
              v-model="values[f.key]"
              :options="fieldOptions(f)"
              :label="f.label"
              icon="language"
              layout="grid"
              :required="f.required"
              :disabled="submitting"
            />
          </template>
          <p v-if="disabledReason" :id="reasonId" class="sr-only" aria-live="polite">{{ disabledReason }}</p>
          <button
            type="submit"
            form="tool-form"
            class="sx-submit relative box-border select-none [transition:background_0.11s_cubic-bezier(0.2,0.7,0.2,1),border-color_0.11s,box-shadow_0.11s,color_0.11s] motion-reduce:transition-none"
            :class="
              submitting
                ? '!bg-none !bg-[linear-gradient(var(--xq-violet-bottom),#6b487c)] !border-violet-press !text-white !cursor-progress'
                : ''
            "
            :disabled="!!disabledReason || submitting"
            :title="disabledReason || schema.hint || undefined"
            :aria-busy="submitting || undefined"
            :aria-describedby="
              [disabledReason ? reasonId : '', schema.hint ? hintId : ''].filter(Boolean).join(' ') || undefined
            "
          >
            <!-- 加载环（原型 .sx-btn__spinner）：12 / 1.5px，绝对定位在左 14，不参与排版 -->
            <span
              v-if="submitting"
              class="absolute left-14px top-1/2 -mt-6px block w-12px h-12px box-border rounded-full border-1.5px border-solid border-white/35 border-t-white animate-spin [animation-duration:0.7s]"
              aria-hidden="true"
            />
            <span class="text-16px font-600 leading-22px tracking-[0.04em] whitespace-nowrap">
              {{ submitLabel }}
            </span>
            <span class="text-11px leading-11px text-white/74 whitespace-nowrap" aria-live="polite">
              <template v-if="'num' in costLine"
                >消耗 <b class="font-600 tabular-nums">{{ costLine.num }}</b
                >{{ costLine.suffix }}<template v-if="costLine.note"> · {{ costLine.note }}</template></template
              >
              <template v-else>{{ costLine.text }}</template>
            </span>
          </button>
          <!-- schema.hint 照原型只放进按钮 title；读屏经 aria-describedby 读这段视觉隐藏文字 -->
          <span v-if="schema.hint" :id="hintId" class="sr-only">{{ schema.hint }}</span>
        </div>
      </section>

      <!--
        历史记录（原型 StudioHistoryColumn ml 版）：列内边距 12、gap 8；列头最小高 24、标题 14/600；
        搜索框高 30、11px；卡片列表 gap 8、内边距 2 0 10，每页 8 条翻页（翻页钮 26 / r4）。
      -->
      <section
        class="ll-card flex min-h-0 flex-col gap-8px overflow-hidden p-12px"
        aria-labelledby="tool-history-title"
      >
        <div class="flex-none flex items-center gap-6px min-h-24px">
          <h2 id="tool-history-title" class="m-0 text-14px font-600 leading-20px text-ink">历史记录</h2>
          <span class="ml-auto flex items-center gap-8px text-11px leading-16px">
            <span v-if="history.running.value" class="text-violet-ink">{{ history.running.value }} 个进行中</span>
            <span class="text-muted tabular-nums">{{ history.total.value || history.items.value.length }} 条</span>
          </span>
        </div>

        <p
          v-if="history.loading.value && !history.items.value.length"
          class="m-0 py-18px text-center text-11px leading-[1.55] text-muted"
          role="status"
        >
          加载中…
        </p>
        <!-- 空态：至少一张历史卡大小（198×65）：虚线浅底卡 + 28 圆底时钟（16），标题 13/600/18、说明 11/15 全文换行 -->
        <div
          v-else-if="!history.items.value.length"
          class="flex-none min-h-65px box-border flex items-center gap-8px px-10px py-10px rounded-8px border border-dashed border-line-strong bg-[linear-gradient(var(--xq-surface),var(--xq-surface2))]"
        >
          <span
            class="flex-none grid place-items-center w-28px h-28px box-border rounded-full border border-solid border-line bg-white text-violet-ink"
            aria-hidden="true"
          >
            <svg
              class="w-16px h-16px"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 7.5V12l3 2" />
            </svg>
          </span>
          <span class="min-w-0 flex-1 flex flex-col gap-1px overflow-hidden">
            <b class="text-13px font-600 leading-18px text-ink-2">还没有生成记录</b>
            <span class="text-11px leading-15px text-muted">{{ HISTORY_EMPTY_HINT }}</span>
          </span>
        </div>

        <template v-else>
          <div class="relative flex-none flex items-center pb-8px">
            <svg
              class="absolute left-10px top-8.5px w-13px h-13px text-placeholder pointer-events-none"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="6.5" />
              <path d="m20 20-4.2-4.2" />
            </svg>
            <input
              v-model="historyQuery"
              type="search"
              placeholder="搜索提示词"
              aria-label="搜索历史记录"
              :class="[inputCls, '!h-32px !pl-27px !pr-8px !text-13px']"
            />
          </div>

          <ul class="m-0 -mx-4px px-4px pt-2px pb-10px list-none gap-8px flex-1 min-h-0 overflow-y-auto flex flex-col">
            <li v-for="item in historyPaged" :key="item.aiToolHistoryId">
              <!-- 历史卡（2026-11-06 材质：软瓷 r18 squircle、两种状态统一高 74，含 1px 边框与 10px 内边距）；
                   静止 白→#f8f9fa + 0 6px 16px α.08 + 顶 1px 白内线；hover 描边 #aeb4b9 + 0 8px 18px；选中 violet-line + 白→#faf4fd -->
              <div
                class="sx-squircle group relative flex items-stretch gap-10px box-border h-74px p-10px rounded-18px border border-solid [transition:border-color_110ms,background_110ms,box-shadow_110ms] motion-reduce:transition-none"
                :class="
                  current?.aiToolHistoryId === item.aiToolHistoryId && !showSync
                    ? 'border-violet-line bg-[linear-gradient(180deg,var(--xq-surface)_0%,var(--xq-violet-tint)_100%)] shadow-[0_1px_2px_rgba(31,35,41,0.05),inset_0_1px_0_#fff]'
                    : 'border-line bg-[linear-gradient(180deg,var(--xq-surface)_0%,var(--xq-soft-bottom)_100%)] shadow-[0_6px_16px_rgba(31,35,41,0.08),inset_0_1px_0_#fff] hover:(border-control-hover shadow-[0_8px_18px_rgba(31,35,41,0.1),inset_0_1px_0_#fff])'
                "
              >
                <!-- 整卡选中：铺满的透明按钮（卡内还有操作按钮，按钮里不能再套按钮） -->
                <button
                  type="button"
                  class="absolute inset-0 w-full h-full p-0 rounded-18px border-none bg-transparent cursor-pointer"
                  :class="focusRing"
                  :aria-pressed="current?.aiToolHistoryId === item.aiToolHistoryId && !showSync"
                  :aria-label="`${formatTime(item.createdAt)} ${statusOf(item.status).text}：${promptOf(item)}`"
                  @click="selectedId = item.aiToolHistoryId"
                />
                <!--
                  进行中（原型 .v3-hist__card.is-progress）：骨架缩略 44 / r14 + 提示词行 +
                  进度条（轨 4px r999 #eceef0 内凹，紫渐变填充最小 6px，160ms linear）+ 百分比 11/600
                -->
                <template v-if="!isTerminal(item.status)">
                  <span
                    class="relative flex-none w-44px h-44px self-center rounded-14px bg-gradient-to-b from-white to-violet-soft-tint shadow-[inset_0_0_0_1px_var(--xq-violet-line)]"
                    aria-hidden="true"
                  >
                    <DotWave class="absolute inset-0" />
                  </span>
                  <span
                    class="min-w-0 flex-1 self-stretch flex flex-col justify-between gap-4px pointer-events-none"
                    aria-hidden="true"
                  >
                    <span class="flex flex-col gap-5px">
                      <span :class="[shimmerCls, 'block w-[82%] h-9px rounded-4px']" />
                      <span :class="[shimmerCls, 'block w-[64%] h-9px rounded-4px']" />
                    </span>
                    <span class="flex items-center gap-6px">
                      <span
                        class="relative flex-1 min-w-6px h-4px rounded-full bg-sunken shadow-[inset_0_1px_1px_rgba(31,35,41,0.06)] overflow-hidden"
                      >
                        <span
                          class="absolute inset-y-0 left-0 rounded-full sx-grad-progress [transition:width_160ms_linear] motion-reduce:transition-none"
                          :style="{ width: `${Math.min(100, Math.max(4, item.progress ?? 6))}%` }"
                        />
                      </span>
                      <span class="flex-none text-11px font-600 leading-16px text-violet-ink tabular-nums"
                        >{{ Math.min(100, Math.max(0, item.progress ?? 6)) }}%</span
                      >
                    </span>
                  </span>
                </template>
                <template v-else>
                  <!-- 缩略 44 / r14（内图同心 r13）：有图时是按钮（压在整卡按钮之上），点开灯箱看大图，悬停放大镜光标；
                       多张用 3/6px 偏移叠影表示，张数角标高 16、11px -->
                  <component
                    :is="stackOf(item)[0] ? 'button' : 'span'"
                    v-bind="
                      stackOf(item)[0]
                        ? {
                            type: 'button',
                            'aria-label': `放大查看${stackOf(item).length > 1 ? `（共 ${stackOf(item).length} 张）` : ''}`,
                          }
                        : { 'aria-hidden': 'true' }
                    "
                    class="sx-squircle relative z-1 flex-none grid place-items-center w-44px h-44px self-center box-border p-0 rounded-14px border border-solid border-line bg-surface3 text-placeholder"
                    :class="[
                      stackOf(item)[0] ? ['cursor-zoom-in', focusRing] : 'pointer-events-none',
                      stackOf(item).length >= 3
                        ? 'shadow-[3px_-3px_0_-1px_var(--xq-surface),3px_-3px_0_0_var(--xq-line),6px_-6px_0_-1px_var(--xq-surface),6px_-6px_0_0_var(--xq-line)]'
                        : stackOf(item).length === 2
                          ? 'shadow-[3px_-3px_0_-1px_var(--xq-surface),3px_-3px_0_0_var(--xq-line)]'
                          : '',
                    ]"
                    @click="stackOf(item)[0] && openThumbs(stackOf(item), 0, promptOf(item))"
                  >
                    <img
                      v-if="stackOf(item)[0]"
                      :src="ossResize(stackOf(item)[0], 44, 44)"
                      alt=""
                      loading="lazy"
                      decoding="async"
                      @error="(e: Event) => thumbFallback(e, stackOf(item)[0])"
                      class="absolute inset-0 block h-full w-full rounded-13px object-cover object-center"
                      draggable="false"
                    />
                    <span v-else class="text-11px">{{ schema.media === 'video' ? '视频' : '—' }}</span>
                    <span
                      v-if="stackOf(item).length > 1"
                      class="absolute z-2 -top-4px -right-4px grid min-w-16px h-16px box-border place-items-center px-4px rounded-full border border-solid border-surface bg-ink text-11px font-600 leading-none text-surface"
                      aria-hidden="true"
                      >{{ stackOf(item).length }}</span
                    >
                  </component>
                  <span class="min-w-0 flex-1 flex flex-col justify-between gap-2px">
                    <!-- 第一行：提示词（单行省略）；状态只在下方胶囊出现一次，时间放进悬停提示 -->
                    <span
                      class="m-0 truncate text-12px leading-18px text-ink pointer-events-none"
                      :title="`${formatTime(item.createdAt)} · ${promptOf(item)}`"
                      >{{ promptOf(item) }}</span
                    >
                    <!-- 第二行：成功只显示时间，其它状态显示胶囊（失败 / 超时 / 取消需要醒目）；操作钮靠右，压在整卡按钮之上 -->
                    <HistoryActionRow
                      class="h-24px"
                      :more-items="[
                        { key: 'delete', label: '删除', danger: true },
                        {
                          key: 'reedit',
                          label: item.requestParams ? '重新编辑' : `重新编辑（${RESTORE_DISABLED_TIP}）`,
                          disabled: !item.requestParams || submitting,
                        },
                      ]"
                      @more="(k) => (k === 'delete' ? confirmDelete(item) : restoreFrom(item))"
                      @lead-click="selectedId = item.aiToolHistoryId"
                    >
                      <template #lead>
                        <span
                          v-if="item.status === 'SUCCEED'"
                          class="min-w-0 truncate text-11px leading-16px text-muted tabular-nums whitespace-nowrap"
                          :title="formatTime(item.createdAt)"
                          :aria-label="formatTime(item.createdAt)"
                          >{{ shortTime(item.createdAt) }}</span
                        >
                        <span
                          v-else
                          class="flex-none inline-flex items-center h-18px px-7px rounded-full text-11px leading-none whitespace-nowrap"
                          :class="statusChipCls(item.status)"
                        >
                          <i
                            class="w-5px h-5px rounded-full mr-4px"
                            :class="statusDotCls(item.status)"
                            aria-hidden="true"
                          ></i>
                          {{ statusOf(item.status).text }}
                        </span>
                      </template>
                      <!-- 顺序：下载 · 删除 · 重新编辑；sm = 视觉 24，命中区外扩到 ≥32（触屏 ≥44）；放不下时后两个收进「更多」 -->
                      <template #primary>
                        <IconButton
                          v-if="firstOutput(item)"
                          label="下载"
                          size="sm"
                          :href="firstOutput(item)"
                          target="_blank"
                          download
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.8"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
                          </svg>
                        </IconButton>
                      </template>
                      <template #secondary>
                        <IconButton label="删除" size="sm" variant="danger" @click="confirmDelete(item)">
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.8"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
                          </svg>
                        </IconButton>
                        <!-- 重新编辑：老记录（无 requestParams）不可用，用 disabled 且 title 说明原因 -->
                        <IconButton
                          :label="item.requestParams ? '重新编辑' : `重新编辑（${RESTORE_DISABLED_TIP}）`"
                          size="sm"
                          :disabled="!item.requestParams || submitting"
                          @click="restoreFrom(item)"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.8"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
                          </svg>
                        </IconButton>
                      </template>
                    </HistoryActionRow>
                  </span>
                </template>
              </div>
              <!-- compact 版式右栏没有结果卡（原型）：选中的那条在这里展开结果 -->
              <div
                v-if="compact && current?.aiToolHistoryId === item.aiToolHistoryId"
                class="mt-6px px-2px flex flex-col gap-6px"
              >
                <p v-if="!isTerminal(item.status)" class="m-0 text-11px leading-16px text-muted">
                  任务进行中，结果出来后会自动显示
                </p>
                <p v-else-if="item.status !== 'SUCCEED'" class="m-0 text-11px leading-16px text-danger" role="status">
                  {{ item.errorMessage || '任务未成功，点数已按规则退回' }}
                </p>
                <template v-else>
                  <template v-for="url in outputsOf(item).videos" :key="url">
                    <video
                      :src="url"
                      controls
                      preload="metadata"
                      class="block w-full max-h-240px rounded-6px bg-black"
                    />
                    <a
                      :href="url"
                      target="_blank"
                      rel="noopener"
                      download
                      :class="[
                        plateBtnCls,
                        focusRing,
                        'self-start h-32px px-12px rounded-4px text-13px leading-30px no-underline',
                      ]"
                      >下载视频</a
                    >
                  </template>
                  <template v-for="(url, i) in outputsOf(item).images" :key="url">
                    <img :src="url" :alt="`结果图 ${i + 1}`" class="block w-full rounded-6px object-contain" />
                    <a
                      :href="url"
                      target="_blank"
                      rel="noopener"
                      download
                      :class="[
                        plateBtnCls,
                        focusRing,
                        'self-start h-32px px-12px rounded-4px text-13px leading-30px no-underline',
                      ]"
                      >下载结果</a
                    >
                  </template>
                  <p
                    v-if="!outputsOf(item).images.length && !outputsOf(item).videos.length"
                    class="m-0 text-11px leading-16px text-muted"
                  >
                    任务已完成，但没有返回产物地址
                  </p>
                </template>
              </div>
            </li>
            <li
              v-if="!historyPaged.length"
              class="col-span-full flex flex-col items-center justify-center gap-5px h-65px box-border px-10px rounded-8px border border-dashed border-line-strong bg-[linear-gradient(var(--xq-surface),var(--xq-surface2))] text-center"
            >
              <b class="text-13px font-600 leading-18px text-ink-2">没有匹配的记录</b>
              <span class="text-11px leading-15px text-muted">换个关键词再试</span>
            </li>
          </ul>

          <div class="flex-none flex items-center justify-center gap-10px pt-8px pb-2px">
            <IconButton label="上一页" :disabled="historyPage <= 1" @click="historyPage -= 1">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="m15 6-6 6 6 6" />
              </svg>
            </IconButton>
            <span class="text-12px leading-16px text-muted tabular-nums" aria-live="polite"
              >{{ historyPage }} / {{ historyPages }}</span
            >
            <IconButton label="下一页" :disabled="historyPage >= historyPages" @click="historyPage += 1">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
            </IconButton>
          </div>
        </template>
      </section>

      <!--
        结果列（原型 ToolPreviewPanel v3）：有记录时一张结果卡撑满整列（内边距 12、gap 10）——
        头部（标题 14/600 + 状态·时间 11 + 名称 11 最宽 240 + 结果 / 前后对比 + 下载图标钮 32 / r4，按下 #e9ecef 内凹）→ 舞台（最小高 320，contain 居中，点图开灯箱）
        → 候选图 4 列 gap 6；没有任何记录时整列只放功能介绍。compact 版式只有功能介绍卡（原型），结果在历史列表里展开。
      -->
      <div class="flex min-h-0 min-w-0 flex-col gap-10px">
        <section
          v-if="!compact && hasRecord"
          class="ll-card relative flex-1 min-h-0 min-w-0 flex flex-col gap-10px box-border overflow-hidden p-12px"
          aria-labelledby="tool-result-title"
        >
          <div class="flex-none flex flex-wrap items-center gap-8px min-w-0">
            <h2 id="tool-result-title" class="m-0 text-14px font-600 leading-[1.55] text-ink">
              {{ schema.resultTitle ?? '生成结果' }}
            </h2>
            <!-- 原型 .v3-preview__meta：11/1.55 muted，时间用 MM-DD HH:mm 短格式 -->
            <span class="text-11px leading-[1.55] text-muted">
              <template v-if="showSync">已完成 · 本次结果</template>
              <template v-else-if="current"
                >{{ statusOf(current.status).text }} · {{ shortTime(current.createdAt) }}</template
              >
            </span>
            <span class="min-w-0 max-w-240px truncate text-11px leading-16px text-placeholder" :title="recordTitle">{{
              recordTitle
            }}</span>
            <div
              v-if="canCompare || canColorCompare"
              class="flex-none ml-auto flex p-2px box-border rounded-6px border border-solid border-line bg-surface3 shadow-[inset_0_1px_2px_rgba(31,35,41,0.055),inset_0_0_0_1px_rgba(255,255,255,0.7)]"
              role="group"
              aria-label="查看方式"
            >
              <button
                v-for="m in [
                  { key: 'result', label: '结果', show: true },
                  { key: 'compare', label: '前后对比', show: canCompare },
                  { key: 'colorfix', label: '校色对比', show: canColorCompare },
                ].filter((x) => x.show) as { key: 'result' | 'compare' | 'colorfix'; label: string }[]"
                :key="m.key"
                type="button"
                class="h-28px box-border px-12px rounded-4px border border-solid text-13px leading-26px cursor-pointer [transition:background_300ms_cubic-bezier(0.4,0,0.2,1),border-color_300ms_cubic-bezier(0.4,0,0.2,1),color_300ms_cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
                :class="[
                  focusRing,
                  resultMode === m.key
                    ? 'border-violet-line bg-[linear-gradient(180deg,var(--xq-surface)_0%,var(--xq-violet-tint)_100%)] font-600 text-violet-ink shadow-[0_1px_2px_rgba(31,35,41,0.05)]'
                    : 'border-transparent bg-transparent font-400 text-muted hover:text-ink',
                ]"
                :aria-pressed="resultMode === m.key"
                @click="resultMode = m.key"
              >
                {{ m.label }}
              </button>
            </div>
            <!-- 头部操作（原型 v3-preview__actions）：存为资产 · 下载，md 32、间距 8；校色对比档的两个下载放在图上 -->
            <span
              v-if="selectedProduct && resultMode !== 'colorfix'"
              class="flex-none flex items-center gap-8px"
              :class="canCompare || canColorCompare ? '' : 'ml-auto'"
            >
              <IconButton
                v-if="selectedProduct.type === 'image' && !showSync"
                :label="colorFixEnabled && colorFixTouched ? '存为资产（原图 + 校色后两版）' : '存为资产'"
                :disabled="colorFixSaving"
                @click="saveAsAsset"
              >
                <svg v-if="colorFixSaving" class="animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity="0.25" stroke-width="2.5" />
                  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
                </svg>
                <svg
                  v-else
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <rect x="4" y="7" width="16" height="13" rx="2.5" />
                  <path d="M7 4h10M12 10.5v6M9 13.5h6" />
                </svg>
              </IconButton>
              <IconButton
                :label="
                  selectedProduct.type === 'video'
                    ? '下载视频'
                    : colorFixEnabled && colorFixTouched && selectedProduct.type === 'image'
                      ? '下载（含校色效果）'
                      : '下载结果'
                "
                @click="downloadSelected"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
                </svg>
              </IconButton>
            </span>
          </div>

          <!-- 校色对比：同一张结果，左原图、右挂校色滤镜；图上「下载校色前 / 下载校色后」 -->
          <div
            v-if="canColorCompare && resultMode === 'colorfix' && selectedProduct"
            class="relative flex-none h-[min(62vh,640px)] min-h-320px overflow-hidden rounded-8px bg-surface3"
          >
            <ColorFixCompare
              :before="selectedProduct.src"
              :after="stageSrc"
              :after-filter="stageFilter"
              @download-before="downloadBeforeColorFix"
              @download-after="downloadSelected"
            >
              <template #actions>
                <ColorFixPill :pressed="colorFixPanelOpen" @click="cf.open()" />
              </template>
            </ColorFixCompare>
          </div>

          <!-- 前后对比：高 min(62vh,640)、最小 320、r8 -->
          <div
            v-else-if="canCompare && resultMode === 'compare'"
            class="relative flex-none h-[min(62vh,640px)] min-h-320px overflow-hidden rounded-8px bg-surface3"
          >
            <ToolImageCompare
              :before="compareBefore"
              :after="canColorCompare ? stageSrc : compareAfter"
              :after-filter="canColorCompare ? stageFilter : undefined"
              :labels="compareLabels"
              :aria-label="`${compareLabels[0]}与生成结果前后对比`"
            />
            <!-- 校色入口：前后对比档也在（原型三档都有「校色调整」） -->
            <ColorFixPill
              v-if="colorFixEnabled && selectedProduct?.type === 'image'"
              class="absolute top-10px right-10px z-6"
              :pressed="colorFixPanelOpen"
              @click="cf.open()"
            />
          </div>

          <!-- 结果舞台：产物绝对定位 contain 居中；图片点开灯箱，视频用原生控件。
               校色闭环：右上「校色」入口胶囊（原型 .v3-cf-edit），右下「存为资产」；
               校色参数即时挂 CSS filter 预览，存资产 / 下载时才烘真图 -->
          <div
            v-else-if="selectedProduct"
            :class="[stageCls, 'flex-1 min-h-320px max-[1439px]:(flex-none h-[min(52vh,480px)])']"
          >
            <img
              v-if="selectedProduct.type === 'image'"
              :src="stageSrc || selectedProduct.src"
              :crossorigin="colorFixEnabled ? corsAttr(stageSrc || selectedProduct.src) : undefined"
              :alt="selectedProduct.name"
              class="absolute inset-0 block m-auto max-w-full max-h-full object-contain cursor-zoom-in"
              :class="focusRing"
              :style="stageFilter ? { filter: stageFilter } : undefined"
              role="button"
              tabindex="0"
              :title="syncGroups.length ? '点击查看输入图与结果对照' : '点击放大'"
              :aria-label="syncGroups.length ? '打开输入图与结果的同步对照' : '放大查看生成结果'"
              @click="openResult"
              @keydown.enter.prevent="openResult"
              @keydown.space.prevent="openResult"
              @error="colorFixEnabled && markCorsBlocked(stageSrc || selectedProduct.src)"
            />
            <video
              v-else
              :key="selectedProduct.src"
              :src="selectedProduct.src"
              controls
              playsinline
              class="absolute inset-0 block m-auto max-w-full max-h-full object-contain"
            />
            <!-- 校色入口（出图的工具、仅图片产物）：毛玻璃胶囊「校色调整」 -->
            <ColorFixPill
              v-if="colorFixEnabled && selectedProduct.type === 'image'"
              class="absolute top-10px right-10px z-2"
              :pressed="colorFixPanelOpen"
              @click="cf.open()"
            />
          </div>

          <!-- 生成中：点阵波（DotWave，功能态）+ 文案 -->
          <div
            v-else-if="current && !isTerminal(current.status)"
            :class="[resultEmptyCls, '!gap-8px']"
            role="status"
            aria-live="polite"
          >
            <DotWave size="md" class="mb-4px" />
            <b class="text-13px font-600 leading-[1.4] text-ink-2">正在生成</b>
            <span class="max-w-240px">任务已提交，完成后结果会出现在这里</span>
            <span v-if="history.running.value > 1" class="text-violet-ink"
              >共 {{ history.running.value }} 个任务处理中</span
            >
          </div>
          <div v-else-if="current && current.status !== 'SUCCEED'" :class="resultEmptyCls" role="status">
            <span
              class="grid place-items-center w-36px h-36px mb-2px box-border rounded-full border border-solid border-danger-line bg-white text-danger"
              aria-hidden="true"
            >
              <svg
                class="w-16px h-16px"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
              >
                <path d="M12 7v6M12 16.5v.5" />
              </svg>
            </span>
            <b class="text-13px font-600 leading-[1.4] text-ink-2">这一条没有成功</b>
            <span class="max-w-240px text-danger">{{ current.errorMessage || '任务未成功，点数已按规则退回' }}</span>
          </div>
          <div v-else :class="resultEmptyCls">
            <span
              class="grid place-items-center w-36px h-36px mb-2px box-border rounded-full border border-solid border-line bg-white text-violet-ink"
              aria-hidden="true"
            >
              <svg
                class="w-16px h-16px"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
                <circle cx="9" cy="10" r="1.6" />
                <path d="M20.5 16l-5-5L6 19.5" />
              </svg>
            </span>
            <b class="text-13px font-600 leading-[1.4] text-ink-2">没有可预览的产物</b>
            <span class="max-w-240px">任务已完成，但没有返回产物地址</span>
          </div>

          <!-- 候选 4 列、gap 6，方形 r4；选中 1px violet 描边 + 1px 光晕 -->
          <div v-if="products.length > 1" class="flex-none grid gap-6px grid-cols-4" role="group" aria-label="候选结果">
            <div v-for="(item, i) in products" :key="`${item.src}-${i}`" class="group relative min-w-0">
              <button
                type="button"
                class="relative block w-full overflow-hidden aspect-square box-border p-0 rounded-4px border border-solid bg-surface3 cursor-pointer"
                :class="[
                  focusRing,
                  selectedIndex === i ? 'border-violet shadow-[0_0_0_1px_var(--xq-violet)]' : 'border-line hover:border-control',
                ]"
                :aria-label="`候选 ${i + 1}`"
                :aria-pressed="selectedIndex === i"
                @click="selectedIndex = i"
              >
                <img
                  v-if="item.type === 'image'"
                  :src="item.src"
                  :crossorigin="colorFixEnabled ? corsAttr(item.src) : undefined"
                  :alt="`候选 ${i + 1}`"
                  class="block w-full h-full object-cover"
                  draggable="false"
                  @error="colorFixEnabled && markCorsBlocked(item.src)"
                />
                <video
                  v-else
                  :src="item.src"
                  muted
                  playsinline
                  preload="metadata"
                  class="block w-full h-full object-cover"
                />
              </button>
              <!--
              悬停看大图（原型 ToolPreviewPanel v-hover-preview，与 ToolUploadSlot 同一套）：媒体 240 宽、卡内边距 4、r8、最大高 312；
              延迟 320ms、入场 120ms + 4px 上浮；只在能悬停的指针上出现（触屏 / 键盘不出，点选照旧），纯看不挡点击；往上展开，后两列靠右
            -->
              <div
                v-if="item.type === 'image'"
                class="hidden [@media(hover:hover)]:group-hover:block absolute bottom-[calc(100%+8px)] z-30 w-248px box-border p-4px rounded-8px border border-solid border-line bg-overlay shadow-preview pointer-events-none animate-[tus-preview-in_120ms_ease_320ms_both] motion-reduce:animate-none"
                :class="i % 4 >= 2 ? 'right-0' : 'left-0'"
                aria-hidden="true"
              >
                <div class="grid place-items-center w-240px max-h-[312px] overflow-hidden rounded-6px bg-surface2">
                  <img :src="item.src" alt="" class="block max-w-full max-h-[312px] object-contain" />
                </div>
              </div>
            </div>
          </div>

          <p
            v-if="history.running.value && !(current && !isTerminal(current.status))"
            class="flex-none m-0 text-11px leading-16px text-muted"
          >
            还有 {{ history.running.value }} 个任务处理中，完成后会补进中间那一列
          </p>

          <!-- 校色参数台（与商拍工作室共用 ColorFixPanel，含选区 / 涂抹弹窗）：相对结果卡定位、贴右缘垂直居中、可拖并夹在卡内 -->
          <ColorFixResultPanel :cf="cf" />
        </section>

        <!--
          功能介绍（原型 ToolIntroPanel fill）：内边距 18、gap 14；标题 14/600，正文 13/1.65 ink-2；
          适用场景块内边距 10、1px line-soft、r6、surface2。
        -->
        <section
          v-if="compact || !hasRecord"
          class="ll-card flex-1 min-h-0 overflow-y-auto box-border p-18px flex flex-col gap-14px"
          aria-labelledby="tool-intro-title"
        >
          <h2 id="tool-intro-title" class="m-0 text-14px font-600 leading-[1.55] text-ink">功能介绍</h2>
          <p class="m-0 text-13px leading-[1.65] text-ink-2">{{ schema.intro || schema.description }}</p>
          <div
            class="sx-squircle flex flex-col gap-[5.5px] p-10px rounded-12px border border-solid border-line-soft bg-surface2"
          >
            <h3 id="tool-intro-scenes" class="m-0 text-13px font-500 leading-[1.55] text-ink">
              {{ schema.scenarios?.length ? '适用场景' : '使用步骤' }}
            </h3>
            <ul
              v-if="schema.scenarios?.length"
              class="m-0 p-0 list-none flex flex-col gap-[5.5px] text-13px leading-[1.55] text-ink-2"
              aria-labelledby="tool-intro-scenes"
            >
              <li v-for="sc in schema.scenarios" :key="sc">{{ sc }}</li>
            </ul>
            <ol
              v-else
              class="m-0 pl-18px flex flex-col gap-[5.5px] text-13px leading-[1.55] text-ink-2"
              aria-labelledby="tool-intro-scenes"
            >
              <li v-for="step in schema.steps" :key="step">{{ step }}</li>
            </ol>
          </div>
          <p v-if="history.running.value" class="m-0 text-11px leading-16px text-violet-ink" role="status">
            {{ history.running.value }} 个任务处理中，完成后会更新到历史记录
          </p>
        </section>
      </div>
    </div>

    <ToolMediaPreview v-model:open="lightboxOpen" v-model:index="lightboxIndex" :items="lightboxItems" />
    <!-- 历史缩略图 / 抠图结果卡的放大：共用 MediaLightbox -->
    <MediaLightbox v-model:show="thumbLightbox.show" v-model:index="thumbLightbox.index" :items="thumbLightbox.items" />
    <ImageCompareSync v-model:show="syncOpen" v-model:index="syncIndex" :title="schema?.title" :groups="syncGroups" />
  </div>
</template>

<style scoped>
/* 骨架呼吸：UnoCSS 原子类只能引用动画名，关键帧本身写不成原子类，故此处是唯一允许的 CSS；1.2s 循环，仅动透明度，不改尺寸 */
@keyframes tool-skeleton-breathe {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}

.tool-skeleton-row {
  animation: tool-skeleton-breathe 1.2s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .tool-skeleton-row {
    animation: none;
  }
}
</style>

<style>
/*
 * 收起目录的功能名气泡推入 / 缩回（原型 NextDirectory rail-tip-in / rail-tip-out）：UnoCSS 的 animate-[…] 只能引用名字，
 * 关键帧本身写不成原子类；不加 scoped（scoped 会给关键帧名加哈希，模板里的原子类就对不上），名字带 tool- 前缀避免撞名。
 * 用独立的 translate 属性，和气泡自身 transform（居中 + 0.9/1 缩放）互不覆盖。
 */
@keyframes tool-rail-tip-in {
  from {
    translate: calc(-100% - 12px) 0;
  }
  to {
    translate: 0 0;
  }
}
/* 历史骨架扫光（原型 StudioHistoryColumn hist-shimmer）：同样只能用关键帧表达 */
@keyframes tool-hist-shimmer {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}
@keyframes tool-rail-tip-out {
  from {
    translate: 0 0;
  }
  to {
    translate: calc(-100% - 12px) 0;
  }
}
</style>
