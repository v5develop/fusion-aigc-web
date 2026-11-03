<script setup lang="ts">
/**
 * 工作流页 /workflow?flow=&category=&template=（query 形状与 v1.0 原型一致；契约 14 个 wf:* 按 schemas.ts 渲染）。
 *
 * <p>版式沿用工具页（views/tools）：左操作（模板切换 + 上传 + 参数，底部固定提交栏）/ 中历史 / 右结果 + 说明。
 * 提交打 Java v1 现有路由（schema.javaEndpoint），请求体按 schema 映射组装；服装工作流的 content 取
 * GET /api/v1/workflows/templates/{flow} 下发的模板 prompt；视频工作流的模型 / 清晰度 / 比例 / 时长取
 * GET /api/v1/features/video-model-configs（与视频生成工具同源），参考视频可上传或填分享链接（二选一）。结果与历史都取
 * GET /api/v1/workflows/{templateTitle}/histories（提交只回 workflowHistoryIds）。
 */
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { NSelect, useDialog, useMessage, type SelectProps } from 'naive-ui'
import { toApiError } from '@/api/index.ts'
import {
  submitWorkflow,
  workflowHistories,
  workflowTemplates,
  type WorkflowHistoryItem,
  type WorkflowTemplateView,
} from '@/api/workflows.ts'
import { videoModelConfigs, type ModelConfig } from '@/api/tools.ts'
import { useUserInfoStore } from '@/stores/userInfo'
import PointsBalanceChip from '@/components/points/PointsBalanceChip.vue'
import CreationOptionPills from '@/components/creation/CreationOptionPills.vue'
import ToolUploadSlot from '@/views/tools/ToolUploadSlot.vue'
import PollingOfflineBanner from '@/views/tools/PollingOfflineBanner.vue'
import CreationImageSettings from '@/components/creation/CreationImageSettings.vue'
import CreationSettingsRow from '@/components/creation/CreationSettingsRow.vue'
import CreationPromptInput from '@/components/creation/CreationPromptInput.vue'
import CreationActionBar from '@/components/creation/CreationActionBar.vue'
import CreationHistoryHeader from '@/components/creation/CreationHistoryHeader.vue'
import WorkflowTemplateHead from './WorkflowTemplateHead.vue'
import WorkflowFlowBoard, { type WorkflowFlowInput } from './WorkflowFlowBoard.vue'
import {
  creationSettingsSummary,
  toCreationOptions,
  type CreationOption,
  type CreationSettingKey,
  type CreationSettingsConfig,
  type CreationSettingsRowItem,
  type CreationSettingsValue,
} from '@/components/creation/types'
import {
  isWorkflowListed,
  resolveWorkflowSchema,
  restoreWorkflowForm,
  taskCountOf,
  toWorkflowJavaValue,
  workflowCategoryLabel,
  workflowFlowLabels,
  workflowSchemas,
  type WorkflowField,
  type WorkflowSchema,
} from './schemas'
import { isWorkflowTerminal, useWorkflowHistory } from './useWorkflowHistory'
import { takeRefill } from '@/utils/refillHandoff'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const dialog = useDialog()
const userInfo = useUserInfoStore()

const q = (v: unknown) => (Array.isArray(v) ? String(v[0] ?? '') : String(v ?? ''))
const schema = computed<WorkflowSchema | undefined>(() =>
  resolveWorkflowSchema(q(route.query.flow), q(route.query.category), q(route.query.template)),
)
const mapped = computed(() => schema.value?.status === 'mapped')
/** 流程板 ① 的输入项：按 schema 顺序 0–4 项（校验与提交也按这个顺序） */
const flowInputs = computed<WorkflowFlowInput[]>(() =>
  (schema.value?.uploads ?? []).map((u) => ({
    label: u.label,
    kind: u.kind === 'video' ? 'video' : 'image',
    max: u.max,
    withNote: !!u.itemNote,
  })),
)
/** 带逐张备注的槽位（SKU替换的「特殊需求」），传了图才出输入行 */
const hasNotes = (u: WorkflowSchema['uploads'][number]) => !!u.itemNote && (uploads[u.slot]?.length ?? 0) > 0

/** 模板切换目录：同 query 形状的链接；隐藏项不列，但当前打开的是隐藏项时仍带上 */
const treeOptions = computed(() =>
  workflowSchemas.filter((s) => isWorkflowListed(s) || s.schemaId === schema.value?.schemaId),
)
const linkOf = (s: WorkflowSchema) => ({
  path: '/workflow',
  query: { flow: s.flow, category: s.category, template: s.name },
})
const categoryLabel = computed(() =>
  schema.value ? workflowCategoryLabel(schema.value.flow, schema.value.category) || schema.value.name : '',
)
const headDesc = computed(() =>
  schema.value ? `${workflowFlowLabels[schema.value.flow]} · ${categoryLabel.value}` : '',
)
const actionHint = computed(() => {
  const n = schema.value?.uploads.length ?? 0
  return n ? `线已连好 · 上传 ${n} 个素材即可生成` : '无需上传素材 · 选好模板选项直接生成'
})

// ---------------- 表单状态 ----------------

// 图片设置（目标分辨率 / 画幅比例 / 生成张数）交给共用的 CreationImageSettings：
// 这几个字段合成一组，放进底部设置行（原型「图片设置 3:4 · 1K · 1 张 ▾」）的弹层；取值仍写回 values[key]，请求体不变
const SETTING_KEYS: readonly string[] = ['resolution', 'aspectRatio', 'count'] satisfies CreationSettingKey[]
const isSettingField = (f: WorkflowField) => SETTING_KEYS.includes(f.key) && f.type !== 'textarea'
const settingFields = computed(() => (schema.value?.fields ?? []).filter(isSettingField))
/** 视频模板的时长也进「视频设置」弹层（原型 WorkflowView.vue:1139-1182：清晰度 / 画幅比例 / 时长同一抽屉） */
const durationField = computed(() => schema.value?.fields.find((f) => f.key === 'duration'))
/** 表单里渲染的字段：设置字段改由底部设置行承载 */
const formFields = computed(() =>
  (schema.value?.fields ?? []).filter((f) => !isSettingField(f) && f !== durationField.value),
)
const settingsConfig = computed<CreationSettingsConfig>(() =>
  Object.fromEntries(
    settingFields.value.map((f) => [
      f.key,
      {
        label: f.label,
        required: f.required,
        // 数字字段（SKU替换张数 1–4）列成同范围的胶囊，取值仍是数字；下拉 / 胶囊字段取值仍是原字符串；
        // 视频字段的选项由服务端下发
        options:
          f.type === 'number'
            ? toCreationOptions(Array.from({ length: (f.max ?? 1) - (f.min ?? 1) + 1 }, (_, i) => (f.min ?? 1) + i))
            : fieldOptions(f),
      },
    ]),
  ),
)

const uploads = reactive<Record<number, string[]>>({})
const values = reactive<Record<string, any>>({})
const settingsValue = computed<CreationSettingsValue>(() =>
  Object.fromEntries(settingFields.value.map((f) => [f.key, values[f.key]])),
)
function onSettings(v: CreationSettingsValue) {
  for (const f of settingFields.value) values[f.key] = v[f.key as CreationSettingKey]
}
/** 底部设置行：有设置字段才出一枚按钮；视频模板叫「视频设置」 */
const settingItems = computed<CreationSettingsRowItem[]>(() =>
  settingFields.value.length
    ? [
        {
          key: 'settings',
          icon: 'gear',
          label: schema.value?.media === 'video' ? '视频设置' : '图片设置',
          value: [
            creationSettingsSummary(settingsConfig.value, settingsValue.value),
            durationField.value && values.duration ? `${values.duration} 秒` : '',
          ]
            .filter(Boolean)
            .join(' · '),
        },
      ]
    : [],
)

// ---------------- 视频模型（GET /api/v1/features/video-model-configs，与视频生成工具同源） ----------------

const videoModels = ref<ModelConfig[]>([])
const videoModelsLoaded = ref(false)
const videoModelsFailed = ref(false)

async function loadVideoModels() {
  videoModelsFailed.value = false
  try {
    const res = await videoModelConfigs()
    videoModels.value = (res.data ?? []).filter((m) => m && typeof m.model === 'string' && m.model)
    videoModelsLoaded.value = true
  } catch (err) {
    videoModelsFailed.value = true
    reportError(err, '视频模型加载失败')
  }
}

const currentVideoModel = computed(() => videoModels.value.find((m) => m.model === values.model))
const VIDEO_RATIO_LABELS: Record<string, string> = { adaptive: '自适应' }

/** 当前模型这一档清晰度的配置（按小写对齐：部分模型下发的是大写 768P、2K） */
function videoSizeOf(m: ModelConfig | undefined, resolution: unknown) {
  if (!m || typeof resolution !== 'string') return undefined
  return m.size?.find((x) => x.resolution?.toLowerCase() === resolution.toLowerCase())
}

/** 字段的可选项：静态取 schema.options；dynamic 按当前模型 / 清晰度现算（同视频生成工具） */
function fieldOptions(f: WorkflowField): CreationOption[] {
  if (!f.dynamic) return toCreationOptions(f.options ?? [])
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
      // 服务端没建模时长（duration 为空）：只给 v1 默认的 4 秒
      const range = Number.isInteger(min) && Number.isInteger(max) && min! > 0 && max! >= min! ? [min!, max!] : [4, 4]
      return Array.from({ length: range[1]! - range[0]! + 1 }, (_, i) => {
        const n = range[0]! + i
        return { label: `${n} 秒`, value: String(n) }
      })
    }
  }
}

/**
 * 模型表到了、换了模型 / 清晰度后，不再合法的取值落到第一档（按 schema 顺序：先模型、再清晰度、再比例与时长）。
 * 「重新编辑」回填的原值合法就保留。
 */
watch(
  () => [
    schema.value?.schemaId,
    videoModels.value,
    ...(schema.value?.fields ?? []).filter((f) => f.dynamic).map((f) => values[f.key]),
  ],
  () => {
    for (const f of schema.value?.fields ?? []) {
      if (!f.dynamic) continue
      const opts = fieldOptions(f)
      if (opts.length && !opts.some((o) => o.value === values[f.key])) values[f.key] = opts[0]!.value
    }
  },
)
/** 逐张备注，按图片地址存：删图 / 换顺序后备注仍跟着那张图 */
const itemNotes = reactive<Record<string, string>>({})
/** 视频槽的来源（upload = 上传 → videoUrl，link = 分享链接 → videoLink）与链接文本，按槽位存；二者只出网一个 */
const videoSource = reactive<Record<number, 'upload' | 'link'>>({})
const videoLinks = reactive<Record<number, string>>({})
const VIDEO_SOURCE_OPTIONS = [
  { key: 'upload', label: '上传视频' },
  { key: 'link', label: '视频链接' },
] as const
const isLinkMode = (u: WorkflowSchema['uploads'][number]) => !!u.linkAlt && videoSource[u.slot] === 'link'
const submitting = ref(false)
const selectedId = ref<number | null>(null)

const history = useWorkflowHistory(() => (mapped.value ? (schema.value?.templateTitle ?? '') : ''))

function reportError(err: unknown, fallback = '操作失败，请重试') {
  const apiErr = toApiError(err)
  if (apiErr && apiErr.code !== -1 && !apiErr.httpStatus) return
  if (apiErr?.isNetwork) message.error('网络异常或请求超时，请稍后在历史记录里确认是否已提交')
  else message.error(err instanceof Error && err.message ? err.message : fallback)
}

function setUploads(slot: number, urls: string[]) {
  uploads[slot] = urls
}

function clampNumber(f: WorkflowField) {
  const n = Math.round(Number(values[f.key]))
  values[f.key] = Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, Number.isFinite(n) ? n : (f.min ?? 1)))
}

function resetForm(s: WorkflowSchema) {
  for (const key of Object.keys(uploads)) delete uploads[Number(key)]
  for (const key of Object.keys(values)) delete values[key]
  for (const key of Object.keys(itemNotes)) delete itemNotes[key]
  for (const key of Object.keys(videoSource)) delete videoSource[Number(key)]
  for (const key of Object.keys(videoLinks)) delete videoLinks[Number(key)]
  for (const u of s.uploads) uploads[u.slot] = []
  for (const f of s.fields) if (f.default !== undefined) values[f.key] = f.default
  selectedId.value = null
}

// ---------------- 模板（GET /workflows/templates/{flow}） ----------------

const templatesByFlow = reactive<Record<string, WorkflowTemplateView[] | undefined>>({})
const templatesFailed = reactive<Record<string, boolean>>({})

async function loadTemplates(flow: string) {
  if (templatesByFlow[flow]) return
  templatesFailed[flow] = false
  try {
    const res = await workflowTemplates(flow)
    templatesByFlow[flow] = res.data ?? []
  } catch (err) {
    templatesFailed[flow] = true
    reportError(err, '模板加载失败')
  }
}

const templateView = computed(() =>
  schema.value ? templatesByFlow[schema.value.flow]?.find((t) => t.title === schema.value!.templateTitle) : undefined,
)
const templatePrompt = computed(() => templateView.value?.payload?.payload?.prompt?.trim() ?? '')
const sampleUrl = computed(() => templateView.value?.payload?.result?.[0] ?? '')
/** 模板中文名以后端为准，契约名兜底 */
const nameOf = (s: WorkflowSchema) =>
  templatesByFlow[s.flow]?.find((t) => t.title === s.templateTitle)?.titleZh || s.name

watch(
  schema,
  (s) => {
    history.stop()
    if (!s) return
    resetForm(s)
    if (s.status !== 'mapped') return
    void loadTemplates(s.flow)
    if (s.fields.some((f) => f.dynamic) && !videoModelsLoaded.value) void loadVideoModels()
    history.reload().catch((err) => reportError(err, '历史记录加载失败'))
  },
  { immediate: true },
)

// ---------------- 就绪判定 ----------------

const disabledReason = computed(() => {
  const s = schema.value
  if (!s) return ''
  if (s.status !== 'mapped') return '该工作流即将开放'
  if (s.contentSource === 'template-prompt') {
    if (templatesFailed[s.flow]) return '模板加载失败，请刷新页面重试'
    if (!templatesByFlow[s.flow]) return '模板加载中…'
    if (!templateView.value) return '该模板暂未启用'
    if (!templatePrompt.value) return '该模板缺少生成配置，暂不可用'
  }
  if (s.fields.some((f) => f.dynamic)) {
    if (videoModelsFailed.value) return '视频模型加载失败，请刷新页面重试'
    if (!videoModelsLoaded.value) return '视频模型加载中…'
    if (!videoModels.value.length) return '暂无可用的视频模型'
  }
  for (const u of s.uploads) {
    if (isLinkMode(u)) {
      if (u.required && !videoLinks[u.slot]?.trim()) return '请填写视频链接'
    } else if (u.required && !uploads[u.slot]?.length) return `还没上传${u.label}`
  }
  if (s.imageUrlsMax) {
    const total = s.uploads
      .filter((u) => u.javaKey === 'imageUrls')
      .reduce((n, u) => n + (uploads[u.slot]?.length ?? 0), 0)
    if (total > s.imageUrlsMax) return `图片合计最多 ${s.imageUrlsMax} 张`
  }
  for (const f of s.fields) {
    const v = values[f.key]
    const empty = v === undefined || v === null || (typeof v === 'string' && !v.trim())
    if (f.required && empty) return `请填写${f.label}`
    if (f.minLength && typeof v === 'string' && v.trim().length < f.minLength)
      return `${f.label}至少 ${f.minLength} 个字`
  }
  return ''
})

const costText = computed(() => {
  const s = schema.value
  if (!s || !mapped.value) return ''
  const n = taskCountOf(s, values, uploads)
  const unit = `按${s.submit.costUnit}计费，提交即扣点`
  return n > 1 ? `将生成 ${n} 个任务 · ${unit}` : unit
})

// ---------------- 组装请求体 ----------------

function buildBody(s: WorkflowSchema): Record<string, unknown> {
  const body: Record<string, unknown> = { ...s.fixedBody }
  for (const f of s.fields) {
    const v = toWorkflowJavaValue(f, values[f.key])
    if (v !== undefined) body[f.javaKey] = v
  }
  if (s.contentSource === 'template-prompt') body.content = templatePrompt.value
  const imageUrls: string[] = []
  for (const u of [...s.uploads].sort((a, b) => a.slot - b.slot)) {
    // 视频来源二选一：链接模式只传 videoLink，不带 videoUrl
    if (isLinkMode(u)) {
      const link = videoLinks[u.slot]?.trim()
      if (link) body.videoLink = link
      continue
    }
    const urls = uploads[u.slot] ?? []
    if (!urls.length) continue
    if (u.javaKey === 'imageUrls') imageUrls.push(...urls)
    else if (u.javaKey === 'prdImageUrls') {
      body.prdImageUrls = urls.map((url) => {
        const content = u.itemNote ? itemNotes[url]?.trim().slice(0, u.itemNote.maxLength) : ''
        return content ? { url, content } : { url }
      })
    } else body[u.javaKey] = urls[0]
  }
  if (imageUrls.length) body.imageUrls = imageUrls
  return body
}

async function onSubmit() {
  const s = schema.value
  if (!s || submitting.value || disabledReason.value) return
  submitting.value = true
  let ok = false
  try {
    await submitWorkflow(s.javaEndpoint, buildBody(s))
    ok = true
  } catch (err) {
    reportError(err, '提交失败，请重试')
  } finally {
    submitting.value = false
    if (ok) message.success('已提交，结果会出现在历史记录里')
    // 失败也刷新一次：超时 / 断网时任务可能已在服务端创建
    selectedId.value = null
    void userInfo.updateUserInfo()
    history.afterSubmit().catch((err) => reportError(err, '历史记录刷新失败'))
  }
}

// ---------------- 历史与结果 ----------------

/** 删除单条历史（DELETE /api/v1/workflows/{workflowTitle}/histories）；进行中的记录 Java 会拒绝，界面上不给删除入口 */
function confirmDelete(item: WorkflowHistoryItem) {
  dialog.warning({
    title: '删除记录',
    content: '确定删除这条历史记录？已下载的结果不受影响。',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await history.remove(item.workflowHistoryId)
        if (selectedId.value === item.workflowHistoryId) selectedId.value = null
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

// ---------------- 重新编辑（历史记录 data.requestParams → 表单，只回填不提交） ----------------

const RESTORE_DISABLED_TIP = '旧记录不支持重新编辑'
const formRef = ref<HTMLFormElement | null>(null)
const canRestore = (item: WorkflowHistoryItem) => !!item.data?.requestParams && !submitting.value

/**
 * 用原始提交体回填整张表单：requestParams.title 对到的模板与当前不同时先切过去（同一 query 形状），
 * 再回到默认值并按 restoreWorkflowForm 覆盖；图片地址原样放进槽位（不重新上传）。
 * 没有 requestParams 的老记录入口是禁用的，这里也直接返回——不拿 payload 拼半张表单误导用户。
 * 不触发提交：用户确认后自己点提交按钮。
 */
async function restoreFrom(item: WorkflowHistoryItem) {
  const params = item.data?.requestParams
  if (!params || submitting.value || !schema.value) return
  const target = workflowSchemas.find((x) => x.templateTitle === params.title && x.status === 'mapped')
  if (target && target.schemaId !== schema.value.schemaId) {
    await router.push(linkOf(target))
    await nextTick()
  }
  const s = schema.value
  if (!s || s.status !== 'mapped' || (target && s.schemaId !== target.schemaId)) return

  await fillForm(s, params, { sameStyle: false, historyId: item.workflowHistoryId })
}

/**
 * 回填表单（「重新编辑」与任务中心交接共用）。sameStyle=做同款：只回填模板与设置，素材与逐张备注留空。
 */
async function fillForm(
  s: WorkflowSchema,
  params: Record<string, unknown>,
  opts: { sameStyle: boolean; historyId?: number },
) {
  const r = restoreWorkflowForm(s, params)
  resetForm(s)
  if (opts.historyId != null) selectedId.value = opts.historyId
  if (!opts.sameStyle) {
    for (const [slot, urls] of Object.entries(r.uploads)) uploads[Number(slot)] = urls
    Object.assign(itemNotes, r.itemNotes)
    for (const [slot, link] of Object.entries(r.videoLinks)) {
      videoSource[Number(slot)] = 'link'
      videoLinks[Number(slot)] = link
    }
  }
  Object.assign(values, r.values)

  await nextTick()
  const form = formRef.value
  if (form) {
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    form.scrollTo({ top: 0, behavior })
    form.scrollIntoView({ block: 'start', behavior })
    form.focus({ preventScroll: true })
  }
  message.success(
    opts.sameStyle
      ? `已套用原任务的设置，换上你的素材后点「${s.submit.label}」`
      : `已回填原参数，确认后点「${s.submit.label}」提交`,
  )
}

// 任务中心「做同款 / 参数回填」：跳过来时带着原始提交体（sessionStorage 一次性交接），按当前模板回填
watch(
  schema,
  (s) => {
    if (!s || s.status !== 'mapped') return
    const handoff = takeRefill('workflow', s.templateTitle)
    if (!handoff) return
    void nextTick(() => {
      if (schema.value === s) void fillForm(s, handoff.params, { sameStyle: handoff.mode === 'same' })
    })
  },
  { immediate: true },
)

const current = computed<WorkflowHistoryItem | null>(
  () => history.items.value.find((i) => i.workflowHistoryId === selectedId.value) ?? history.items.value[0] ?? null,
)

const isVideoUrl = (u: string) => /\.(mp4|webm|mov)(\?|#|$)/i.test(u)

function outputsOf(item: WorkflowHistoryItem) {
  const images = [...(item.data?.resultImageUrls ?? [])]
  const videos = [...(item.data?.resultVideoUrls ?? [])]
  const result = item.data?.result
  const urls = [result?.taskResult?.url, ...(result?.tasks ?? []).map((t) => t.taskResult?.url)]
  for (const url of urls) {
    if (url && !images.includes(url) && !videos.includes(url)) (isVideoUrl(url) ? videos : images).push(url)
  }
  return { images, videos }
}

function thumbOf(item: WorkflowHistoryItem) {
  return outputsOf(item).images[0] ?? item.data?.inputImageUrls?.[0] ?? item.data?.payload?.imageUrls?.[0] ?? ''
}

const errorOf = (item: WorkflowHistoryItem) =>
  item.data?.result?.error || item.data?.result?.tasks?.find((t) => t.error)?.error || ''

/** 下载走 original=true 的同一条历史（不带水印）；拿不到时退回查看地址 */
async function downloadOriginal(item: WorkflowHistoryItem, kind: 'images' | 'videos', index: number) {
  const fallback = outputsOf(item)[kind][index]
  let url = fallback
  try {
    const res = await workflowHistories(schema.value?.templateTitle ?? '', 1, 20, true)
    const hit = res.data?.data?.find((i) => i.workflowHistoryId === item.workflowHistoryId)
    if (hit) url = outputsOf(hit)[kind][index] ?? fallback
  } catch (err) {
    reportError(err, '获取原图失败，已打开查看图')
  }
  if (url) window.open(url, '_blank', 'noopener')
}

const STATUS: Record<string, { text: string; cls: string }> = {
  PENDING: { text: '排队中', cls: 'll-chip-running' },
  RUNNING: { text: '生成中', cls: 'll-chip-running' },
  WAITING_MANUAL_PROCESS: { text: '处理中', cls: 'll-chip-running' },
  SUCCEED: { text: '已完成', cls: 'll-chip-success' },
  PARTIAL_SUCCEED: { text: '部分完成', cls: 'll-chip-warning' },
  FAILED: { text: '失败', cls: 'll-chip-error' },
  TIMEOUT: { text: '超时', cls: 'll-chip-error' },
  CANCELLED: { text: '已取消', cls: 'll-chip-warning' },
}
const statusOf = (s: string) => STATUS[s] ?? { text: s || '未知', cls: 'll-chip-warning' }
const formatTime = (v?: string | null) => (v ? v.replace('T', ' ').slice(0, 16) : '')

/** 结果舞台：当前查看第几个产物（图片在前、视频在后）；换记录时回到第一个 */
const activeOutput = ref(0)
watch(
  () => current.value?.workflowHistoryId,
  () => (activeOutput.value = 0),
)
const currentOutputs = computed(() => {
  if (!current.value) return []
  const { images, videos } = outputsOf(current.value)
  return [
    ...images.map((url, index) => ({ kind: 'images' as const, url, index })),
    ...videos.map((url, index) => ({ kind: 'videos' as const, url, index })),
  ]
})
const stageOutput = computed(() => currentOutputs.value[activeOutput.value] ?? currentOutputs.value[0])

/** 下拉与同面板输入框对齐：高 34、r4、#c9cfd6 描边，聚焦 violet 描边 + 3px 外环 */
const selectThemeOverrides: NonNullable<SelectProps['themeOverrides']> = {
  peers: {
    InternalSelection: {
      borderRadius: '4px',
      fontSizeMedium: '13px',
      heightMedium: '34px',
      border: '1px solid #c9cfd6',
      borderHover: '1px solid #aeb6bf',
      borderActive: '1px solid #875F9A',
      borderFocus: '1px solid #875F9A',
      boxShadowActive: '0 0 0 3px rgba(135,95,154,0.14)',
      boxShadowFocus: '0 0 0 3px rgba(135,95,154,0.14)',
      caretColor: '#875F9A',
    },
  },
}

const focusRing = 'outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)'
/** 输入框（§4.1）：高 34、r4、#c9cfd6 描边 + 内影，hover #aeb6bf，聚焦 violet 描边 + 3px 外环 */
const inputCls =
  'w-full h-34px box-border rounded-4px border border-solid border-#c9cfd6 bg-white px-10px text-13px text-ink ' +
  'shadow-[inset_0_1px_2px_rgba(31,35,41,0.055),inset_0_0_0_1px_rgba(255,255,255,0.7)] outline-none ' +
  'placeholder:text-placeholder hover:border-#aeb6bf focus:(border-violet shadow-[0_0_0_3px_rgba(135,95,154,0.14)])'
/** 逐张备注输入（原型 WorkflowNotesList.vue:243-258）：高 30、11px、r6、line 描边 + 内影 */
const noteInputCls =
  'min-w-0 flex-1 h-30px box-border rounded-6px border border-solid border-line bg-white px-10px text-11px leading-18px text-ink ' +
  'shadow-[inset_0_1px_2px_rgba(31,35,41,0.055),inset_0_0_0_1px_rgba(255,255,255,0.7)] outline-none ' +
  'placeholder:text-placeholder focus:(border-violet shadow-[0_0_0_3px_rgba(135,95,154,0.14)]) disabled:(bg-surface3 cursor-not-allowed)'
/** 结果列头部操作按钮（§5.11）：高 28、内边距 0 8、r4、11px */
const headBtn =
  'inline-flex items-center gap-4px h-28px px-8px box-border rounded-4px border border-solid border-#c9cfd6 bg-[linear-gradient(#fff,#fbfcfc)] ' +
  'text-11px text-ink-2 no-underline cursor-pointer hover:(border-#aeb6bf text-ink) ' +
  focusRing
</script>

<template>
  <div v-if="!schema" class="h-full flex items-center justify-center p-16px bg-page">
    <div
      class="flex flex-col items-center justify-center gap-6px min-h-150px w-full max-w-360px box-border p-18px rounded-8px border border-dashed border-line-strong bg-white text-center"
    >
      <p class="m-0 text-13px font-600 text-ink">没有找到这个工作流</p>
      <p class="m-0 text-11px leading-[1.65] text-muted">链接里的模板可能已下线，回首页从目录重新进入</p>
      <RouterLink to="/tools" class="ll-link mt-4px" :class="focusRing">返回首页</RouterLink>
    </div>
  </div>

  <!-- 三栏 460 / 224 / 1fr、gap 16、内边距 16（原型 WorkflowView.vue:870-877,1771）；≥1440 三栏等高，<1440 单列整页滚 -->
  <div
    v-else
    class="relative grid h-full min-h-0 box-border gap-16px p-16px bg-page grid-cols-1 content-start overflow-y-auto min-[1440px]:(grid-cols-[460px_224px_minmax(0,1fr)] content-stretch overflow-hidden)"
  >
    <!-- 断网提示条：浏览器离线或连续网络失败暂停轮询时出现（与创作页同一份） -->
    <PollingOfflineBanner :show="history.offline.value" @retry="history.retryPolling()" />
    <!-- 左：操作区（一张白板：模板头 64 → 流程板（唯一滚动）→ 设置 44 + 提交 56） -->
    <section
      class="ll-card !rounded-8px flex flex-col min-[1440px]:(min-h-0 overflow-hidden)"
      aria-labelledby="wf-title"
    >
      <WorkflowTemplateHead
        title-id="wf-title"
        :name="nameOf(schema)"
        :desc="headDesc"
        :current="schema"
        :options="treeOptions"
        :name-of="nameOf"
        :link-of="linkOf"
      />

      <div v-if="!mapped" class="flex-1 min-h-0 p-12px">
        <div
          class="flex flex-col items-center justify-center gap-6px min-h-150px h-full box-border p-18px rounded-8px border border-dashed border-line-strong text-center"
          role="status"
        >
          <p class="m-0 text-13px font-600 text-ink">即将开放</p>
          <p class="m-0 max-w-320px text-11px leading-[1.65] text-muted">「{{ schema.name }}」正在接入中，敬请期待</p>
        </div>
      </div>

      <!-- tabindex=-1：「重新编辑」回填后把焦点移到表单开头（程序聚焦落点，不进 Tab 序列，故不画焦点环） -->
      <form
        v-else
        id="wf-form"
        ref="formRef"
        tabindex="-1"
        class="flex-1 min-h-0 box-border p-12px flex flex-col gap-12px outline-none min-[1440px]:overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        @submit.prevent="onSubmit"
      >
        <WorkflowFlowBoard
          :inputs="flowInputs"
          :action-label="categoryLabel"
          :action-hint="actionHint"
          :template-label="nameOf(schema)"
        >
          <template v-for="(u, index) in schema.uploads" :key="`${schema.schemaId}-${u.slot}`" #[`input-${index}`]>
            <!-- 参考视频：上传或分享链接二选一（v1 video_url / video_link 互斥），切换只换输入方式，出网只带当前这一种 -->
            <div
              v-if="u.linkAlt"
              role="radiogroup"
              :aria-label="`${u.label}来源`"
              class="flex flex-wrap gap-6px mb-8px"
            >
              <button
                v-for="opt in VIDEO_SOURCE_OPTIONS"
                :key="opt.key"
                type="button"
                role="radio"
                :aria-checked="(videoSource[u.slot] ?? 'upload') === opt.key"
                class="ll-pill"
                :class="[focusRing, (videoSource[u.slot] ?? 'upload') === opt.key ? 'll-pill-active' : '']"
                :disabled="submitting"
                @click="videoSource[u.slot] = opt.key"
              >
                {{ opt.label }}
              </button>
            </div>
            <input
              v-if="isLinkMode(u)"
              :id="`wf-upload-${u.slot}`"
              v-model="videoLinks[u.slot]"
              type="text"
              :class="inputCls"
              :disabled="submitting"
              :aria-label="`${u.label}链接`"
              placeholder="粘贴视频分享链接"
            />
            <ToolUploadSlot
              v-else
              :id="`wf-upload-${u.slot}`"
              :model-value="uploads[u.slot] ?? []"
              :spec="u"
              :layout="u.kind === 'video' ? 'single' : 'material'"
              :disabled="submitting"
              asset-picker
              @update:model-value="setUploads(u.slot, $event)"
            />
            <!-- 逐张备注（SKU替换「特殊需求」）：每张图一格、两列，选填（原型 WorkflowNotesList.vue:159-258） -->
            <div v-if="hasNotes(u)" class="mt-12px flex flex-col gap-8px">
              <div class="flex items-baseline gap-8px">
                <span :id="`wf-notes-${u.slot}-label`" class="text-12px font-600 leading-18px text-ink-2">{{
                  u.itemNote!.label
                }}</span>
                <span class="ml-auto text-11px leading-16px text-muted">每张选填，≤{{ u.itemNote!.maxLength }} 字</span>
              </div>
              <ul
                class="m-0 mt-5px p-0 list-none grid grid-cols-2 gap-x-12px gap-y-8px items-start"
                :aria-labelledby="`wf-notes-${u.slot}-label`"
              >
                <li v-for="(url, i) in uploads[u.slot]" :key="url" class="min-w-0 flex items-center gap-8px">
                  <img
                    :src="url"
                    alt=""
                    class="flex-none block w-32px h-32px box-border rounded-4px border border-solid border-line object-cover bg-surface3"
                  />
                  <input
                    v-model="itemNotes[url]"
                    type="text"
                    :maxlength="u.itemNote!.maxLength"
                    :disabled="submitting"
                    :placeholder="`第 ${i + 1} 张（选填）`"
                    :aria-label="`第 ${i + 1} 张${u.label}的${u.itemNote!.label}`"
                    :class="noteInputCls"
                  />
                </li>
              </ul>
            </div>
          </template>

          <template #tool>
            <div class="flex flex-col gap-12px">
              <p
                v-if="!formFields.length"
                class="m-0 px-10px py-8px rounded-6px bg-surface2 text-11px leading-16px text-muted"
              >
                {{
                  schema.contentSource === 'template-prompt' ? '提示词由模板内置，这里不用填' : '这个模板没有其它选项'
                }}
              </p>
              <template v-for="f in formFields" :key="`${schema.schemaId}-${f.key}`">
                <div v-if="f.type === 'chips'">
                  <div :id="`wf-field-${f.key}-label`" class="ll-label">
                    <span>{{ f.label }}<span v-if="f.required" class="text-danger" aria-hidden="true"> *</span></span>
                  </div>
                  <div role="radiogroup" :aria-labelledby="`wf-field-${f.key}-label`" class="flex flex-wrap gap-6px">
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

                <div v-else-if="f.type === 'select'">
                  <div class="ll-label">
                    <label :for="`wf-field-${f.key}`">
                      {{ f.label }}<span v-if="f.required" class="text-danger" aria-hidden="true"> *</span>
                    </label>
                  </div>
                  <n-select
                    :id="`wf-field-${f.key}`"
                    v-model:value="values[f.key]"
                    class="w-full"
                    size="medium"
                    :disabled="submitting"
                    :options="fieldOptions(f).map((o) => ({ label: o.label, value: o.value }))"
                    :theme-overrides="selectThemeOverrides"
                  />
                </div>

                <div v-else-if="f.type === 'number'">
                  <div class="ll-label">
                    <label :for="`wf-field-${f.key}`">
                      {{ f.label }}<span v-if="f.required" class="text-danger" aria-hidden="true"> *</span>
                    </label>
                    <span class="text-12px text-placeholder">{{ f.min }}–{{ f.max }}</span>
                  </div>
                  <input
                    :id="`wf-field-${f.key}`"
                    v-model.number="values[f.key]"
                    type="number"
                    :min="f.min"
                    :max="f.max"
                    step="1"
                    :class="inputCls"
                    @change="clampNumber(f)"
                  />
                </div>

                <CreationPromptInput
                  v-else-if="f.type === 'textarea'"
                  :id="`wf-field-${f.key}`"
                  v-model="values[f.key]"
                  :label="f.label"
                  :required="f.required"
                  :rows="4"
                  :max-length="f.maxLength"
                  :placeholder="f.placeholder ?? `请输入${f.label}（选填）`"
                />
              </template>
            </div>
          </template>
        </WorkflowFlowBoard>
      </form>

      <!-- 页脚贴板底（内边距 0 12 12）：设置 44 + 提交 56，间距 8 -->
      <div class="flex-none flex flex-col gap-8px px-12px pb-12px" :class="mapped ? '' : 'pt-12px'">
        <!-- 共用设置行按钮是 40 高，工作流页按原型 WorkflowSettings 撑到 44 -->
        <div v-if="mapped && settingItems.length" class="[&_button]:h-44px">
          <CreationSettingsRow :items="settingItems">
            <template #settings>
              <CreationImageSettings
                :model-value="settingsValue"
                :fields="settingsConfig"
                @update:model-value="onSettings"
              />
              <CreationOptionPills
                v-if="durationField"
                :model-value="values[durationField.key]"
                :options="fieldOptions(durationField)"
                :label="durationField.label"
                :required="durationField.required"
                @update:model-value="values[durationField.key] = $event"
              />
            </template>
          </CreationSettingsRow>
        </div>
        <!-- 余额胶囊：与工具页同位（提交按钮上方单独一行靠左） -->
        <PointsBalanceChip v-if="mapped" class="self-start" />
        <CreationActionBar
          form="wf-form"
          :label="schema.submit.label"
          :cost-text="costText"
          :disabled="!!disabledReason"
          :loading="submitting"
          :reason="disabledReason"
        />
      </div>
    </section>

    <!-- 中：历史记录（原型 StudioHistoryColumn 卡片口径） -->
    <section
      class="ll-card !rounded-8px flex min-h-0 flex-col overflow-hidden max-[1439px]:max-h-480px"
      aria-labelledby="wf-history-title"
    >
      <CreationHistoryHeader
        title-id="wf-history-title"
        :count="mapped ? history.items.value.length : undefined"
        :running="history.running.value"
      />
      <div class="flex-1 min-h-0 overflow-y-auto px-12px">
        <div
          v-if="!mapped || !history.items.value.length"
          class="flex items-center gap-10px min-h-65px box-border mt-2px mb-10px px-10px rounded-8px border border-solid border-line bg-white"
          :role="history.loading.value ? 'status' : undefined"
        >
          <span
            v-if="mapped && history.loading.value"
            class="flex-none w-16px h-16px box-border rounded-full border-2 border-solid border-#ede3f2 border-t-violet animate-spin animate-duration-800 motion-reduce:animate-none"
            aria-hidden="true"
          />
          <span class="min-w-0 flex flex-col gap-2px">
            <span class="text-12px font-600 leading-18px text-ink">{{
              !mapped ? '即将开放' : history.loading.value ? '加载中…' : '还没有生成记录'
            }}</span>
            <span v-if="mapped && !history.loading.value" class="text-11px leading-16px text-muted"
              >上传素材、点底部按钮，结果会落在这一列</span
            >
          </span>
        </div>
        <ul v-else class="m-0 pt-2px pb-10px px-0 list-none flex flex-col gap-8px">
          <li
            v-for="item in history.items.value"
            :key="item.workflowHistoryId"
            class="group relative flex items-center gap-10px p-10px rounded-8px border border-solid [transition:border-color_110ms,background_110ms,box-shadow_110ms] motion-reduce:transition-none"
            :class="
              current?.workflowHistoryId === item.workflowHistoryId
                ? 'border-violet-line bg-[linear-gradient(180deg,#fff_0%,#f8f3fc_100%)] shadow-[0_1px_2px_rgba(31,35,41,0.05)]'
                : 'border-line bg-white hover:(border-#c9cfd6 shadow-[0_1px_2px_rgba(31,35,41,0.05)])'
            "
          >
            <!-- 整卡选中：按钮铺满卡面（删除按钮压在其上） -->
            <button
              type="button"
              class="absolute inset-0 m-0 p-0 rounded-8px border-none bg-transparent cursor-pointer"
              :class="focusRing"
              :aria-pressed="current?.workflowHistoryId === item.workflowHistoryId"
              :aria-label="`${formatTime(item.createdAt)} ${statusOf(item.status).text}`"
              @click="selectedId = item.workflowHistoryId"
            />
            <span
              class="relative flex-none w-44px h-44px box-border rounded-6px border border-solid border-line bg-surface3 flex items-center justify-center pointer-events-none"
              :class="
                outputsOf(item).images.length > 2
                  ? 'shadow-[3px_-3px_0_-1px_#fff,3px_-3px_0_0_#e5e7eb,6px_-6px_0_-1px_#fff,6px_-6px_0_0_#e5e7eb]'
                  : outputsOf(item).images.length === 2
                    ? 'shadow-[3px_-3px_0_-1px_#fff,3px_-3px_0_0_#e5e7eb]'
                    : ''
              "
            >
              <img
                v-if="thumbOf(item)"
                :src="thumbOf(item)"
                alt=""
                class="block w-full h-full rounded-5px object-cover"
              />
              <span v-else class="text-11px text-placeholder">—</span>
              <span
                v-if="outputsOf(item).images.length > 1"
                class="absolute z-2 -top-4px -right-4px grid place-items-center min-w-16px h-16px box-border px-4px rounded-full border border-solid border-white bg-ink text-10px font-600 leading-none text-white"
                aria-hidden="true"
                >{{ outputsOf(item).images.length }}</span
              >
            </span>
            <span class="min-w-0 flex-1 flex flex-col justify-between gap-6px pointer-events-none">
              <span class="ll-chip self-start" :class="statusOf(item.status).cls">{{
                statusOf(item.status).text
              }}</span>
              <span class="flex items-center gap-4px min-w-0">
                <span class="flex-none text-11px leading-16px text-placeholder">{{ formatTime(item.createdAt) }}</span>
                <!-- 重新编辑：老记录（无 requestParams）用 aria-disabled 而非 disabled，仍可聚焦、悬停能看到原因 -->
                <button
                  v-if="isWorkflowTerminal(item.status)"
                  type="button"
                  class="relative z-1 grid place-items-center w-20px h-20px p-0 rounded-4px border-none bg-transparent text-placeholder pointer-events-auto opacity-0 transition-colors group-hover:opacity-100 focus-visible:opacity-100"
                  :class="[
                    focusRing,
                    canRestore(item) ? 'cursor-pointer hover:(bg-surface3 text-ink)' : 'cursor-not-allowed',
                  ]"
                  :aria-disabled="canRestore(item) ? undefined : 'true'"
                  :aria-label="item.data?.requestParams ? '重新编辑' : `重新编辑（${RESTORE_DISABLED_TIP}）`"
                  :title="item.data?.requestParams ? '重新编辑' : RESTORE_DISABLED_TIP"
                  @click="restoreFrom(item)"
                >
                  <svg
                    class="w-13px h-13px"
                    :class="canRestore(item) ? '' : 'opacity-40'"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
                  </svg>
                </button>
                <button
                  v-if="isWorkflowTerminal(item.status)"
                  type="button"
                  class="relative z-1 grid place-items-center w-20px h-20px p-0 rounded-4px border-none bg-transparent text-placeholder cursor-pointer pointer-events-auto opacity-0 transition-colors group-hover:opacity-100 focus-visible:opacity-100 hover:(bg-surface3 text-danger)"
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
                    stroke-width="1.7"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
                  </svg>
                </button>
              </span>
            </span>
          </li>
        </ul>
      </div>
    </section>

    <!-- 右：结果（§5.11 ToolPreviewPanel）+ 功能介绍（§5.12 ToolIntroPanel） -->
    <section class="ll-card !rounded-8px flex min-h-0 flex-col overflow-hidden" aria-labelledby="wf-result-title">
      <div class="flex-1 min-h-0 overflow-y-auto p-12px flex flex-col gap-10px">
        <header class="flex items-center gap-8px min-h-28px">
          <h2 id="wf-result-title" class="m-0 text-14px font-600 leading-20px text-ink">生成结果</h2>
          <template v-if="mapped && current">
            <span class="ll-chip" :class="statusOf(current.status).cls">{{ statusOf(current.status).text }}</span>
            <span class="text-11px text-placeholder">{{ formatTime(current.createdAt) }}</span>
            <span v-if="stageOutput" class="ml-auto flex items-center gap-6px">
              <button
                type="button"
                :class="headBtn"
                @click="downloadOriginal(current, stageOutput.kind, stageOutput.index)"
              >
                {{ stageOutput.kind === 'videos' ? '下载视频' : '下载原图' }}
              </button>
              <a
                v-if="stageOutput.kind === 'images'"
                :href="stageOutput.url"
                target="_blank"
                rel="noopener"
                :class="headBtn"
                >放大查看</a
              >
            </span>
          </template>
        </header>

        <template v-if="mapped && current">
          <!-- 生成中：34 圆转圈、2px 环、800ms 一圈 -->
          <div
            v-if="!isWorkflowTerminal(current.status)"
            class="flex flex-col items-center justify-center gap-8px min-h-220px box-border p-18px rounded-8px bg-surface2"
            role="status"
          >
            <span
              class="w-34px h-34px box-border rounded-full border-2 border-solid border-#ede3f2 border-t-violet animate-spin animate-duration-800 motion-reduce:animate-none"
              aria-hidden="true"
            />
            <span class="text-11px text-muted">任务进行中，结果出来后会自动显示</span>
          </div>
          <template v-else>
            <p
              v-if="current.status !== 'SUCCEED' && current.status !== 'PARTIAL_SUCCEED'"
              class="m-0 px-10px py-8px rounded-6px border border-solid border-danger-line bg-danger-soft text-12px leading-18px text-#8f4b47"
              role="status"
            >
              {{ errorOf(current) || '任务未成功，点数已按规则退回' }}
            </p>
            <p
              v-else-if="current.status === 'PARTIAL_SUCCEED'"
              class="m-0 px-10px py-8px rounded-6px border border-solid border-warning-line bg-warning-soft text-12px leading-18px text-#7d5a20"
              role="status"
            >
              部分任务未成功，未成功的点数已按规则退回
            </p>
            <!-- 舞台：最小高 320、20px 棋盘格、内影，产物 contain 居中 -->
            <div
              v-if="stageOutput"
              class="flex items-center justify-center min-h-320px box-border overflow-hidden rounded-8px border border-solid border-line bg-[conic-gradient(#f3f4f5_25%,#fff_0_50%,#f3f4f5_0_75%,#fff_0)] bg-[length:20px_20px] shadow-[inset_0_1px_2px_rgba(31,35,41,0.055),inset_0_0_0_1px_rgba(255,255,255,0.7)]"
            >
              <video
                v-if="stageOutput.kind === 'videos'"
                :key="stageOutput.url"
                :src="stageOutput.url"
                controls
                class="block w-full max-h-480px bg-black"
              />
              <img
                v-else
                :src="stageOutput.url"
                :alt="`结果图 ${stageOutput.index + 1}`"
                class="block max-w-full max-h-[min(62vh,640px)] object-contain"
              />
            </div>
            <!-- 候选：4 列、gap 6、方形 r4，选中 1px violet 光晕 -->
            <ul
              v-if="currentOutputs.length > 1"
              class="m-0 p-0 list-none grid grid-cols-4 gap-6px"
              aria-label="切换查看的结果"
            >
              <li v-for="(o, i) in currentOutputs" :key="o.url">
                <button
                  type="button"
                  class="block w-full aspect-square p-0 overflow-hidden rounded-4px border border-solid bg-surface3 cursor-pointer"
                  :class="[
                    focusRing,
                    i === activeOutput
                      ? 'border-violet shadow-[0_0_0_1px_#875f9a]'
                      : 'border-line hover:border-#c9cfd6',
                  ]"
                  :aria-pressed="i === activeOutput"
                  :aria-label="`${o.kind === 'videos' ? '结果视频' : '结果图'} ${o.index + 1}`"
                  @click="activeOutput = i"
                >
                  <img v-if="o.kind === 'images'" :src="o.url" alt="" class="block w-full h-full object-cover" />
                  <span v-else class="grid place-items-center w-full h-full text-11px text-muted">视频</span>
                </button>
              </li>
            </ul>
            <div
              v-if="(current.status === 'SUCCEED' || current.status === 'PARTIAL_SUCCEED') && !currentOutputs.length"
              class="flex flex-col items-center justify-center gap-6px min-h-220px box-border p-18px rounded-8px bg-surface2 text-center"
            >
              <p class="m-0 text-13px font-600 text-ink">没有拿到产物</p>
              <p class="m-0 max-w-240px text-11px leading-[1.55] text-muted">任务已完成，但没有返回产物地址</p>
            </div>
          </template>
        </template>
        <!-- 空态：最小高 220、内边距 18；36 圆图标 + 标题 13 + 说明 11/1.55 -->
        <div
          v-else
          class="flex flex-col items-center justify-center gap-6px min-h-220px box-border p-18px rounded-8px bg-surface2 text-center"
        >
          <span
            class="grid place-items-center w-36px h-36px rounded-full bg-white border border-solid border-line text-violet"
            aria-hidden="true"
          >
            <svg
              class="w-18px h-18px"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21" />
            </svg>
          </span>
          <p class="m-0 text-13px font-600 text-ink">{{ mapped ? '还没有结果' : '即将开放' }}</p>
          <p class="m-0 max-w-240px text-11px leading-[1.55] text-muted">
            {{ mapped ? '提交后，结果会显示在这里' : '这个模板正在接入中' }}
          </p>
        </div>

        <!-- 功能介绍（§5.12）：gap 14、内边距 14；正文 13/1.65；适用场景块 内边距 10 / line-soft / r6 / surface2 -->
        <div class="flex flex-col gap-14px p-14px rounded-8px border border-solid border-line-soft">
          <h3 class="m-0 text-14px font-600 leading-20px text-ink">功能介绍</h3>
          <ol class="m-0 pl-18px text-13px leading-[1.65] text-ink-2">
            <li>依次上传：{{ schema.uploads.map((u) => u.label).join('、') }}</li>
            <li v-if="schema.fields.length">选择{{ schema.fields.map((f) => f.label).join('、') }}</li>
            <li>点击「{{ schema.submit.label }}」，结果在历史记录里查看与下载</li>
          </ol>
          <div class="p-10px rounded-6px border border-solid border-line-soft bg-surface2">
            <p class="m-0 mb-6px text-12px font-600 text-ink-2">需要的素材</p>
            <ul class="m-0 p-0 list-none flex flex-wrap gap-6px">
              <li
                v-for="u in schema.uploads"
                :key="u.slot"
                class="px-6px h-20px inline-flex items-center rounded-3px bg-white border border-solid border-line text-11px text-ink-2"
              >
                {{ u.label }}
              </li>
            </ul>
          </div>
          <p class="m-0 text-11px leading-16px text-placeholder">
            计费：按{{ schema.submit.costUnit }}计费，提交即扣点
          </p>
          <figure v-if="sampleUrl && !isVideoUrl(sampleUrl)" class="m-0">
            <img
              :src="sampleUrl"
              :alt="`${schema.name}示例效果`"
              class="block max-w-full max-h-240px rounded-8px object-contain"
            />
            <figcaption class="mt-4px text-11px text-placeholder">示例效果</figcaption>
          </figure>
        </div>
      </div>
    </section>
  </div>
</template>
