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
 * <p>服装校色（仅商拍换装 / 姿态复刻）：参数台编辑 useColorFix 单例里的 params；切任务时按任务还原参数
 * （colorfix/persist.ts），**不改**输入区的提交开关 enabled（胶囊用 openPanelOnly）——这一批结果是否校色只看它提交时的
 * `payload.color_fix`，或这张图保存过参数 / 本次调过 / 参数台开着。参数台开着时切到别的任务，新任务直接进校色态并套用
 * 它自己的参数（面板数值与舞台一致）。用户打开过参数台、调过参数或点过候选后，选中的任务就钉住，轮询带来的新成品
 * 不会把舞台切走。显示、灯箱、对比右侧、下载、存资产都用烘进像素的图（colorfix/useColorFixBake.ts），
 * CSS filter 只在烘好之前做即时预览。
 *
 * <p>未选中 / 无历史时：有功能介绍文案就按原型 ToolIntroPanel 整列显示「功能介绍 + 适用场景」（有在跑任务时补一行提示），
 * 否则显示空态引导。在跑批次由 useStudioHistory 轮询，这里只做展示。
 */
import { computed, nextTick, onBeforeUnmount, ref, useSlots, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { studioBatchDetail, studioCancelBatch, studioDeleteBatch, studioRetryTask } from '@/api/studio.ts'
import { toApiError } from '@/api/index.ts'
import { goUploadImage } from '@/api/goUpload.ts'
import { assetLibAddVersion } from '@/api/assetLibrary.ts'
import type { StudioBatchDetail, StudioTask } from '@/api/studioTypes.ts'
import IconButton from '@/components/IconButton/index.vue'
import MediaLightbox from '@/components/MediaLightbox/index.vue'
import type { LightboxItem } from '@/components/MediaLightbox/index.vue'
import ToolImageCompare from '@/views/tools/ToolImageCompare.vue'
import ColorFixPanel from '@/views/tools/ColorFixPanel.vue'
import { COLORFIX_DEFAULT, colorFixDataUrlToFile, colorFixEquals, corsAttr, markCorsBlocked } from '@/utils/colorfix.ts'
import { downloadImage } from '@/utils/download.ts'
import type { useStudioHistory } from '../../hooks.ts'
import { KIND_LABEL, batchChip, batchProgress, formatTime, isBatchTerminal, taskCaption, taskChip } from '../../constants.ts'
import { useColorFix } from '../../colorfix/useColorFix.ts'
import { downloadDataUrl, extOf, useColorFixBake } from '../../colorfix/useColorFixBake.ts'
import {
  lastSavedAssetColorFix,
  loadTaskColorFix,
  rememberSavedAssetColorFix,
  saveTaskColorFix,
} from '../../colorfix/persist.ts'
import { STUDIO_INTRO } from './intro.ts'
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
    message.success(`已取消 ${res.data?.canceled_tasks ?? 0} 个未开始任务，点数原路退回`)
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
  retrying.value = task.task_id
  try {
    await studioRetryTask(task.task_id)
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

// ---------------- 展示辅助 ----------------

/** 任务态是否展示为进行中（0 排队 / 1 生成中 / 5 交付中） */
const isTaskRunning = (task: StudioTask) => task.status === 0 || task.status === 1 || task.status === 5
const isTaskSuccess = (task: StudioTask | null | undefined): boolean =>
  !!task && task.status === 2 && !!task.result_url

/** 全部在跑的任务数（各批次未结束的张数之和）：功能介绍与底部提示用 */
const runningTotal = computed(() =>
  ctl.items.value.reduce(
    (n, d) => n + (isBatchTerminal(d.batch.status) ? 0 : Math.max(0, d.batch.task_total - d.batch.task_done - d.batch.task_failed)),
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
    done: d.batch.task_done,
    failed: d.batch.task_failed,
    total: d.batch.task_total,
    points: d.batch.estimated_points,
    time: formatTime(d.batch.created_at),
    short: shortTime(d.batch.created_at),
    progress: batchProgress(d.batch),
    running: !isBatchTerminal(d.batch.status),
    reason: d.batch.error_reason,
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
    tasks.value.find((t) => t.task_id === selectedTaskId.value) ??
    tasks.value.find((t) => isTaskSuccess(t)) ??
    tasks.value[0] ??
    null,
)
const selectedSuccess = computed<StudioTask | null>(() => (isTaskSuccess(selectedTask.value) ? selectedTask.value : null))
const selectedSrc = computed(() => selectedSuccess.value?.result_url ?? '')
const runningInBatch = computed(() => tasks.value.filter(isTaskRunning).length)

/** 把当前看到的那张钉住（只在还没钉住时写，不改变舞台） */
function pinSelected() {
  const t = selectedTask.value
  if (t && selectedTaskId.value !== t.task_id) selectedTaskId.value = t.task_id
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
  const caption = taskCaption(t).replace(/^姿态复刻 · /, '')
  return `${kind}-${d.batch.id}-${caption}`.replace(/[\\/:*?"<>|\s·]+/g, '-').replace(/-+/g, '-')
})

// ---------------- 服装校色 ----------------

const cf = useColorFix()
const { panelOpen, params: cfParams, touched: cfTouched } = cf

/** 只有商拍换装 / 姿态复刻做服装校色（原型 COLORFIX_TOOLS） */
const cfTool = computed(() => props.detail?.batch.kind === 'tryon' || props.detail?.batch.kind === 'pose')
/** 这张结果是否处于校色态：提交时开了默认校色 / 保存过参数 / 本次打开过参数台或调过参数 */
const resultOn = ref(false)
let syncing = false

watch(
  () => `${props.detail?.batch.id ?? ''}|${selectedTask.value?.task_id ?? ''}`,
  async () => {
    syncing = true
    const d = props.detail
    const t = selectedTask.value
    const saved = t ? loadTaskColorFix(t) : null
    cfParams.value = saved ? { ...saved } : { ...COLORFIX_DEFAULT }
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
// 打开参数台（胶囊或输入区「调整」）：等同开启这张结果的校色
watch(panelOpen, (open) => {
  if (open && !syncing) persistCurrent()
})

const cfOn = computed(() => cfTool.value && !!selectedSuccess.value && (resultOn.value || cfTouched.value))
const showCfCompare = cfOn

const bake = useColorFixBake({
  src: selectedSrc,
  params: cfParams,
  on: cfOn,
  mask: computed(() => selectedSuccess.value?.mask_url),
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
  selectedTaskId.value = task.task_id
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
    void downloadImage(t.result_url, `${fileTitle.value}.${extOf(t.result_url)}`)
  }
}

/** 头部「下载」：校色态下载烘好的校色图，否则原图 */
function download() {
  const t = selectedSuccess.value
  if (!t) return
  if (cfOn.value) void downloadCorrected()
  else void downloadImage(t.result_url, `${fileTitle.value}.${extOf(t.result_url)}`)
}

function downloadBefore() {
  const t = selectedSuccess.value
  if (t) void downloadImage(t.result_url, `${fileTitle.value}-校色前.${extOf(t.result_url)}`)
}

const saving = ref(false)
/** 成品已入素材库（asset_id > 0）；asset_id = 0 时按钮仍可点，点了先重拉一次批次再判断（入库可能刚完成） */
const canSaveAsset = computed(() => (selectedSuccess.value?.asset_id ?? 0) > 0)
const showSaveAsset = computed(() => typeof selectedSuccess.value?.asset_id === 'number')

/** asset_id 还是 0：重拉一次批次详情（顺手更新列表里的这条），返回最新的 asset_id */
async function refetchAssetId(t: StudioTask): Promise<number> {
  const batchId = props.detail?.batch.id
  if (!batchId) return 0
  try {
    const fresh = (await studioBatchDetail(batchId)).data
    if (!fresh) return 0
    const at = ctl.items.value.findIndex((d) => d.batch.id === batchId)
    if (at >= 0) ctl.items.value[at] = fresh
    return fresh.tasks.find((x) => x.task_id === t.task_id)?.asset_id ?? 0
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
    let assetId = t.asset_id ?? 0
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
    const last = lastSavedAssetColorFix(t.task_id)
    if (last && colorFixEquals(last, params)) {
      message.info('已存过这一版')
      return
    }
    const baked = await bake.exportBaked()
    const url = await goUploadImage(colorFixDataUrlToFile(baked, `colorfix-${t.task_id}.png`))
    await assetLibAddVersion(assetId, {
      image_url: url,
      prompt: '校色后',
      params: JSON.stringify({ colorFix: params, sourceImage: t.result_url }),
    })
    rememberSavedAssetColorFix(t.task_id, params)
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
    url: t.task_id === selectedSuccess.value?.task_id && !liveFilter.value ? displaySrc.value : t.result_url,
    name: taskCaption(t),
  })),
)

function openLightbox() {
  const t = selectedSuccess.value
  if (!t) return
  const at = tasks.value.filter(isTaskSuccess).findIndex((x) => x.task_id === t.task_id)
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
/** 压在图上的毛玻璃胶囊（原型 .v3-cf-edit）：视觉 26 高 r13、84% 白 + 模糊 8，命中区外扩到 34 */
const pillCls =
  'sx-hit inline-flex items-center gap-4px h-26px box-border px-10px rounded-13px border border-solid border-white/60 ' +
  'bg-white/84 backdrop-blur-[8px] shadow-[0_2px_8px_rgba(0,0,0,0.14)] text-11px font-500 leading-none text-violet-ink ' +
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
          <span class="min-w-0 max-w-240px truncate text-11px leading-16px text-placeholder" :title="summary!.title">{{
            summary!.title
          }}</span>
          <div
            v-if="modes.length > 1"
            class="flex-none ml-auto flex p-2px box-border rounded-6px border border-solid border-line bg-surface3 shadow-[inset_0_1px_2px_rgba(31,35,41,0.055),inset_0_0_0_1px_rgba(255,255,255,0.7)]"
            role="group"
            aria-label="查看方式"
          >
            <button
              v-for="m in modes"
              :key="m.key"
              type="button"
              class="h-28px box-border px-12px rounded-4px border border-solid text-13px leading-26px cursor-pointer [transition:background_300ms_cubic-bezier(0.4,0,0.2,1),border-color_300ms_cubic-bezier(0.4,0,0.2,1),color_300ms_cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
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
            class="flex-none flex items-center gap-8px"
            :class="modes.length > 1 ? '' : 'ml-auto'"
          >
            <IconButton
              v-if="showSaveAsset"
              :label="
                !canSaveAsset
                  ? '存为资产：这张结果可能还在入库，点一下重新查询'
                  : cfOn
                    ? '存为资产（校色前 / 后两版）'
                    : '存为资产'
              "
              :loading="saving"
              @click="saveAsAsset"
            >
              <svg v-if="saving" class="animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
                :before="selectedSuccess.result_url"
                :after="displaySrc"
                :after-filter="liveFilter"
                :labels="['校色前', '校色后']"
                aria-label="校色前后对比"
                cors
              />
              <span class="absolute right-10px bottom-10px z-6 flex items-center gap-8px">
                <button type="button" :class="[pillCls, '!bg-white/72 !text-ink-2']" @click="downloadBefore">
                  <svg class="w-13px h-13px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
                  </svg>
                  下载校色前
                </button>
                <button type="button" :class="pillCls" @click="downloadCorrected">
                  <svg class="w-13px h-13px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
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
              :alt="taskCaption(selectedSuccess)"
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
              @error="cfTool && markCorsBlocked(displaySrc)"
            />

            <!-- 校色调整（商拍 / 姿态的成品，三档都在） -->
            <button
              v-if="cfTool"
              type="button"
              :class="[pillCls, 'absolute top-10px right-10px z-6']"
              :aria-pressed="panelOpen"
              aria-label="校色调整"
              @click.stop="openPanel"
            >
              <svg class="w-13px h-13px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
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
              <svg class="w-16px h-16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                <path d="M12 7v6M12 16.5v.5" />
              </svg>
            </span>
            <b class="text-13px font-600 leading-[1.4] text-ink-2">这一条失败了</b>
            <span class="max-w-280px break-all text-danger">{{ selectedTask.error_reason || '生成失败，点数已按规则退回' }}</span>
            <n-popconfirm
              v-if="retrySupported && canRetryTask(detail!.batch, selectedTask)"
              @positive-click="retryTask(selectedTask)"
            >
              <template #trigger>
                <button type="button" class="sx-btn mt-6px" :disabled="!!retrying">
                  {{ retrying === selectedTask.task_id ? '提交中…' : '重试这张' }}
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

        <!-- 候选 4 列、gap 6，方形 r4；选中 1px violet 描边 + 1px 光晕；悬停 / 聚焦看大图 -->
        <div v-if="tasks.length > 1" class="flex-none grid gap-6px grid-cols-4" role="group" aria-label="候选结果">
          <div v-for="(task, i) in tasks" :key="task.task_id" class="group relative">
            <button
              type="button"
              class="relative block w-full overflow-hidden aspect-square box-border p-0 rounded-4px border border-solid bg-surface3 cursor-pointer"
              :class="[
                focusRing,
                selectedTask?.task_id === task.task_id
                  ? 'border-violet shadow-[0_0_0_1px_#875f9a]'
                  : 'border-line hover:border-#c9cfd6',
              ]"
              :aria-label="`${taskCaption(task)} · ${taskChip(task.status).label}`"
              :aria-pressed="selectedTask?.task_id === task.task_id"
              @click="selectTask(task)"
            >
              <img
                v-if="isTaskSuccess(task)"
                :src="task.result_url"
                :crossorigin="cfTool ? corsAttr(task.result_url) : undefined"
                :alt="taskCaption(task)"
                class="block w-full h-full object-cover"
                loading="lazy"
                draggable="false"
                @error="cfTool && markCorsBlocked(task.result_url)"
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
                  :src="task.result_url"
                  :crossorigin="cfTool ? corsAttr(task.result_url) : undefined"
                  alt=""
                  class="block max-w-full max-h-[312px] object-contain"
                  @error="cfTool && markCorsBlocked(task.result_url)"
                />
              </div>
            </div>
          </div>
        </div>

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
          <div class="flex flex-wrap gap-6px justify-end mt-8px">
            <n-popconfirm v-if="summary!.running" @positive-click="cancelBatch(detail!)">
              <template #trigger
                ><button type="button" class="sx-btn-ghost !text-violet-ink hover:!text-violet-press">
                  取消批次
                </button></template
              >
              只会取消还没开始的任务，已开始的继续跑完，确定取消？
            </n-popconfirm>
            <button type="button" class="sx-btn-ghost !text-violet-ink hover:!text-violet-press" @click="reedit(detail!)">
              重新编辑
            </button>
            <n-popconfirm v-if="!summary!.running" @positive-click="removeBatch(detail!)">
              <template #trigger
                ><button type="button" class="sx-btn-ghost !text-danger hover:!bg-danger-soft">删除批次</button></template
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
      :open="panelVisible"
      @done="closePanel"
    />

    <MediaLightbox v-model:show="lbShow" v-model:index="lbIndex" :items="lbItems" />
  </div>
</template>

<style scoped lang="less">
@import '@/assets/variables.less';

/* 滚动条 mixin 无法用原子类表达 */
.stu-scroll {
  .scrollbar-autohide(@width: 8px, @trackColor: #fff, @thumbColor: rgba(0, 0, 0, 0.1), @thumbWidth: 4px, @hoverColor: rgba(0, 0, 0, 0.35));
}

/* 生成中：34 圆藤紫旋转环（2px 环、800ms 一圈）；减少动态效果时放慢到 2.4s 仍保持转动（表示还在跑） */
.spp-loader {
  display: block;
  width: 34px;
  height: 34px;
  box-sizing: border-box;
  margin-bottom: 2px;
  border: 2px solid #f3edf8;
  border-top-color: #875f9a;
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
