<script setup lang="ts">
/**
 * 工具箱共用工具页 /tools/:toolId（12 个工具按 schemas.ts 渲染）。
 *
 * <p>版式对齐新版原型（工具详情页）：贴边目录栏 160（可收起）/ 操作 460（工具头卡 + 上传 + 参数，自己滚，
 * 底部固定提交栏）/ 历史 224 / 结果卡 + 功能介绍卡。操作栏内边距 13，正好放下 s1.1 的 B3.1 上传卡 434×742。
 * 阴影、渐变、过渡时长照抄原型计算样式。提交打 Java v1 现有路由（schema.javaRoute），请求体按 schema 的
 * javaKey 映射组装；结果与历史都取 GET /api/v1/tools/{toolTitle}/histories（异步工具只回任务号）。
 */
import { computed, nextTick, onBeforeUnmount, reactive, ref, useId, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { NPopover, useDialog, useMessage } from 'naive-ui'
import { toApiError } from '@/api/index.ts'
import { upload } from '@/api/ossUpload.ts'
import {
  bizPoints,
  submitCutout,
  submitTool,
  toolOcr,
  voiceList,
  type ToolHistoryItem,
  type VoiceItem,
} from '@/api/tools.ts'
import { useUserInfoStore } from '@/stores/userInfo'
import { findToolSchema, isFieldVisible, toJavaValue, type ToolField, type ToolSchema } from './schemas'
import { catalogFor } from './catalog'
import { isTerminal, useToolHistory } from './useToolHistory'
import ToolUploadSlot from './ToolUploadSlot.vue'
import MaskPainter from './MaskPainter.vue'
import PollingOfflineBanner from './PollingOfflineBanner.vue'
import CreationImageSettings from '@/components/creation/CreationImageSettings.vue'
import CreationSettingsRow from '@/components/creation/CreationSettingsRow.vue'
import CreationPromptInput from '@/components/creation/CreationPromptInput.vue'
import CreationActionBar from '@/components/creation/CreationActionBar.vue'
import {
  creationSettingsSummary,
  toCreationOptions,
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
/** 头卡右侧 chevron 展开的功能说明 */
const introOpen = ref(false)

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

// ---------------- 表单状态 ----------------

const uploads = reactive<Record<number, string[]>>({})
const values = reactive<Record<string, any>>({})
const maskRef = ref<InstanceType<typeof MaskPainter> | null>(null)
const maskHasStroke = ref(false)
const regions = ref<Region[]>([])
const ocrLoading = ref(false)
const voices = ref<VoiceItem[]>([])
const voicesLoaded = ref(false)
const submitting = ref(false)
const progressText = ref('')
/** 同步抠图本次直接拿到的结果 */
const syncResultUrl = ref('')
const selectedId = ref<number | null>(null)

const history = useToolHistory(() => schema.value?.historyTitle ?? '')

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

function resetForm(s: ToolSchema) {
  for (const key of Object.keys(uploads)) delete uploads[Number(key)]
  for (const key of Object.keys(values)) delete values[key]
  for (const u of s.uploads) uploads[u.slot] = []
  for (const f of s.fields) if (f.default !== undefined) values[f.key] = f.default
  maskHasStroke.value = false
  regions.value = []
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
  },
  { immediate: true },
)

const visibleFields = computed(() => (schema.value?.fields ?? []).filter((f) => isFieldVisible(f, values)))
/** 上传槽位的显示顺序：s1.1 产品替换「替换素材」在上、底图片格在下（只换显示顺序，校验与提交仍按 schema 顺序） */
const displayUploads = computed(() =>
  [...(schema.value?.uploads ?? [])].sort((a, b) => Number(b.layout === 'material') - Number(a.layout === 'material')),
)
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
            : toCreationOptions(f.options ?? []),
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

// compact 版式的设置行与弹层（原型「视频设置 1080P ▾」→ 弹层标题「视频设置」+「目标分辨率」分段选择）
const settingsOpen = ref(false)
const settingsPopId = `tool-settings-${useId()}`
const reasonId = `tool-submit-reason-${useId()}`
/** lucide settings 线稿（与共用设置行同一枚） */
const GEAR_PATHS = [
  'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
  'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
]
function setSettingsOpen(show: boolean) {
  if (show && submitting.value) return
  settingsOpen.value = show
}
function pickSetting(key: string, value: unknown) {
  values[key] = value
}

// 换图后蒙版与识别结果都作废
watch(singleImage, () => {
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
  if (url && hasRegionField.value) void runOcr()
})

// ---------------- 就绪判定 ----------------

const disabledReason = computed(() => {
  const s = schema.value
  if (!s) return ''
  for (const u of s.uploads) {
    if (u.required && !uploads[u.slot]?.length) return `还没上传${u.label.replace(/（.*）/, '')}`
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
    if (f.type === 'voice') {
      if (!selectedVoice.value) return voicesLoaded.value && !voices.value.length ? '暂无可用音色' : '请选择配音音色'
      continue
    }
    const v = values[f.key]
    if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) return `请填写${f.label}`
  }
  return ''
})

/** 本次会拆成几次提交（单值键多张 = 逐张提交） */
const fanOutCount = computed(() => {
  const s = schema.value
  if (!s) return 0
  const fan = s.uploads.find((u) => u.javaKey !== 'imageUrls' && u.max > 1)
  return fan ? Math.max(uploads[fan.slot]?.length ?? 0, 1) : 1
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
  const value = toJavaValue(f, values[f.key])
  return value === undefined || typeof f.javaKey !== 'string' ? [] : [[f.javaKey, value]]
}

async function buildBodies(s: ToolSchema): Promise<Record<string, unknown>[]> {
  const base: Record<string, unknown> = {}
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
    if (!urls.length) continue
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

function thumbOf(item: ToolHistoryItem) {
  const out = outputsOf(item)
  return out.images[0] ?? item.inputImageUrls?.[0] ?? item.payload?.imageUrls?.[0] ?? ''
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

const HISTORY_EMPTY_HINT = '左边传好素材、点底部按钮提交，每次生成都会在这里留一条'
/** 图标框（目录条目 / 头卡）：135° 柔紫渐变 + 顶 1px 白内线 */
const tileCls =
  'flex-none grid place-items-center box-border rounded-8px border border-solid border-violet-soft-2 ' +
  'bg-[linear-gradient(135deg,#f6effa,#efe6f5)] shadow-[inset_0_1px_0_#fff]'
/** 透明底棋盘格：原型 4 道 45° 渐变，8px 一格，α.06 */
const checkerCls =
  'bg-page bg-[linear-gradient(45deg,rgba(31,35,41,0.06)_25%,transparent_25%),linear-gradient(-45deg,rgba(31,35,41,0.06)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,rgba(31,35,41,0.06)_75%),linear-gradient(-45deg,transparent_75%,rgba(31,35,41,0.06)_75%)] ' +
  'bg-[length:16px_16px] [background-position:0_0,0_8px,8px_-8px,-8px_0]'

const focusRing = 'outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)'
const inputCls =
  'w-full box-border rounded-6px border border-solid border-line-strong bg-white px-10px py-7px text-13px text-ink ' +
  'focus:(border-violet outline-none shadow-[0_0_0_2px_rgba(135,95,154,0.18)])'
</script>

<template>
  <div v-if="!schema" class="h-full flex flex-col items-center justify-center gap-12px bg-page">
    <p class="m-0 text-15px text-ink">没有找到这个工具</p>
    <RouterLink to="/" class="ll-link" :class="focusRing">返回工具箱</RouterLink>
  </div>

  <div v-else class="relative flex h-full min-h-0 bg-page">
    <!-- 断网提示条：浏览器离线或连续网络失败暂停轮询时出现（与创作页同一份） -->
    <PollingOfflineBanner :show="history.offline.value" @retry="history.retryPolling()" />
    <!-- 目录：原型左栏（贴边白栏 + 右侧 10px 柔影，可收起成只剩图标）；没有页面的条目显示「即将开放」 -->
    <nav
      class="relative z-1 flex-none flex min-h-0 flex-col bg-white shadow-[10px_0_16px_-12px_rgba(31,35,41,0.22)] [transition:width_0.2s_ease,flex-basis_0.2s_ease] motion-reduce:transition-none"
      :class="catalogCollapsed ? 'w-60px basis-60px' : 'w-160px basis-160px'"
      aria-labelledby="tool-catalog-title"
    >
      <div
        class="flex-none flex items-center h-48px"
        :class="catalogCollapsed ? 'justify-center' : 'justify-between pl-15px pr-10px'"
      >
        <h2
          id="tool-catalog-title"
          class="m-0 truncate text-16px font-600 leading-[1.55] text-ink"
          :class="catalogCollapsed ? 'sr-only' : ''"
        >
          {{ catalog.title }}
        </h2>
        <button
          type="button"
          class="flex-none grid place-items-center w-24px h-24px p-0 rounded-6px border-none bg-transparent text-placeholder cursor-pointer transition-colors hover:(bg-surface2 text-ink)"
          :class="focusRing"
          :aria-expanded="!catalogCollapsed"
          aria-controls="tool-catalog-list"
          :aria-label="catalogCollapsed ? '展开目录' : '收起目录'"
          @click="catalogCollapsed = !catalogCollapsed"
        >
          <svg
            class="w-14px h-14px"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M4 6.5h16M4 12h16M4 17.5h16" />
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
        <div
          id="tool-catalog-list"
          ref="catalogScroll"
          class="h-full overflow-y-auto pl-7px pr-6px pb-10px"
          @scroll="updateFades"
        >
          <section
            v-for="(g, gi) in catalog.groups"
            :key="g.label"
            :class="
              gi ? 'mt-16px pt-10px shadow-[inset_0_0.8px_0_#efefef,inset_0_2px_3px_-2px_rgba(31,35,41,0.1)]' : ''
            "
            :aria-labelledby="`tool-catalog-group-${gi}`"
          >
            <h3
              :id="`tool-catalog-group-${gi}`"
              class="m-0 px-8px py-[4.7px] text-12px font-600 leading-[1.55] text-muted"
              :class="catalogCollapsed ? 'sr-only' : ''"
            >
              {{ g.label }}
            </h3>
            <ul class="m-0 p-0 list-none flex flex-col">
              <li v-for="e in g.entries" :key="e.id">
                <component
                  :is="e.route ? RouterLink : 'div'"
                  v-bind="
                    e.route
                      ? { to: e.route, 'aria-current': e.id === toolId ? 'page' : undefined }
                      : { 'aria-disabled': 'true' }
                  "
                  :aria-label="e.route ? `${e.name}，${e.tagline}` : `${e.name}（即将开放）`"
                  :title="catalogCollapsed ? e.name : e.route ? undefined : '即将开放'"
                  class="flex items-center gap-10px py-5px rounded-8px border border-solid no-underline transition-colors"
                  :class="[
                    catalogCollapsed ? 'justify-center px-0' : 'pl-19px pr-8px',
                    e.route ? focusRing : 'cursor-not-allowed',
                    e.id === toolId
                      ? 'border-line bg-[linear-gradient(#f3f4f5,#fafbfc)] shadow-[inset_0_1px_3px_rgba(31,35,41,0.1),inset_0_-1px_0_#fff]'
                      : e.route
                        ? 'border-transparent hover:bg-surface2'
                        : 'border-transparent',
                  ]"
                >
                  <span
                    :class="[tileCls, 'w-36px h-36px', e.route ? 'text-violet-ink' : 'text-muted opacity-60']"
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
                  <span v-if="!catalogCollapsed" class="min-w-0 flex flex-col">
                    <span
                      class="truncate text-13px font-500 leading-[1.3]"
                      :class="e.route ? 'text-ink' : 'text-muted'"
                    >
                      {{ e.name }}
                    </span>
                    <!-- 原型每项都写短说明；没开放的项由读屏名「（即将开放）」与悬停提示说明 -->
                    <span class="truncate text-11px leading-[1.35] text-muted">{{ e.tagline }}</span>
                  </span>
                </component>
              </li>
            </ul>
          </section>
        </div>
        <span
          class="pointer-events-none absolute inset-x-0 bottom-0 z-1 h-16px bg-[linear-gradient(to_top,#fff,rgba(255,255,255,0))] [transition:opacity_0.16s_ease]"
          :class="fadeBottom ? 'opacity-100' : 'opacity-0'"
          aria-hidden="true"
        />
      </div>
    </nav>

    <div class="flex-1 min-w-0 min-h-0 grid gap-16px p-16px grid-cols-[460px_224px_minmax(0,1fr)]">
      <!-- 操作区：工具头卡（可展开功能说明）+ 上传 + 参数，自己滚；底部固定提交栏 -->
      <section class="ll-card flex min-h-0 flex-col overflow-hidden" aria-labelledby="tool-title">
        <form
          id="tool-form"
          class="flex-1 min-h-0 overflow-y-auto pt-12px px-12px flex flex-col gap-12px [scrollbar-gutter:stable]"
          :class="compact ? 'pb-0' : 'pb-14px'"
          @submit.prevent="onSubmit"
        >
          <div
            class="flex-none rounded-10px border border-solid border-violet-soft-2 bg-[linear-gradient(#fff_0%,#fbf7fe_100%)] shadow-[0_1px_2px_rgba(31,35,41,0.05)]"
          >
            <div class="flex items-center gap-12px h-62px pl-15px pr-10px">
              <span :class="[tileCls, 'w-56px h-40px text-violet-ink']" aria-hidden="true">
                <svg
                  v-if="currentEntry?.icon"
                  class="w-18px h-18px"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  :innerHTML="currentEntry.icon"
                />
              </span>
              <div class="min-w-0 flex-1 flex flex-col gap-2px">
                <h1 id="tool-title" class="m-0 truncate text-15px font-600 leading-20px text-ink">
                  {{ schema.title }}
                </h1>
                <p v-if="currentEntry?.tagline" class="m-0 truncate text-11px leading-16px text-muted">
                  {{ currentEntry.tagline }}
                </p>
              </div>
              <button
                type="button"
                class="flex-none grid place-items-center w-28px h-28px p-0 rounded-6px border-none bg-transparent text-muted cursor-pointer transition-colors hover:(bg-violet-soft text-violet-ink)"
                :class="focusRing"
                :aria-expanded="introOpen"
                aria-controls="tool-intro-desc"
                :aria-label="introOpen ? '收起功能介绍' : '展开功能介绍'"
                @click="introOpen = !introOpen"
              >
                <svg
                  class="w-16px h-16px transition-transform duration-200 motion-reduce:transition-none"
                  :class="introOpen ? 'rotate-180' : ''"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
            </div>
            <p v-show="introOpen" id="tool-intro-desc" class="m-0 px-15px pb-12px text-12px leading-20px text-ink-2">
              {{ schema.description }}
            </p>
          </div>

          <ToolUploadSlot
            v-for="u in displayUploads"
            :id="`tool-upload-${u.slot}`"
            :key="`${schema.homeId}-${u.slot}`"
            :model-value="uploads[u.slot] ?? []"
            :spec="u"
            :layout="u.layout"
            :disabled="submitting"
            asset-picker
            @update:model-value="setUploads(u.slot, $event)"
          />

          <template v-for="f in formFields" :key="`${schema.homeId}-${f.key}`">
            <!-- 涂抹蒙版 -->
            <div v-if="f.type === 'mask'">
              <div class="ll-label">
                <span>{{ f.label }}<span class="text-danger" aria-hidden="true"> *</span></span>
              </div>
              <MaskPainter v-if="singleImage" :ref="setMaskRef" :src="singleImage" @change="maskHasStroke = $event" />
              <p v-else class="m-0 ll-empty py-12px">先上传原图，再在图上涂抹要消除的区域</p>
            </div>

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
                  v-for="opt in f.options"
                  :key="opt"
                  type="button"
                  role="radio"
                  :aria-checked="values[f.key] === opt"
                  class="ll-pill"
                  :class="[focusRing, values[f.key] === opt ? 'll-pill-active' : '']"
                  @click="values[f.key] = opt"
                >
                  {{ opt }}
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
              <select :id="`tool-field-${f.key}`" v-model="values[f.key]" :class="inputCls">
                <option v-for="opt in f.options" :key="opt" :value="opt">{{ opt }}</option>
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
              :placeholder="`请输入${f.label}`"
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
                class="relative w-36px h-20px rounded-full border-none cursor-pointer transition-colors"
                :class="[focusRing, values[f.key] ? 'bg-violet' : 'bg-line-strong']"
                @click="values[f.key] = !values[f.key]"
              >
                <span
                  class="absolute top-2px w-16px h-16px rounded-full bg-white shadow transition-all"
                  :class="values[f.key] ? 'left-18px' : 'left-2px'"
                  aria-hidden="true"
                />
              </button>
            </div>
          </template>
        </form>

        <!-- 底部固定提交栏：原型整宽主按钮（第二行写消耗），还不能提交的原因在按钮上方一行小字；上方是设置行（原型「图片设置 / 视频设置 ▾」）-->
        <!--
          compact（新版原型视频高清）：设置行 434×44（左 11 / 右 24，齿轮 13 + 灰标签 11/16，取值 11/16·500 ink-2 右对齐，下箭头在右侧 24 里），
          弹层 340 宽右对齐、标题 14·600 +「目标分辨率」分段选择；提交按钮 434×56，主文案 16/22·600，第二行 11/11·600、数字 900。
          原型没有按钮上方那行原因小字：原因只给读屏（aria-describedby），按钮照常置灰。
        -->
        <div v-if="compact" class="flex-none flex flex-col gap-12px pt-12px px-12px pb-12px">
          <NPopover
            v-if="settingFields.length"
            raw
            trigger="click"
            placement="top-end"
            :show="settingsOpen"
            :show-arrow="false"
            @update:show="setSettingsOpen"
          >
            <template #trigger>
              <button
                type="button"
                class="relative w-full h-44px box-border flex items-center gap-6px pl-11px pr-24px rounded-6px border border-solid bg-[linear-gradient(#fff,#fbfcfc)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(31,35,41,0.04),0_1px_2px_rgba(31,35,41,0.05)] cursor-pointer [transition:background_0.11s_cubic-bezier(0.2,0.7,0.2,1),border-color_0.11s_ease,box-shadow_0.11s_ease,color_0.11s_ease] motion-reduce:transition-none hover:border-#aeb6bf disabled:(opacity-50 cursor-not-allowed)"
                :class="[focusRing, settingsOpen ? 'border-violet-line' : 'border-#c9cfd6']"
                :disabled="submitting"
                :aria-label="`${settingItems[0]?.label}：${settingItems[0]?.value}`"
                aria-haspopup="dialog"
                :aria-expanded="settingsOpen"
                :aria-controls="settingsOpen ? settingsPopId : undefined"
              >
                <svg
                  class="flex-none w-13px h-13px text-violet"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path v-for="d in GEAR_PATHS" :key="d" :d="d" />
                </svg>
                <span class="flex-none text-11px leading-16px text-muted">{{ settingItems[0]?.label }}</span>
                <span class="flex-1 min-w-0 truncate text-right text-11px font-500 leading-16px text-ink-2">{{
                  settingItems[0]?.value
                }}</span>
                <svg
                  class="absolute right-7px top-1/2 -mt-6px w-12px h-12px text-muted transition-transform duration-150 motion-reduce:transition-none"
                  :class="settingsOpen ? 'rotate-180' : ''"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
            </template>
            <div
              :id="settingsPopId"
              role="dialog"
              :aria-label="settingItems[0]?.label"
              class="w-340px max-w-[calc(100vw-24px)] box-border pt-12px px-15px pb-20px rounded-10px border border-solid border-line bg-white shadow-[0_12px_24px_rgba(31,35,41,0.14),0_2px_6px_rgba(31,35,41,0.06)]"
              @keydown.esc="setSettingsOpen(false)"
            >
              <div class="text-14px font-600 leading-[1.55] text-ink">{{ settingItems[0]?.label }}</div>
              <div v-for="f in settingFields" :key="f.key" class="mt-[23px] flex items-center justify-between gap-10px">
                <span :id="`tool-setting-${f.key}-label`" class="text-12px font-500 leading-18px text-ink-2">{{
                  f.label
                }}</span>
                <div
                  role="radiogroup"
                  :aria-labelledby="`tool-setting-${f.key}-label`"
                  class="flex gap-2px p-3px box-border rounded-6px border border-solid border-line bg-surface3 shadow-[inset_0_1px_2px_rgba(31,35,41,0.055),inset_0_0_0_1px_rgba(255,255,255,0.7)]"
                >
                  <button
                    v-for="opt in settingsConfig[f.key as CreationSettingKey]?.options ?? []"
                    :key="String(opt.value)"
                    type="button"
                    role="radio"
                    :aria-checked="values[f.key] === opt.value"
                    class="min-w-55px h-30px box-border px-9px rounded-4px border border-solid text-13px leading-26px cursor-pointer [transition:background-color_0.3s_cubic-bezier(0.4,0,0.2,1),opacity_0.3s_cubic-bezier(0.4,0,0.2,1),border-color_0.3s_cubic-bezier(0.4,0,0.2,1),color_0.3s_cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
                    :class="[
                      focusRing,
                      values[f.key] === opt.value
                        ? 'border-violet-line bg-white font-600 text-violet-ink shadow-[0_1px_2px_rgba(31,35,41,0.05)]'
                        : 'border-transparent bg-transparent font-400 text-muted hover:text-ink',
                    ]"
                    @click="pickSetting(f.key, opt.value)"
                  >
                    {{ opt.label }}
                  </button>
                </div>
              </div>
            </div>
          </NPopover>
          <p v-if="disabledReason" :id="reasonId" class="sr-only" aria-live="polite">{{ disabledReason }}</p>
          <button
            type="submit"
            form="tool-form"
            class="group ll-btn-primary relative w-full h-56px box-border py-0 px-12px flex-col !gap-3px !rounded-10px ![transition:background_0.11s_cubic-bezier(0.2,0.7,0.2,1),border-color_0.11s_ease,box-shadow_0.11s_ease,color_0.11s_ease] motion-reduce:!transition-none"
            :class="focusRing"
            :disabled="!!disabledReason || submitting"
            :aria-busy="submitting || undefined"
            :aria-describedby="disabledReason ? reasonId : undefined"
          >
            <span
              class="flex items-center gap-6px text-16px font-600 leading-22px text-white group-disabled:text-white/80"
            >
              <span
                v-if="submitting"
                class="block w-12px h-12px box-border rounded-full border-1.5px border-solid border-white/35 border-t-white animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              {{ submitting ? '提交中…' : schema.submit.label }}
            </span>
            <span class="text-11px font-600 leading-11px text-white/85 group-disabled:text-white/74" aria-live="polite">
              <template v-if="'num' in costLine"
                >消耗 <b class="font-900">{{ costLine.num }}</b
                >{{ costLine.suffix }}</template
              >
              <template v-else>{{ costLine.text }}</template>
            </span>
          </button>
        </div>
        <div v-else class="flex-none flex flex-col gap-12px pt-8px px-12px pb-12px">
          <CreationSettingsRow v-if="settingItems.length" :items="settingItems">
            <template #settings>
              <CreationImageSettings
                :model-value="settingsValue"
                :fields="settingsConfig"
                @update:model-value="onSettings"
              />
            </template>
          </CreationSettingsRow>
          <CreationActionBar
            form="tool-form"
            :label="schema.submit.label"
            :cost-text="progressText || costText"
            :disabled="!!disabledReason"
            :loading="submitting"
            :reason="disabledReason"
          />
        </div>
      </section>

      <!-- 历史记录 -->
      <section class="ll-card flex min-h-0 flex-col overflow-hidden" aria-labelledby="tool-history-title">
        <!-- 列头（原型「历史记录 · N 条」）：标题 14/21.7·600，条数 11/17.05 muted；标题顶 30、列表顶 61 -->
        <div class="flex-none flex items-center gap-6px pt-13px px-12px pb-9px">
          <h2 id="tool-history-title" class="m-0 text-14px font-600 leading-[1.55] text-ink">历史记录</h2>
          <span class="ml-auto flex items-center gap-8px text-11px leading-[1.55]">
            <span v-if="history.running.value" class="text-violet-ink">{{ history.running.value }} 个进行中</span>
            <span class="text-muted">{{ history.total.value || history.items.value.length }} 条</span>
          </span>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto px-12px pb-12px">
          <p v-if="history.loading.value && !history.items.value.length" class="ll-empty m-0 py-24px">加载中…</p>
          <!-- 空态：虚线浅底卡 + 圆底时钟（原型 198×65，左右 10，图标与文字隔 8；文字 140 宽） -->
          <div
            v-else-if="!history.items.value.length"
            class="h-65px box-border flex items-center gap-8px px-10px rounded-8px border border-dashed border-line-strong bg-[linear-gradient(#fff,#f7f8f9)]"
          >
            <span
              class="flex-none grid place-items-center w-28px h-28px rounded-full border border-solid border-line bg-white text-violet-ink"
              aria-hidden="true"
            >
              <svg
                class="w-14px h-14px"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="12" cy="12" r="8.5" />
                <path d="M12 7.5V12l3 2" />
              </svg>
            </span>
            <span class="min-w-0 flex-1 flex flex-col gap-1px">
              <b class="text-13px font-600 leading-18px text-ink-2">还没有生成记录</b>
              <span class="truncate text-11px leading-[1.55] text-muted" :title="HISTORY_EMPTY_HINT">{{
                HISTORY_EMPTY_HINT
              }}</span>
            </span>
          </div>
          <ul v-else class="m-0 p-0 list-none flex flex-col gap-6px">
            <li v-for="item in history.items.value" :key="item.aiToolHistoryId" class="group relative">
              <button
                type="button"
                class="w-full flex items-center gap-10px p-8px pr-30px rounded-8px border border-solid text-left cursor-pointer transition-colors"
                :class="[
                  focusRing,
                  current?.aiToolHistoryId === item.aiToolHistoryId
                    ? 'border-violet-line bg-violet-soft'
                    : 'border-transparent bg-transparent hover:bg-surface2',
                ]"
                :aria-pressed="current?.aiToolHistoryId === item.aiToolHistoryId"
                :aria-label="`${formatTime(item.createdAt)} ${statusOf(item.status).text}`"
                @click="selectedId = item.aiToolHistoryId"
              >
                <span
                  class="flex-none w-44px h-44px overflow-hidden rounded-6px bg-surface3 flex items-center justify-center"
                >
                  <img v-if="thumbOf(item)" :src="thumbOf(item)" alt="" class="w-full h-full object-cover" />
                  <span v-else class="text-11px text-placeholder">{{ schema.media === 'video' ? '视频' : '—' }}</span>
                </span>
                <span class="min-w-0 flex-1 flex flex-col gap-4px">
                  <span class="ll-chip self-start" :class="statusOf(item.status).cls">{{
                    statusOf(item.status).text
                  }}</span>
                  <span class="text-11px text-placeholder">{{ formatTime(item.createdAt) }}</span>
                </span>
              </button>
              <button
                v-if="isTerminal(item.status)"
                type="button"
                class="absolute right-6px top-6px grid place-items-center w-22px h-22px p-0 rounded-6px border-none bg-transparent text-placeholder cursor-pointer opacity-0 transition-colors group-hover:opacity-100 focus-visible:opacity-100 hover:(bg-surface3 text-danger)"
                :class="focusRing"
                :aria-label="`删除 ${formatTime(item.createdAt)} 的记录`"
                title="删除"
                @click="confirmDelete(item)"
              >
                <svg
                  class="w-14px h-14px"
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
                      class="ll-pill no-underline self-start"
                      :class="focusRing"
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
                      class="ll-pill no-underline self-start"
                      :class="focusRing"
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
          </ul>
        </div>
      </section>

      <!-- 结果卡（内容自己滚）+ 功能介绍卡（占满余下高度）；compact 版式只有功能介绍卡（原型），结果在历史列表里展开 -->
      <div class="flex min-h-0 flex-col gap-12px">
        <section
          v-if="!compact"
          class="flex-[0_1_auto] min-h-0 overflow-y-auto box-border rounded-10px border border-solid border-line bg-white p-12px shadow-[0_1px_2px_rgba(31,35,41,0.04),0_8px_18px_rgba(31,35,41,0.05)]"
          aria-labelledby="tool-result-title"
        >
          <h2 id="tool-result-title" class="m-0 mb-12px text-14px font-600 leading-20px text-ink">
            {{ schema.resultTitle ?? '生成结果' }}
          </h2>

          <!-- 同步抠图本次直接拿到的结果 -->
          <div v-if="syncResultUrl" class="mb-12px">
            <div :class="[checkerCls, 'rounded-8px overflow-hidden border border-solid border-line']">
              <img
                :src="syncResultUrl"
                alt="本次抠图结果"
                class="block max-w-full max-h-480px mx-auto object-contain"
              />
            </div>
            <div class="mt-8px flex gap-8px">
              <a
                :href="syncResultUrl"
                target="_blank"
                rel="noopener"
                download
                class="ll-pill no-underline"
                :class="focusRing"
                >下载结果</a
              >
              <a :href="syncResultUrl" target="_blank" rel="noopener" class="ll-pill no-underline" :class="focusRing"
                >放大查看抠图结果</a
              >
            </div>
          </div>

          <div v-if="current" class="flex flex-col gap-10px">
            <div class="flex items-center gap-8px">
              <span class="ll-chip" :class="statusOf(current.status).cls">{{ statusOf(current.status).text }}</span>
              <span class="text-12px text-placeholder">{{ formatTime(current.createdAt) }}</span>
            </div>
            <p v-if="!isTerminal(current.status)" class="ll-empty m-0 py-24px">任务进行中，结果出来后会自动显示</p>
            <p v-else-if="current.status !== 'SUCCEED'" class="m-0 text-13px text-danger" role="status">
              {{ current.errorMessage || '任务未成功，点数已按规则退回' }}
            </p>
            <template v-else>
              <ul class="m-0 p-0 list-none grid gap-10px grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
                <li v-for="(url, i) in outputsOf(current).images" :key="url">
                  <div :class="[checkerCls, 'rounded-8px overflow-hidden border border-solid border-line']">
                    <img :src="url" :alt="`结果图 ${i + 1}`" class="block w-full max-h-420px object-contain" />
                  </div>
                  <div class="mt-6px flex gap-8px">
                    <a
                      :href="url"
                      target="_blank"
                      rel="noopener"
                      download
                      class="ll-pill no-underline"
                      :class="focusRing"
                      >下载结果</a
                    >
                    <a :href="url" target="_blank" rel="noopener" class="ll-pill no-underline" :class="focusRing"
                      >放大查看</a
                    >
                  </div>
                </li>
                <li v-for="url in outputsOf(current).videos" :key="url" class="col-span-full">
                  <video :src="url" controls class="block w-full max-h-480px rounded-8px bg-black" />
                  <a
                    :href="url"
                    target="_blank"
                    rel="noopener"
                    download
                    class="ll-pill no-underline mt-6px"
                    :class="focusRing"
                    >下载视频</a
                  >
                </li>
              </ul>
              <p
                v-if="!outputsOf(current).images.length && !outputsOf(current).videos.length"
                class="ll-empty m-0 py-24px"
              >
                任务已完成，但没有返回产物地址
              </p>
            </template>
          </div>
          <!-- 空态：透明底棋盘格预览区（原型 8px 格、α.06） -->
          <div v-else-if="!syncResultUrl" :class="[checkerCls, 'grid place-items-center h-316px rounded-8px']">
            <p class="m-0 text-13px text-muted">处理完成后在这里展示结果</p>
          </div>
        </section>

        <!-- 功能介绍 -->
        <!-- 原型：内边距 18；标题 14/21.7·600，说明 13/21.45 ink-2（标题下 20）；适用场景是浅灰圆角 6 面板（说明下 14，内边距 10，行距 5.5） -->
        <section
          class="ll-card flex-[1_0_auto] min-h-0 overflow-y-auto box-border p-18px"
          aria-labelledby="tool-intro-title"
        >
          <h2 id="tool-intro-title" class="m-0 text-14px font-600 leading-[1.55] text-ink">功能介绍</h2>
          <p class="m-0 mt-20px text-13px leading-[1.65] text-ink-2">{{ schema.description }}</p>
          <div
            v-if="schema.scenarios?.length"
            class="mt-14px flex flex-col gap-[5.5px] p-10px rounded-6px border border-solid border-line-soft bg-surface2"
          >
            <h3 id="tool-intro-scenes" class="m-0 text-13px font-500 leading-[1.55] text-ink">适用场景</h3>
            <ul
              class="m-0 p-0 list-none flex flex-col gap-[5.5px] text-13px leading-[1.55] text-ink-2"
              aria-labelledby="tool-intro-scenes"
            >
              <li v-for="s in schema.scenarios" :key="s">{{ s }}</li>
            </ul>
          </div>
          <ol v-else class="m-0 mt-4px pl-18px text-12px leading-20px text-muted">
            <li v-for="step in schema.steps" :key="step">{{ step }}</li>
          </ol>
        </section>
      </div>
    </div>
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
