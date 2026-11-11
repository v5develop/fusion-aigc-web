<script setup lang="ts">
/**
 * 三栏工作台 · 右列预览区（对齐原型 ToolPreviewPanel v3：舞台 + 4 列候选 + 三档查看 + 服装校色）。
 *
 * <p>有选中批次时：
 * <ul>
 *   <li>头部：「生成结果」+ 批次状态 · MM-DD HH:mm + 记录名；右侧「结果 / 前后对比 / 校色对比」分段 +
 *       「存为资产」「下载」图标钮（校色对比档隐藏，改用图上的两个下载胶囊）；</li>
 *   <li>舞台：选中任务的成品（contain，点 / Enter / 空格放大）；前后对比 = 商拍的模特图或姿态的参考姿势图 vs 成品
 *       （compare.ts）；校色对比 = 原图 vs 校色后。商拍 / 姿态的成品右上角常驻「校色调整」胶囊；</li>
 *   <li>候选条：本批次全部任务 4 列（悬停看大图，生成中 / 失败 / 已取消各有占位态）；</li>
 *   <li>批次摘要：成功 / 失败 / 点数 / 时间 / 阶段进度 + 取消批次 / 重新编辑 / 删除批次；失败任务在舞台给「重试这张」。</li>
 * </ul>
 *
 * <p>校色（商拍换装 / 姿态复刻 / 图片生成）：参数台编辑 useColorFix 单例里的 params；切任务时按任务还原参数
 * （colorfix/persist.ts），**不改**输入区的提交开关 enabled（胶囊用 openPanelOnly）——这一批结果是否校色只看它提交时的
 * `payload.colorFix`，或这张图保存过参数 / 本次调过 / 参数台开着。参数台开着时切到别的任务，新任务直接进校色态并套用
 * 它自己的参数（面板数值与舞台一致）。用户打开过参数台、调过参数或点过候选后，选中的任务就钉住，轮询带来的新成品
 * 不会把舞台切走。显示、灯箱、对比右侧、下载、存资产都用烘进像素的图（colorfix/useColorFixBake.ts），
 * CSS filter 只在烘好之前做即时预览。
 *
 * <p>选区（局部调色，复用 components/ColorFix 套件的识别 / 涂抹 / 存储）：整图 / 自动识别（服装 · 商品 · 人物 · 背景，
 * POST /api/v1/studio/masks）/ 手动涂抹，可反选、柔化。商拍 / 姿态默认「自动识别 · 服装」：任务带 `mask_url` 直接用，
 * 没有就向接口要（与服务端补的蒙版共用缓存）；仍然没有服装区域时退回整图并提示「未识别到服装区域，校色将作用于整张图」。
 * 图片生成默认整图。选区按任务存本机（colorfix-region:studio:<task_id>）。
 * 服装细分部位（服务端支持时）：商拍默认只选用户提交的单品（items → 上衣 / 下装 / 裙装 / 外套 / 鞋 / 包帽），任务的 `mask_url`
 * 就是这些单品的合并蒙版、`mask_parts` 是逐件；改选部位时单件直接用 `mask_parts`，其余组合向接口要。
 *
 * <p>未选中 / 无历史时：有功能介绍文案就按原型 ToolIntroPanel 整列显示「功能介绍 + 适用场景」（有在跑任务时补一行提示），
 * 否则显示空态引导。在跑批次由 useStudioHistory 轮询，这里只做展示。
 */
import { computed, nextTick, onBeforeUnmount, ref, useSlots, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { studioBatchDetail, studioCancelBatch, studioDeleteBatch, studioRetryTask } from '@/api/studio.ts'
import { toApiError } from '@/api/index.ts'
import {
  COLORFIX_REGION_DEFAULT,
  ColorFixMaskPainter,
  colorFixGarmentParts,
  colorFixPresetFor,
  colorFixRequestParts,
  colorFixSegmentSupported,
  defaultColorFixSegmenter,
  noteColorFixGarmentParts,
  bakeForUpload,
  COLORFIX_GARMENT_PARTS,
  type ColorFixAutoTarget,
  type ColorFixRegion,
  type ColorFixRegionMode,
} from '@/components/ColorFix/index.ts'
import {
  copyPaintedMask,
  loadPaintedMask,
  loadRegion,
  savePaintedMask,
  saveRegion,
} from '@/components/ColorFix/mask-store.ts'
import { goUploadImage } from '@/api/go-upload.ts'
import { assetLibAddVersion } from '@/api/asset-library.ts'
import type { StudioBatchDetail, StudioTask } from '@/api/studio-types.ts'
import IconButton from '@/components/IconButton/index.vue'
import MediaLightbox from '@/components/MediaLightbox/index.vue'
import type { LightboxItem } from '@/components/MediaLightbox/index.vue'
import ToolImageCompare from '@/views/tools/ToolImageCompare.vue'
import ColorFixPanel from '@/views/tools/ColorFixPanel.vue'
import {
  COLORFIX_DEFAULT,
  COLORFIX_MASK_LOAD_FAILED,
  colorFixDataUrlToFile,
  colorFixEquals,
  corsAttr,
  markCorsBlocked,
} from '@/utils/colorfix.ts'
import { downloadImage } from '@/utils/download.ts'
import type { useStudioHistory } from '../../hooks.ts'
import {
  KIND_LABEL,
  LIBRARY_FAILED_HINT,
  LIBRARY_PENDING_HINT,
  LIBRARY_PENDING_LABEL,
  batchChip,
  batchProgress,
  formatTime,
  isBatchTerminal,
  isTransientResult,
  taskCaption,
  taskChip,
  taskLibraryStatus,
  urlIdentity,
} from '../../constants.ts'
import { useColorFix } from '../../colorfix/useColorFix.ts'
import { tryonItemParts } from '../../colorfix/mask-parts.ts'
import { downloadDataUrl, extOf, useColorFixBake } from '../../colorfix/useColorFixBake.ts'
import {
  lastSavedAssetColorFix,
  loadTaskColorFix,
  rememberSavedAssetColorFix,
  saveTaskColorFix,
} from '../../colorfix/persist.ts'
import { STUDIO_INTRO } from './intro.ts'
import StudioPromptCard from './StudioPromptCard.vue'
import { batchColorFix, canRetryTask, compareBefore, retrySupported, unitPoints } from './compare.ts'

const props = defineProps<{
  /** useStudioHistory 实例（游标分页 + 在跑批次轮询） */
  history: ReturnType<typeof useStudioHistory>
  /** 预览的批次；null = 显示空态引导（selectedId 有值但列表还没有它时显示加载态） */
  detail: StudioBatchDetail | null
  /** 是否有批次正在被选中但还没进列表（提交后刷新的瞬间） */
  pending?: boolean
  /** 功能键：查 STUDIO_INTRO 取默认的功能介绍文案（tryon / pose / imagegen） */
  feature?: string
  /** 功能介绍正文；传了覆盖 STUDIO_INTRO 的默认值 */
  intro?: string
  /** 适用场景；传了覆盖 STUDIO_INTRO 的默认值 */
  scenes?: string[]
}>()

const slots = useSlots()

const emit = defineEmits<{
  reedit: [payload: Record<string, unknown>, detail: StudioBatchDetail]
}>()

const message = useMessage()
const ctl = props.history

// ---------------- 批次操作 ----------------

const acting = ref(false)

async function cancelBatch(d: StudioBatchDetail) {
  if (acting.value) return
  acting.value = true
  try {
    const res = await studioCancelBatch(d.batch.id)
    message.success(`已取消 ${res.data?.canceledTasks ?? 0} 个未开始任务，点数原路退回`)
    await ctl.refresh()
  } finally {
    acting.value = false
  }
}

async function removeBatch(d: StudioBatchDetail) {
  await studioDeleteBatch(d.batch.id)
  message.success('已删除')
  ctl.drop(d.batch.id)
  await ctl.refresh()
}

function reedit(d: StudioBatchDetail) {
  let payload: Record<string, unknown>
  try {
    const parsed = JSON.parse(d.batch.payload || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad payload')
    payload = parsed as Record<string, unknown>
  } catch {
    message.error('该记录没有可回填的参数')
    return
  }
  emit('reedit', payload, d)
}

// ---------------- 单张重试 ----------------

const retrying = ref('')

function retryConfirmText(d: StudioBatchDetail) {
  const unit = unitPoints(d.batch)
  return `只重新生成这一张，会按原入口重新冻结这 1 张的点数${unit ? `（约 ${unit} 点）` : ''}，其余图片不受影响。确定重试？`
}

async function retryTask(task: StudioTask) {
  if (retrying.value) return
  retrying.value = task.taskId
  try {
    await studioRetryTask(task.taskId)
  } catch (err) {
    const e = toApiError(err)
    // 业务失败（不满足重试条件 / 点数不足等）拦截器已 toast；只补「接口不存在」与传输层失败
    if (e?.httpStatus === 404 && e.code === -1) {
      retrySupported.value = false
      message.warning('单张重试暂未开放，可点「重新编辑」再提交')
    } else if (!e || e.isNetwork) {
      message.error('重试请求没有发出去，请检查网络后再试')
    }
    retrying.value = ''
    return
  }
  // 重试已成功（已重新冻结点数）：刷新失败不能再报成「重试失败」，免得用户再点一次重复扣点。刷新完成前保持 retrying，防止连点
  try {
    await ctl.refresh()
    message.success('已重新提交这一张，生成好会自动刷新')
  } catch {
    message.warning('已重新提交，刷新失败，请稍后查看')
  } finally {
    retrying.value = ''
  }
}

/** 编辑提示词后重新生成已提交（服务端已冻结点数）：钉住这张、刷新批次；刷新失败只提示，不报成失败 */
async function onRegenerated() {
  pinSelected()
  try {
    await ctl.refresh()
  } catch {
    message.warning('已重新提交，刷新失败，请稍后查看')
  }
}

// ---------------- 展示辅助 ----------------

/** 任务态是否展示为进行中（0 排队 / 1 生成中 / 5 交付中） */
const isTaskRunning = (task: StudioTask) => task.status === 0 || task.status === 1 || task.status === 5
const isTaskSuccess = (task: StudioTask | null | undefined): boolean => !!task && task.status === 2 && !!task.resultUrl

/** 全部在跑的任务数（各批次未结束的张数之和）：功能介绍与底部提示用 */
const runningTotal = computed(() =>
  ctl.items.value.reduce(
    (n, d) =>
      n +
      (isBatchTerminal(d.batch.status) ? 0 : Math.max(0, d.batch.taskTotal - d.batch.taskDone - d.batch.taskFailed)),
    0,
  ),
)

/** 无结果时的功能介绍：属性优先，其次按 feature 查默认文案；都没有就回到空态引导 */
const introCopy = computed(() => {
  const fallback = props.feature ? STUDIO_INTRO[props.feature] : undefined
  const intro = props.intro ?? fallback?.intro ?? ''
  const scenes = props.scenes ?? fallback?.scenes ?? []
  return intro || scenes.length ? { intro, scenes } : null
})
const showIntro = computed(() => !!slots.intro || !!introCopy.value)

/** MM-DD HH:mm（原型 v3-preview__meta 短格式） */
function shortTime(ms?: number) {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const summary = computed(() => {
  const d = props.detail
  if (!d) return null
  const chip = batchChip(d.batch.status)
  return {
    title: `${KIND_LABEL[d.batch.kind] ?? d.batch.kind}批次 #${d.batch.id}`,
    chip,
    done: d.batch.taskDone,
    failed: d.batch.taskFailed,
    total: d.batch.taskTotal,
    points: d.batch.estimatedPoints,
    time: formatTime(d.batch.createdAt),
    short: shortTime(d.batch.createdAt),
    progress: batchProgress(d.batch),
    running: !isBatchTerminal(d.batch.status),
    reason: d.batch.errorReason,
    // 读图 / 参考图提示（验收 F12 / B2）：新网关下发 batch.warnings；老网关没有时按任务 warnings 去重合并
    warnings: d.batch.warnings ?? [...new Set(d.tasks.flatMap((t) => t.warnings ?? []))],
  }
})

// ---------------- 选中任务 / 查看方式 ----------------

const tasks = computed(() => props.detail?.tasks ?? [])
/**
 * 钉住的任务号：用户点过候选 / 打开过参数台 / 调过参数后写入（pinSelected）。
 * 没钉住时舞台跟着「第一张成品」走，轮询出新成品可能换图；钉住后轮询不会把舞台切走。
 */
const selectedTaskId = ref('')
/** 选中的任务：钉住的那张；没钉住 = 第一张成品，再没有 = 第一张 */
const selectedTask = computed<StudioTask | null>(
  () =>
    tasks.value.find((t) => t.taskId === selectedTaskId.value) ??
    tasks.value.find((t) => isTaskSuccess(t)) ??
    tasks.value[0] ??
    null,
)
const selectedSuccess = computed<StudioTask | null>(() =>
  isTaskSuccess(selectedTask.value) ? selectedTask.value : null,
)
const selectedSrc = computed(() => selectedSuccess.value?.resultUrl ?? '')
/** 选中成品的入素材库状态（契约 §4.6）：pending 入库中 / failed 未能入库 / undefined 已入库或不适用 */
const libraryState = computed(() => taskLibraryStatus(selectedSuccess.value))
const runningInBatch = computed(() => tasks.value.filter(isTaskRunning).length)

/** 把当前看到的那张钉住（只在还没钉住时写，不改变舞台） */
function pinSelected() {
  const t = selectedTask.value
  if (t && selectedTaskId.value !== t.taskId) selectedTaskId.value = t.taskId
}

type ViewMode = 'result' | 'compare' | 'colorfix'
const mode = ref<ViewMode>('result')

watch(
  () => props.detail?.batch.id,
  () => {
    selectedTaskId.value = ''
    mode.value = 'result'
  },
)

const before = computed(() =>
  props.detail && selectedSuccess.value ? compareBefore(props.detail, selectedSuccess.value) : null,
)
const canCompare = computed(() => !!before.value)

/** 记录名 / 下载文件名前缀 */
const fileTitle = computed(() => {
  const d = props.detail
  const t = selectedTask.value
  if (!d || !t) return 'result'
  const kind = KIND_LABEL[d.batch.kind] ?? d.batch.kind
  const caption = taskCaption(t, props.detail?.batch).replace(/^姿态复刻 · /, '')
  return `${kind}-${d.batch.id}-${caption}`.replace(/[\\/:*?"<>|\s·]+/g, '-').replace(/-+/g, '-')
})

/** 头部记录名：当前这张的称呼（如「姿态复刻 · 姿势 2」）；批次号留在下方摘要卡 */
const headerName = computed(() => {
  const t = selectedTask.value
  if (!t) return summary.value?.title ?? ''
  const caption = taskCaption(t, props.detail?.batch)
  const kind = KIND_LABEL[t.kind] ?? ''
  return !kind || caption.startsWith(kind) ? caption : `${kind} · ${caption}`
})

// ---------------- 校色 ----------------

const cf = useColorFix()
const { panelOpen, params: cfParams, touched: cfTouched } = cf

/** 校色：商拍换装 / 姿态复刻（原型 COLORFIX_TOOLS）+ 图片生成 */
const cfTool = computed(() => ['tryon', 'pose', 'imagegen'].includes(props.detail?.batch.kind ?? ''))
/** 成品是穿着服装的人物：默认选区「自动识别 · 服装」（图片生成默认整图） */
const garmentKind = computed(() => props.detail?.batch.kind === 'tryon' || props.detail?.batch.kind === 'pose')
const cfTitle = computed(() => (garmentKind.value ? '服装校色' : '图片校色'))

// ---------------- 选区（局部调色） ----------------

const region = ref<ColorFixRegion>({ ...COLORFIX_REGION_DEFAULT })
const regionKey = (t: StudioTask) => `studio:${t.taskId}`
/**
 * 商拍默认部位：任务已有蒙版时取它实际覆盖的部位（mask_parts；空 = 服务端按全部服装出的），
 * 还没有蒙版时取提交的单品；姿态 / 图片生成为空（全部服装）
 */
function defaultParts(t: StudioTask | null) {
  if (props.detail?.batch.kind !== 'tryon') return []
  if (t?.maskUrl)
    return colorFixRequestParts(
      'garment',
      (t.maskParts ?? []).map((p) => p.part),
    )
  return tryonItemParts(props.detail?.batch.payload)
}
const regionDefault = (t: StudioTask | null = selectedTask.value): ColorFixRegion => {
  const parts = defaultParts(t)
  return {
    ...COLORFIX_REGION_DEFAULT,
    mode: garmentKind.value ? 'auto' : 'whole',
    target: 'garment',
    ...(parts.length ? { parts } : {}),
  }
}
const presetMask = computed(() => selectedSuccess.value?.maskUrl || '')
const presetParts = computed(() => selectedSuccess.value?.maskParts ?? null)
// 任务带 mask_parts 字段（哪怕空数组）= 新服务端，支持服装细分部位
watch(
  () => Array.isArray(selectedTask.value?.maskParts),
  (yes) => {
    if (yes && !colorFixGarmentParts.value.length) noteColorFixGarmentParts([...COLORFIX_GARMENT_PARTS])
  },
  { immediate: true },
)
/** 「自动识别 · 服装」可细分的部位；空 = 不出部位选择 */
const garmentParts = computed(() => (colorFixSegmentSupported.value ? colorFixGarmentParts.value : []))
/** 当前选区实际生效的部位（服务端不支持 / 非服装为空 = 全部服装） */
const activeParts = computed(() => colorFixRequestParts(region.value.target, region.value.parts))
const autoTargets = computed<ColorFixAutoTarget[]>(() =>
  colorFixSegmentSupported.value ? ['garment', 'product', 'person', 'background'] : presetMask.value ? ['garment'] : [],
)
const regionModes = computed<ColorFixRegionMode[]>(() =>
  (['whole', 'auto', 'paint'] as ColorFixRegionMode[]).filter((m) => m !== 'auto' || autoTargets.value.length > 0),
)
const autoMask = ref('')
const maskBusy = ref(false)
const maskError = ref('')
/** 「自动识别 · 服装」没拿到蒙版（没识别到 / 接口不可用）：退回整图校色 */
const garmentMissing = ref(false)
const paintedMask = ref('')
const painterShow = ref(false)
/**
 * 涂抹蒙版按「任务 + 成品图」存本机。键里不带查询串：短期签名地址（入库中 / 免费档）每次查询现签，
 * 带着签名进键，下一次轮询就找不回刚涂的选区，过期后还成了死键
 */
const paintScope = computed(() =>
  selectedSuccess.value ? `${regionKey(selectedSuccess.value)}::${urlIdentity(selectedSrc.value)}` : '',
)
const garmentFallback = computed(
  () => region.value.mode === 'auto' && region.value.target === 'garment' && garmentMissing.value,
)
/** 当前生效的蒙版；整图 / 退回整图 / 未就绪为 '' */
const effectiveMask = computed(() => {
  if (region.value.mode === 'auto') return garmentFallback.value ? '' : autoMask.value
  if (region.value.mode === 'paint') return paintedMask.value
  return ''
})
/** 选了局部选区但蒙版还没就绪（识别中 / 没涂）：不校色 */
const maskPending = computed(() => region.value.mode !== 'whole' && !garmentFallback.value && !effectiveMask.value)
const maskOpts = computed(() => ({ invert: region.value.invert, feather: region.value.feather }))
/** 这张结果是否处于校色态：提交时开了默认校色 / 保存过参数 / 本次打开过参数台或调过参数 */
const resultOn = ref(false)
let syncing = false

watch(
  () => `${props.detail?.batch.id ?? ''}|${selectedTask.value?.taskId ?? ''}`,
  async () => {
    syncing = true
    const d = props.detail
    const t = selectedTask.value
    const saved = t ? loadTaskColorFix(t) : null
    cfParams.value = saved ? { ...saved } : { ...COLORFIX_DEFAULT }
    region.value = (t ? loadRegion(regionKey(t)) : null) ?? regionDefault(t)
    // 参数台开着切到另一张成品：新任务直接进校色态（面板显示的就是舞台在用的参数），不必再点一次
    const panelShowing = panelOpen.value && isTaskSuccess(t)
    resultOn.value = !!d && !!t && cfTool.value && (!!saved || batchColorFix(d) || panelShowing)
    await nextTick()
    syncing = false
  },
  { immediate: true },
)

function persistCurrent() {
  const t = selectedSuccess.value
  if (!t || !cfTool.value) return
  pinSelected()
  resultOn.value = true
  saveTaskColorFix(t, cfParams.value)
}

// 参数台调参 / 恢复默认：这张结果进入校色态并按任务保存
watch(cfParams, () => {
  if (!syncing) persistCurrent()
})
// 改选区：同样进入校色态，并按任务存选区
watch(
  region,
  (r) => {
    if (syncing) return
    persistCurrent()
    const t = selectedSuccess.value
    if (t && cfTool.value) saveRegion(regionKey(t), r)
  },
  { deep: true },
)
// 打开参数台（胶囊或输入区「调整」）：等同开启这张结果的校色
watch(panelOpen, (open) => {
  if (open && !syncing) persistCurrent()
})

const cfOn = computed(() => cfTool.value && !!selectedSuccess.value && (resultOn.value || cfTouched.value))
const showCfCompare = cfOn

// 自动识别：只在校色开着时取蒙版（不为每张看过的图都发识别请求）
let segTicket = 0
watch(
  () =>
    [
      cfOn.value,
      region.value.mode,
      region.value.target,
      selectedSrc.value,
      presetMask.value,
      activeParts.value.join(','),
      presetParts.value,
      libraryState.value,
    ] as const,
  async ([on, mode, target, image, preset]) => {
    const my = ++segTicket
    maskError.value = ''
    garmentMissing.value = false
    autoMask.value = ''
    if (!on || mode !== 'auto' || !image) {
      maskBusy.value = false
      return
    }
    const parts = activeParts.value
    const presetHit = target === 'garment' ? colorFixPresetFor(parts, preset, presetParts.value) : ''
    if (presetHit) {
      autoMask.value = presetHit
      maskBusy.value = false
      return
    }
    // 成品还在入库（§4.6）：服务端入库完成后会补服装蒙版（mask_url），轮询带回来再用；
    // 现在拿私有桶签名地址去识别，可能被拒（1003）而误退回整图
    if (target === 'garment' && garmentKind.value && libraryState.value === 'pending') {
      maskBusy.value = true
      return
    }
    if (!colorFixSegmentSupported.value) {
      maskBusy.value = false
      if (target === 'garment') garmentMissing.value = true
      else maskError.value = '当前环境不支持自动识别，请改用手动涂抹'
      return
    }
    maskBusy.value = true
    try {
      const url = await defaultColorFixSegmenter(image, target, parts)
      if (my === segTicket) autoMask.value = url
    } catch (err) {
      if (my !== segTicket) return
      // 全部服装没识别到：退回整图；选了具体部位没识别到：就地提示（不拿整图冒充那几件）
      if (target === 'garment' && !parts.length) garmentMissing.value = true
      else maskError.value = toApiError(err)?.message || '识别失败，可重试或改用手动涂抹'
    } finally {
      if (my === segTicket) maskBusy.value = false
    }
  },
  { immediate: true },
)

let paintTicket = 0
watch(
  () => [paintScope.value, selectedSuccess.value?.taskId ?? '', libraryState.value] as const,
  async ([scope, taskId], prev) => {
    const my = ++paintTicket
    paintedMask.value = ''
    if (!scope) return
    // 入库完成：同一张图从私有桶签名地址换成素材库公有地址，入库中涂的选区搬到新键下
    const [prevScope, prevTaskId, prevState] = prev ?? []
    if (prevScope && prevScope !== scope && prevTaskId === taskId && prevState === 'pending') {
      if (!(await loadPaintedMask(scope))) await copyPaintedMask(prevScope, scope).catch(() => null)
      if (my !== paintTicket) return
    }
    const url = await loadPaintedMask(scope)
    if (my === paintTicket) paintedMask.value = url
  },
  { immediate: true },
)

/** 手动涂抹完成：存蒙版（IndexedDB / 内存）并切到「手动涂抹」 */
async function applyPaintedMask(blob: Blob) {
  const scope = paintScope.value
  if (!scope) return
  const { url } = await savePaintedMask(scope, blob)
  if (scope !== paintScope.value) return
  paintedMask.value = url
  region.value = { ...region.value, mode: 'paint' }
  painterShow.value = false
}

const bake = useColorFixBake({
  src: selectedSrc,
  params: cfParams,
  on: cfOn,
  mask: effectiveMask,
  maskOpts,
  pending: maskPending,
})

const maskHint = computed(() => {
  const r = region.value
  if (garmentFallback.value) return '未识别到服装区域，校色将作用于整张图'
  if (r.mode === 'auto' && maskError.value) return maskError.value
  if (r.mode === 'paint' && !paintedMask.value) return '还没有涂抹选区，点「涂抹选区」开始'
  if (r.mode !== 'whole' && bake.failed.value)
    return bake.maskLoadFailed.value ? COLORFIX_MASK_LOAD_FAILED : '选区校色未能生成，已显示原图'
  return ''
})
const displaySrc = bake.displaySrc
const liveFilter = bake.liveFilter

watch([canCompare, showCfCompare, selectedSuccess], () => {
  if (mode.value === 'compare' && !canCompare.value) mode.value = 'result'
  if (mode.value === 'colorfix' && !showCfCompare.value) mode.value = 'result'
})

const panelVisible = computed(() => panelOpen.value && cfTool.value && !!selectedSuccess.value)

/** 舞台「校色调整」胶囊：只开参数台，不碰输入区「默认校色」开关 */
function openPanel() {
  pinSelected()
  cf.openPanelOnly()
}

function closePanel() {
  panelOpen.value = false
}

/** 点候选：钉住这张 */
function selectTask(task: StudioTask) {
  selectedTaskId.value = task.taskId
}

onBeforeUnmount(() => {
  panelOpen.value = false
})

const modes = computed(() =>
  (
    [
      { key: 'result', label: '结果', show: true },
      { key: 'compare', label: '前后对比', show: canCompare.value },
      { key: 'colorfix', label: '校色对比', show: showCfCompare.value },
    ] as { key: ViewMode; label: string; show: boolean }[]
  ).filter((m) => m.show),
)

// ---------------- 下载 / 存为资产 ----------------

async function downloadCorrected() {
  const t = selectedSuccess.value
  if (!t) return
  try {
    downloadDataUrl(await bake.exportBaked(), `${fileTitle.value}-校色后.png`)
  } catch {
    // 烘图要跨域读像素（依赖 OSS CORS），失败退回原图，别让用户拿不到图
    message.warning('校色效果未能写入，已下载原图')
    void downloadImage(t.resultUrl, `${fileTitle.value}.${extOf(t.resultUrl)}`)
  }
}

/** 头部「下载」：校色态下载烘好的校色图，否则原图 */
function download() {
  const t = selectedSuccess.value
  if (!t) return
  if (cfOn.value) void downloadCorrected()
  else void downloadImage(t.resultUrl, `${fileTitle.value}.${extOf(t.resultUrl)}`)
}

function downloadBefore() {
  const t = selectedSuccess.value
  if (t) void downloadImage(t.resultUrl, `${fileTitle.value}-校色前.${extOf(t.resultUrl)}`)
}

const saving = ref(false)
/** 成品已入素材库（asset_id > 0）；asset_id = 0 时按钮仍可点，点了先重拉一次批次再判断（入库可能刚完成） */
const canSaveAsset = computed(() => (selectedSuccess.value?.assetId ?? 0) > 0)
/** 未能入库（failed）的成品素材库里没有这条、永远不会有 asset_id：不出「存为资产」，改出提示 */
const showSaveAsset = computed(
  () => typeof selectedSuccess.value?.assetId === 'number' && libraryState.value !== 'failed',
)
/** 入库中：按钮转圈置灰（「入库中」），轮询拿到 asset_id 后自动恢复 */
const savePending = computed(() => libraryState.value === 'pending')

/** asset_id 还是 0：重拉一次批次详情（顺手更新列表里的这条），返回最新的 asset_id */
async function refetchAssetId(t: StudioTask): Promise<number> {
  const batchId = props.detail?.batch.id
  if (!batchId) return 0
  try {
    const fresh = (await studioBatchDetail(batchId)).data
    if (!fresh) return 0
    ctl.replace(fresh)
    const ft = fresh.tasks.find((x) => x.taskId === t.taskId)
    // 重拉时才发现还在入库：asset_id 不可用（轮询会继续，入库完成后按钮自动恢复）
    return ft && !taskLibraryStatus(ft) ? (ft.assetId ?? 0) : 0
  } catch {
    return 0
  }
}

/**
 * 存为资产：成品完成时已自动入库（版本 1 = 原图，即「校色前」）。校色态下把校色图烘成 PNG → 直传 →
 * 给这条资产追加「校色后」版本（params 带 colorFix，详情页版本胶囊按它标注）；没校色时只提示已在素材库。
 */
async function saveAsAsset() {
  const t = selectedSuccess.value
  if (!t || saving.value) return
  saving.value = true
  try {
    let assetId = t.assetId ?? 0
    if (taskLibraryStatus(t) === 'pending') {
      message.info('这张结果正在存入素材库，完成后即可存为资产')
      return
    }
    if (!assetId) assetId = await refetchAssetId(t)
    if (!assetId) {
      message.warning('这张结果还没进素材库（入库中或已删除），稍后再试')
      return
    }
    if (!cfOn.value) {
      message.success('这张结果已在素材库，可到资产库查看')
      return
    }
    const params = { ...cfParams.value }
    const last = lastSavedAssetColorFix(t.taskId)
    if (last && colorFixEquals(last, params)) {
      message.info('已存过这一版')
      return
    }
    // 长边 3072，超 9.5MB 降到 2048（goUpload 上限 10MB）
    const file = await bakeForUpload(async (side) =>
      colorFixDataUrlToFile(await bake.exportBaked(side), `colorfix-${t.taskId}.png`),
    )
    if (!file) throw new Error('烘图失败')
    const url = await goUploadImage(file)
    await assetLibAddVersion(assetId, {
      imageUrl: url,
      prompt: '校色后',
      // 短期签名地址（免费档水印视图）会过期，不写进版本参数
      params: JSON.stringify({ colorFix: params, ...(isTransientResult(t) ? {} : { sourceImage: t.resultUrl }) }),
    })
    rememberSavedAssetColorFix(t.taskId, params)
    message.success('已存为资产（校色前 / 后两版）')
  } catch {
    message.error('存为资产失败')
  } finally {
    saving.value = false
  }
}

// ---------------- 灯箱 ----------------

const lbShow = ref(false)
const lbIndex = ref(0)
const lbItems = computed<LightboxItem[]>(() =>
  tasks.value.filter(isTaskSuccess).map((t) => ({
    // 选中的那张给烘好的校色图（还在烘 / 烘失败时给原图）
    url: t.taskId === selectedSuccess.value?.taskId && !liveFilter.value ? displaySrc.value : t.resultUrl,
    name: taskCaption(t, props.detail?.batch),
  })),
)

/**
 * 成品图加载失败：带 crossorigin 的先退回普通加载（校色读像素要 CORS）；仍失败且是短期签名地址
 * （入库中 / 未能入库 / 免费档，10 分钟过期）时现签一次这张（同一地址只补一次、同一任务有间隔，见 refreshTask）
 */
function onResultError(task: StudioTask, url: string) {
  if (cfTool.value && corsAttr(url)) {
    markCorsBlocked(url)
    return
  }
  if (url === task.resultUrl && isTransientResult(task)) void ctl.refreshTask(task.taskId, url)
}

function openLightbox() {
  const t = selectedSuccess.value
  if (!t) return
  const at = tasks.value.filter(isTaskSuccess).findIndex((x) => x.taskId === t.taskId)
  lbIndex.value = Math.max(0, at)
  lbShow.value = true
}

// ---------------- 样式常量 ----------------

const focusRing = 'outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)'
/** 舞台（原型 .v3-preview__stage）：1px line、r8、surface2 + 20px 淡棋盘格、内凹影 */
const stageCls =
  'relative flex-1 min-h-320px overflow-hidden box-border rounded-8px border border-solid border-line bg-surface2 ' +
  '[background-image:repeating-conic-gradient(#eef0f2_0_25%,transparent_0_50%)] bg-[length:20px_20px] ' +
  'shadow-[inset_0_1px_2px_rgba(31,35,41,0.055),inset_0_0_0_1px_rgba(255,255,255,0.7)]'
/** 舞台空态（原型 .v3-preview__empty）：内边距 18、gap 5，说明 11/1.55 muted */
const emptyCls =
  'absolute inset-0 flex flex-col items-center justify-center gap-5px p-18px text-center text-11px leading-[1.55] text-muted'
/** 压在图上的毛玻璃胶囊（原型 .v3-cf-edit）：视觉 26 高 r13、84% 白 + 模糊 8，命中区外扩到 34；字号按 §10 交互下限 12（原型 10.5） */
const pillCls =
  'sx-hit inline-flex items-center gap-4px h-26px box-border px-10px rounded-13px border border-solid border-white/60 ' +
  'bg-white/84 backdrop-blur-[8px] shadow-[0_2px_8px_rgba(31,35,41,0.14)] text-12px font-400 leading-none text-violet-ink ' +
  'cursor-pointer whitespace-nowrap [transition:background_120ms] hover:bg-white motion-reduce:transition-none ' +
  focusRing
</script>

<template>
  <div class="relative flex h-full min-h-0 flex-col">
    <div class="stu-scroll flex min-h-0 flex-1 flex-col box-border p-12px overflow-y-auto [scrollbar-gutter:stable]">
      <!-- 加载态：选中的批次还没进已加载列表（原型 .studio-result-muted：最小高 420、r8、page 底） -->
      <div
        v-if="pending && !detail"
        class="flex min-h-420px flex-col items-center justify-center gap-8px rounded-lg bg-page"
        role="status"
        aria-live="polite"
      >
        <n-spin size="small" />
        <span class="text-13px leading-20px text-muted">正在载入批次…</span>
      </div>

      <!-- 功能介绍（原型 ToolIntroPanel fill：没有记录时占满整列；内边距 18、块间距 14） -->
      <div v-else-if="!detail && showIntro" class="flex h-full min-h-0 flex-col p-6px">
        <slot name="intro">
          <aside class="flex flex-col gap-14px" aria-label="功能介绍">
            <div>
              <h3 class="m-0 text-14px font-600 leading-22px text-ink">功能介绍</h3>
              <p v-if="introCopy!.intro" class="mb-0 mt-20px text-13px leading-[1.65] text-ink-2">
                {{ introCopy!.intro }}
              </p>
            </div>
            <div
              v-if="introCopy!.scenes.length"
              class="p-10px box-border border border-solid border-line-soft rounded-6px bg-surface2"
            >
              <p class="m-0 text-13px font-500 leading-20px text-ink">适用场景</p>
              <ul class="m-0 mt-6px flex list-none flex-col gap-5px p-0 text-13px leading-[1.55] text-ink-2">
                <li v-for="scene in introCopy!.scenes" :key="scene">{{ scene }}</li>
              </ul>
            </div>
          </aside>
        </slot>
        <p v-if="runningTotal" class="m-0 mt-14px text-11px leading-16px text-violet-ink" role="status">
          {{ runningTotal }} 个任务处理中，完成后会更新到下方历史记录
        </p>
      </div>

      <!-- 空态（原型 StudioPreviewEmpty：最小高 420、内边距 24、r8、gap 6；图标圆 56 / 26） -->
      <div
        v-else-if="!detail"
        class="flex h-full min-h-420px box-border flex-col items-center justify-center gap-6px p-24px rounded-lg bg-white text-center"
      >
        <span
          class="mb-6px flex h-56px w-56px items-center justify-center rounded-full bg-page text-violet"
          aria-hidden="true"
        >
          <svg
            class="h-26px w-26px"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
            <path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />
          </svg>
        </span>
        <p class="m-0 text-13px font-500 leading-20px text-muted">生成后在这里出结果</p>
        <p class="m-0 text-11px leading-17px text-placeholder">在左侧传好素材、调好参数，点底部按钮提交</p>
        <p class="m-0 text-11px leading-17px text-placeholder">生成过程中可以随时改参数接着做下一批</p>
      </div>

      <!-- 批次结果（原型 v3-preview：gap 10） -->
      <div v-else class="flex min-h-full flex-1 flex-col gap-10px">
        <!-- 头部：标题 14/600 + 状态·时间 11 + 记录名 11（最宽 240）+ 查看方式 + 操作 -->
        <div class="flex flex-none flex-wrap items-center gap-8px min-w-0">
          <h2 class="m-0 text-14px font-600 leading-[1.55] text-ink">生成结果</h2>
          <span class="text-11px leading-[1.55] text-muted">{{ summary!.chip.label }} · {{ summary!.short }}</span>
          <span class="min-w-0 max-w-240px truncate text-11px leading-16px text-placeholder" :title="headerName">{{
            headerName
          }}</span>
          <div
            v-if="modes.length > 1"
            class="flex-none ml-auto flex gap-4px p-2px box-border rounded-6px border border-solid border-line bg-surface3 shadow-[inset_0_1px_2px_rgba(31,35,41,0.055),inset_0_0_0_1px_rgba(255,255,255,0.7)]"
            role="group"
            aria-label="查看方式"
          >
            <!-- §10：视觉 28 / 12px，命中外扩 2 → 32；按钮间距 4，外扩各占一半不重叠（原型 26 / 11 让位于 §10） -->
            <button
              v-for="m in modes"
              :key="m.key"
              type="button"
              class="relative after:(content-empty absolute -inset-2px rounded-[inherit]) h-28px box-border px-10px rounded-4px border border-solid text-12px leading-26px cursor-pointer [transition:background_300ms_cubic-bezier(0.4,0,0.2,1),border-color_300ms_cubic-bezier(0.4,0,0.2,1),color_300ms_cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
              :class="[
                focusRing,
                mode === m.key
                  ? 'border-violet-line bg-[linear-gradient(180deg,#ffffff_0%,#f8f3fc_100%)] font-600 text-violet-ink shadow-[0_1px_2px_rgba(31,35,41,0.05)]'
                  : 'border-transparent bg-transparent font-400 text-muted hover:text-ink',
              ]"
              :aria-pressed="mode === m.key"
              @click="mode = m.key"
            >
              {{ m.label }}
            </button>
          </div>
          <!-- 头部操作：存为资产 · 下载（md 32、间距 8）；校色对比档的两个下载放在图上 -->
          <span
            v-if="selectedSuccess && mode !== 'colorfix'"
            class="flex-none flex items-center gap-6px"
            :class="modes.length > 1 ? '' : 'ml-auto'"
          >
            <IconButton
              v-if="showSaveAsset"
              :label="
                savePending
                  ? `${LIBRARY_PENDING_LABEL}：完成后即可存为资产`
                  : !canSaveAsset
                    ? '存为资产：这张结果可能还在入库，点一下重新查询'
                    : cfOn
                      ? '存为资产（校色前 / 后两版）'
                      : '存为资产'
              "
              :loading="saving"
              :disabled="savePending"
              @click="saveAsAsset"
            >
              <svg v-if="saving || savePending" class="animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity="0.25" stroke-width="2.5" />
                <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
              </svg>
              <svg
                v-else
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <rect x="3.5" y="8" width="17" height="12.5" rx="2.2" />
                <path d="M6 5h12M8.5 2.5h7" />
              </svg>
            </IconButton>
            <IconButton :label="cfOn ? '下载（校色后）' : '下载'" @click="download">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
              </svg>
            </IconButton>
          </span>
        </div>

        <!-- 舞台 -->
        <div :class="stageCls">
          <template v-if="selectedSuccess">
            <!-- 校色对比：校色前（原图）vs 校色后（烘好的图）；右下两个下载胶囊 -->
            <template v-if="mode === 'colorfix' && showCfCompare">
              <ToolImageCompare
                :before="selectedSuccess.resultUrl"
                :after="displaySrc"
                :after-filter="liveFilter"
                :labels="['校色前', '校色后']"
                aria-label="校色前后对比"
                cors
              />
              <span class="absolute right-10px bottom-10px z-6 flex items-center gap-6px">
                <button type="button" :class="[pillCls, '!bg-white/72 !text-ink-2']" @click="downloadBefore">
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
                    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
                  </svg>
                  下载校色前
                </button>
                <button type="button" :class="pillCls" @click="downloadCorrected">
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
                    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
                  </svg>
                  下载校色后
                </button>
              </span>
            </template>

            <!-- 前后对比：商拍 = 模特图、姿态 = 参考姿势图 vs 成品（校色态右侧为校色后） -->
            <ToolImageCompare
              v-else-if="mode === 'compare' && before"
              :before="before.url"
              :after="displaySrc"
              :after-filter="liveFilter"
              :labels="[before.label, '生成结果']"
              :aria-label="`${before.label}与生成结果前后对比`"
            />

            <!-- 结果：contain 居中，点 / Enter / 空格放大 -->
            <img
              v-else
              :src="displaySrc"
              :crossorigin="cfTool ? corsAttr(displaySrc) : undefined"
              :alt="taskCaption(selectedSuccess, props.detail?.batch)"
              class="absolute inset-0 block m-auto max-w-full max-h-full object-contain cursor-zoom-in"
              :class="focusRing"
              :style="liveFilter ? { filter: liveFilter } : undefined"
              role="button"
              tabindex="0"
              title="点击放大"
              aria-label="放大查看生成结果"
              @click="openLightbox"
              @keydown.enter.prevent="openLightbox"
              @keydown.space.prevent="openLightbox"
              @error="selectedSuccess && onResultError(selectedSuccess, displaySrc)"
            />

            <!-- 没识别到服装：退回整图校色的小提示（结果档，校色开着时） -->
            <span
              v-if="cfOn && garmentFallback && mode === 'result'"
              class="absolute left-10px bottom-10px z-6 max-w-[calc(100%-20px)] truncate px-8px py-4px box-border rounded-4px bg-white/84 backdrop-blur-[8px] shadow-[0_2px_8px_rgba(31,35,41,0.14)] text-11px leading-16px text-ink-2"
              role="status"
            >
              未识别到服装区域，校色将作用于整张图
            </span>

            <!-- 校色调整（商拍 / 姿态 / 图片生成的成品，三档都在） -->
            <button
              v-if="cfTool"
              type="button"
              :class="[pillCls, 'absolute top-10px right-10px z-6']"
              :aria-pressed="panelOpen"
              aria-label="校色调整"
              @click.stop="openPanel"
            >
              <svg
                class="w-13px h-13px"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
                <circle cx="15" cy="7" r="2" />
                <circle cx="9" cy="17" r="2" />
              </svg>
              校色调整
            </button>
          </template>

          <!-- 生成中（含批次还没拆出任务）：34 圆转圈 -->
          <div
            v-else-if="(selectedTask && isTaskRunning(selectedTask)) || (!selectedTask && summary!.running)"
            :class="[emptyCls, '!gap-8px']"
            role="status"
            aria-live="polite"
          >
            <span class="spp-loader" aria-hidden="true" />
            <b class="text-13px font-600 leading-[1.4] text-ink-2">正在生成</b>
            <span class="max-w-240px">任务已提交，完成后结果会出现在这里</span>
            <span v-if="runningInBatch > 1" class="text-violet-ink">共 {{ runningInBatch }} 个任务处理中</span>
          </div>

          <!-- 失败：原因 + 重试这张 -->
          <div v-else-if="selectedTask && selectedTask.status === 3" :class="emptyCls" role="status">
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
            <b class="text-13px font-600 leading-[1.4] text-ink-2">这一条失败了</b>
            <span class="max-w-280px break-all text-danger">{{
              selectedTask.errorReason || '生成失败，点数已按规则退回'
            }}</span>
            <n-popconfirm
              v-if="retrySupported && canRetryTask(detail!.batch, selectedTask)"
              @positive-click="retryTask(selectedTask)"
            >
              <template #trigger>
                <button type="button" class="sx-btn mt-6px" :disabled="!!retrying">
                  {{ retrying === selectedTask.taskId ? '提交中…' : '重试这张' }}
                </button>
              </template>
              {{ retryConfirmText(detail!) }}
            </n-popconfirm>
          </div>

          <!-- 已取消 / 其它 -->
          <div v-else :class="emptyCls">
            <b class="text-13px font-600 leading-[1.4] text-ink-2">{{
              selectedTask ? `这一条${taskChip(selectedTask.status).label}` : '这条记录没有可预览的产物'
            }}</b>
            <span class="max-w-240px">{{
              selectedTask?.status === 4 ? '未开始的任务已取消，点数原路退回' : '可以点「重新编辑」再提交一次'
            }}</span>
          </div>
        </div>

        <!-- 成品入素材库状态（§4.6）：常驻 live region，pending → 空 / failed 时读屏能播报 -->
        <div v-if="selectedSuccess" class="flex-none empty:hidden" role="status" aria-live="polite">
          <div
            v-if="libraryState === 'pending'"
            class="flex items-center gap-6px text-12px leading-18px text-muted"
            title="成品已可查看和下载，正在后台存入素材库，通常几秒内完成"
          >
            <span
              class="shrink-0 w-10px h-10px box-border border-[1.5px] border-solid border-violet-line border-t-violet rounded-full animate-spin animate-duration-1000 motion-reduce:animate-none"
              aria-hidden="true"
            />
            {{ LIBRARY_PENDING_HINT }}
          </div>
          <div
            v-else-if="libraryState === 'failed'"
            class="flex items-center gap-6px text-12px leading-18px text-warning"
            title="成品仍可查看和下载，但素材库里没有这条，不能存为资产"
          >
            <span class="shrink-0 w-6px h-6px rounded-full bg-warning" aria-hidden="true" />
            {{ LIBRARY_FAILED_HINT }}
          </div>
        </div>

        <!-- 这张图的读图 / 参考图提示（验收 F12 / B2：结果里就地展示，不只 toast） -->
        <ul
          v-if="selectedTask?.warnings?.length"
          class="flex-none m-0 pl-0 list-none flex flex-col gap-4px p-8px box-border rounded-6px bg-warning-soft text-12px leading-18px text-warning"
          role="note"
          aria-label="这张图的提示"
        >
          <li v-for="w in selectedTask.warnings" :key="w" class="break-all">{{ w }}</li>
        </ul>

        <!-- 候选 4 列、gap 6，方形 r4；选中 1px violet 描边 + 1px 光晕；悬停 / 聚焦看大图 -->
        <div v-if="tasks.length > 1" class="flex-none grid gap-6px grid-cols-4" role="group" aria-label="候选结果">
          <div v-for="(task, i) in tasks" :key="task.taskId" class="group relative">
            <button
              type="button"
              class="relative block w-full overflow-hidden aspect-square box-border p-0 rounded-4px border border-solid bg-surface3 cursor-pointer"
              :class="[
                focusRing,
                selectedTask?.taskId === task.taskId
                  ? 'border-violet shadow-[0_0_0_1px_#875f9a]'
                  : 'border-line hover:border-control',
              ]"
              :aria-label="`${taskCaption(task, props.detail?.batch)} · ${taskChip(task.status).label}`"
              :aria-pressed="selectedTask?.taskId === task.taskId"
              @click="selectTask(task)"
            >
              <img
                v-if="isTaskSuccess(task)"
                :src="task.resultUrl"
                :crossorigin="cfTool ? corsAttr(task.resultUrl) : undefined"
                :alt="taskCaption(task, props.detail?.batch)"
                class="block w-full h-full object-cover"
                loading="lazy"
                draggable="false"
                @error="onResultError(task, task.resultUrl)"
              />
              <span
                v-else-if="isTaskRunning(task)"
                class="absolute inset-0 flex flex-col items-center justify-center gap-4px text-11px leading-16px text-ink-2"
              >
                <span class="spp-loader spp-loader--sm" aria-hidden="true" />
                <span class="tabular-nums">{{ task.status === 0 ? '排队中' : `${task.progress}%` }}</span>
              </span>
              <span
                v-else
                class="absolute inset-0 flex items-center justify-center p-4px text-11px leading-16px text-center"
                :class="task.status === 3 ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'"
              >
                {{ task.status === 3 ? '失败' : taskChip(task.status).label }}
              </span>
            </button>
            <!-- 悬停大图（原型 HoverPreview）：延迟 320ms、入场 120ms 上浮 4px；后两列往左展开；纯看不挡点击 -->
            <div
              v-if="isTaskSuccess(task)"
              class="spp-hover hidden group-hover:block group-focus-within:block absolute bottom-[calc(100%+6px)] z-30 w-248px box-border p-4px rounded-8px border border-solid border-line bg-white shadow-[0_12px_28px_rgba(31,35,41,0.16),0_2px_6px_rgba(31,35,41,0.06)] pointer-events-none"
              :class="i % 4 >= 2 ? 'right-0' : 'left-0'"
              aria-hidden="true"
            >
              <div class="grid place-items-center w-240px h-[312px] overflow-hidden rounded-6px bg-surface2">
                <img
                  :src="task.resultUrl"
                  :crossorigin="cfTool ? corsAttr(task.resultUrl) : undefined"
                  alt=""
                  class="block max-w-full max-h-[312px] object-contain"
                  @error="onResultError(task, task.resultUrl)"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- 当前任务的提示词：姿态可编辑 / 复制 / 复制全部 / 编辑后重新生成；商拍只读（C2 / C4 / C16） -->
        <StudioPromptCard
          v-if="selectedTask && (detail!.batch.kind === 'pose' || selectedTask.promptText)"
          :detail="detail!"
          :task="selectedTask"
          @regenerated="onRegenerated"
        />

        <p
          v-if="runningTotal && !(selectedTask && isTaskRunning(selectedTask))"
          class="flex-none m-0 text-11px leading-16px text-muted"
        >
          还有 {{ runningTotal }} 个任务处理中，完成后会补进中间那一列
        </p>

        <!-- 批次摘要：成功 / 失败 / 点数 / 时间 + 阶段进度 + 取消 / 重新编辑 / 删除 -->
        <div class="flex-none p-12px box-border border border-solid border-line rounded-lg bg-white">
          <div class="flex gap-8px items-center min-w-0">
            <span class="min-w-0 truncate text-13px font-600 text-ink">{{ summary!.title }}</span>
            <span class="ll-chip" :class="summary!.chip.cls">{{ summary!.chip.label }}</span>
          </div>
          <div class="mt-6px text-12px leading-18px text-muted">
            成功 {{ summary!.done }} · 失败 {{ summary!.failed }} / 共 {{ summary!.total }} 张
            <span class="mx-4px text-line-strong">·</span> 预估 {{ summary!.points }} 点
            <span class="mx-4px text-line-strong">·</span> {{ summary!.time }}
          </div>
          <!-- 生成中（原型 StudioProgress：横条高 6 / r3 + 阶段 + 百分比 + 可离开提示） -->
          <div v-if="summary!.running" class="mt-8px flex flex-col gap-6px">
            <div
              class="h-6px overflow-hidden rounded-3px bg-line-soft"
              role="progressbar"
              :aria-valuenow="Math.round(summary!.progress)"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-label="批次进度"
            >
              <div
                class="h-full rounded-3px sx-grad-progress transition-[width] duration-slow ease-sx"
                :style="{ width: summary!.progress + '%' }"
              />
            </div>
            <div class="flex items-center gap-8px">
              <span class="text-12px leading-18px text-ink">{{ summary!.chip.label }}</span>
              <span class="text-11px leading-16px text-ink tabular-nums">{{ Math.round(summary!.progress) }}%</span>
              <span class="ml-auto text-11px leading-16px text-placeholder">可以离开这一页，任务不会中断</span>
            </div>
          </div>
          <div v-if="summary!.reason" class="mt-6px text-12px text-danger break-all">{{ summary!.reason }}</div>
          <ul
            v-if="summary!.warnings.length"
            class="mt-6px mb-0 pl-0 list-none flex flex-col gap-2px text-12px leading-18px text-warning"
            role="note"
            aria-label="本批提示"
          >
            <li v-for="w in summary!.warnings" :key="w" class="break-all">提示：{{ w }}</li>
          </ul>
          <div class="flex flex-wrap gap-6px justify-end mt-8px">
            <n-popconfirm v-if="summary!.running" @positive-click="cancelBatch(detail!)">
              <template #trigger
                ><button type="button" class="sx-btn-ghost !text-violet-ink hover:!text-violet-press">
                  取消批次
                </button></template
              >
              只会取消还没开始的任务，已开始的继续跑完，确定取消？
            </n-popconfirm>
            <button
              type="button"
              class="sx-btn-ghost !text-violet-ink hover:!text-violet-press"
              @click="reedit(detail!)"
            >
              重新编辑
            </button>
            <n-popconfirm v-if="!summary!.running" @positive-click="removeBatch(detail!)">
              <template #trigger
                ><button type="button" class="sx-btn-ghost !text-danger hover:!bg-danger-soft">
                  删除批次
                </button></template
              >
              删除后历史里不再显示（已入素材库的成品图不受影响），确定删除？
            </n-popconfirm>
          </div>
        </div>
      </div>
    </div>

    <!-- 校色参数台：悬浮在结果列里（相对本列定位，不随内容滚动），可拖动、夹在列内 -->
    <ColorFixPanel
      v-if="detail && cfTool"
      v-model="cfParams"
      v-model:region="region"
      :open="panelVisible"
      :title="cfTitle"
      :region-modes="regionModes"
      :auto-targets="autoTargets"
      :garment-parts="garmentParts"
      :mask-busy="maskBusy"
      :mask-hint="maskHint"
      :has-painted="!!paintedMask"
      @done="closePanel"
      @paint="painterShow = true"
    />
    <ColorFixMaskPainter
      v-if="detail && cfTool && selectedSrc"
      v-model:show="painterShow"
      :src="selectedSrc"
      @apply="applyPaintedMask"
    />

    <MediaLightbox v-model:show="lbShow" v-model:index="lbIndex" :items="lbItems" />
  </div>
</template>

<style scoped lang="less">
@import '@/assets/variables.less';

/* 滚动条 mixin 无法用原子类表达 */
.stu-scroll {
  .scrollbar-autohide(@width: 8px, @trackColor: var(--xq-surface), @thumbColor: rgb(var(--xq-ink-rgb) / 0.1), @thumbWidth: 4px, @hoverColor: rgb(var(--xq-ink-rgb) / 0.35));
}

/* 生成中：34 圆藤紫旋转环（2px 环、800ms 一圈）；减少动态效果时放慢到 2.4s 仍保持转动（表示还在跑） */
.spp-loader {
  display: block;
  width: 34px;
  height: 34px;
  box-sizing: border-box;
  margin-bottom: 2px;
  border: 2px solid var(--xq-violet-soft);
  border-top-color: var(--xq-violet);
  border-radius: 50%;
  animation: spp-spin 800ms linear infinite;
}
.spp-loader--sm {
  width: 18px;
  height: 18px;
  margin-bottom: 0;
}
@keyframes spp-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spp-loader {
    animation-duration: 2400ms;
  }
}

/* 候选悬停大图：延迟 320ms 出现、120ms 上浮 4px */
.spp-hover {
  animation: spp-preview-in 120ms ease 320ms both;
}
@keyframes spp-preview-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .spp-hover {
    animation: none;
  }
}
</style>
