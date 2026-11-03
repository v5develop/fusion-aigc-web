<script setup lang="ts">
/**
 * 资产详情弹层（NModal 960）：
 * 预览（image 大图 / video 播放器）、标题行内编辑、分类 / 授权下拉、收藏开关、
 * 标签编辑（已有标签点选 + 输入新建，整组替换 PATCH）、授权 / 元数据草稿编辑（脏字段才 PATCH）、溯源折叠、
 * 版本列表（设为当前版本 / 回到原图 / 分页加载更多）、相关资产与生成结果（分页加载更多）。
 *
 * <p>modelValue 为资产 id，null = 关闭；点相关资产 / 生成结果的缩略图会换 id 重载。
 * 详情接口一次带回三组子列表的当前页，翻页各自 page+1 重拉后追加。
 */
import { computed, ref, watch } from 'vue'
import { NCollapse, NCollapseItem, NInput, NModal, NSelect, useMessage } from 'naive-ui'
import MediaFallback from '@/components/MediaFallback/index.vue'
import {
  assetLibAddRelation,
  assetLibAddVersion,
  assetLibDetail,
  assetLibRemoveRelation,
  assetLibTags,
  assetLibUpdate,
} from '@/api/assetLibrary.ts'
import type { IAssetLibAsset, IAssetLibDetail, IAssetLibTag, IAssetLibUpdateReq } from '@/api/assetLibrary.ts'
import { formatTime } from '@/views/local-life/constants.ts'
import { goUploadImage } from '@/api/goUpload.ts'
import AssetPickerModal from '@/views/studio/components/AssetPickerModal/index.vue'
import { useFileDropPaste } from '@/composables/useFileDropPaste'

const assetId = defineModel<number | null>({ required: true })

const emit = defineEmits<{ changed: [] }>()

const message = useMessage()

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
    const res = await assetLibDetail(id, { page_size: PAGE_SIZE })
    detail.value = res.data ?? null
    versionPage.value = 1
    relatedPage.value = 1
    resultPage.value = 1
    versionThumbFailed.value = {}
    miniThumbFailed.value = {}
    previewFailed.value = false
    editingTitle.value = false
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
    { label: '运行 ID', value: p.run_id || '' },
    { label: '模型', value: p.model || '' },
    { label: '工作流', value: p.workflow_id || '' },
    { label: '节点', value: p.node_id || '' },
    { label: '操作人', value: p.operator || '' },
    { label: '时间', value: p.created_at ? formatTime(p.created_at) : '' },
    { label: '参数', value: p.params || '' },
  ]
  return rows.filter((r) => r.value)
})

// ---------------- 版本 ----------------

const versions = computed(() => detail.value?.versions ?? { items: [], total: 0 })
const hasMoreVersions = computed(() => versions.value.items.length < versions.value.total)
const loadingVersions = ref(false)

async function loadMoreVersions() {
  const id = assetId.value
  const d = detail.value
  if (!id || !d || loadingVersions.value || !hasMoreVersions.value) return
  loadingVersions.value = true
  try {
    const next = versionPage.value + 1
    const res = await assetLibDetail(id, { version_page: next, page_size: PAGE_SIZE })
    d.versions.items.push(...(res.data?.versions?.items ?? []))
    versionPage.value = next
  } finally {
    loadingVersions.value = false
  }
}

// ---------------- 相关资产 / 生成结果 ----------------

const related = computed(() => detail.value?.related ?? { items: [], total: 0 })
const generatedResults = computed(() => detail.value?.generated_results ?? { items: [], total: 0 })
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
    const res = await assetLibDetail(id, { related_page: next, page_size: PAGE_SIZE })
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
    const res = await assetLibDetail(id, { result_page: next, page_size: PAGE_SIZE })
    d.generated_results.items.push(...(res.data?.generated_results?.items ?? []))
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
  { label: 'GPT Image 2', value: 'GPT' },
  { label: 'Nano Banana Pro', value: 'Banana' },
  { label: 'Seedream 5 Pro', value: 'Seedream' },
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
      image_url: versionImage.value[0] ?? '',
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
  <n-modal v-model:show="show" preset="card" title="资产详情" style="width: 960px">
    <div v-loading="loading" class="min-h-320px max-h-74vh overflow-auto">
      <template v-if="asset">
        <div class="flex gap-16px">
          <div
            class="w-400px shrink-0 self-start h-420px flex items-center justify-center bg-sunken rounded-10px overflow-hidden"
          >
            <video
              v-if="asset.media === 'video' && asset.video_url && !previewFailed"
              :src="asset.video_url"
              :poster="asset.image || undefined"
              controls
              class="max-w-full max-h-full object-contain"
              @error="previewFailed = true"
            />
            <img
              v-else-if="asset.image && !previewFailed"
              class="max-w-full max-h-full object-contain"
              :src="asset.image"
              alt=""
              @error="previewFailed = true"
            />
            <MediaFallback v-else type="image" reason="loadFailed" />
          </div>

          <div class="flex-1 min-w-0">
            <div class="mb-12px">
              <div class="ll-label">标题</div>
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
              <div v-else class="flex items-center gap-10px cursor-pointer" @click="startEditTitle">
                <span
                  class="text-16px font-600 text-ink whitespace-nowrap overflow-hidden text-ellipsis"
                  :title="asset.title"
                  >{{ asset.title || '未命名资产' }}</span
                >
                <span class="ll-link">编辑</span>
              </div>
            </div>

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
              <div class="flex items-center gap-8px min-w-0">
                <span class="shrink-0 w-28px text-12px text-placeholder">收藏</span>
                <span
                  class="inline-flex items-center text-13px leading-20px cursor-pointer"
                  :class="asset.favorite ? 'text-violet' : 'text-ink-2'"
                  @click="patchAsset({ favorite: !asset.favorite })"
                >
                  {{ asset.favorite ? '★ 已收藏' : '☆ 收藏' }}
                </span>
              </div>
            </div>

            <div class="mb-12px">
              <div class="ll-label">标签（{{ currentTags.length }}/10）</div>
              <div class="flex flex-wrap items-center gap-6px">
                <span
                  v-for="t in currentTags"
                  :key="t"
                  class="inline-flex items-center px-8px py-3px rounded-4px text-12px bg-violet-soft-2 text-violet-ink border border-solid border-violet-line cursor-pointer"
                  title="点击移除"
                  @click="removeTag(t)"
                >
                  {{ t }} ×
                </span>
                <n-input
                  v-model:value="newTagName"
                  size="small"
                  maxlength="20"
                  placeholder="输入后回车，没有的会自动建"
                  class="flex-1 min-w-180px"
                  @keydown.enter="addTag"
                />
              </div>
              <div v-if="dictOptions.length" class="flex flex-wrap items-center gap-6px mt-8px">
                <span class="text-12px text-placeholder">我的标签：</span>
                <span v-for="t in dictOptions" :key="t.id" class="ll-tag" @click="toggleDictTag(t.name)">{{
                  t.name
                }}</span>
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
                  >{{ formatTime(asset.created_at) }}</span
                >
                <span
                  v-if="asset.width"
                  class="text-12px text-ink max-w-full overflow-hidden text-ellipsis whitespace-nowrap"
                  ><i class="not-italic text-placeholder mr-6px after:content-['：']">尺寸</i>{{ asset.width }}×{{
                    asset.height
                  }}</span
                >
                <span v-if="asset.prompt" class="text-12px text-ink max-w-full line-clamp-2" :title="asset.prompt"
                  ><i class="not-italic text-placeholder mr-6px after:content-['：']">提示词</i>{{ asset.prompt }}</span
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
          </div>
        </div>

        <div class="border-t border-solid border-sunken pt-12px mt-12px">
          <div class="flex items-center gap-10px min-h-20px mb-10px">
            <span class="ll-section-title !mb-0">版本（{{ versions.total }}）</span>
            <span v-if="!asset.current_version_id" class="ll-chip ll-chip-success">当前：原图</span>
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
              :class="[versionUploading ? 'opacity-60 cursor-wait' : 'cursor-pointer', versionDragging && 'sx-drop']"
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
            <n-input v-model:value="versionPrompt" type="textarea" :rows="2" placeholder="版本说明 / 提示词（选填）" />
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
            :class="v.id === asset.current_version_id ? 'border-violet-line bg-violet-soft' : 'border-line'"
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
                <span class="text-13px font-600 text-ink">V{{ v.version_no }}</span>
                <span v-if="v.id === asset.current_version_id" class="ll-chip ll-chip-success">当前版本</span>
                <span class="text-12px text-placeholder"
                  >{{ v.model || '未知模型' }} · {{ formatTime(v.created_at) }}</span
                >
              </div>
              <div class="text-12px text-ink-2 mt-2px line-clamp-2" :title="v.prompt">
                {{ v.prompt || '（无提示词）' }}
              </div>
            </div>
            <n-button
              v-if="v.id !== asset.current_version_id"
              size="tiny"
              :disabled="saving"
              @click="patchAsset({ current_version_id: v.id })"
            >
              设为当前版本
            </n-button>
          </div>
          <div v-if="asset.current_version_id || hasMoreVersions" class="flex gap-16px mt-8px">
            <span v-if="asset.current_version_id" class="ll-link" @click="patchAsset({ current_version_id: 0 })"
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
            <n-button size="small" type="primary" :loading="relationBusy" @click="submitRelation">建立关联</n-button>
          </div>
          <div v-if="!related.items.length" class="ll-empty">暂无相关资产</div>
          <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-10px mt-10px">
            <div v-for="r in related.items" :key="r.id" class="relative cursor-pointer group" @click="assetId = r.id">
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
              <span
                class="hidden group-hover:block absolute top-4px right-4px w-18px h-18px rounded-full bg-[rgba(0,0,0,0.5)] text-white text-12px leading-18px text-center cursor-pointer hover:bg-danger"
                title="解除关联"
                @click.stop="removeRelation(r.id)"
                >×</span
              >
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
      </template>
    </div>
  </n-modal>
</template>
