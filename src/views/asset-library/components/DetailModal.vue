<script setup lang="ts">
import { modelLabelOf } from '@/utils/model-label'
/**
 * 资产详情弹层（NModal 960）：
 * 预览（image 大图 / video 播放器）、标题行内编辑、分类 / 授权下拉、收藏开关、
 * 标签编辑（已有标签点选 + 输入新建，整组替换 PATCH）、授权 / 元数据草稿编辑（脏字段才 PATCH）、溯源折叠、
 * 版本列表（设为当前版本 / 回到原图 / 分页加载更多）、相关资产与生成结果（分页加载更多）。
 *
 * <p>modelValue 为资产 id，null = 关闭；点相关资产 / 生成结果的缩略图会换 id 重载。
 * hasPrev / hasNext 由列表页给出：媒体两侧的翻页钮与键盘 ← / → 发 prev / next，列表页负责跨页。
 * 详情接口一次带回三组子列表的当前页，翻页各自 page+1 重拉后追加。
 *
 * <p>校色（2026-11-09，components/ColorFix 套件）：图片资产右上「校色调整」，参数台含局部调色选区；调过之后
 * 「下载」给校色后的 PNG（另留「下载原图」）、可切「校色对比」、可「存为校色版本」——追加版本（prompt「校色后」，
 * params = { colorFix, colorFixRegion?, sourceImage }），已有同参数的校色版本时直接切过去不重复追加。
 * 当前版本本身是校色版本时以它的 sourceImage 为底图，免得在校色结果上再叠一层。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { NButton, NCollapse, NCollapseItem, NInput, NModal, NSelect, useMessage } from 'naive-ui'
import MediaFallback from '@/components/MediaFallback/index.vue'
import IconButton from '@/components/IconButton/index.vue'
import {
  assetLibAddRelation,
  assetLibAddVersion,
  assetLibDetail,
  assetLibRemoveRelation,
  assetLibTags,
  assetLibUpdate,
} from '@/api/asset-library.ts'
import type { IAssetLibAsset, IAssetLibDetail, IAssetLibTag, IAssetLibUpdateReq } from '@/api/asset-library.ts'
import { formatTime } from '@/views/local-life/constants.ts'
import { goUploadImage } from '@/api/go-upload.ts'
import AssetPickerModal from '@/views/studio/components/AssetPickerModal/index.vue'
import { useFileDropPaste } from '@/composables/useFileDropPaste'
import { copyText, downloadName } from '../ui.ts'
import {
  ColorFixCompare,
  ColorFixPill,
  ColorFixResultPanel,
  colorFixRegionSanitize,
  colorFixSanitize,
  corsAttr,
  markCorsBlocked,
  saveColorFixVersion,
  useResultColorFix,
} from '@/components/ColorFix'
import { useAssetsInCanvas } from '../useInCanvas.ts'

const assetId = defineModel<number | null>({ required: true })

const props = withDefaults(
  defineProps<{
    hasPrev?: boolean
    hasNext?: boolean
    /** 删除预留位：后端支持后列表页传 true 并监听 delete；本组件不自己删 */
    canDelete?: boolean
    /** 不可删时按钮显示为禁用，悬停给原因；空则不显示按钮 */
    deleteDisabledReason?: string
  }>(),
  { hasPrev: false, hasNext: false, canDelete: false, deleteDisabledReason: '' },
)

const emit = defineEmits<{ changed: []; prev: []; next: []; delete: [id: number] }>()

const message = useMessage()
const { opening: openingCanvas, openAssetsInCanvas } = useAssetsInCanvas()

const PAGE_SIZE = 6

const KIND_OPTIONS = [
  { label: '其他分类', value: '' },
  { label: '模特', value: 'model' },
  { label: '场景', value: 'scene' },
  { label: '妆造', value: 'makeup' },
  { label: '发型', value: 'hair' },
  { label: '配饰', value: 'accessory' },
]
const LICENSE_OPTIONS = [
  { label: '已授权', value: 'cleared' },
  { label: '内部使用', value: 'internal' },
  { label: '未知', value: 'unknown' },
  { label: '未设置', value: '' },
]
const META_MAX = 50
const META_FIELDS = [
  { key: 'industry', label: '行业' },
  { key: 'style', label: '风格' },
  { key: 'shot', label: '镜头' },
  { key: 'color', label: '颜色' },
] as const
type MetaKey = (typeof META_FIELDS)[number]['key']
const SOURCE_LABELS: Record<string, string> = {
  generated: 'AI 生成',
  upload: '上传',
  official: '官方',
}

// ---------------- 详情加载 ----------------

const detail = ref<IAssetLibDetail | null>(null)
const loading = ref(false)
const versionPage = ref(1)
const relatedPage = ref(1)
const resultPage = ref(1)

// 缩略图挂了就上占位。版本 id 与资产 id 是两个空间，分表记，避免误伤同号
const versionThumbFailed = ref<Record<number, boolean>>({})
const miniThumbFailed = ref<Record<number, boolean>>({})
// 大预览挂了降级占位
const previewFailed = ref(false)
// 标题行内编辑状态（换资产 / 重开时复位）
const editingTitle = ref(false)
const titleDraft = ref('')

async function load(id: number) {
  loading.value = true
  try {
    const res = await assetLibDetail(id, { pageSize: PAGE_SIZE })
    detail.value = res.data ?? null
    versionPage.value = 1
    relatedPage.value = 1
    resultPage.value = 1
    versionThumbFailed.value = {}
    miniThumbFailed.value = {}
    previewFailed.value = false
    editingTitle.value = false
    tagEditing.value = false
    resetDrafts()
  } catch {
    detail.value = null
    // 资产可能已被删（4001）：toast 已由请求层弹过，收起空壳弹层
    assetId.value = null
  } finally {
    loading.value = false
  }
}

const show = computed({
  get: () => assetId.value !== null,
  set: (v: boolean) => {
    if (!v) assetId.value = null
  },
})

watch(assetId, (id) => {
  if (id != null) {
    void load(id)
    void loadMyTags()
  } else {
    detail.value = null
  }
})

const asset = computed<IAssetLibAsset | null>(() => detail.value?.asset ?? null)

/** 「日期 · 分类 [· 视频]」 */
const metaLine = computed(() => {
  const a = asset.value
  if (!a) return ''
  const date = a.createdAt ? formatTime(a.createdAt).slice(0, 10) : ''
  const kind = KIND_OPTIONS.find((k) => k.value === a.kind)?.label ?? '其他分类'
  return [date, kind, a.media === 'video' ? '视频' : ''].filter(Boolean).join(' · ')
})

// ---------------- 翻页（← / →）、下载、复制提示词 ----------------

/** 正在输入 / 操作媒体时方向键留给控件本身 */
function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el || !el.tagName) return false
  if (el.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT', 'VIDEO', 'AUDIO'].includes(el.tagName) || !!el.closest('.n-base-selection')
}

function onKeydown(e: KeyboardEvent) {
  if (!show.value || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || versionAssetShow.value) return
  // 校色参数台 / 涂抹弹窗开着：方向键留给它们
  if (cf.panelOpen.value || cf.painterOpen.value) return
  if (isEditableTarget(e.target)) return
  if (e.key === 'ArrowLeft' && props.hasPrev) {
    e.preventDefault()
    emit('prev')
  } else if (e.key === 'ArrowRight' && props.hasNext) {
    e.preventDefault()
    emit('next')
  }
}
watch(
  () => assetId.value !== null,
  (open) => {
    if (open) window.addEventListener('keydown', onKeydown)
    else window.removeEventListener('keydown', onKeydown)
  },
  { immediate: true },
)
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

const downloadHref = computed(() => {
  const a = asset.value
  if (!a) return ''
  return (a.media === 'video' ? a.videoUrl : a.image) || ''
})

// ---------------- 通用 PATCH（返回完整资产，就地覆盖） ----------------

const saving = ref(false)

async function patchAsset(data: IAssetLibUpdateReq): Promise<boolean> {
  const id = assetId.value
  if (!id || saving.value) return false
  saving.value = true
  try {
    const res = await assetLibUpdate(id, data)
    if (res.data && detail.value) detail.value.asset = res.data
    emit('changed')
    return true
  } catch {
    return false // 失败 toast 已由请求层弹出
  } finally {
    saving.value = false
  }
}

// ---------------- 授权 / 元数据草稿（按字段脏检查，只 PATCH 改过的顶层字段） ----------------

const licenseDraft = ref('')
const metaDraft = ref<Record<MetaKey, string>>({ industry: '', style: '', shot: '', color: '' })

function baseMeta(): Record<MetaKey, string> {
  const m = asset.value?.metadata
  return {
    industry: m?.industry ?? '',
    style: m?.style ?? '',
    shot: m?.shot ?? '',
    color: m?.color ?? '',
  }
}

function resetDrafts() {
  licenseDraft.value = asset.value?.license ?? ''
  metaDraft.value = baseMeta()
}

const licenseDirty = computed(() => licenseDraft.value !== (asset.value?.license ?? ''))
const metaDirty = computed(() => {
  const base = baseMeta()
  return META_FIELDS.some((f) => metaDraft.value[f.key].trim() !== base[f.key])
})
const profileDirty = computed(() => licenseDirty.value || metaDirty.value)

async function saveProfile() {
  const id = assetId.value
  if (!id || !profileDirty.value) return
  const body: IAssetLibUpdateReq = {}
  if (licenseDirty.value) body.license = licenseDraft.value
  if (metaDirty.value) {
    for (const f of META_FIELDS) {
      if (metaDraft.value[f.key].trim().length > META_MAX) {
        message.warning(`${f.label}最多 ${META_MAX} 字`)
        return
      }
    }
    // metadata 是整体替换：四个键都带，空的发空串
    body.metadata = {
      industry: metaDraft.value.industry.trim(),
      style: metaDraft.value.style.trim(),
      shot: metaDraft.value.shot.trim(),
      color: metaDraft.value.color.trim(),
    }
  }
  if (await patchAsset(body)) {
    message.success('授权与元数据已保存')
    await load(id) // 重拉详情，草稿随之复位
  }
}

// ---------------- 标题行内编辑 ----------------

function startEditTitle() {
  titleDraft.value = asset.value?.title ?? ''
  editingTitle.value = true
}

async function saveTitle() {
  const t = titleDraft.value.trim()
  if (!t) {
    message.warning('标题不能为空')
    return
  }
  if (t.length > 100) {
    message.warning('标题最多 100 字')
    return
  }
  if (await patchAsset({ title: t })) {
    editingTitle.value = false
    message.success('标题已保存')
  }
}

// ---------------- 标签编辑（整组替换，≤10） ----------------

const myTags = ref<IAssetLibTag[]>([])
const newTagName = ref('')
const tagEditing = ref(false)
const moreOpen = ref(false)

async function loadMyTags() {
  try {
    const res = await assetLibTags()
    myTags.value = res.data?.items ?? []
  } catch {
    myTags.value = []
  }
}

const currentTags = computed<string[]>(() => asset.value?.tags ?? [])
/** 字典里还没打上这个资产的标签，供点选 */
const dictOptions = computed(() => myTags.value.filter((t) => !currentTags.value.includes(t.name)))

async function setTags(next: string[]): Promise<boolean> {
  if (next.length > 10) {
    message.warning('每个资产最多 10 个标签')
    return false
  }
  return patchAsset({ tags: next })
}

async function addTag() {
  const n = newTagName.value.trim()
  if (!n) return
  if (n.length > 20) {
    message.warning('标签名最多 20 字')
    return
  }
  if (currentTags.value.includes(n)) {
    message.warning('该标签已在这个资产上')
    return
  }
  if (await setTags([...currentTags.value, n])) newTagName.value = '' // 字典里没有的名字服务端自动建
}

async function removeTag(name: string) {
  await setTags(currentTags.value.filter((t) => t !== name))
}

function toggleDictTag(name: string) {
  void (currentTags.value.includes(name) ? removeTag(name) : setTags([...currentTags.value, name]))
}

// ---------------- 溯源（只读） ----------------

const provRows = computed(() => {
  const p = asset.value?.provenance
  if (!p) return []
  const rows = [
    { label: '运行 ID', value: p.runId || '' },
    { label: '模型', value: modelLabelOf(p.model) },
    { label: '工作流', value: p.workflowId || '' },
    { label: '节点', value: p.nodeId || '' },
    { label: '操作人', value: p.operator || '' },
    { label: '时间', value: p.createdAt ? formatTime(p.createdAt) : '' },
    { label: '参数', value: p.params || '' },
  ]
  return rows.filter((r) => r.value)
})

// ---------------- 版本 ----------------

const versions = computed(() => detail.value?.versions ?? { items: [], total: 0 })

/** 版本胶囊标签：校色后（params 带 colorFix）优先按它标，其余回退提示词 / 版本号（原型标签取自 v.prompt） */
function versionLabel(v: { id: number; prompt: string; params: string }, index: number): string {
  try {
    if (v.params && JSON.parse(v.params)?.colorFix) return '校色后'
  } catch {
    /* params 不是 JSON 就当普通版本 */
  }
  const prompt = (v.prompt || '').trim()
  return prompt ? prompt.slice(0, 8) : `版本 ${index + 1}`
}
const hasMoreVersions = computed(() => versions.value.items.length < versions.value.total)
const loadingVersions = ref(false)

async function loadMoreVersions() {
  const id = assetId.value
  const d = detail.value
  if (!id || !d || loadingVersions.value || !hasMoreVersions.value) return
  loadingVersions.value = true
  try {
    const next = versionPage.value + 1
    const res = await assetLibDetail(id, { versionPage: next, pageSize: PAGE_SIZE })
    d.versions.items.push(...(res.data?.versions?.items ?? []))
    versionPage.value = next
  } finally {
    loadingVersions.value = false
  }
}

// ---------------- 相关资产 / 生成结果 ----------------

const related = computed(() => detail.value?.related ?? { items: [], total: 0 })
const generatedResults = computed(() => detail.value?.generatedResults ?? { items: [], total: 0 })
const hasMoreRelated = computed(() => related.value.items.length < related.value.total)
const hasMoreResults = computed(() => generatedResults.value.items.length < generatedResults.value.total)
const loadingRelated = ref(false)
const loadingResults = ref(false)

async function loadMoreRelated() {
  const id = assetId.value
  const d = detail.value
  if (!id || !d || loadingRelated.value || !hasMoreRelated.value) return
  loadingRelated.value = true
  try {
    const next = relatedPage.value + 1
    const res = await assetLibDetail(id, { relatedPage: next, pageSize: PAGE_SIZE })
    d.related.items.push(...(res.data?.related?.items ?? []))
    relatedPage.value = next
  } finally {
    loadingRelated.value = false
  }
}

async function loadMoreResults() {
  const id = assetId.value
  const d = detail.value
  if (!id || !d || loadingResults.value || !hasMoreResults.value) return
  loadingResults.value = true
  try {
    const next = resultPage.value + 1
    const res = await assetLibDetail(id, { resultPage: next, pageSize: PAGE_SIZE })
    d.generatedResults.items.push(...(res.data?.generatedResults?.items ?? []))
    resultPage.value = next
  } finally {
    loadingResults.value = false
  }
}

// ---------------- 追加版本 ----------------

const addingVersion = ref(false)
const versionUploading = ref(false)
const versionImage = ref<string[]>([]) // goUploadImage 产出的 Go 签发地址
const versionPrompt = ref('')
const versionModel = ref('')

const versionModelOptions = [
  { label: '通用', value: '通用' },
  { label: 'GPT Image 2.6', value: 'GPT' },
  { label: 'GPT Image 2.5', value: 'GPT25' },
  { label: 'Nano Banana 2.1', value: 'Banana' },
  { label: 'Seedream 5.5', value: 'Seedream' },
]

const versionFileRef = ref<HTMLInputElement | null>(null)

function pickVersionFile() {
  if (versionUploading.value) return
  versionFileRef.value?.click()
}

async function onVersionFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  await uploadVersionFile(file)
}

/** 选文件 / 拖入 / 粘贴共用 */
async function uploadVersionFile(file: File) {
  versionUploading.value = true
  try {
    versionImage.value = [await goUploadImage(file)]
  } catch {
    // 失败原因（超限/网络）已由调用方 toast 或错误信息携带，这里保持空态
    message.error('图片上传失败')
  } finally {
    versionUploading.value = false
  }
}

// 从资产库添加：选回的是资产库里已有的图片地址，与上传结果同样落进 versionImage（单张，换一张）
const versionAssetShow = ref(false)

function openVersionAssets() {
  if (versionUploading.value) return
  versionAssetShow.value = true
}

function onVersionAssets(picked: string[]) {
  const url = picked.find((u) => /^https?:\/\//i.test(u))
  if (url) versionImage.value = [url]
}

// 拖入 / 粘贴新版本图片：与选文件同一个上传函数
const versionDropRef = ref<HTMLElement | null>(null)
const { dragging: versionDragging } = useFileDropPaste(versionDropRef, {
  accept: 'image',
  disabled: versionUploading,
  onFiles: ([file]) => {
    if (file) uploadVersionFile(file)
  },
})

function resetVersionForm() {
  versionImage.value = []
  versionPrompt.value = ''
  versionModel.value = ''
}

async function submitVersion() {
  const id = assetId.value
  const d = detail.value
  if (!id || !d || versionUploading.value) return
  if (!versionImage.value.length) return message.warning('请上传新版本图片')

  versionUploading.value = true
  try {
    await assetLibAddVersion(id, {
      imageUrl: versionImage.value[0] ?? '',
      prompt: versionPrompt.value.trim() || undefined,
      model: versionModel.value || undefined,
    })
    message.success('已追加版本并设为当前版本')
    addingVersion.value = false
    resetVersionForm()
    // 重拉首页版本 + 详情头图：直接整单重载最省心
    await load(id)
    emit('changed')
  } finally {
    versionUploading.value = false
  }
}

// ---------------- 校色（components/ColorFix 套件） ----------------

function parseVersionParams(raw: string | null | undefined): Record<string, unknown> | null {
  try {
    const o = raw ? JSON.parse(raw) : null
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** 当前版本若是校色版本，取它的 params（colorFix / colorFixRegion / sourceImage） */
const currentFixParams = computed(() => {
  const a = asset.value
  if (!a?.currentVersionId) return null
  const v = versions.value.items.find((x) => x.id === a.currentVersionId)
  const o = parseVersionParams(v?.params)
  return o?.colorFix ? o : null
})
/**
 * 校色底图：当前是校色版本 → 它的 sourceImage；否则当前展示图（= 本页「下载」的 asset.image）。
 * 免费档水印：asset.image 是后端按观看者档位下发的地址；sourceImage 是当初存校色版本时那一页给这位用户的校色来源
 * （同样是他有权下载的那张，各页都按「普通下载同一地址」取），不会是另取的干净原件。
 */
const colorFixBase = computed(() => {
  const a = asset.value
  if (!a || a.media !== 'image') return ''
  const source = currentFixParams.value?.sourceImage
  return (typeof source === 'string' && source) || a.image || ''
})
const colorFixKey = computed(() => {
  const a = asset.value
  const base = colorFixBase.value
  return a && base ? `asset:${a.id}:${(base.split('?')[0] ?? '').slice(-64)}` : ''
})
const cf = useResultColorFix({
  key: colorFixKey,
  src: colorFixBase,
  enabled: computed(() => asset.value?.media === 'image' && !previewFailed.value),
  // 本机没存过、当前又是整图校色版本：参数从版本里取（选区版本还原不了蒙版，不自动套）
  saver: {
    load: () => {
      const o = currentFixParams.value
      if (!o) return null
      const region = colorFixRegionSanitize(o.colorFixRegion)
      return region && region.mode !== 'whole' ? null : colorFixSanitize(o.colorFix)
    },
  },
})
/** 大图：校色开着显示校色预览，否则当前版本图 */
const mediaSrc = computed(() => (cf.active.value ? cf.displaySrc.value : asset.value?.image || ''))
function onMediaError() {
  const src = mediaSrc.value
  // 带 crossorigin 加载失败（存储没开 CORS）：先退回普通加载，再失败才是真挂了
  if (corsAttr(src)) markCorsBlocked(src)
  else previewFailed.value = true
}

const fixMode = ref<'result' | 'compare'>('result')
watch(colorFixKey, () => (fixMode.value = 'result'))
watch(cf.compareAvailable, (ok) => {
  if (!ok) fixMode.value = 'result'
})

async function downloadColorFixed() {
  const a = asset.value
  if (!a) return
  if (!(await cf.downloadBaked(`${downloadName(a.title, false).replace(/\.[a-z0-9]+$/i, '')}-校色后.png`))) {
    message.warning('校色效果未能写入，已下载原图')
  }
}
function downloadColorFixOriginal() {
  const a = asset.value
  if (a) cf.downloadOriginal(downloadName(a.title, false))
}

const savingColorFix = ref(false)
/** 存为校色版本：已有同参数的校色版本就切过去，否则烘 PNG → 直传 → 追加版本（追加即设为当前） */
async function saveFixVersion() {
  const id = assetId.value
  const base = colorFixBase.value
  if (!id || !base || !cf.active.value || savingColorFix.value) return
  savingColorFix.value = true
  try {
    const r = await saveColorFixVersion(id, cf, {
      sourceImage: base,
      fileName: `colorfix-asset-${id}.png`,
      existingVersions: versions.value.items,
    })
    if (r.status === 'not-active') return
    cf.close()
    if (r.status === 'duplicate') {
      if (!r.versionId || r.versionId === asset.value?.currentVersionId) message.info('当前已是这组参数的校色版本')
      else if (await patchAsset({ currentVersionId: r.versionId }))
        message.success('已有相同参数的校色版本，已切换到它')
      return
    }
    message.success('已存为校色版本并设为当前版本')
    await load(id)
    emit('changed')
  } catch {
    message.error('校色版本保存失败，请重试')
  } finally {
    savingColorFix.value = false
  }
}

// ---------------- 相关资产：手动建立 / 解除关联 ----------------

const addingRelation = ref(false)
const relationIdDraft = ref('')
const relationBusy = ref(false)

async function submitRelation() {
  const id = assetId.value
  const d = detail.value
  if (!id || !d || relationBusy.value) return
  const target = Number(relationIdDraft.value.trim())
  if (!Number.isInteger(target) || target <= 0) return message.warning('请输入数字形式的资产 id')
  if (target === id) return message.warning('不能关联资产自身')

  relationBusy.value = true
  try {
    await assetLibAddRelation(id, target)
    message.success('已建立关联')
    addingRelation.value = false
    relationIdDraft.value = ''
    await load(id)
  } finally {
    relationBusy.value = false
  }
}

async function removeRelation(relatedId: number) {
  const id = assetId.value
  if (!id || relationBusy.value) return
  relationBusy.value = true
  try {
    await assetLibRemoveRelation(id, relatedId)
    message.success('已解除关联')
    const d = detail.value
    if (d) {
      d.related.items = d.related.items.filter((r) => r.id !== relatedId)
      d.related.total = Math.max(0, d.related.total - 1)
    }
  } finally {
    relationBusy.value = false
  }
}
</script>

<template>
  <n-modal v-model:show="show" :auto-focus="false" transform-origin="center">
    <section
      class="asset-dlg relative flex overflow-hidden bg-white sx-squircle rounded-18px border border-solid border-line shadow-[0_24px_64px_rgba(31,35,41,0.22)]"
      role="dialog"
      aria-modal="true"
      aria-label="资产详情"
    >
      <IconButton label="关闭" variant="overlay" class="!absolute right-10px top-10px z-3" @click="show = false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </IconButton>
      <div v-if="loading && !asset" class="flex-1 flex items-center justify-center text-13px text-placeholder">
        加载中…
      </div>
      <template v-if="asset">
        <!-- relative：校色参数台相对这一行定位（压在右侧信息栏上，不挡大图） -->
        <ColorFixResultPanel :cf="cf" title="资产校色" />
        <div class="relative flex-1 min-w-0 h-full flex items-center justify-center bg-sunken overflow-hidden">
          <!-- 校色对比：左原图右校色后（下载按钮在右侧操作区） -->
          <ColorFixCompare
            v-if="fixMode === 'compare' && cf.compareAvailable.value && !previewFailed"
            :before="cf.src.value"
            :after="cf.displaySrc.value"
            :after-filter="cf.liveFilter.value"
            :labels="['原图', '校色后']"
            :downloads="false"
          >
            <template #actions>
              <ColorFixPill :pressed="cf.panelOpen.value" @click="cf.open()" />
            </template>
          </ColorFixCompare>
          <video
            v-if="asset.media === 'video' && asset.videoUrl && !previewFailed"
            :src="asset.videoUrl"
            :poster="asset.image || undefined"
            controls
            class="max-w-full max-h-full object-contain"
            @error="previewFailed = true"
          />
          <img
            v-else-if="asset.image && !previewFailed"
            class="max-w-full max-h-full object-contain"
            :src="mediaSrc"
            :crossorigin="corsAttr(mediaSrc)"
            :style="cf.active.value ? cf.previewStyle.value : undefined"
            alt=""
            @error="onMediaError"
          />
          <MediaFallback v-else type="image" reason="loadFailed" />
          <!-- 上一个 / 下一个（原型 relay-nav）：按列表页当前筛选顺序，跨页由列表页处理；键盘 ← / → 同效 -->
          <IconButton
            v-if="hasPrev"
            label="上一个（←）"
            variant="overlay"
            class="!absolute left-8px top-1/2 -translate-y-1/2 z-1"
            @click="emit('prev')"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="m15 5-7 7 7 7" />
            </svg>
          </IconButton>
          <IconButton
            v-if="hasNext"
            label="下一个（→）"
            variant="overlay"
            class="!absolute right-8px top-1/2 -translate-y-1/2 z-1"
            @click="emit('next')"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="m9 5 7 7-7 7" />
            </svg>
          </IconButton>
          <!-- 校色入口（图片资产）：右上毛玻璃胶囊，常显 -->
          <ColorFixPill
            v-if="asset.media === 'image' && asset.image && !previewFailed && fixMode !== 'compare'"
            class="absolute top-10px right-10px z-2"
            :label="cf.active.value ? '校色中' : '校色调整'"
            :pressed="cf.panelOpen.value"
            @click="cf.open()"
          />
          <!-- 版本胶囊（原型 .relay-versions）：媒体底部居中悬浮，原图 / 各版本一键切换（= 切当前版本）；对比档让位给滑杆 -->
          <div
            v-if="versions.items.length && fixMode !== 'compare'"
            class="absolute bottom-10px left-1/2 -translate-x-1/2 flex items-center gap-2px p-4px rounded-full border border-solid border-white/70 bg-white/92 backdrop-blur-[6px] shadow-[0_4px_12px_rgba(31,35,41,0.14)] max-w-[92%]"
          >
            <button
              type="button"
              class="h-28px box-border px-12px rounded-full border-none text-12px cursor-pointer whitespace-nowrap [transition:background_140ms,color_140ms] motion-reduce:transition-none"
              :class="
                !asset.currentVersionId
                  ? 'bg-violet text-white font-600'
                  : 'bg-transparent text-ink-2 hover:(bg-surface3 text-ink)'
              "
              @click="patchAsset({ currentVersionId: 0 })"
            >
              原图
            </button>
            <button
              v-for="(v, vi) in versions.items"
              :key="v.id"
              type="button"
              class="h-28px box-border px-12px rounded-full border-none text-12px cursor-pointer whitespace-nowrap [transition:background_140ms,color_140ms] motion-reduce:transition-none"
              :class="
                v.id === asset.currentVersionId
                  ? 'bg-violet text-white font-600'
                  : 'bg-transparent text-ink-2 hover:(bg-surface3 text-ink)'
              "
              :title="v.prompt || undefined"
              @click="patchAsset({ currentVersionId: v.id })"
            >
              {{ versionLabel(v, vi) }}
            </button>
          </div>
        </div>

        <aside class="w-360px shrink-0 min-w-0 flex flex-col border-l border-l-solid border-line-soft max-md:w-300px">
          <div v-loading="loading" class="flex-1 min-h-0 overflow-auto px-18px pt-18px pb-14px">
            <header class="mb-14px pr-28px">
              <div v-if="editingTitle" class="flex items-center gap-8px">
                <n-input
                  v-model:value="titleDraft"
                  class="flex-1"
                  size="small"
                  maxlength="100"
                  show-count
                  placeholder="1-100 字"
                  @keydown.enter="saveTitle"
                />
                <n-button size="small" type="primary" :loading="saving" @click="saveTitle">保存</n-button>
                <n-button size="small" quaternary @click="editingTitle = false">取消</n-button>
              </div>
              <div v-else class="group flex items-center gap-8px">
                <h2 class="m-0 text-18px leading-26px font-600 text-ink break-all line-clamp-2" :title="asset.title">
                  {{ asset.title || '未命名资产' }}
                </h2>
                <button
                  type="button"
                  class="ll-link relative after:(content-empty absolute -inset-x-6px -inset-y-8px rounded-[inherit]) shrink-0 border-none bg-transparent p-0 cursor-pointer text-12px"
                  @click="startEditTitle"
                >
                  编辑
                </button>
              </div>
              <div class="mt-4px flex items-center gap-8px text-12px text-placeholder">
                <span class="min-w-0 truncate">{{ metaLine }}</span>
                <button
                  type="button"
                  class="relative after:(content-empty absolute -inset-x-6px -inset-y-8px rounded-[inherit]) shrink-0 border-none bg-transparent p-0 text-12px cursor-pointer"
                  :class="asset.favorite ? 'text-violet' : 'text-ink-2'"
                  :disabled="saving"
                  @click="patchAsset({ favorite: !asset.favorite })"
                >
                  {{ asset.favorite ? '★ 已收藏' : '☆ 收藏' }}
                </button>
              </div>
            </header>

            <!-- 提示词：藤紫描边渐变卡，完整内容可滚动，不截断 -->
            <section class="asset-dlg-prompt mb-14px rounded-12px border border-solid border-violet-line">
              <header class="flex items-center justify-between px-12px pt-8px">
                <span class="text-12px font-600 text-violet-ink">提示词</span>
                <button
                  v-if="asset.prompt"
                  type="button"
                  class="relative after:(content-empty absolute -inset-x-6px -inset-y-8px rounded-[inherit]) inline-flex items-center gap-4px border-none bg-transparent p-0 text-12px text-violet-ink cursor-pointer hover:underline"
                  @click="copyText(asset.prompt, message)"
                >
                  复制
                </button>
              </header>
              <pre
                v-if="asset.prompt"
                class="m-0 px-12px pt-6px pb-10px max-h-200px overflow-auto whitespace-pre-wrap break-words font-sans text-13px leading-20px text-ink-2"
                >{{ asset.prompt }}</pre
              >
              <div v-else class="px-12px pt-6px pb-10px text-12px text-placeholder">这个资产没有提示词</div>
            </section>

            <!-- 标签 + 管理 -->
            <div class="mb-14px">
              <div class="flex flex-wrap items-center gap-6px">
                <span class="text-12px text-placeholder">标签</span>
                <span
                  v-for="t in currentTags"
                  :key="t"
                  class="inline-flex items-center px-8px py-3px rounded-4px text-12px bg-violet-soft-2 text-violet-ink border border-solid border-violet-line"
                  :class="tagEditing && 'cursor-pointer'"
                  :title="tagEditing ? '点击移除' : undefined"
                  @click="tagEditing && removeTag(t)"
                >
                  {{ t }}<template v-if="tagEditing">&nbsp;×</template>
                </span>
                <span v-if="!currentTags.length" class="text-12px text-placeholder">未分类</span>
                <button
                  type="button"
                  class="relative after:(content-empty absolute -inset-x-6px -inset-y-8px rounded-[inherit]) border-none bg-transparent p-0 text-12px text-violet cursor-pointer hover:underline"
                  :aria-expanded="tagEditing"
                  @click="tagEditing = !tagEditing"
                >
                  {{ tagEditing ? '完成' : '管理' }}
                </button>
              </div>
              <div v-if="tagEditing" class="mt-8px">
                <n-input
                  v-model:value="newTagName"
                  size="small"
                  maxlength="20"
                  :placeholder="`输入后回车，没有的会自动建（${currentTags.length}/10）`"
                  @keydown.enter="addTag"
                />
                <div v-if="dictOptions.length" class="flex flex-wrap items-center gap-6px mt-8px">
                  <span class="text-12px text-placeholder">我的标签：</span>
                  <span v-for="t in dictOptions" :key="t.id" class="ll-tag" @click="toggleDictTag(t.name)">{{
                    t.name
                  }}</span>
                </div>
              </div>
            </div>

            <!-- 更多：属性 / 授权与元数据 / 溯源 / 版本 / 相关资产 / 生成结果 -->
            <button
              type="button"
              class="flex items-center gap-6px w-full border-none bg-transparent p-0 mb-4px text-12px text-ink-2 cursor-pointer min-h-32px hover:text-ink"
              :aria-expanded="moreOpen"
              @click="moreOpen = !moreOpen"
            >
              <span
                class="inline-block transition-transform motion-reduce:transition-none"
                :class="moreOpen && 'rotate-90'"
                aria-hidden="true"
                >›</span
              >
              更多信息（属性 · 版本 · 相关资产）
            </button>
            <div v-if="moreOpen">
              <!-- 字段网格：分类/授权/收藏与元数据共用同一两列网格（标签列 28px、列距 16px），控件左缘对齐 -->
              <div class="grid grid-cols-2 gap-x-16px gap-y-8px mb-12px">
                <div class="flex items-center gap-8px min-w-0">
                  <span class="shrink-0 w-28px text-12px text-placeholder">分类</span>
                  <n-select
                    class="flex-1 min-w-0"
                    size="small"
                    :options="KIND_OPTIONS"
                    :value="asset.kind"
                    :disabled="saving"
                    @update:value="(v: string) => patchAsset({ kind: v })"
                  />
                </div>
                <div class="flex items-center gap-8px min-w-0">
                  <span class="shrink-0 w-28px text-12px text-placeholder">授权</span>
                  <n-select
                    class="flex-1 min-w-0"
                    size="small"
                    :options="LICENSE_OPTIONS"
                    v-model:value="licenseDraft"
                    :disabled="saving"
                  />
                </div>
              </div>

              <div class="mb-12px">
                <div class="ll-label">元数据</div>
                <div class="grid grid-cols-2 gap-x-16px gap-y-8px">
                  <div v-for="f in META_FIELDS" :key="f.key" class="flex items-center gap-8px min-w-0">
                    <span class="shrink-0 w-28px text-12px text-placeholder">{{ f.label }}</span>
                    <n-input
                      v-model:value="metaDraft[f.key]"
                      class="flex-1 min-w-0"
                      size="small"
                      :maxlength="META_MAX"
                      show-count
                      :disabled="saving"
                      :placeholder="`${f.label}（选填）`"
                    />
                  </div>
                </div>
                <div class="flex items-center gap-8px mt-10px">
                  <n-button size="small" type="primary" :disabled="!profileDirty" :loading="saving" @click="saveProfile"
                    >保存授权与元数据</n-button
                  >
                  <n-button size="small" quaternary :disabled="!profileDirty || saving" @click="resetDrafts"
                    >还原</n-button
                  >
                  <span v-if="profileDirty" class="text-12px text-placeholder">有未保存的修改</span>
                </div>
              </div>

              <div class="mb-12px">
                <div class="ll-label">基础信息</div>
                <div class="flex flex-wrap gap-x-16px gap-y-6px">
                  <span class="text-12px text-ink max-w-full overflow-hidden text-ellipsis whitespace-nowrap"
                    ><i class="not-italic text-placeholder mr-6px after:content-['：']">来源</i
                    >{{ SOURCE_LABELS[asset.source] ?? asset.source }}</span
                  >
                  <span class="text-12px text-ink max-w-full overflow-hidden text-ellipsis whitespace-nowrap"
                    ><i class="not-italic text-placeholder mr-6px after:content-['：']">媒体</i
                    >{{ asset.media === 'video' ? '视频' : '图片' }}</span
                  >
                  <span class="text-12px text-ink max-w-full overflow-hidden text-ellipsis whitespace-nowrap"
                    ><i class="not-italic text-placeholder mr-6px after:content-['：']">创建</i
                    >{{ formatTime(asset.createdAt) }}</span
                  >
                  <span
                    v-if="asset.width"
                    class="text-12px text-ink max-w-full overflow-hidden text-ellipsis whitespace-nowrap"
                    ><i class="not-italic text-placeholder mr-6px after:content-['：']">尺寸</i>{{ asset.width }}×{{
                      asset.height
                    }}</span
                  >
                </div>
              </div>

              <n-collapse v-if="provRows.length">
                <n-collapse-item title="溯源信息" name="prov">
                  <div class="flex flex-col gap-6px">
                    <div v-for="r in provRows" :key="r.label" class="flex gap-8px text-12px">
                      <span class="shrink-0 text-placeholder">{{ r.label }}</span>
                      <span class="text-ink break-all">{{ r.value }}</span>
                    </div>
                  </div>
                </n-collapse-item>
              </n-collapse>

              <div class="border-t border-solid border-sunken pt-12px mt-12px">
                <div class="flex items-center gap-10px min-h-20px mb-10px">
                  <span class="ll-section-title !mb-0">版本（{{ versions.total }}）</span>
                  <span v-if="!asset.currentVersionId" class="ll-chip ll-chip-success">当前：原图</span>
                  <span class="ll-link ml-auto" @click="addingVersion = !addingVersion">
                    {{ addingVersion ? '收起' : '+ 追加版本' }}
                  </span>
                </div>

                <!-- 追加版本：Go presign 直传（资产库只认 Go 签发地址） -->
                <div
                  v-if="addingVersion"
                  class="flex flex-col gap-8px mt-8px mb-10px p-10px border border-solid border-sunken rounded-8px bg-surface2"
                >
                  <div
                    v-if="!versionImage.length"
                    ref="versionDropRef"
                    class="relative flex flex-col items-center gap-4px py-18px border-2 border-dashed border-line-strong rounded-8px text-muted text-12px hover:(border-violet text-violet-ink) has-[:focus-visible]:(outline outline-2 outline-solid outline-violet outline-offset-2)"
                    :class="[
                      versionUploading ? 'opacity-60 cursor-wait' : 'cursor-pointer',
                      versionDragging && 'sx-drop',
                    ]"
                    @click="pickVersionFile"
                  >
                    <!-- 从资产库添加：盖在透明文件框之上（z-1），点它不弹文件框 -->
                    <button
                      type="button"
                      class="absolute right-12px top-12px z-1 px-4px text-12px leading-18px text-violet bg-transparent border-none cursor-pointer rounded-sm hover:underline disabled:(opacity-45 cursor-not-allowed) sx-focus"
                      aria-label="从资产库添加新版本图片"
                      :disabled="versionUploading"
                      @click.stop="openVersionAssets"
                    >
                      从资产库添加
                    </button>
                    <input
                      ref="versionFileRef"
                      type="file"
                      accept="image/*"
                      class="absolute inset-0 opacity-0 cursor-pointer"
                      @change="onVersionFile"
                    />
                    <span class="text-20px">☁</span>
                    <span>{{ versionUploading ? '上传中…' : '上传新版本图片' }}</span>
                    <span class="text-11px text-placeholder">单张 ≤10M</span>
                  </div>
                  <div v-else class="relative">
                    <img
                      class="max-w-120px max-h-120px rounded-8px border border-solid border-line block"
                      :src="versionImage[0]"
                      alt=""
                    />
                    <span
                      class="absolute top-4px right-4px text-11px text-white bg-[rgba(0,0,0,0.45)] rounded-4px px-6px py-1px cursor-pointer"
                      @click="versionImage = []"
                      >重选</span
                    >
                  </div>
                  <n-input
                    v-model:value="versionPrompt"
                    type="textarea"
                    :rows="2"
                    placeholder="版本说明 / 提示词（选填）"
                  />
                  <div>
                    <n-select
                      v-model:value="versionModel"
                      :options="versionModelOptions"
                      placeholder="生成模型（选填）"
                      size="small"
                      clearable
                    />
                    <n-button size="small" type="primary" :loading="versionUploading" @click="submitVersion"
                      >提交版本</n-button
                    >
                  </div>
                </div>

                <AssetPickerModal v-model:show="versionAssetShow" :limit="1" @select="onVersionAssets" />

                <div v-if="!versions.items.length" class="ll-empty">没有版本记录，当前展示原图</div>
                <div
                  v-for="v in versions.items"
                  :key="v.id"
                  class="flex items-center gap-12px px-10px py-8px border border-solid rounded-8px mt-8px"
                  :class="v.id === asset.currentVersionId ? 'border-violet-line bg-violet-soft' : 'border-line'"
                >
                  <img
                    v-if="v.image && !versionThumbFailed[v.id]"
                    class="w-56px h-56px shrink-0 object-cover rounded-6px bg-sunken"
                    :src="v.image"
                    alt=""
                    loading="lazy"
                    @error="versionThumbFailed[v.id] = true"
                  />
                  <div
                    v-else
                    class="w-56px h-56px shrink-0 rounded-6px bg-sunken flex items-center justify-center text-11px text-placeholder"
                  >
                    无图
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-8px">
                      <span class="text-13px font-600 text-ink">V{{ v.versionNo }}</span>
                      <span v-if="v.id === asset.currentVersionId" class="ll-chip ll-chip-success">当前版本</span>
                      <span class="text-12px text-placeholder"
                        >{{ modelLabelOf(v.model) || '未知模型' }} · {{ formatTime(v.createdAt) }}</span
                      >
                    </div>
                    <div class="text-12px text-ink-2 mt-2px line-clamp-2" :title="v.prompt">
                      {{ v.prompt || '（无提示词）' }}
                    </div>
                  </div>
                  <n-button
                    v-if="v.id !== asset.currentVersionId"
                    size="tiny"
                    :disabled="saving"
                    @click="patchAsset({ currentVersionId: v.id })"
                  >
                    设为当前版本
                  </n-button>
                </div>
                <div v-if="asset.currentVersionId || hasMoreVersions" class="flex gap-16px mt-8px">
                  <span v-if="asset.currentVersionId" class="ll-link" @click="patchAsset({ currentVersionId: 0 })"
                    >回到原图</span
                  >
                  <span v-if="hasMoreVersions" class="ll-link" @click="loadMoreVersions">
                    {{ loadingVersions ? '加载中…' : '加载更多版本' }}
                  </span>
                </div>
              </div>

              <div class="border-t border-solid border-sunken pt-12px mt-12px">
                <div class="flex items-center gap-10px min-h-20px mb-10px">
                  <span class="ll-section-title !mb-0">相关资产（{{ related.total }}）</span>
                  <span class="ll-link ml-auto" @click="addingRelation = !addingRelation">
                    {{ addingRelation ? '收起' : '+ 添加关联' }}
                  </span>
                </div>
                <div
                  v-if="addingRelation"
                  class="flex flex-row items-center gap-8px mt-8px mb-10px p-10px border border-solid border-sunken rounded-8px bg-surface2"
                >
                  <n-input
                    v-model:value="relationIdDraft"
                    class="flex-1"
                    size="small"
                    placeholder="输入对方资产 id（数字）"
                    @keydown.enter="submitRelation"
                  />
                  <n-button size="small" type="primary" :loading="relationBusy" @click="submitRelation"
                    >建立关联</n-button
                  >
                </div>
                <div v-if="!related.items.length" class="ll-empty">暂无相关资产</div>
                <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-10px mt-10px">
                  <div
                    v-for="r in related.items"
                    :key="r.id"
                    class="relative cursor-pointer group"
                    @click="assetId = r.id"
                  >
                    <img
                      v-if="r.image && !miniThumbFailed[r.id]"
                      class="block w-full aspect-square object-cover rounded-6px bg-sunken"
                      :src="r.image"
                      alt=""
                      loading="lazy"
                      @error="miniThumbFailed[r.id] = true"
                    />
                    <div
                      v-else
                      class="w-full aspect-square rounded-6px bg-sunken flex items-center justify-center text-11px text-placeholder"
                    >
                      无图
                    </div>
                    <span
                      class="block text-11px text-ink-2 mt-4px whitespace-nowrap overflow-hidden text-ellipsis hover:text-violet"
                      :title="r.title"
                      >{{ r.title || '未命名资产' }}</span
                    >
                    <IconButton
                      label="解除关联"
                      variant="overlay"
                      size="sm"
                      reveal
                      class="absolute top-4px right-4px"
                      @click.stop="removeRelation(r.id)"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.4"
                        stroke-linecap="round"
                      >
                        <path d="M6 6l12 12M18 6 6 18" />
                      </svg>
                    </IconButton>
                  </div>
                </div>
                <div v-if="hasMoreRelated" class="flex gap-16px mt-8px">
                  <span class="ll-link" @click="loadMoreRelated">{{ loadingRelated ? '加载中…' : '加载更多' }}</span>
                </div>
              </div>

              <div class="border-t border-solid border-sunken pt-12px mt-12px">
                <div class="flex items-center gap-10px min-h-20px mb-10px">
                  <span class="ll-section-title !mb-0">生成结果（{{ generatedResults.total }}）</span>
                </div>
                <div v-if="!generatedResults.items.length" class="ll-empty">还没有由它生成的资产</div>
                <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-10px mt-10px">
                  <div
                    v-for="r in generatedResults.items"
                    :key="r.id"
                    class="relative cursor-pointer group"
                    @click="assetId = r.id"
                  >
                    <img
                      v-if="r.image && !miniThumbFailed[r.id]"
                      class="block w-full aspect-square object-cover rounded-6px bg-sunken"
                      :src="r.image"
                      alt=""
                      loading="lazy"
                      @error="miniThumbFailed[r.id] = true"
                    />
                    <div
                      v-else
                      class="w-full aspect-square rounded-6px bg-sunken flex items-center justify-center text-11px text-placeholder"
                    >
                      无图
                    </div>
                    <span
                      class="block text-11px text-ink-2 mt-4px whitespace-nowrap overflow-hidden text-ellipsis hover:text-violet"
                      :title="r.title"
                      >{{ r.title || '未命名资产' }}</span
                    >
                  </div>
                </div>
                <div v-if="hasMoreResults" class="flex gap-16px mt-8px">
                  <span class="ll-link" @click="loadMoreResults">{{ loadingResults ? '加载中…' : '加载更多' }}</span>
                </div>
              </div>
            </div>
          </div>

          <footer class="shrink-0 flex flex-col gap-8px px-18px py-12px border-t border-t-solid border-line-soft">
            <!-- 校色开着：下载给校色后的 PNG，另留「下载原图」 -->
            <div v-if="cf.active.value" class="flex flex-wrap items-center gap-8px">
              <button type="button" class="sx-soft-btn" @click="downloadColorFixed">下载校色后</button>
              <button type="button" class="sx-soft-btn" @click="downloadColorFixOriginal">下载原图</button>
              <button
                type="button"
                class="sx-soft-btn"
                :disabled="savingColorFix"
                :aria-busy="savingColorFix || undefined"
                title="追加一个「校色后」版本并设为当前版本；同参数的版本已存在时直接切过去"
                @click="saveFixVersion"
              >
                {{ savingColorFix ? '保存中…' : '存为校色版本' }}
              </button>
              <button
                type="button"
                class="sx-soft-btn"
                :aria-pressed="fixMode === 'compare'"
                @click="fixMode = fixMode === 'compare' ? 'result' : 'compare'"
              >
                {{ fixMode === 'compare' ? '退出对比' : '校色对比' }}
              </button>
            </div>
            <div class="flex flex-wrap items-center gap-8px">
              <button
                v-if="asset.prompt"
                type="button"
                class="sx-soft-btn sx-soft-btn-primary"
                @click="copyText(asset.prompt, message)"
              >
                复制提示词
              </button>
              <a
                v-if="!cf.active.value && downloadHref"
                class="sx-soft-btn no-underline"
                :href="downloadHref"
                :download="downloadName(asset.title, asset.media === 'video')"
                target="_blank"
                rel="noopener noreferrer"
              >
                <svg
                  class="w-13px h-13px"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.9"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" />
                </svg>
                下载
              </a>
              <button
                v-if="downloadHref"
                type="button"
                class="sx-soft-btn"
                :disabled="openingCanvas"
                :aria-busy="openingCanvas || undefined"
                title="新建一张画布，把这个素材放进去"
                @click="openAssetsInCanvas([asset])"
              >
                {{ openingCanvas ? '正在创建画布…' : '用于画布' }}
              </button>
              <!-- 删除预留位：后端支持后由列表页传 can-delete 并监听 delete；不可删时给原因而不是隐藏 -->
              <button
                v-if="canDelete || deleteDisabledReason"
                type="button"
                class="sx-soft-btn sx-soft-btn-danger ml-auto"
                :disabled="!canDelete"
                :title="canDelete ? undefined : deleteDisabledReason"
                @click="canDelete && emit('delete', asset.id)"
              >
                删除
              </button>
            </div>
          </footer>
        </aside>
      </template>
    </section>
  </n-modal>
</template>

<style scoped lang="less">
.asset-dlg {
  width: min(980px, 94vw);
  height: min(620px, 88vh);
  animation: asset-dlg-in 0.26s cubic-bezier(0.22, 0.61, 0.36, 1) both;
}
.asset-dlg-prompt {
  background: linear-gradient(180deg, #fbf8fd 0%, #fff 100%);
}
@keyframes asset-dlg-in {
  from {
    opacity: 0.86;
    transform: translateY(10px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .asset-dlg {
    animation: none;
  }
}
</style>

<style lang="less">
/* 详情层遮罩：原型 rgba(245,246,248,.72)；NModal 的遮罩在 Teleport 里，scoped 够不着 */
.n-modal-container:has(.asset-dlg) .n-modal-mask {
  background-color: rgba(245, 246, 248, 0.72);
}
</style>
