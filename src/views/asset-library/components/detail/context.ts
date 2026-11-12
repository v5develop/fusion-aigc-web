/**
 * 资产详情弹层的共享状态（2026-11-11 重排）：DetailModal 调 createAssetDetail 一次并 provide，
 * 舞台 / 头部 / 三个页签用 useAssetDetail() 取同一份。数据流与改版前一致：
 * 详情一次带回三组子列表当前页、翻页各自 page+1 追加；所有写操作走 patchAsset（返回完整资产就地覆盖）。
 *
 * <p>校色（components/ColorFix 套件）也在这里：图片资产可调色，调过之后下载给校色后的 PNG（另留原图）、
 * 可切「对比」、可「保存为新版本」——追加版本（params = { colorFix, colorFixRegion?, sourceImage }），
 * 已有同参数的校色版本时直接切过去。当前版本本身是校色版本时以它的 sourceImage 为底图。
 */
import { computed, inject, provide, ref, watch, type InjectionKey, type Ref } from 'vue'
import { useMessage, type DropdownOption } from 'naive-ui'
import { modelLabelOf } from '@/utils/model-label'
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
import { studioBatchDetailQuiet, studioTaskDetailQuiet } from '@/api/studio.ts'
import { tryonReferences } from '@/views/studio/colorfix/references.ts'
import {
  colorFixRegionSanitize,
  colorFixSanitize,
  corsAttr,
  markCorsBlocked,
  saveColorFixVersion,
  saveFlattenedVersion,
  useResultColorFix,
  type ColorFixReference,
} from '@/components/ColorFix'
import { copyText, downloadName } from '../../ui.ts'
import { useAssetsInCanvas } from '../../useInCanvas.ts'

export const PAGE_SIZE = 6

/** 商拍换装成品入素材库时的入口码（Go studio 配置 Entry.Tryon 默认值） */
const STUDIO_TRYON_ENTRY = 'studio_tryon'
/** 来源任务号 → 校色参考图（翻页回看不重复请求；批次快照不会变） */
const referencesCache = new Map<string, ColorFixReference[]>()
const REFERENCES_CACHE_MAX = 40

export const KIND_OPTIONS = [
  { label: '其他分类', value: '' },
  { label: '模特', value: 'model' },
  { label: '场景', value: 'scene' },
  { label: '妆造', value: 'makeup' },
  { label: '发型', value: 'hair' },
  { label: '配饰', value: 'accessory' },
]
export const LICENSE_OPTIONS = [
  { label: '已授权', value: 'cleared' },
  { label: '内部使用', value: 'internal' },
  { label: '未知', value: 'unknown' },
  { label: '未设置', value: '' },
]
export const META_MAX = 50
export const META_FIELDS = [
  { key: 'industry', label: '行业' },
  { key: 'style', label: '风格' },
  { key: 'shot', label: '镜头' },
  { key: 'color', label: '颜色' },
] as const
export type MetaKey = (typeof META_FIELDS)[number]['key']
export const SOURCE_LABELS: Record<string, string> = {
  generated: 'AI 生成',
  upload: '上传',
  official: '官方',
}
export const VERSION_MODEL_OPTIONS = [
  { label: '通用', value: '通用' },
  { label: 'GPT Image 2.6', value: 'GPT' },
  { label: 'GPT Image 2.5', value: 'GPT25' },
  { label: 'Nano Banana 2.1', value: 'Banana' },
  { label: 'Seedream 5.5', value: 'Seedream' },
]

export type DetailTab = 'info' | 'versions' | 'related'

interface DetailProps {
  canDelete: boolean
  deleteDisabledReason: string
}
interface DetailEmit {
  (e: 'changed'): void
  (e: 'delete', id: number): void
}

function parseVersionParams(raw: string | null | undefined): Record<string, unknown> | null {
  try {
    const o = raw ? JSON.parse(raw) : null
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** 版本是否为校色版本（params 带 colorFix） */
export function isColorFixVersion(params: string | null | undefined): boolean {
  return !!parseVersionParams(params)?.colorFix
}

/** 地址里的扩展名 → 格式（JPG / PNG / MP4…）；取不到返回空 */
export function formatOfUrl(url: string | null | undefined): string {
  const path = (url || '').split('?')[0] ?? ''
  const m = /\.([a-z0-9]{2,5})$/i.exec(path)
  if (!m?.[1]) return ''
  const ext = m[1].toUpperCase()
  return ext === 'JPEG' ? 'JPG' : ext
}

/** 宽高 → 常见比例（1:1、4:3、16:9…），对不上常见档时给约分后的整数比 */
export function ratioOf(w: number, h: number): string {
  if (!w || !h) return ''
  const common: [number, number][] = [
    [1, 1],
    [4, 3],
    [3, 4],
    [3, 2],
    [2, 3],
    [16, 9],
    [9, 16],
    [21, 9],
    [5, 4],
    [4, 5],
  ]
  const r = w / h
  for (const [a, b] of common) if (Math.abs(r - a / b) < 0.02) return `${a}:${b}`
  const gcd = (x: number, y: number): number => (y ? gcd(y, x % y) : x)
  const g = gcd(w, h)
  return `${w / g}:${h / g}`
}

export function createAssetDetail(assetId: Ref<number | null>, props: DetailProps, emit: DetailEmit) {
  const message = useMessage()
  const { opening: openingCanvas, openAssetsInCanvas } = useAssetsInCanvas()

  // ---------------- 详情加载 ----------------

  const detail = ref<IAssetLibDetail | null>(null)
  const loading = ref(false)
  const versionPage = ref(1)
  const relatedPage = ref(1)
  const resultPage = ref(1)
  // 缩略图挂了就上占位。版本 id 与资产 id 是两个空间，分表记
  const versionThumbFailed = ref<Record<number, boolean>>({})
  const miniThumbFailed = ref<Record<number, boolean>>({})
  const previewFailed = ref(false)
  const editingTitle = ref(false)
  const titleDraft = ref('')

  let loadSeq = 0
  async function load(id: number) {
    const seq = ++loadSeq
    loading.value = true
    try {
      const res = await assetLibDetail(id, { pageSize: PAGE_SIZE })
      // 慢请求回来时用户可能已翻到下一个：只认最后一次请求、且仍是当前 id
      if (seq !== loadSeq || assetId.value !== id) return
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
      if (seq !== loadSeq || assetId.value !== id) return
      detail.value = null
      // 资产可能已被删：toast 已由请求层弹过，收起空壳弹层
      assetId.value = null
    } finally {
      // 旧请求收尾不能把新请求的加载态清掉
      if (seq === loadSeq) loading.value = false
    }
  }

  watch(
    assetId,
    (id) => {
      if (id != null) {
        void load(id)
        void loadMyTags()
      } else {
        detail.value = null
      }
    },
    { immediate: true },
  )

  const asset = computed<IAssetLibAsset | null>(() => detail.value?.asset ?? null)
  const isImage = computed(() => asset.value?.media === 'image')

  const kindLabel = computed(() => KIND_OPTIONS.find((k) => k.value === asset.value?.kind)?.label ?? '其他分类')
  /** 头部说明行：日期 · 来源 · 分类 [· 视频] */
  const metaLine = computed(() => {
    const a = asset.value
    if (!a) return ''
    const date = a.createdAt ? formatTime(a.createdAt).slice(0, 10) : ''
    const source = SOURCE_LABELS[a.source] ?? a.source
    return [date, source, kindLabel.value, a.media === 'video' ? '视频' : ''].filter(Boolean).join(' · ')
  })

  const downloadHref = computed(() => {
    const a = asset.value
    if (!a) return ''
    return (a.media === 'video' ? a.videoUrl : a.image) || ''
  })

  // ---------------- 通用 PATCH ----------------

  const saving = ref(false)

  async function patchAsset(data: IAssetLibUpdateReq): Promise<boolean> {
    const id = assetId.value
    // 翻页后新详情还没回来时，屏幕上仍是上一个资产：不把这次操作打到新 id 上
    if (!id || saving.value || detail.value?.asset.id !== id) return false
    saving.value = true
    try {
      const res = await assetLibUpdate(id, data)
      // 请求途中翻到了别的资产：不能拿旧资产覆盖新详情
      if (res.data && detail.value?.asset.id === id && assetId.value === id) detail.value.asset = res.data
      emit('changed')
      return true
    } catch {
      return false // 失败 toast 已由请求层弹出
    } finally {
      saving.value = false
    }
  }

  async function toggleFavorite() {
    const a = asset.value
    if (!a) return
    const next = !a.favorite
    if (await patchAsset({ favorite: next })) message.success(next ? '已收藏' : '已取消收藏')
  }

  async function setCurrentVersion(versionId: number) {
    if (asset.value?.currentVersionId === versionId) return
    if (await patchAsset({ currentVersionId: versionId }))
      message.success(versionId ? '已设为当前版本' : '已切回原图')
  }

  // ---------------- 授权（即改即存，同分类）/ 补充信息草稿（脏字段才 PATCH） ----------------

  async function setLicense(v: string) {
    if ((asset.value?.license ?? '') === v) return
    if (await patchAsset({ license: v })) message.success('授权已更新')
  }
  async function setKind(v: string) {
    if ((asset.value?.kind ?? '') === v) return
    if (await patchAsset({ kind: v })) message.success('分类已更新')
  }

  const metaDraft = ref<Record<MetaKey, string>>({ industry: '', style: '', shot: '', color: '' })

  function baseMeta(): Record<MetaKey, string> {
    const m = asset.value?.metadata
    return { industry: m?.industry ?? '', style: m?.style ?? '', shot: m?.shot ?? '', color: m?.color ?? '' }
  }
  function resetDrafts() {
    metaDraft.value = baseMeta()
  }
  const metaDirty = computed(() => {
    const base = baseMeta()
    return META_FIELDS.some((f) => metaDraft.value[f.key].trim() !== base[f.key])
  })
  const metaFilledCount = computed(() => META_FIELDS.filter((f) => baseMeta()[f.key]).length)

  async function saveMeta() {
    if (!metaDirty.value) return
    for (const f of META_FIELDS) {
      if (metaDraft.value[f.key].trim().length > META_MAX) {
        message.warning(`${f.label}最多 ${META_MAX} 字`)
        return
      }
    }
    // metadata 是整体替换：四个键都带，空的发空串
    const ok = await patchAsset({
      metadata: {
        industry: metaDraft.value.industry.trim(),
        style: metaDraft.value.style.trim(),
        shot: metaDraft.value.shot.trim(),
        color: metaDraft.value.color.trim(),
      },
    })
    if (ok) {
      resetDrafts()
      message.success('补充信息已保存')
    }
  }

  // ---------------- 标题行内编辑 ----------------

  function startEditTitle() {
    titleDraft.value = asset.value?.title ?? ''
    editingTitle.value = true
  }
  async function saveTitle() {
    const t = titleDraft.value.trim()
    if (!t) return message.warning('标题不能为空')
    if (t.length > 100) return message.warning('标题最多 100 字')
    if (t === asset.value?.title) {
      editingTitle.value = false
      return
    }
    if (await patchAsset({ title: t })) {
      editingTitle.value = false
      message.success('标题已保存')
    }
  }

  // ---------------- 标签（整组替换，≤10） ----------------

  const myTags = ref<IAssetLibTag[]>([])
  const newTagName = ref('')
  const tagEditing = ref(false)

  async function loadMyTags() {
    try {
      const res = await assetLibTags()
      myTags.value = res.data?.items ?? []
    } catch {
      myTags.value = []
    }
  }
  const currentTags = computed<string[]>(() => asset.value?.tags ?? [])
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
    if (n.length > 20) return message.warning('标签名最多 20 字')
    if (currentTags.value.includes(n)) return message.warning('该标签已在这个资产上')
    if (await setTags([...currentTags.value, n])) newTagName.value = '' // 字典里没有的名字服务端自动建
  }
  async function removeTag(name: string) {
    await setTags(currentTags.value.filter((t) => t !== name))
  }
  function toggleDictTag(name: string) {
    void (currentTags.value.includes(name) ? removeTag(name) : setTags([...currentTags.value, name]))
  }

  // ---------------- 溯源（只读） ----------------

  const modelLabel = computed(() => modelLabelOf(asset.value?.provenance?.model) || '')
  const provRows = computed(() => {
    const p = asset.value?.provenance
    if (!p) return []
    const rows = [
      { label: '运行 ID', value: p.runId || '' },
      { label: '工作流', value: p.workflowId || '' },
      { label: '节点', value: p.nodeId || '' },
      { label: '操作人', value: p.operator || '' },
      { label: '生成时间', value: p.createdAt ? formatTime(p.createdAt) : '' },
      { label: '参数', value: p.params || '' },
    ]
    return rows.filter((r) => r.value)
  })

  // ---------------- 版本 ----------------

  const versions = computed(() => detail.value?.versions ?? { items: [], total: 0 })

  /** 版本胶囊标签：校色版本标「校色后」，其余回退提示词前 8 字 / 版本号 */
  function versionLabel(v: { id: number; prompt: string; params: string; versionNo?: number }, index: number) {
    if (isColorFixVersion(v.params)) return '校色后'
    const prompt = (v.prompt || '').trim()
    return prompt ? prompt.slice(0, 8) : `版本 ${v.versionNo ?? index + 1}`
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
      if (detail.value !== d) return // 已换资产 / 已重载
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
      if (detail.value !== d) return
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
      if (detail.value !== d) return
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
  const versionAssetShow = ref(false)

  /** 选文件 / 拖入 / 粘贴共用 */
  async function uploadVersionFile(file: File) {
    versionUploading.value = true
    try {
      versionImage.value = [await goUploadImage(file)]
    } catch {
      message.error('图片上传失败')
    } finally {
      versionUploading.value = false
    }
  }
  function openVersionAssets() {
    if (versionUploading.value) return
    versionAssetShow.value = true
  }
  function onVersionAssets(picked: string[]) {
    const url = picked.find((u) => /^https?:\/\//i.test(u))
    if (url) versionImage.value = [url]
  }
  function resetVersionForm() {
    versionImage.value = []
    versionPrompt.value = ''
    versionModel.value = ''
  }
  async function submitVersion() {
    const id = assetId.value
    if (!id || !detail.value || versionUploading.value) return
    if (!versionImage.value.length) return message.warning('请先上传或选一张新版本图片')
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
      await load(id)
      emit('changed')
    } finally {
      versionUploading.value = false
    }
  }

  // ---------------- 相关资产：手动建立 / 解除关联 ----------------

  const addingRelation = ref(false)
  const relationIdDraft = ref('')
  const relationBusy = ref(false)

  async function submitRelation() {
    const id = assetId.value
    if (!id || !detail.value || relationBusy.value) return
    const target = Number(relationIdDraft.value.trim())
    if (!Number.isInteger(target) || target <= 0) return message.warning('请输入数字形式的资产编号')
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
      if (d && assetId.value === id) {
        d.related.items = d.related.items.filter((r) => r.id !== relatedId)
        d.related.total = Math.max(0, d.related.total - 1)
      }
    } finally {
      relationBusy.value = false
    }
  }

  // ---------------- 校色 ----------------

  /** 当前版本若是校色版本，取它的 params（colorFix / colorFixRegion / sourceImage） */
  const currentFixParams = computed(() => {
    const a = asset.value
    if (!a?.currentVersionId) return null
    const v = versions.value.items.find((x) => x.id === a.currentVersionId)
    const o = parseVersionParams(v?.params)
    return o?.colorFix ? o : null
  })
  /**
   * 校色底图：当前是校色版本 → 它的 sourceImage；否则当前展示图（= 「下载」的 asset.image）。
   * 免费档水印：两者都是这位用户有权下载的那张，不会是另取的干净原件。
   */
  const colorFixBase = computed(() => {
    const a = asset.value
    if (!a || a.media !== 'image') return ''
    const fix = currentFixParams.value
    // 带像素层的校色版本：像素只在存它的设备上，底图用它已存的成品图（同 colorFixBaseOf）
    if ((fix?.colorFixLayers as { hasPixelLayers?: boolean } | undefined)?.hasPixelLayers === true) return a.image || ''
    const source = fix?.sourceImage
    return (typeof source === 'string' && source) || a.image || ''
  })
  const colorFixKey = computed(() => {
    const a = asset.value
    const base = colorFixBase.value
    return a && base ? `asset:${a.id}:${(base.split('?')[0] ?? '').slice(-64)}` : ''
  })
  // 商拍换装产出的资产：由来源任务号（provenance.runId）反查批次提交快照，取原服装图作校色浮卡的参考图 / 单品切换。
  // 只用现有接口（GET /studio/tasks/{id} → batchId → GET /studio/batches/{id}）；批次已删除 / 不是本人的 / 取不到 = 不出参考图
  const colorFixReferences = ref<ColorFixReference[]>([])
  let referencesTicket = 0
  watch(
    () => {
      const a = asset.value
      return a && a.media === 'image' && a.entryCode === STUDIO_TRYON_ENTRY ? (a.provenance?.runId ?? '') : ''
    },
    async (taskId) => {
      const my = ++referencesTicket
      colorFixReferences.value = []
      if (!taskId) return
      try {
        let list = referencesCache.get(taskId)
        if (!list) {
          const task = (await studioTaskDetailQuiet(taskId)).data
          if (my !== referencesTicket || !task?.batchId) return
          const batch = (await studioBatchDetailQuiet(task.batchId)).data
          list = tryonReferences(batch?.batch.payload)
          referencesCache.set(taskId, list)
          if (referencesCache.size > REFERENCES_CACHE_MAX) referencesCache.delete(referencesCache.keys().next().value!)
        }
        if (my === referencesTicket) colorFixReferences.value = list
      } catch {
        /* 取不到：不出参考图，校色照常 */
      }
    },
    { immediate: true },
  )

  const cf = useResultColorFix({
    key: colorFixKey,
    src: colorFixBase,
    references: colorFixReferences,
    enabled: computed(() => asset.value?.media === 'image' && !previewFailed.value),
    // 本机没存过、当前又是整图校色版本：参数从版本里取（选区版本还原不了蒙版，不自动套）
    saver: {
      load: () => {
        const o = currentFixParams.value
        if (!o) return null
        // 多图层 / 替换颜色的版本（colorFixLayers）同样还原不全，不自动套
        if (o.colorFixLayers) return null
        const region = colorFixRegionSanitize(o.colorFixRegion)
        return region && region.mode !== 'whole' ? null : colorFixSanitize(o.colorFix)
      },
    },
    // 拼合：当前效果烘成新版本（不带 colorFix，之后以它为底图），设为当前版本后重新拉详情 → 底图切到新版本、图层清空
    flattener: async (ctx) => {
      const id = assetId.value
      if (!id) return false
      try {
        await saveFlattenedVersion(id, ctx)
      } catch (err) {
        message.error('拼合失败，请重试')
        throw err
      }
      message.success('已拼合为新版本，并设为当前版本')
      await load(id)
      emit('changed')
      return true
    },
  })

  /** 校色后的查看方式：校色后 / 原图 / 左右对比 */
  const fixMode = ref<'result' | 'compare' | 'original'>('result')
  watch(colorFixKey, () => (fixMode.value = 'result'))
  watch(cf.compareAvailable, (ok) => {
    if (!ok && fixMode.value === 'compare') fixMode.value = 'result'
  })

  const canColorFix = computed(() => isImage.value && !!asset.value?.image && !previewFailed.value)
  /** 大图：校色开着且没切到「原图」时显示校色预览，否则当前版本图 */
  const showFixed = computed(() => cf.active.value && fixMode.value !== 'original')
  const mediaSrc = computed(() => (showFixed.value ? cf.displaySrc.value : asset.value?.image || ''))
  function onMediaError() {
    const src = mediaSrc.value
    // 带 crossorigin 加载失败（存储没开 CORS）：先退回普通加载，再失败才是真挂了
    if (corsAttr(src)) markCorsBlocked(src)
    else previewFailed.value = true
  }

  /** 校色效果是否已存成版本（当前版本就是校色版本且参数没再动过时，算已保存） */
  const fixSavedAsVersion = computed(() => !!currentFixParams.value)

  // ---------------- 下载 / 更多 ----------------

  async function downloadColorFixed() {
    const a = asset.value
    if (!a) return
    if (await cf.downloadBaked(`${downloadName(a.title, false).replace(/\.[a-z0-9]+$/i, '')}-校色后.png`))
      message.success('已开始下载校色后的图片')
    else message.warning('校色效果未能写入，已下载原图')
  }
  function downloadColorFixOriginal() {
    const a = asset.value
    if (!a) return
    cf.downloadOriginal(downloadName(a.title, false))
    message.success('已开始下载原图')
  }
  /** 主「下载」：校色开着且正在看校色效果 → 校色后；否则原图（= 屏幕上看到的那张） */
  function downloadCurrent() {
    if (showFixed.value) void downloadColorFixed()
    else downloadColorFixOriginal()
  }
  const downloadMenu = computed<DropdownOption[]>(() => [
    { key: 'fixed', label: '下载校色后（PNG）' },
    { key: 'original', label: '下载原图' },
  ])
  function onDownloadMenu(key: string) {
    if (key === 'fixed') void downloadColorFixed()
    else downloadColorFixOriginal()
  }
  /** 「⋯」更多：复制提示词、删除（不可删时置灰并给原因；确认弹窗由列表页负责） */
  const moreMenu = computed<DropdownOption[]>(() => {
    const a = asset.value
    const list: DropdownOption[] = []
    if (a?.prompt) list.push({ key: 'copy', label: '复制提示词' })
    if (props.canDelete || props.deleteDisabledReason) {
      if (list.length) list.push({ type: 'divider', key: 'd1' })
      list.push({
        key: 'delete',
        label: props.canDelete ? '删除…' : `删除（${props.deleteDisabledReason}）`,
        disabled: !props.canDelete,
        props: { style: props.canDelete ? 'color: var(--xq-danger-fg)' : undefined },
      })
    }
    return list
  })
  function onMoreMenu(key: string) {
    const a = asset.value
    if (!a) return
    if (key === 'copy' && a.prompt) void copyText(a.prompt, message)
    else if (key === 'delete' && props.canDelete) emit('delete', a.id)
  }
  function copyPrompt() {
    const p = asset.value?.prompt
    if (p) void copyText(p, message)
  }
  function openInCanvas() {
    const a = asset.value
    if (a) void openAssetsInCanvas([a])
  }

  const savingColorFix = ref(false)
  /** 保存为新版本：已有同参数的校色版本就切过去，否则烘 PNG → 直传 → 追加版本（追加即设为当前） */
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
      message.success('已保存为新版本，并设为当前版本')
      await load(id)
      emit('changed')
    } catch {
      message.error('校色版本保存失败，请重试')
    } finally {
      savingColorFix.value = false
    }
  }

  return {
    assetId,
    message,
    detail,
    loading,
    asset,
    isImage,
    kindLabel,
    metaLine,
    downloadHref,
    versionThumbFailed,
    miniThumbFailed,
    previewFailed,
    editingTitle,
    titleDraft,
    saving,
    patchAsset,
    toggleFavorite,
    setCurrentVersion,
    setLicense,
    setKind,
    metaDraft,
    metaDirty,
    metaFilledCount,
    resetDrafts,
    saveMeta,
    startEditTitle,
    saveTitle,
    newTagName,
    tagEditing,
    currentTags,
    dictOptions,
    addTag,
    removeTag,
    toggleDictTag,
    modelLabel,
    provRows,
    versions,
    versionLabel,
    hasMoreVersions,
    loadingVersions,
    loadMoreVersions,
    related,
    generatedResults,
    hasMoreRelated,
    hasMoreResults,
    loadingRelated,
    loadingResults,
    loadMoreRelated,
    loadMoreResults,
    addingVersion,
    versionUploading,
    versionImage,
    versionPrompt,
    versionModel,
    versionAssetShow,
    uploadVersionFile,
    openVersionAssets,
    onVersionAssets,
    submitVersion,
    addingRelation,
    relationIdDraft,
    relationBusy,
    submitRelation,
    removeRelation,
    cf,
    fixMode,
    canColorFix,
    showFixed,
    mediaSrc,
    onMediaError,
    fixSavedAsVersion,
    savingColorFix,
    saveFixVersion,
    downloadCurrent,
    downloadMenu,
    onDownloadMenu,
    moreMenu,
    onMoreMenu,
    copyPrompt,
    openingCanvas,
    openInCanvas,
  }
}

export type AssetDetailCtx = ReturnType<typeof createAssetDetail>
const KEY: InjectionKey<AssetDetailCtx> = Symbol('asset-detail')

export function provideAssetDetail(ctx: AssetDetailCtx) {
  provide(KEY, ctx)
}
export function useAssetDetail(): AssetDetailCtx {
  const ctx = inject(KEY)
  if (!ctx) throw new Error('useAssetDetail() 须在 DetailModal 内使用')
  return ctx
}
