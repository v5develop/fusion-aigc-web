<script setup lang="ts">
/**
 * 工具箱共用工具页 /tools/:toolId（各工具按 schemas.ts 渲染）。
 *
 * <p>版式对齐新版原型（工具详情页）：贴边目录栏 160（可收起）/ 操作 460（工具头卡 + 上传 + 参数，自己滚，
 * 底部固定提交栏）/ 历史 224 / 结果卡 + 功能介绍卡。操作栏内边距 13，正好放下 s1.1 的 B3.1 上传卡 434×742。
 * 阴影、渐变、过渡时长照抄原型计算样式。提交打 Java v1 现有路由（schema.javaRoute），请求体按 schema 的
 * javaKey 映射组装；结果与历史都取 GET /api/v1/tools/{toolTitle}/histories（异步工具只回任务号）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, useId, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useDialog, useMessage } from 'naive-ui'
import { toApiError } from '@/api/index.ts'
import { upload } from '@/api/ossUpload.ts'
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
import { useUserInfoStore } from '@/stores/userInfo'
import {
  findToolSchema,
  isFieldVisible,
  restoreToolForm,
  toJavaValue,
  type ToolField,
  type ToolSchema,
  type ToolUpload,
} from './schemas'
import { catalogFor, catalogKindOf, catalogKinds } from './catalog'
import { isTerminal, useToolHistory } from './useToolHistory'
import { takeRefill } from '@/utils/refillHandoff'
import ToolUploadSlot from './ToolUploadSlot.vue'
import ToolTryonMaterials from './ToolTryonMaterials.vue'
import MaskPainter from './MaskPainter.vue'
import InpaintRegionPicker from './InpaintRegionPicker.vue'
import { inpaintImages, inpaintMissingReason, type InpaintBoxes } from './inpaint'
import PollingOfflineBanner from './PollingOfflineBanner.vue'
import ToolImageCompare from './ToolImageCompare.vue'
import ToolMediaPreview, { type PreviewItem } from './ToolMediaPreview.vue'
import CreationImageSettings from '@/components/creation/CreationImageSettings.vue'
import CreationSettingsRow from '@/components/creation/CreationSettingsRow.vue'
import CreationPromptInput from '@/components/creation/CreationPromptInput.vue'
import {
  creationSettingsSummary,
  toCreationOptions,
  type CreationOption,
  type CreationSettingKey,
  type CreationSettingsConfig,
  type CreationSettingsRowItem,
  type CreationSettingsValue,
} from '@/components/creation/types'

/** Java 同步抠图「等不及」的专用码（ErrorCode.TASK_PROCESSING） */
const TASK_PROCESSING_CODE = 3010

interface Region {
  targetText: string
  text: string
  include: boolean
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
const catalog = computed(() => catalogFor(toolId.value))
/** 当前工具在目录里的条目：头卡的图标与短说明取这里 */
const currentEntry = computed(() => catalog.value.groups.flatMap((g) => g.entries).find((e) => e.id === toolId.value))
const catalogCollapsed = ref(false)

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
const switcherCatalog = computed(() => catalogKinds.find((k) => k.key === switcherKind.value)?.catalog ?? catalog.value)
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
/** GET /api/v1/features/image-model-configs：图片生成各分辨率单价；null = 还没拿到（失败时保持原文案） */
const imageModels = ref<ModelConfig[] | null>(null)

async function loadVideoModels() {
  const res = await videoModelConfigs()
  videoModels.value = (res.data ?? []).filter((m) => m && typeof m.model === 'string' && m.model)
  videoModelsLoaded.value = true
}

const currentVideoModel = computed(() => videoModels.value.find((m) => m.model === values.model))
const VIDEO_RATIO_LABELS: Record<string, string> = { adaptive: '自适应' }

/** 当前模型这一档清晰度的配置（清晰度按小写对齐：h3 / happyhorse 下发的是大写 768P、2K） */
function videoSizeOf(m: ModelConfig | undefined, resolution: unknown) {
  if (!m || typeof resolution !== 'string') return undefined
  return m.size?.find((x) => x.resolution?.toLowerCase() === resolution.toLowerCase())
}

/** 字段的可选项：静态取 schema.options，dynamic 按当前模型 / 清晰度现算 */
function fieldOptions(f: ToolField): CreationOption<string>[] {
  if (!f.dynamic) return (f.options ?? []).map((o) => ({ label: o, value: o }))
  const m = currentVideoModel.value
  switch (f.dynamic) {
    case 'videoModel':
      return videoModels.value.map((x) => ({
        label: x.description ? `${x.model}（${x.description}）` : x.model,
        value: x.model,
      }))
    case 'videoResolution':
      return (m?.size ?? [])
        .filter((x) => typeof x.resolution === 'string' && x.resolution)
        .map((x) => ({ label: x.resolution.toUpperCase(), value: x.resolution.toLowerCase() }))
    case 'videoRatio':
      return (videoSizeOf(m, values.resolution)?.aspectRatio ?? []).map((r) => ({
        label: VIDEO_RATIO_LABELS[r] ?? r,
        value: r,
      }))
    case 'videoDuration': {
      if (!m) return []
      const [min, max] = m.duration ?? []
      // 服务端没建模时长（duration 为空）：只给契约默认的 4 秒
      const range = Number.isInteger(min) && Number.isInteger(max) && min! > 0 && max! >= min! ? [min!, max!] : [4, 4]
      return Array.from({ length: range[1]! - range[0]! + 1 }, (_, i) => {
        const n = range[0]! + i
        return { label: `${n} 秒`, value: String(n) }
      })
    }
  }
}

/** 视频模型支不支持这个上传槽（supportedModes 为空 = 服务端没建模，按都支持） */
function uploadEnabled(u: ToolUpload) {
  if (!u.needsMode) return true
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

function clampNumber(f: ToolField) {
  const n = Math.round(Number(values[f.key]))
  const fallback = f.min ?? 1
  values[f.key] = Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, Number.isFinite(n) ? n : fallback))
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
    if (s.price === 'image-model-configs' && !imageModels.value) {
      imageModelConfigs()
        .then((res) => (imageModels.value = res.data ?? []))
        .catch(() => {})
    }
  },
  { immediate: true },
)

const visibleFields = computed(() => (schema.value?.fields ?? []).filter((f) => isFieldVisible(f, values)))

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
      if (opts.length && !opts.some((o) => o.value === values[f.key])) values[f.key] = opts[0]!.value
    }
    for (const u of s.uploads) if (!uploadEnabled(u) && uploads[u.slot]?.length) uploads[u.slot] = []
  },
  { immediate: true },
)
/** 上传槽位的显示顺序：s1.1 产品替换「替换素材」在上、底图片格在下（只换显示顺序，校验与提交仍按 schema 顺序） */
const displayUploads = computed(() =>
  [...(schema.value?.uploads ?? [])].sort((a, b) => Number(b.layout === 'material') - Number(a.layout === 'material')),
)
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

// 图片设置（目标分辨率 / 画幅比例 / 生成张数）交给共用的 CreationImageSettings：
// 这几个字段合成一组，放进底部设置行（原型「图片设置 3:4 · 1K · 1 张 ▾」）的弹层；取值仍写回 values[key]，请求体不变
const SETTING_KEYS: readonly string[] = ['resolution', 'aspectRatio', 'count'] satisfies CreationSettingKey[]
const isSettingField = (f: ToolField) => SETTING_KEYS.includes(f.key) && (f.type === 'chips' || f.type === 'stepper')
const settingFields = computed(() => visibleFields.value.filter(isSettingField))
/** 表单里渲染的字段：设置字段改由底部设置行承载 */
const formFields = computed(() => visibleFields.value.filter((f) => !isSettingField(f)))
const settingsConfig = computed<CreationSettingsConfig>(() =>
  Object.fromEntries(
    settingFields.value.map((f) => [
      f.key,
      {
        label: f.label,
        required: f.required,
        // 张数原为 min–max 的数字框，这里列成同范围的胶囊，取值仍是数字
        options:
          f.type === 'stepper'
            ? toCreationOptions(Array.from({ length: (f.max ?? 1) - (f.min ?? 1) + 1 }, (_, i) => (f.min ?? 1) + i))
            : fieldOptions(f),
      },
    ]),
  ),
)
const settingsValue = computed<CreationSettingsValue>(() =>
  Object.fromEntries(settingFields.value.map((f) => [f.key, values[f.key]])),
)
function onSettings(v: CreationSettingsValue) {
  for (const f of settingFields.value) values[f.key] = v[f.key as CreationSettingKey]
}
/**
 * 只有一个档位字段（chips、≤4 档）时照原型 ChoiceFieldButton inline 摆在提交按钮上方，分段片直接点选；取值仍写回 values[key]。
 * ←/→ 循环切换，焦点跟到新选中的那一片（原型 move）。
 */
const inlineSetting = computed(() => {
  const only = settingFields.value.length === 1 ? settingFields.value[0] : undefined
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
/** 底部设置行：有设置字段才出一枚按钮；视频工具叫「视频设置」（原型视频高清「视频设置 1080P」） */
const settingItems = computed<CreationSettingsRowItem[]>(() =>
  settingFields.value.length
    ? [
        {
          key: 'settings',
          icon: 'gear',
          label: schema.value?.media === 'video' ? '视频设置' : '图片设置',
          value: creationSettingsSummary(settingsConfig.value, settingsValue.value),
        },
      ]
    : [],
)

const reasonId = `tool-submit-reason-${useId()}`

// 换图后蒙版与识别结果都作废
watch(singleImage, (url) => {
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
const auditionUrl = computed(() => {
  const meta = selectedVoice.value?.meta
  if (!meta || typeof meta !== 'object') return ''
  const hit = Object.values(meta as Record<string, unknown>).find(
    (v) => typeof v === 'string' && /^https?:\/\/.+\.(mp3|wav|m4a|aac|ogg)(\?|$)/i.test(v),
  )
  return (hit as string) ?? ''
})

let audio: HTMLAudioElement | null = null
function playAudition() {
  if (!auditionUrl.value) return
  audio?.pause()
  audio = new Audio(auditionUrl.value)
  void audio.play().catch(() => message.error('试听播放失败'))
}

// ---------------- 文字识别（文字替换） ----------------

async function runOcr() {
  if (!singleImage.value || ocrLoading.value) return
  ocrLoading.value = true
  try {
    const res = await toolOcr(singleImage.value)
    const list = res.data?.Results ?? []
    regions.value = list
      .filter((r) => r.Text && r.TextRectangles?.Pos?.length === 4)
      .map((r) => {
        const t = r.TextRectangles!
        return {
          targetText: r.Text!,
          text: r.Text!,
          include: true,
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
  } catch (err) {
    reportError(err, '文字识别失败')
  } finally {
    ocrLoading.value = false
  }
}

// 文字替换：原图上传后自动识别（复用 runOcr / toolOcr，无需点按钮）
const hasRegionField = computed(() => !!schema.value?.fields.some((f) => f.type === 'region-list'))
watch(singleImage, (url) => {
  if (url && url === restoredImage) return
  if (url && hasRegionField.value) void runOcr()
})

// ---------------- 就绪判定 ----------------

const disabledReason = computed(() => {
  const s = schema.value
  if (!s) return ''
  for (const u of s.uploads) {
    if (u.required && uploadEnabled(u) && !uploads[u.slot]?.length) return `还没上传${u.label.replace(/（.*）/, '')}`
  }
  for (const f of visibleFields.value) {
    if (!f.required || f.uiOnly) continue
    if (f.type === 'mask') {
      if (!maskHasStroke.value) return '请先涂抹要消除的区域'
      continue
    }
    if (f.type === 'region-list') {
      if (!regions.value.length) return '请先识别图片中的文字'
      if (!regions.value.some((r) => r.include && r.text.trim())) return '至少保留一条要替换的文字'
      continue
    }
    if (f.type === 'inpaint-region') {
      const reason = inpaintMissingReason(uploads[0] ?? [], inpaintBoxes.value)
      if (reason) return reason
      continue
    }
    if (f.type === 'voice') {
      if (!selectedVoice.value) return voicesLoaded.value && !voices.value.length ? '暂无可用音色' : '请选择配音音色'
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
  return ''
})

/** 本次会拆成几次提交（单值键多张 = 逐张提交） */
const fanOutCount = computed(() => {
  const s = schema.value
  if (!s) return 0
  const fan = s.uploads.find(
    (u) => u.javaKey !== 'imageUrls' && u.javaKey !== 'images' && u.max > 1 && uploadEnabled(u),
  )
  return fan ? Math.max(uploads[fan.slot]?.length ?? 0, 1) : 1
})

/** 提交按钮主文案：countLabel 的工具有图时写任务数（原型「开始换装（2 张）」）；计费与提交逻辑不看它 */
const submitLabel = computed(() => {
  const s = schema.value
  if (!s) return ''
  const fan = s.uploads.find((u) => u.javaKey !== 'imageUrls' && u.javaKey !== 'images' && u.max > 1)
  const n = fan ? (uploads[fan.slot]?.length ?? 0) : 0
  return s.submit.countLabel && n ? `${s.submit.label}（${n} 张）` : s.submit.label
})

// 预计消耗：GET /api/v1/features/biz-points 进页读一次（切工具不重读）；失败或该工具无报价时保持原文案
const pointsTable = ref<Record<string, unknown> | null>(null)
bizPoints()
  .then((res) => (pointsTable.value = res.data ?? null))
  .catch(() => {})

/** schema.submit.costSource 形如 `features/biz-points.cutout` 或 `features/biz-points.videoEnhance[目标分辨率] × 秒` */
const BIZ_POINTS_SOURCE = /^features\/biz-points\.(\w+)(?:\[([^\]]+)\])?/
const POINT_UNITS: Record<string, string> = { second: '秒', minute: '分钟' }

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
  return { points, unit: typeof unit === 'string' ? (POINT_UNITS[unit] ?? unit) : '' }
})

/**
 * 图片生成 / 视频生成的预计消耗（schema.price）：取该路由自己的 model-configs，
 * 图片 = 所选分辨率单价 × 张数，视频 = 所选模型该档每秒单价 × 时长；没报价的档返回 null（保持原文案）。
 */
const modelEstimate = computed<{ points: number; unit: string } | null>(() => {
  const s = schema.value
  if (s?.price === 'image-model-configs') {
    const res = s.fields.find((f) => f.key === 'resolution')
    const tier = res ? toJavaValue(res, values[res.key]) : undefined
    const unit = videoSizeOf(imageModels.value?.[0], tier)?.points
    if (typeof unit !== 'number') return null
    const count = Number(values.count ?? 1)
    return { points: unit * (Number.isFinite(count) && count > 0 ? count : 1), unit: '' }
  }
  if (s?.price === 'video-model-configs') {
    const unit = videoSizeOf(currentVideoModel.value, values.resolution)?.points
    const seconds = Number(values.duration)
    if (typeof unit !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null
    return { points: unit * seconds, unit: '' }
  }
  return null
})

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
    ? `预计消耗 ${estimatedPoints.value}，提交即扣点`
    : `按${s.submit.costUnit}计费，提交即扣点`
  return fanOutCount.value > 1 ? `将提交 ${fanOutCount.value} 个任务 · ${unit}` : unit
})

/**
 * compact 版式按钮第二行：原型「消耗 30 点」（数字 900 粗）。点数取真实价目表；按时长计价的工具价目只有单价，
 * 总价要等视频时长，这里如实写成「消耗 N 点/分钟」。价目表没给 / 正在逐个提交时退回原来的整句。
 */
const costLine = computed<{ num: string; suffix: string } | { text: string }>(() => {
  if (progressText.value) return { text: progressText.value }
  const e = estimate.value
  if (!e || fanOutCount.value > 1) return { text: costText.value }
  return { num: String(e.points), suffix: e.unit ? ` 点/${e.unit}` : ' 点' }
})

// ---------------- 组装请求体 ----------------

function fieldEntries(f: ToolField): [string, unknown][] {
  if (f.uiOnly) return []
  if (f.type === 'region-list') {
    const info = regions.value
      .filter((r) => r.include && r.text.trim())
      .map((r) => ({ targetText: r.targetText, text: r.text.trim(), textRectangles: r.rect }))
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

async function buildBodies(s: ToolSchema): Promise<Record<string, unknown>[]> {
  const base: Record<string, unknown> = { ...s.constants }
  for (const f of visibleFields.value) for (const [k, v] of fieldEntries(f)) base[k] = v

  if (s.fields.some((f) => f.type === 'mask')) {
    const file = await maskRef.value?.exportMask()
    if (!file) throw new Error('蒙版生成失败，请重新涂抹')
    const [maskUrl] = await upload([file], undefined, { compress: false })
    base.maskUrl = maskUrl
  }

  let fan: { key: string; urls: string[] } | null = null
  for (const u of s.uploads) {
    const urls = uploads[u.slot] ?? []
    if (!urls.length || !uploadEnabled(u)) continue
    if (u.javaKey === 'images') continue // 局部重绘：地址已随区域进了 images
    if (u.javaKey === 'imageUrls') base.imageUrls = [...urls]
    else if (u.max > 1) fan = { key: u.javaKey, urls }
    else base[u.javaKey] = urls[0]
  }
  return fan ? fan.urls.map((url) => ({ ...base, [fan!.key]: url })) : [base]
}

// ---------------- 提交 ----------------

async function onSubmit() {
  const s = schema.value
  if (!s || submitting.value || disabledReason.value) return
  submitting.value = true
  progressText.value = ''
  let done = 0
  let total = 0
  try {
    if (s.sync) {
      await submitSync()
      return
    }
    const bodies = await buildBodies(s)
    total = bodies.length
    for (const body of bodies) {
      if (total > 1) progressText.value = `正在提交 ${done + 1} / ${total}`
      await submitTool(s.javaRoute, body)
      done += 1
    }
  } catch (err) {
    reportError(err, '提交失败，请重试')
  } finally {
    submitting.value = false
    progressText.value = ''
    if (done > 0) {
      message.success(done === total ? `已提交 ${done} 个任务` : `已提交 ${done} / ${total} 个任务，其余未提交`)
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
async function submitSync() {
  syncResultUrl.value = ''
  try {
    const res = await submitCutout(singleImage.value)
    syncResultUrl.value = res.data?.url ?? ''
  } catch (err) {
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
  const lost: string[] = []
  if (r.voice) {
    const hit = voices.value.find((v) => v.model === r.voice!.voiceModel && v.voiceKey === r.voice!.voiceKey)
    if (hit) values.voice = hit.voiceId
    else lost.push('配音音色')
  }
  if (hasRegionField.value) {
    // 文字替换：识别结果随提交体回填；回填的原图不自动重新识别（识别单独计费），要重识别用户自己点
    restoredImage = uploads[0]?.[0] ?? ''
    if (r.regions) regions.value = r.regions.map((x) => ({ ...x, include: true }))
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
  if (lost.length) message.warning(`已回填原参数，${lost.join('、')}需要重新设置`)
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

const current = computed<ToolHistoryItem | null>(
  () => history.items.value.find((i) => i.aiToolHistoryId === selectedId.value) ?? history.items.value[0] ?? null,
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

function formatTime(v?: string | null) {
  if (!v) return ''
  return v.replace('T', ' ').slice(0, 16)
}

/** MM-DD HH:mm（历史卡空间窄，原型同款短格式；完整时间放读屏名） */
const shortTime = (v?: string | null) => formatTime(v).slice(5)

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

const resultMode = ref<'result' | 'compare'>('result')
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
const compareBefore = computed(() => {
  if (showSync.value) return singleImage.value
  const item = current.value
  return item?.inputImageUrls?.[0] ?? item?.payload?.imageUrls?.[0] ?? ''
})
/** 一进一出的处理类工具：有输入图 + 结果图时给「结果 / 前后对比」两档 */
const canCompare = computed(() => !!compareAfter.value && !!compareBefore.value)

const lightboxOpen = ref(false)
const lightboxIndex = ref(0)
function openLightbox() {
  if (!products.value.length) return
  lightboxIndex.value = Math.min(selectedIndex.value, products.value.length - 1)
  lightboxOpen.value = true
}

/** 原型 ToolWorkspaceColumns 历史列 empty-hint 全文（原型展示时切到分号前，按产品要求用全文） */
const HISTORY_EMPTY_HINT = '左边传好素材、点底部按钮提交，每次生成都会在这一列留一条；点一条就能在右边看它的产物'
/** 图标框（原型 .v3-item__icon / .fn-switch__thumb）：1px line、r6、135° 柔紫渐变 + 顶 1px 白内线，图标藤紫 */
const tileCls =
  'flex-none grid place-items-center box-border rounded-6px border border-solid border-line ' +
  'bg-[linear-gradient(135deg,#f6effa,#efe6f5)] shadow-[inset_0_1px_0_#fff]'
/** 结果舞台（原型 `.v3-preview__stage`）：1px line、r8、surface2 + 20px 淡棋盘格、inset-input 内影 */
const stageCls =
  'relative overflow-hidden box-border rounded-8px border border-solid border-line bg-surface2 ' +
  '[background-image:repeating-conic-gradient(#eef0f2_0_25%,transparent_0_50%)] bg-[length:20px_20px] ' +
  'shadow-[inset_0_1px_2px_rgba(31,35,41,0.055),inset_0_0_0_1px_rgba(255,255,255,0.7)]'
/** 结果列空态（原型 `.v3-preview__empty`）：最小高 220、内边距 18、gap 5，说明 11/1.55 muted */
const resultEmptyCls =
  'flex-1 min-h-[220px] flex flex-col items-center justify-center gap-5px p-18px text-center text-11px leading-[1.55] text-muted'

const focusRing = 'outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)'
/** 输入框（原型 `.sx-input`）：高 34、1px #c9cfd6、r4、inset-input；hover #aeb6bf；焦点 violet 描边 + 3px 光晕 α.14 */
const inputCls =
  'w-full h-34px box-border rounded-4px border border-solid border-#c9cfd6 bg-white px-10px text-13px text-ink ' +
  'shadow-[inset_0_1px_2px_rgba(31,35,41,0.055),inset_0_0_0_1px_rgba(255,255,255,0.7)] ' +
  '[transition:border-color_110ms,box-shadow_110ms] hover:border-#aeb6bf ' +
  'focus:(border-violet outline-none shadow-[inset_0_1px_2px_rgba(31,35,41,0.055),0_0_0_3px_rgba(135,95,154,0.14)]) ' +
  'disabled:(border-line bg-surface3 text-placeholder cursor-not-allowed)'
/** 历史骨架扫光（原型 hist-shimmer）：90° #f1f2f4 25% / #f8f9fa 50% / #f1f2f4 75%、底图 200% 宽，1.2s ease-in-out 循环 */
const shimmerCls =
  'bg-[linear-gradient(90deg,#f1f2f4_25%,#f8f9fa_50%,#f1f2f4_75%)] bg-[length:200%_100%] ' +
  'animate-[tool-hist-shimmer_1.2s_ease-in-out_infinite] motion-reduce:animate-none'
/** 板材小按钮（原型 `.sx-btn`）：#c9cfd6 描边 + 白→#fbfcfc + 内高光；按下 #b9c0c8 + #f3f4f5→#f7f8f9 + inset-press */
const plateBtnCls =
  'border border-solid border-#c9cfd6 bg-[linear-gradient(#fff,#fbfcfc)] text-ink-2 cursor-pointer ' +
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(31,35,41,0.04),0_1px_2px_rgba(31,35,41,0.05)] ' +
  'active:(border-#b9c0c8 bg-[linear-gradient(#f3f4f5,#f7f8f9)] shadow-[inset_0_1px_2px_rgba(31,35,41,0.12),inset_0_0_0_1px_rgba(31,35,41,0.03)]) ' +
  '[transition:border-color_110ms,color_110ms,background_110ms] hover:(border-#aeb6bf text-ink bg-[linear-gradient(#fff,#f7f8f9)])'
</script>

<template>
  <div v-if="!schema" class="h-full flex flex-col items-center justify-center gap-12px bg-page">
    <p class="m-0 text-15px text-ink">没有找到这个工具</p>
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
      class="relative z-34 flex-none flex min-h-0 flex-col box-border overflow-hidden border-l border-solid border-shell-line bg-white shadow-[10px_0_16px_-12px_rgba(31,35,41,0.22)] [transition:width_0.2s_ease,flex-basis_0.2s_ease] motion-reduce:transition-none"
      :class="catalogCollapsed ? 'w-44px basis-44px' : 'w-160px basis-160px'"
      aria-labelledby="tool-catalog-title"
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
        <button
          type="button"
          class="flex-none grid place-items-center w-28px h-28px p-0 rounded-4px border-none bg-transparent text-muted cursor-pointer hover:(bg-surface3 text-ink)"
          :class="focusRing"
          :aria-expanded="!catalogCollapsed"
          aria-controls="tool-catalog-list"
          :aria-label="catalogCollapsed ? '展开目录' : '收起目录'"
          :title="catalogCollapsed ? '展开目录' : '收起目录'"
          @click="catalogCollapsed = !catalogCollapsed"
        >
          <svg
            class="w-16px h-16px"
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
        </button>
      </div>
      <div class="relative flex-1 min-h-0">
        <!-- 上下渐隐：只在还能往那个方向滚时出现（opacity 160ms） -->
        <span
          class="pointer-events-none absolute inset-x-0 top-0 z-1 h-16px bg-[linear-gradient(#fff,rgba(255,255,255,0))] [transition:opacity_0.16s_ease]"
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
                    ? 'mt-16px pt-10px shadow-[inset_0_0.8px_0_#efefef,inset_0_2px_3px_-2px_rgba(31,35,41,0.1)]'
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
                    :title="catalogCollapsed ? undefined : e.route ? undefined : '即将开放'"
                    class="flex items-center box-border rounded-6px border border-solid no-underline"
                    :class="[
                      catalogCollapsed
                        ? 'flex-[0_0_36px] justify-center w-36px h-36px p-0 [transition:background_110ms,color_110ms] motion-reduce:transition-none'
                        : 'justify-start gap-10px w-full h-48px pl-8px pr-14px',
                      e.route ? focusRing : 'cursor-not-allowed',
                      e.id === toolId
                        ? [
                            'border-line bg-[linear-gradient(#f3f4f5,#fafbfc)] shadow-[inset_0_1px_3px_rgba(31,35,41,0.1),inset_0_-1px_0_#fff]',
                            catalogCollapsed ? 'text-ink' : '',
                          ]
                        : [
                            'border-transparent',
                            e.route ? 'hover:bg-surface3' : '',
                            catalogCollapsed ? (e.route ? 'text-muted hover:text-ink' : 'text-muted opacity-60') : '',
                          ],
                    ]"
                    @mouseenter="hoveredRail = e.id"
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
                        :class="[tileCls, 'ml-auto w-36px h-36px', e.route ? 'text-violet' : 'text-muted opacity-60']"
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
                      <span class="mr-auto min-w-0 w-56px flex-[0_0_56px] flex flex-col">
                        <span
                          class="truncate text-13px font-500 leading-[1.3]"
                          :class="e.route ? 'text-ink' : 'text-muted'"
                        >
                          {{ e.name }}
                        </span>
                        <!-- 原型每项都写短说明；没开放的项由读屏名「（即将开放）」与悬停提示说明 -->
                        <span class="truncate text-11px leading-[1.35] text-muted">{{ e.tagline }}</span>
                      </span>
                    </template>
                  </component>
                </li>
              </ul>
            </section>
          </template>
        </div>
        <span
          class="pointer-events-none absolute inset-x-0 bottom-0 z-1 h-16px bg-[linear-gradient(to_top,#fff,rgba(255,255,255,0))] [transition:opacity_0.16s_ease]"
          :class="fadeBottom ? 'opacity-100' : 'opacity-0'"
          aria-hidden="true"
        />
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
          ? 'border-violet-line bg-[linear-gradient(180deg,#fff_0%,#f8f3fc_100%)] shadow-[0_1px_2px_rgba(31,35,41,0.05)] text-violet-ink font-600'
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
      三栏（原型 ToolWorkspaceColumns ml）：≥1440 时 460 / 224 / 1fr、gap 16、内边距 16（左 15），三栏等高、各栏内部滚动；
      <1440 单列堆叠、gap 14，整页滚动。
    -->
    <div
      class="flex-1 min-w-0 min-h-0 grid grid-cols-1 gap-14px p-16px overflow-y-auto border-l border-solid border-shell-line min-[1440px]:(grid-cols-[460px_224px_minmax(0,1fr)] gap-16px pl-15px overflow-hidden)"
    >
      <!-- 操作区：功能卡（点开切换功能）+ 上传 + 参数，自己滚；底部固定设置行 + 提交栏 -->
      <section class="ll-card flex flex-col min-h-0 overflow-hidden" aria-labelledby="tool-title">
        <!-- tabindex=-1：「重新编辑」回填后把焦点移到表单开头（程序聚焦落点，不进 Tab 序列，故不画焦点环） -->
        <form
          id="tool-form"
          ref="formRef"
          tabindex="-1"
          class="flex-1 min-h-0 overflow-y-auto pt-12px px-12px pb-0 flex flex-col gap-12px [scrollbar-width:thin] [overscroll-behavior:contain] outline-none"
          @submit.prevent="onSubmit"
        >
          <!--
                功能卡（原型 FunctionSwitcher ml）：高 64、内边距 12 14、gap 12、1px #e9dff2、r10、白→#fbf7fe、0 1 2 α.05；
                缩略 56×40 / r6、图标 20；名称 15/20·600、说明 11/16；箭头 14 muted。整卡可点（铺满的透明按钮），悬停内容 opacity .82（无过渡）。
              -->
          <div
            :ref="setSwitcherCard"
            class="group relative flex-none flex items-center gap-12px h-64px box-border px-14px py-12px rounded-10px border border-solid border-[#e9dff2] bg-[linear-gradient(180deg,#fff_0%,#fbf7fe_100%)] shadow-[0_1px_2px_rgba(31,35,41,0.05)]"
          >
            <div
              class="min-w-0 flex-1 flex items-center gap-12px h-40px pointer-events-none group-hover:opacity-82"
              :class="switcherOpen ? 'opacity-82' : ''"
            >
              <span :class="[tileCls, 'w-56px h-40px text-violet']" aria-hidden="true">
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
                <h1 id="tool-title" class="m-0 max-w-full truncate text-15px font-600 leading-20px text-ink">
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
              class="absolute inset-0 w-full h-full p-0 rounded-10px border-none bg-transparent cursor-pointer"
              :class="focusRing"
              :aria-expanded="switcherOpen"
              aria-haspopup="dialog"
              :aria-controls="switcherOpen ? switcherId : undefined"
              aria-label="切换功能"
              @click="toggleSwitcher"
            />
          </div>
          <!-- 功能面板（原型 .fn-switch__pop.is-ml）：1px line、r10、白底、shadow-pop；出现 / 收起都是淡入 + 4px 上移 120ms ease -->
          <Teleport to="body">
            <Transition
              enter-active-class="[transition:opacity_120ms_ease,transform_120ms_ease] motion-reduce:transition-none"
              leave-active-class="[transition:opacity_120ms_ease,transform_120ms_ease] motion-reduce:transition-none"
              enter-from-class="opacity-0 translate-y-4px"
              leave-to-class="opacity-0 translate-y-4px"
            >
              <div
                v-if="switcherOpen"
                :id="switcherId"
                :ref="setSwitcherPop"
                role="dialog"
                aria-label="切换功能"
                class="fixed z-260 flex flex-col box-border overflow-hidden rounded-10px border border-solid border-line bg-white shadow-[0_12px_24px_rgba(31,35,41,0.14),0_2px_6px_rgba(31,35,41,0.06)]"
                :style="switcherStyle"
              >
                <div
                  class="flex-none flex items-center gap-8px h-44px pl-14px pr-8px shadow-[inset_0_-0.8px_0_#e5e7eb]"
                >
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
                      class="h-26px box-border px-10px rounded-4px border border-solid text-11px cursor-pointer"
                      :class="[
                        focusRing,
                        switcherKind === k.key
                          ? 'border-line bg-[linear-gradient(#fff,#f7f8f9)] shadow-[0_1px_2px_rgba(31,35,41,0.07),inset_0_1px_0_#fff] text-ink font-600'
                          : 'border-transparent bg-transparent text-muted hover:text-ink',
                      ]"
                      :aria-selected="switcherKind === k.key"
                      @click="switcherKind = k.key"
                    >
                      {{ k.catalog.title }}
                    </button>
                  </div>
                  <button
                    type="button"
                    aria-label="关闭"
                    class="relative grid h-26px w-26px place-items-center p-0 rounded-4px border-none bg-transparent text-muted cursor-pointer hover:(bg-surface3 text-ink) after:(content-[''] absolute -inset-3px)"
                    :class="focusRing"
                    @click="switcherOpen = false"
                  >
                    <svg
                      class="h-14px w-14px"
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
                  </button>
                </div>
                <div class="flex-1 min-h-0 overflow-y-auto pt-4px pb-10px [scrollbar-width:thin]">
                  <section
                    v-for="(g, gi) in switcherCatalog.groups"
                    :key="g.label"
                    :class="gi ? 'mt-2px shadow-[inset_0_0.8px_0_#eff1f3]' : ''"
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
                              ? 'border-violet-line bg-[linear-gradient(#fff,#f3edf8)] text-violet-ink'
                              : ['border-transparent text-ink-2', e.route ? 'hover:bg-surface3' : ''],
                          ]"
                          @click="e.route && (switcherOpen = false)"
                        >
                          <span
                            class="grid flex-[0_0_22px] w-22px h-22px place-items-center box-border rounded-5px border border-solid border-line bg-[linear-gradient(135deg,#f6effa,#efe6f5)] shadow-[inset_0_1px_0_#fff] text-violet"
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

          <!-- 商拍换装：服装图 / 模特图并排在一块素材板里（服装图点开弹窗选单品与角度）；仍写回 slot 0 / slot 1 -->
          <ToolTryonMaterials
            v-if="schema.uploadsView === 'tryon' && tryonSlots"
            :key="`${schema.homeId}-tryon`"
            :cloth="uploads[tryonSlots.cloth.slot] ?? []"
            :models="uploads[tryonSlots.models.slot] ?? []"
            :cloth-spec="tryonSlots.cloth"
            :model-spec="tryonSlots.models"
            :disabled="submitting"
            @update:cloth="setUploads(tryonSlots.cloth.slot, $event)"
            @update:models="setUploads(tryonSlots.models.slot, $event)"
          />
          <template
            v-for="u in schema.uploadsView === 'tryon' && tryonSlots ? [] : displayUploads"
            :key="`${schema.homeId}-${u.slot}`"
          >
            <ToolUploadSlot
              v-if="uploadEnabled(u)"
              :id="`tool-upload-${u.slot}`"
              :model-value="uploads[u.slot] ?? []"
              :spec="u"
              :layout="u.layout"
              :disabled="submitting"
              asset-picker
              @update:model-value="setUploads(u.slot, $event)"
            />
            <div v-else>
              <div class="ll-label">
                <span>{{ u.label }}</span>
              </div>
              <p class="m-0 ll-empty py-12px">{{ unsupportedUploadHint(u) }}</p>
            </div>
          </template>

          <template v-for="f in formFields" :key="`${schema.homeId}-${f.key}`">
            <!-- 涂抹蒙版 -->
            <div v-if="f.type === 'mask'">
              <div class="ll-label">
                <span>{{ f.label }}<span class="text-danger" aria-hidden="true"> *</span></span>
              </div>
              <MaskPainter v-if="singleImage" :ref="setMaskRef" :src="singleImage" @change="maskHasStroke = $event" />
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

            <!-- 识别结果（文字替换） -->
            <div v-else-if="f.type === 'region-list'">
              <div class="ll-label">
                <span id="tool-regions-label">{{ f.label }}<span class="text-danger" aria-hidden="true"> *</span></span>
                <button
                  type="button"
                  class="ll-pill"
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
                  class="tool-skeleton-row h-70px box-border rounded-8px bg-surface2"
                  aria-hidden="true"
                />
              </ul>
              <p v-else-if="!regions.length" class="m-0 ll-empty py-12px">
                {{ singleImage ? '点击「识别文字」，识别结果会列在这里（识别单独计费）' : '先上传原图' }}
              </p>
              <ul v-else class="m-0 p-0 list-none flex flex-col gap-8px" aria-labelledby="tool-regions-label">
                <li v-for="(r, i) in regions" :key="i" class="rounded-8px border border-solid border-line p-8px">
                  <label class="flex items-center gap-6px text-12px text-muted">
                    <input v-model="r.include" type="checkbox" class="accent-violet" />
                    <span class="truncate">原文：{{ r.targetText }}</span>
                  </label>
                  <input
                    v-model="r.text"
                    type="text"
                    :maxlength="f.maxLength"
                    :disabled="!r.include"
                    :aria-label="`替换「${r.targetText}」为`"
                    :class="[inputCls, 'mt-6px']"
                  />
                </li>
              </ul>
            </div>

            <!-- 配音音色 -->
            <div v-else-if="f.type === 'voice'">
              <div class="ll-label">
                <label :for="`tool-field-${f.key}`"
                  >{{ f.label }}<span class="text-danger" aria-hidden="true"> *</span></label
                >
                <button
                  v-if="schema.actions.includes('试听') && auditionUrl"
                  type="button"
                  class="ll-link border-none bg-transparent p-0"
                  :class="focusRing"
                  @click="playAudition"
                >
                  试听
                </button>
              </div>
              <select :id="`tool-field-${f.key}`" v-model="values[f.key]" :class="inputCls" :disabled="!voices.length">
                <option v-if="!voices.length" :value="undefined">
                  {{ voicesLoaded ? '暂无可用音色' : '加载中…' }}
                </option>
                <option v-for="v in voices" :key="v.voiceId" :value="v.voiceId">{{ v.voiceName }}</option>
              </select>
            </div>

            <!-- 胶囊单选 -->
            <div v-else-if="f.type === 'chips'">
              <div :id="`tool-field-${f.key}-label`" class="ll-label">
                <span>{{ f.label }}<span v-if="f.required" class="text-danger" aria-hidden="true"> *</span></span>
              </div>
              <div role="radiogroup" :aria-labelledby="`tool-field-${f.key}-label`" class="flex flex-wrap gap-6px">
                <button
                  v-for="opt in fieldOptions(f)"
                  :key="opt.value"
                  type="button"
                  role="radio"
                  :aria-checked="values[f.key] === opt.value"
                  class="ll-pill"
                  :class="[focusRing, values[f.key] === opt.value ? 'll-pill-active' : '']"
                  @click="values[f.key] = opt.value"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>

            <!-- 下拉 -->
            <div v-else-if="f.type === 'select'">
              <div class="ll-label">
                <label :for="`tool-field-${f.key}`">
                  {{ f.label }}<span v-if="f.required" class="text-danger" aria-hidden="true"> *</span>
                </label>
              </div>
              <select
                :id="`tool-field-${f.key}`"
                v-model="values[f.key]"
                :class="inputCls"
                :disabled="!fieldOptions(f).length"
              >
                <option v-if="!fieldOptions(f).length" :value="undefined">
                  {{ !f.dynamic || videoModelsLoaded ? `暂无可用${f.label}` : '加载中…' }}
                </option>
                <option v-for="opt in fieldOptions(f)" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
            </div>

            <!-- 多行文本 -->
            <CreationPromptInput
              v-else-if="f.type === 'textarea'"
              :id="`tool-field-${f.key}`"
              v-model="values[f.key]"
              :label="f.label"
              :required="f.required"
              :rows="5"
              :max-length="f.maxLength"
              :placeholder="f.placeholder ?? `请输入${f.label}`"
            />

            <!-- 数字 / 张数 -->
            <div v-else-if="f.type === 'number' || f.type === 'stepper'">
              <div class="ll-label">
                <label :for="`tool-field-${f.key}`">
                  {{ f.label }}<span v-if="f.required" class="text-danger" aria-hidden="true"> *</span>
                </label>
                <span class="text-12px text-placeholder">{{ f.min }}–{{ f.max }}</span>
              </div>
              <input
                :id="`tool-field-${f.key}`"
                v-model.number="values[f.key]"
                type="number"
                :min="f.min"
                :max="f.max"
                step="1"
                :class="inputCls"
                @change="clampNumber(f)"
              />
            </div>

            <!-- 开关 -->
            <div v-else-if="f.type === 'switch'" class="flex items-center justify-between">
              <span :id="`tool-field-${f.key}-label`" class="text-13px text-ink-2">{{ f.label }}</span>
              <button
                type="button"
                role="switch"
                :aria-checked="!!values[f.key]"
                :aria-labelledby="`tool-field-${f.key}-label`"
                class="relative flex-none w-34px h-20px box-border p-0 rounded-full border border-solid cursor-pointer [transition:background_180ms_cubic-bezier(0.2,0.7,0.2,1),border-color_180ms_cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none"
                :class="[
                  focusRing,
                  values[f.key]
                    ? 'border-violet-border bg-[linear-gradient(#8a639f,#7a548c)]'
                    : 'border-#c9cfd6 bg-[linear-gradient(#f3f4f5,#fafbfc)] shadow-[inset_0_1px_2px_rgba(31,35,41,0.055)]',
                ]"
                @click="values[f.key] = !values[f.key]"
              >
                <!-- 液态开关 sm 档（原型 SxLiquidSwitch）：34×20、滑块 14 -->
                <span
                  class="absolute top-2px w-14px h-14px rounded-full bg-white shadow-[0_1px_3px_rgba(31,35,41,0.2)] [transition:left_180ms_cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none"
                  :class="values[f.key] ? 'left-16px' : 'left-2px'"
                  aria-hidden="true"
                />
              </button>
            </div>
          </template>
        </form>

        <!--
          底部固定栏（原型参数行 + ToolSubmitBar ml 版）：参数行高 44，与提交按钮间距 8；栏内边距 0 12 12（上沿间距由表单 gap 给）。
          只有一个档位字段（如高清放大的清晰度）时照原型 ChoiceFieldButton inline：一张 .sx-btn 材质卡，左图标 + 名称，右侧直接是分段片；
          多个设置字段仍收进「图片设置 / 视频设置」弹层（共用 CreationSettingsRow）。
          提交按钮整宽 56、r10、内边距 0 12、行距 3，第一行 16/22·600·0.04em，第二行「消耗 N 点」11 白色 74%；加载环在左 14。
          余额与原因不再单占一行（原型 ml：按钮之外不放信息行）：原因写在按钮 title 上并给读屏（aria-describedby）。
        -->
        <div class="flex-none flex flex-col gap-8px pt-12px px-12px pb-12px">
          <div
            v-if="inlineSetting"
            class="flex items-center gap-6px w-full h-44px box-border pl-11px pr-3px rounded-6px border border-solid border-#c9cfd6 bg-[linear-gradient(#fff,#fbfcfc)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(31,35,41,0.04),0_1px_2px_rgba(31,35,41,0.05)]"
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
            <span :id="`tool-inline-${inlineSetting.key}`" class="flex-none text-11px leading-16px text-muted">
              {{ inlineSetting.label }}
            </span>
            <!-- 分段片（原型 .sx-seg--picker）：轨道 1px line、r6、#f3f4f5、内边距 3、gap 2、inset-input；
                   片高 30、内边距 0 14、r4、11px；选中 = 柔紫线 + 白→#f8f3fc + 紫字 600；切换 300ms cubic-bezier(.4,0,.2,1)；按下内凹短影 -->
            <div
              role="radiogroup"
              :aria-labelledby="`tool-inline-${inlineSetting.key}`"
              class="ml-auto inline-flex flex-none gap-2px p-3px box-border rounded-6px border border-solid border-line bg-surface3 shadow-[inset_0_1px_2px_rgba(31,35,41,0.055),inset_0_0_0_1px_rgba(255,255,255,0.7)]"
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
                class="h-30px box-border px-14px rounded-4px border border-solid text-11px tabular-nums cursor-pointer [transition:border-color_300ms_cubic-bezier(0.4,0,0.2,1),background-color_300ms_cubic-bezier(0.4,0,0.2,1),box-shadow_300ms_cubic-bezier(0.4,0,0.2,1),color_300ms_cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none active:enabled:shadow-[inset_0_1px_2px_rgba(80,55,95,0.16)] disabled:(opacity-45 cursor-not-allowed)"
                :class="[
                  focusRing,
                  values[inlineSetting.key] === opt.value
                    ? 'border-violet-line bg-[linear-gradient(180deg,#fff_0%,#f8f3fc_100%)] shadow-[0_1px_2px_rgba(31,35,41,0.05)] text-violet-ink font-600'
                    : 'border-transparent bg-transparent text-muted hover:text-ink',
                ]"
                @click="values[inlineSetting.key] = opt.value"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>
          <CreationSettingsRow v-else-if="settingItems.length" :items="settingItems" :disabled="submitting">
            <template #settings>
              <CreationImageSettings
                :model-value="settingsValue"
                :fields="settingsConfig"
                @update:model-value="onSettings"
              />
            </template>
          </CreationSettingsRow>
          <p v-if="disabledReason" :id="reasonId" class="sr-only" aria-live="polite">{{ disabledReason }}</p>
          <button
            type="submit"
            form="tool-form"
            class="relative flex flex-col items-center justify-center gap-3px w-full h-56px box-border py-0 px-12px rounded-10px border border-solid text-white font-600 select-none [transition:background_0.11s_cubic-bezier(0.2,0.7,0.2,1),border-color_0.11s,box-shadow_0.11s,color_0.11s] motion-reduce:transition-none"
            :class="[
              focusRing,
              submitting
                ? 'border-#5f3f6f bg-[linear-gradient(#7a548c,#6b487c)] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_1px_rgba(90,60,110,0.18),0_2px_4px_rgba(90,60,110,0.18)] cursor-progress'
                : disabledReason
                  ? 'border-violet-line bg-#cbb9d5 shadow-none cursor-not-allowed'
                  : 'border-violet-border bg-[linear-gradient(#8a639f,#7a548c)] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_1px_rgba(90,60,110,0.18),0_2px_4px_rgba(90,60,110,0.18)] cursor-pointer hover:(border-#5f3f6f bg-[linear-gradient(#9a6fae,#875c9a)]) active:(border-#5c3d6b bg-none bg-violet-press shadow-[inset_0_1px_3px_rgba(40,24,48,0.35)])',
            ]"
            :disabled="!!disabledReason || submitting"
            :title="disabledReason || undefined"
            :aria-busy="submitting || undefined"
            :aria-describedby="disabledReason ? reasonId : undefined"
          >
            <!-- 加载环（原型 .sx-btn__spinner）：12 / 1.5px，绝对定位在左 14，不参与排版 -->
            <span
              v-if="submitting"
              class="absolute left-14px top-1/2 -mt-6px block w-12px h-12px box-border rounded-full border-1.5px border-solid border-white/35 border-t-white animate-spin [animation-duration:0.7s] motion-reduce:animate-none"
              aria-hidden="true"
            />
            <span
              class="text-16px leading-22px tracking-[0.04em] whitespace-nowrap"
              :class="!submitting && disabledReason ? 'text-white/80' : 'text-white'"
            >
              {{ submitting ? '提交中…' : submitLabel }}
            </span>
            <span class="text-11px leading-11px text-white/74 whitespace-nowrap" aria-live="polite">
              <template v-if="'num' in costLine"
                >消耗 <b class="font-900 tabular-nums">{{ costLine.num }}</b
                >{{ costLine.suffix }}</template
              >
              <template v-else>{{ costLine.text }}</template>
            </span>
          </button>
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
          class="flex-none min-h-65px box-border flex items-center gap-8px px-10px py-10px rounded-8px border border-dashed border-line-strong bg-[linear-gradient(#fff,#f7f8f9)]"
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
              :class="[inputCls, '!h-30px !pl-27px !pr-8px !text-11px']"
            />
          </div>

          <ul class="m-0 -mx-4px px-4px pt-2px pb-10px list-none gap-8px flex-1 min-h-0 overflow-y-auto flex flex-col">
            <li v-for="item in historyPaged" :key="item.aiToolHistoryId">
              <!-- 历史卡：内边距 10、gap 10、1px line、r10、白底；hover 描边 #c9cfd6 + 短影；选中 violet-line + 白→#f8f3fc -->
              <div
                class="group relative flex items-center gap-10px box-border p-10px rounded-10px border border-solid [transition:border-color_110ms,background_110ms,box-shadow_110ms] motion-reduce:transition-none"
                :class="
                  current?.aiToolHistoryId === item.aiToolHistoryId && !showSync
                    ? 'border-violet-line bg-[linear-gradient(180deg,#ffffff_0%,#f8f3fc_100%)] shadow-[0_1px_2px_rgba(31,35,41,0.05)]'
                    : 'border-line bg-white hover:(border-#c9cfd6 shadow-[0_1px_2px_rgba(31,35,41,0.05)])'
                "
              >
                <!-- 整卡选中：铺满的透明按钮（卡内还有操作按钮，按钮里不能再套按钮） -->
                <button
                  type="button"
                  class="absolute inset-0 w-full h-full p-0 rounded-10px border-none bg-transparent cursor-pointer"
                  :class="focusRing"
                  :aria-pressed="current?.aiToolHistoryId === item.aiToolHistoryId && !showSync"
                  :aria-label="`${formatTime(item.createdAt)} ${statusOf(item.status).text}：${promptOf(item)}`"
                  @click="selectedId = item.aiToolHistoryId"
                />
                <!--
                  进行中：骨架卡（原型 .v3-hist__skeleton-*）：缩略 44 / r6 + 三条 10 高 r4 线（82% / 64% / 38% 贴底），
                  #f1f2f4→#f8f9fa 扫光 1.2s ease-in-out 循环；状态在整卡按钮的读屏名与结果列里
                -->
                <template v-if="!isTerminal(item.status)">
                  <span :class="[shimmerCls, 'flex-none w-44px h-44px rounded-6px']" aria-hidden="true" />
                  <span
                    class="min-w-0 flex-1 self-stretch flex flex-col gap-6px pointer-events-none"
                    aria-hidden="true"
                  >
                    <span :class="[shimmerCls, 'block w-[82%] h-10px rounded-4px']" />
                    <span :class="[shimmerCls, 'block w-[64%] h-10px rounded-4px']" />
                    <span :class="[shimmerCls, 'block w-[38%] h-10px mt-auto rounded-4px']" />
                  </span>
                </template>
                <template v-else>
                  <!-- 缩略 44 / r6；多张用 3/6px 偏移叠影表示，张数角标高 16、10px -->
                  <span
                    class="relative flex-none grid place-items-center w-44px h-44px box-border rounded-6px border border-solid border-line bg-surface3 text-placeholder pointer-events-none"
                    :class="
                      stackOf(item).length >= 3
                        ? 'shadow-[3px_-3px_0_-1px_#fff,3px_-3px_0_0_#e5e7eb,6px_-6px_0_-1px_#fff,6px_-6px_0_0_#e5e7eb]'
                        : stackOf(item).length === 2
                          ? 'shadow-[3px_-3px_0_-1px_#fff,3px_-3px_0_0_#e5e7eb]'
                          : ''
                    "
                    aria-hidden="true"
                  >
                    <img
                      v-if="stackOf(item)[0]"
                      :src="stackOf(item)[0]"
                      alt=""
                      class="absolute inset-0 block h-full w-full rounded-5px object-cover object-center"
                    />
                    <span v-else class="text-11px">{{ schema.media === 'video' ? '视频' : '—' }}</span>
                    <span
                      v-if="stackOf(item).length > 1"
                      class="absolute z-2 -top-4px -right-4px grid min-w-16px h-16px box-border place-items-center px-4px rounded-full border border-solid border-white bg-ink text-10px font-600 leading-none text-white"
                      >{{ stackOf(item).length }}</span
                    >
                  </span>
                  <span class="min-w-0 flex-1 flex flex-col justify-between gap-6px pointer-events-none">
                    <span
                      class="m-0 line-clamp-2 text-12px leading-18px"
                      :class="item.status === 'SUCCEED' ? 'text-ink' : 'text-danger'"
                      :title="promptOf(item)"
                    >
                      <template v-if="item.status !== 'SUCCEED'">{{ statusOf(item.status).text }} · </template
                      >{{ promptOf(item) }}
                    </span>
                    <span class="flex items-center gap-4px min-w-0">
                      <span class="flex-none text-11px leading-16px text-muted tabular-nums whitespace-nowrap">{{
                        shortTime(item.createdAt)
                      }}</span>
                      <!-- 操作钮 20×20 / r4，跟在时间后面；压在整卡按钮之上 -->
                      <span class="relative z-1 ml-auto flex items-center pointer-events-auto">
                        <!-- 原型 v3-hist__acts 顺序：下载 · 删除 · 重新编辑；20×20 / r4，悬停 #f3f4f5 + ink，删除悬停 #fdf1f0 + #b4433e -->
                        <a
                          v-if="firstOutput(item)"
                          :href="firstOutput(item)"
                          target="_blank"
                          rel="noopener"
                          download
                          class="grid place-items-center w-20px h-20px rounded-4px text-muted no-underline hover:(bg-surface3 text-ink)"
                          :class="focusRing"
                          :aria-label="`下载 ${formatTime(item.createdAt)} 的结果`"
                          title="下载"
                        >
                          <svg
                            class="w-13px h-13px"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.8"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
                          </svg>
                        </a>
                        <button
                          type="button"
                          class="grid place-items-center w-20px h-20px p-0 rounded-4px border-none bg-transparent text-muted cursor-pointer hover:(bg-#fdf1f0 text-#b4433e)"
                          :class="focusRing"
                          :aria-label="`删除 ${formatTime(item.createdAt)} 的记录`"
                          title="删除"
                          @click="confirmDelete(item)"
                        >
                          <svg
                            class="w-13px h-13px"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.8"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
                          </svg>
                        </button>
                        <!-- 重新编辑：老记录（无 requestParams）用 aria-disabled 而非 disabled，仍可聚焦、悬停能看到原因 -->
                        <button
                          type="button"
                          class="grid place-items-center w-20px h-20px p-0 rounded-4px border-none bg-transparent text-muted"
                          :class="[
                            focusRing,
                            item.requestParams && !submitting
                              ? 'cursor-pointer hover:(bg-surface3 text-ink)'
                              : 'opacity-40 cursor-not-allowed',
                          ]"
                          :aria-disabled="item.requestParams && !submitting ? undefined : 'true'"
                          :aria-label="item.requestParams ? '重新编辑' : `重新编辑（${RESTORE_DISABLED_TIP}）`"
                          :title="item.requestParams ? '重新编辑' : RESTORE_DISABLED_TIP"
                          @click="restoreFrom(item)"
                        >
                          <svg
                            class="w-13px h-13px"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.8"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
                          </svg>
                        </button>
                      </span>
                    </span>
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
                        'self-start h-28px px-8px rounded-4px text-11px leading-26px no-underline',
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
                        'self-start h-28px px-8px rounded-4px text-11px leading-26px no-underline',
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
              class="col-span-full flex flex-col items-center justify-center gap-5px h-65px box-border px-10px rounded-8px border border-dashed border-line-strong bg-[linear-gradient(#fff,#f7f8f9)] text-center"
            >
              <b class="text-13px font-600 leading-18px text-ink-2">没有匹配的记录</b>
              <span class="text-11px leading-15px text-muted">换个关键词再试</span>
            </li>
          </ul>

          <div class="flex-none flex items-center justify-center gap-10px pt-8px pb-2px">
            <button
              type="button"
              class="grid place-items-center w-26px h-26px box-border p-0 rounded-4px border border-solid border-line bg-white text-ink-2 cursor-pointer enabled:hover:(border-#c9cfd6 text-ink) disabled:(opacity-40 cursor-default)"
              :class="focusRing"
              :disabled="historyPage <= 1"
              aria-label="上一页"
              @click="historyPage -= 1"
            >
              <svg
                class="w-14px h-14px"
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
            </button>
            <span class="text-11px leading-16px text-muted tabular-nums" aria-live="polite"
              >{{ historyPage }} / {{ historyPages }}</span
            >
            <button
              type="button"
              class="grid place-items-center w-26px h-26px box-border p-0 rounded-4px border border-solid border-line bg-white text-ink-2 cursor-pointer enabled:hover:(border-#c9cfd6 text-ink) disabled:(opacity-40 cursor-default)"
              :class="focusRing"
              :disabled="historyPage >= historyPages"
              aria-label="下一页"
              @click="historyPage += 1"
            >
              <svg
                class="w-14px h-14px"
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
            </button>
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
          class="ll-card flex-1 min-h-0 min-w-0 flex flex-col gap-10px box-border overflow-hidden p-12px"
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
            <span class="min-w-0 max-w-240px truncate text-11px leading-16px text-placeholder" :title="schema.title">{{
              schema.title
            }}</span>
            <div
              v-if="canCompare"
              class="flex-none ml-auto flex p-2px box-border rounded-6px border border-solid border-line bg-surface3 shadow-[inset_0_1px_2px_rgba(31,35,41,0.055),inset_0_0_0_1px_rgba(255,255,255,0.7)]"
              role="group"
              aria-label="查看方式"
            >
              <button
                v-for="m in [
                  { key: 'result', label: '结果' },
                  { key: 'compare', label: '前后对比' },
                ] as const"
                :key="m.key"
                type="button"
                class="h-26px box-border px-10px rounded-4px border border-solid text-11px leading-24px cursor-pointer [transition:background_300ms_cubic-bezier(0.4,0,0.2,1),border-color_300ms_cubic-bezier(0.4,0,0.2,1),color_300ms_cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
                :class="[
                  focusRing,
                  resultMode === m.key
                    ? 'border-violet-line bg-[linear-gradient(180deg,#ffffff_0%,#f8f3fc_100%)] font-600 text-violet-ink shadow-[0_1px_2px_rgba(31,35,41,0.05)]'
                    : 'border-transparent bg-transparent font-400 text-muted hover:text-ink',
                ]"
                :aria-pressed="resultMode === m.key"
                @click="resultMode = m.key"
              >
                {{ m.label }}
              </button>
            </div>
            <a
              v-if="selectedProduct"
              :href="selectedProduct.src"
              target="_blank"
              rel="noopener"
              download
              class="flex-none grid place-items-center w-32px h-32px p-0 box-border rounded-4px no-underline border border-solid border-#c9cfd6 bg-[linear-gradient(#fff,#fbfcfc)] text-ink-2 cursor-pointer shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(31,35,41,0.04),0_1px_2px_rgba(31,35,41,0.05)] [transition:background_110ms,box-shadow_110ms,border-color_110ms] motion-reduce:transition-none hover:(border-#aeb6bf bg-none bg-surface3 text-ink) active:(bg-none bg-#e9ecef shadow-[inset_0_1px_2px_rgba(31,35,41,0.12),inset_0_0_0_1px_rgba(31,35,41,0.03)])"
              :class="[focusRing, canCompare ? '' : 'ml-auto']"
              :aria-label="selectedProduct.type === 'video' ? '下载视频' : '下载结果'"
              title="下载"
            >
              <svg
                class="w-16px h-16px"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
              </svg>
            </a>
          </div>

          <!-- 前后对比：高 min(62vh,640)、最小 320、r8 -->
          <div
            v-if="canCompare && resultMode === 'compare'"
            class="relative flex-none h-[min(62vh,640px)] min-h-320px overflow-hidden rounded-8px bg-surface3"
          >
            <ToolImageCompare
              :before="compareBefore"
              :after="compareAfter"
              :labels="['输入图', '生成结果']"
              aria-label="输入图与生成结果前后对比"
            />
          </div>

          <!-- 结果舞台：产物绝对定位 contain 居中；图片点开灯箱，视频用原生控件 -->
          <div
            v-else-if="selectedProduct"
            :class="[stageCls, 'flex-1 min-h-320px max-[1439px]:(flex-none h-[min(52vh,480px)])']"
          >
            <img
              v-if="selectedProduct.type === 'image'"
              :src="selectedProduct.src"
              :alt="selectedProduct.name"
              class="absolute inset-0 block m-auto max-w-full max-h-full object-contain cursor-zoom-in"
              :class="focusRing"
              role="button"
              tabindex="0"
              title="点击放大"
              aria-label="放大查看生成结果"
              @click="openLightbox"
              @keydown.enter.prevent="openLightbox"
              @keydown.space.prevent="openLightbox"
            />
            <video
              v-else
              :key="selectedProduct.src"
              :src="selectedProduct.src"
              controls
              playsinline
              class="absolute inset-0 block m-auto max-w-full max-h-full object-contain"
            />
          </div>

          <!-- 生成中：34 圆转圈（2px 环、800ms 一圈）+ 文案 11px -->
          <div
            v-else-if="current && !isTerminal(current.status)"
            :class="[resultEmptyCls, '!gap-8px']"
            role="status"
            aria-live="polite"
          >
            <span
              class="block w-34px h-34px mb-2px box-border rounded-full border-2 border-solid border-violet-soft border-t-violet animate-spin [animation-duration:800ms] motion-reduce:animate-none"
              aria-hidden="true"
            />
            <b class="text-13px font-600 leading-[1.4] text-ink-2">正在生成</b>
            <span class="max-w-240px">任务进行中，结果出来后会自动显示</span>
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
            <button
              v-for="(item, i) in products"
              :key="`${item.src}-${i}`"
              type="button"
              class="relative overflow-hidden aspect-square box-border p-0 rounded-4px border border-solid bg-surface3 cursor-pointer"
              :class="[
                focusRing,
                selectedIndex === i ? 'border-violet shadow-[0_0_0_1px_#875f9a]' : 'border-line hover:border-#c9cfd6',
              ]"
              :aria-label="`候选 ${i + 1}`"
              :aria-pressed="selectedIndex === i"
              @click="selectedIndex = i"
            >
              <img
                v-if="item.type === 'image'"
                :src="item.src"
                :alt="`候选 ${i + 1}`"
                class="block w-full h-full object-cover"
                draggable="false"
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
          </div>

          <p
            v-if="history.running.value && !(current && !isTerminal(current.status))"
            class="flex-none m-0 text-11px leading-16px text-muted"
          >
            还有 {{ history.running.value }} 个任务处理中，完成后会补进中间那一列
          </p>
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
          <p class="m-0 text-13px leading-[1.65] text-ink-2">{{ schema.description }}</p>
          <div
            v-if="schema.scenarios?.length"
            class="flex flex-col gap-[5.5px] p-10px rounded-6px border border-solid border-line-soft bg-surface2"
          >
            <h3 id="tool-intro-scenes" class="m-0 text-13px font-500 leading-[1.55] text-ink">适用场景</h3>
            <ul
              class="m-0 p-0 list-none flex flex-col gap-[5.5px] text-13px leading-[1.55] text-ink-2"
              aria-labelledby="tool-intro-scenes"
            >
              <li v-for="s in schema.scenarios" :key="s">{{ s }}</li>
            </ul>
          </div>
          <ol v-else class="m-0 pl-18px text-12px leading-20px text-muted">
            <li v-for="step in schema.steps" :key="step">{{ step }}</li>
          </ol>
        </section>
      </div>
    </div>

    <ToolMediaPreview v-model:open="lightboxOpen" v-model:index="lightboxIndex" :items="products" />
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
