<script setup lang="ts">
/**
 * AI图文笔记：构思（异步）→ 规划确认（可改标题/正文/话题，套图数量只能改少）→ 出图。
 * 刷新页面后从列表恢复：构思中/生成中的自动续轮询，待确认的点击进规划页。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useMessage } from 'naive-ui'
import Workbench from '../components/Workbench/index.vue'
import ShopProfileSelect from '../components/ShopProfileSelect/index.vue'
import CopywritingPicker from '../components/CopywritingPicker/index.vue'
import FormCard from '../components/FormCard/index.vue'
import Field from '../components/Field/index.vue'
import ChipGroup from '../components/ChipGroup/index.vue'
import PromptBox from '../components/PromptBox/index.vue'
import PromptActions from '../components/PromptActions/index.vue'
import SettingsBar from '../components/SettingsBar/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import IconButton from '@/components/IconButton/index.vue'
import {
  llCopywritingAiWrite,
  llDigitalHumanList,
  llIdempotencyHeaders,
  llNoteDetail,
  llNoteGenerate,
  llNoteList,
  llNoteOptions,
  llNotePlan,
  llNoteRemove,
  llNoteReplan,
  llNoteUpdate,
} from '@/api/localLife.ts'
import type { ILNote, ILNoteOptions } from '@/api/localLifeTypes.ts'
import HistoryList from '../components/HistoryList/index.vue'
import HistoryCard from '../components/HistoryList/HistoryCard.vue'
import { useHistorySelection } from '../components/HistoryList/selection.ts'
import ResultPreview from '../components/ResultPreview/index.vue'
import { useLLQuote } from '../components/Workbench/useLLQuote.ts'
import { ColorFixItem, ColorFixPill, ColorFixStage, provideColorFixHost } from '@/components/ColorFix'
import { useAgreement, useLLList, usePollingWhile } from '../hooks.ts'
import { NOTE_STATUS_MAP, formatTime, isNoteRunning } from '../constants.ts'

defineOptions({ name: 'local-life-note' })

const message = useMessage()
const { ensureAgreed } = useAgreement()

// ---------------- 构思表单 ----------------

const noteOptions = ref<ILNoteOptions | null>(null)
const form = reactive({
  note_type: '',
  topic: '',
  materials: [] as string[],
  digital_human_id: undefined as number | undefined,
  shop_profile_id: undefined as number | undefined,
  image_count: undefined as number | undefined,
  copywriting_id: undefined as number | undefined,
})

const typeOptions = computed(() => (noteOptions.value?.types ?? []).map((t) => ({ label: t.label, value: t.code })))
const activeType = computed(() => noteOptions.value?.types?.find((t) => t.code === form.note_type))
const imageCountOptions = computed(() => {
  const max = noteOptions.value?.default_images ?? 4
  return Array.from({ length: Math.max(1, max) }, (_, i) => ({ label: `${i + 1}张`, value: i + 1 }))
})
const showCopyPicker = ref(false)

onMounted(async () => {
  const res = await llNoteOptions()
  const data = res.data ?? null
  noteOptions.value = data
  if (data?.types?.length) form.note_type = data.types[0]?.code ?? ''
  if (data?.default_images) form.image_count = data.default_images
})

const aiWriting = ref(false)
async function aiWriteTopic() {
  aiWriting.value = true
  try {
    const res = await llCopywritingAiWrite({
      scene: 'note_topic',
      note_type: form.note_type || undefined,
      context: form.topic.trim() || undefined,
    })
    form.topic = res.data?.text ?? ''
  } finally {
    aiWriting.value = false
  }
}

function pickCopy(c: { id: number; body: string }) {
  form.topic = c.body.slice(0, noteOptions.value?.max_topic_len ?? 200)
  form.copywriting_id = c.id
  showCopyPicker.value = false
}

// ---------------- 中栏历史列表 ----------------

const listCtl = useLLList<ILNote>((params) => llNoteList(params), isNoteRunning)

onMounted(() => void listCtl.reload())

// 三栏：中栏历史选中哪条，右栏就展示哪条的详情（null = 跟随最新）
const { current, select, selectId, followLatest } = useHistorySelection(listCtl.items)
const runningCount = computed(() => listCtl.items.value.filter(isNoteRunning).length)
// 有待确认的笔记时在历史列头下给个明显的提醒（与改版前列表标题旁的「N 条待确认」同口径：只数已加载的）
const pendingCount = computed(() => listCtl.items.value.filter((n) => n.status === 1).length)

async function removeItem(item: ILNote) {
  await llNoteRemove(item.id)
  message.success('已删除')
  if (detailId === item.id) {
    openSeq++
    detailId = null
    stopNotePoll()
    activeNote.value = null
    editingResult.value = false
  }
  // 先在本地摘掉这条，选中项立即回落到最新一条（不等列表刷新）；随后静默刷新对齐服务端
  listCtl.items.value = listCtl.items.value.filter((n) => n.id !== item.id)
  listCtl.total.value = Math.max(0, listCtl.total.value - 1)
  void listCtl.refresh()
}

// ---------------- 详情 / 规划 / 结果 ----------------

const activeNote = ref<ILNote | null>(null)
const detailLoading = ref(false)
/** 0 构思(0/2) · 1 待确认(1) · 2 出图(3/4/5) */
const stepIndex = computed(() => {
  const st = activeNote.value?.status
  if (st === 1) return 1
  return st === 3 || st === 4 || st === 5 ? 2 : 0
})

// 编辑态（规划与成果共用一套字段）
const editForm = reactive({ title: '', content: '', tags: '' })
function fillEditForm(note: ILNote) {
  editForm.title = note.title
  editForm.content = note.content
  editForm.tags = (note.tags ?? []).join(' ')
}

// 生成套图数量（规划页）：只能改少
const genCount = ref<number | null>(null)
const genCountOptions = computed(() => {
  const planned = activeNote.value?.image_count ?? 1
  return Array.from({ length: planned }, (_, i) => ({ label: `${i + 1}张`, value: i + 1 }))
})

const { start: startNotePoll, stop: stopNotePoll } = usePollingWhile(
  () => llNoteDetail(detailId!),
  (data) => {
    if (!data) return true
    // 兜底：回来的不是当前展示的这条（已切走）就收掉这条链
    if (data.id !== detailId) return false
    activeNote.value = data
    if (data.status === 0 || data.status === 3) return true
    void listCtl.refresh()
    if (data.status === 1) {
      fillEditForm(data)
      genCount.value = data.image_count
      message.success('构思完成，请确认内容')
    } else if (data.status === 4) {
      message.success('笔记已生成')
    }
    return false
  },
  3000,
)

/** 右栏正在展示 / 正在载入的笔记 id（比 activeNote 早一步更新，用来判断「是不是同一条」与丢弃过期响应） */
let detailId: number | null = null
let openSeq = 0
/** 详情载入失败的 id：右栏显示「重试」而不是一直转圈 */
const detailErrorId = ref<number | null>(null)

async function openDetail(id: number, opts: { silent?: boolean } = {}) {
  const seq = ++openSeq
  // 切到别的笔记：先停掉上一条的轮询（在途结果也作废），免得它把详情写回当前
  if (detailId !== id) {
    stopNotePoll()
    editingResult.value = false
    activeNote.value = null
  }
  detailId = id
  detailErrorId.value = null
  detailLoading.value = !opts.silent
  try {
    const res = await llNoteDetail(id)
    if (seq !== openSeq) return // 期间又切了别的，丢弃过期结果
    activeNote.value = res.data
    if (res.data?.status === 1) {
      fillEditForm(res.data)
      genCount.value = res.data.image_count
    } else {
      genCount.value = null // 别带着上一条笔记的张数去重试生成 / 报价：不传即按这条记录的张数
    }
    if (res.data && isNoteRunning(res.data)) startNotePoll()
  } catch {
    // 失败提示由请求层弹出；这里只把右栏切到可重试的状态
    if (seq === openSeq && !activeNote.value) detailErrorId.value = id
  } finally {
    if (seq === openSeq) detailLoading.value = false
  }
}

// 历史列选中项变了（点卡 / 跟随最新 / 删除后回落）→ 载入它的详情；没有记录则清空右栏。
// 只盯 id 这个原始值：列表每轮轮询都会换一批新对象，盯对象会每 3 秒多打一次详情
watch(
  () => current.value?.id,
  (id) => {
    if (id == null) {
      openSeq++
      detailId = null
      stopNotePoll()
      activeNote.value = null
      detailErrorId.value = null
    } else if (detailId !== id) {
      void openDetail(id)
    }
  },
  { immediate: true },
)

// 选中项状态在列表里变了、而右栏这条没有在轮询（例如在别的窗口点了重新构思）→ 静默重载一次；
// 在轮询的由详情轮询自己跟进，不重复请求
watch(
  () => current.value?.status,
  (status) => {
    const note = activeNote.value
    if (status == null || !note || current.value?.id !== note.id) return
    if (status !== note.status && !isNoteRunning(note)) void openDetail(note.id, { silent: true })
  },
)

/** 点历史卡：选中；已经在右栏展示的这条不重载（规划页 / 编辑态里改了一半的内容不能被冲掉），只有上次载入失败才重试 */
function onSelectItem(item: ILNote) {
  select(item)
  if (detailId !== item.id || detailErrorId.value === item.id) void openDetail(item.id)
}

// ---------------- 动作 ----------------

// 提交前报价：构思不收费，确认配图时按张冻结——按钮上写「配图消耗」，数字与配图冻结同一套算价
const { estimate } = useLLQuote(
  () => ({ tool: 'imageTextNote', image_count: form.image_count }),
  () => '配图消耗',
)

// 配图阶段（方案已出：待确认 / 生成失败可重试）按这条笔记报价：带 id，后端按记录张数（genCount 覆盖）算，
// 并与出图同口径校验不超过方案张数——参数与 confirmGenerate 发的一致，报价 = 冻结
const { quote: planQuote, estimate: planEstimate } = useLLQuote(
  () => {
    const note = activeNote.value
    if (!note || (note.status !== 1 && note.status !== 5)) return null
    return { tool: 'imageTextNote', id: note.id, image_count: genCount.value ?? undefined }
  },
  () => '配图消耗',
)
/** 确认生成 / 重试生成按钮旁的「配图消耗 N 点」；报不出价时显示后端给的原因 */
const planCostText = computed(() => {
  const e = planEstimate.value
  if (!e) return ''
  const q = planQuote.value
  if (q && !q.available && q.reason) return q.reason
  return `${e.label ?? '消耗'} ${e.points ?? '—'} ${e.suffix ?? '点'}`
})

const submitting = ref(false)

async function submit() {
  if (submitting.value) return
  if (!form.note_type) return message.warning('请选择笔记类型')
  if (!form.topic.trim()) return message.warning('请先填写笔记主题')
  if (form.materials.length && form.materials.length > (noteOptions.value?.max_materials ?? 3)) {
    return message.warning(`素材最多 ${noteOptions.value?.max_materials} 张`)
  }

  if (!(await ensureAgreed())) return

  submitting.value = true
  try {
    const res = await llNotePlan(
      {
        note_type: form.note_type,
        topic: form.topic.trim(),
        material_urls: form.materials.length ? form.materials : undefined,
        digital_human_id: form.digital_human_id,
        shop_profile_id: form.shop_profile_id,
        image_count: form.image_count,
        copywriting_id: form.copywriting_id,
      },
      llIdempotencyHeaders(),
    )
    message.success('开始构思')
    form.topic = ''
    form.materials = []
    form.copywriting_id = undefined
    // 明确选中接口返回的新笔记（不依赖「新记录排第一」）；选中项变化由上面的 watch 载入详情，
    // 新记录万一还没进列表（刷新失败），直接载入它的详情，等下一轮列表对上
    await listCtl.refresh()
    if (res.data?.id) {
      selectId(res.data.id)
      if (detailId !== res.data.id) void openDetail(res.data.id, { silent: true })
    } else {
      followLatest()
    }
  } finally {
    submitting.value = false
  }
}

const replanning = ref(false)
async function replan() {
  if (!activeNote.value || replanning.value) return
  const id = activeNote.value.id
  replanning.value = true
  try {
    await llNoteReplan(id, genCount.value ?? undefined, llIdempotencyHeaders())
    message.success('重新构思中')
    // 等待期间切到了别的笔记就不把右栏拉回来，列表刷新会反映这条的新状态
    if (detailId === id) await openDetail(id, { silent: true })
    void listCtl.refresh()
  } finally {
    replanning.value = false
  }
}

const generating = ref(false)
async function confirmGenerate() {
  if (!activeNote.value || generating.value) return
  if (!editForm.title.trim() && !editForm.content.trim()) return message.warning('标题和正文至少填一项')

  if (!(await ensureAgreed())) return

  const id = activeNote.value.id
  generating.value = true
  try {
    await llNoteGenerate(
      id,
      {
        title: editForm.title.trim() || undefined,
        content: editForm.content.trim() || undefined,
        tags: editForm.tags.trim() ? editForm.tags.trim().split(/\s+/) : undefined,
        image_count: genCount.value ?? undefined,
      },
      llIdempotencyHeaders(),
    )
    message.success('开始生成图片')
    if (detailId === id) await openDetail(id, { silent: true })
    void listCtl.refresh()
  } finally {
    generating.value = false
  }
}

// 成品后的文字编辑
const editingResult = ref(false)

/** 进入「编辑文案」：打开编辑态并把当前笔记回填到表单 */
function beginEditResult() {
  editingResult.value = true
  if (activeNote.value) fillEditForm(activeNote.value)
}
const savingResult = ref(false)
async function saveResult() {
  if (!activeNote.value || savingResult.value) return
  const id = activeNote.value.id
  savingResult.value = true
  try {
    const res = await llNoteUpdate(id, {
      title: editForm.title.trim(),
      content: editForm.content.trim(),
      tags: editForm.tags.trim() ? editForm.tags.trim().split(/\s+/) : [],
      image_urls: activeNote.value.image_urls ?? [],
    })
    // 保存期间切到了别的笔记：不把这条写回右栏
    if (detailId === id) {
      activeNote.value = res.data
      editingResult.value = false
    }
    message.success('已保存')
    void listCtl.refresh()
  } finally {
    savingResult.value = false
  }
}

// 我的数字人（选填关联）：取已完成的
const myDhOptions = ref<{ label: string; value: number }[]>([])
onMounted(async () => {
  const res = await llDigitalHumanList({ page_size: 50 })
  myDhOptions.value = (res.data?.list ?? [])
    .filter((d) => d.status === 2)
    .map((d) => ({ label: d.name || `数字人#${d.id}`, value: d.id }))
})

// 成品图预览（校色过的图给校色后的预览）
const imagePreviewShow = ref(false)
const previewUrl = ref('')
const previewStyle = ref<Record<string, string> | undefined>(undefined)
function openImage(url: string, style?: Record<string, string>) {
  previewUrl.value = url
  previewStyle.value = style
  imagePreviewShow.value = true
}

// 配图校色（components/ColorFix 套件）：每张配图左上「校色调整」，点开后配图上方出校色舞台；
// 键 ll:note-<笔记 id>:<序号>（笔记与海报 / 长图不同表，id 会重号）。笔记不在任务中心，只下载不存资产
const colorFixHost = provideColorFixHost()
const noteCfKey = (i: number) => (activeNote.value ? `ll:note-${activeNote.value.id}:${i}` : '')
const noteFileName = (i: number) => `${(activeNote.value?.title || '图文笔记').slice(0, 24)}_${i + 1}`
watch(
  () => activeNote.value?.id,
  () => colorFixHost.close(),
)
</script>

<template>
  <Workbench title="图文笔记" :submit="submit" :loading="submitting" submit-text="开始构思" submit-hint="先出文案；确认后再按文案配图" :estimate="estimate" :history-count="listCtl.total.value">
    <template #default>
      <FormCard title="笔记类型">
        <ChipGroup
          v-model="form.note_type"
          :options="typeOptions"
          label="笔记类型"
          @update:model-value="form.materials = []"
        />
      </FormCard>

      <FormCard title="主题" required>
        <PromptBox
          v-model="form.topic"
          label="主题"
          size="lg"
          :max-length="noteOptions?.max_topic_len || 500"
          placeholder="这条笔记想写什么：地点、品类、人均、体验感受"
        >
          <template #actions>
            <PromptActions :loading="aiWriting" @ai="aiWriteTopic" @pick="showCopyPicker = true" />
          </template>
        </PromptBox>
      </FormCard>

      <FormCard
        :title="activeType?.material_label ?? '素材图'"
        :hint="`选填 · 最多 ${noteOptions?.max_materials ?? 3} 张`"
      >
        <ImageUpload
          fromAsset
          v-model:imgList="form.materials"
          btnName="上传素材"
          :topRightTips="false"
          multiple
          :limitNumber="noteOptions?.max_materials ?? 3"
        />
        <p v-if="activeType?.material_hint" class="m-0 -mt-4px text-11px leading-16px text-muted">
          {{ activeType.material_hint }}
        </p>
      </FormCard>

      <FormCard title="参数">
        <Field label="出镜数字人">
          <n-select
            v-model:value="form.digital_human_id"
            size="small"
            clearable
            :options="myDhOptions"
            placeholder="选填，用已生成的数字人出镜"
          >
            <template #empty>
              <span class="flex items-center gap-8px py-4px text-12px leading-18px text-muted">
                还没有数字人，可先去「数字人」创建一个
                <RouterLink to="/local-life/digital-human" class="ll-link no-underline">去创建</RouterLink>
              </span>
            </template>
          </n-select>
        </Field>
        <Field label="关联店铺档案">
          <ShopProfileSelect v-model:value="form.shop_profile_id" />
        </Field>
      </FormCard>
    </template>

    <template #settings>
      <SettingsBar
        v-model:data="form"
        :fields="[{ field: 'image_count', label: '套图数量', options: imageCountOptions }]"
      />
    </template>

    <template #history>
      <HistoryList
        :count="listCtl.total.value"
        :running="runningCount"
        :loading="listCtl.loading.value"
        :has-more="listCtl.hasMore.value"
        :loading-more="listCtl.loadingMore.value"
        @load-more="listCtl.loadMore()"
      >
        <template v-if="pendingCount" #extra>
          <span class="sx-chip flex-shrink-0 ll-chip-warning" role="status">{{ pendingCount }} 条待确认</span>
        </template>
        <HistoryCard
          v-for="item in listCtl.items.value"
          :key="item.id"
          :title="item.title || item.topic"
          :summary="item.title ? item.content || item.topic : ''"
          :status="NOTE_STATUS_MAP[item.status]?.type ?? 'running'"
          :status-label="NOTE_STATUS_MAP[item.status]?.label ?? ''"
          :time="item.create_time"
          :thumb="item.image_urls?.[0]"
          :count="item.image_urls?.length ?? 0"
          placeholder="笔记"
          :fail-reason="item.status === 2 || item.status === 5 ? item.fail_reason || (item.status === 2 ? '构思失败' : '生成失败') : ''"
          :eta-sec="90"
          :selected="current?.id === item.id"
          @select="onSelectItem(item)"
        >
          <template #actions>
            <n-popconfirm @positive-click="removeItem(item)">
              <template #trigger>
                <IconButton label="删除笔记" size="sm" variant="danger">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5M10.5 11v5M13.5 11v5" /></svg>
                </IconButton>
              </template>
              确定删除这条笔记？
            </n-popconfirm>
          </template>
        </HistoryCard>
      </HistoryList>
    </template>

    <!-- 预览区：选中笔记的构思 / 规划确认 / 成果 -->
    <template #preview>
      <div v-if="activeNote" v-loading="detailLoading" class="flex-1 min-h-0 overflow-auto p-16px">
        <div class="flex items-center gap-10px">
          <span class="sx-chip flex-shrink-0" :class="`ll-chip-${NOTE_STATUS_MAP[activeNote.status]?.type}`">{{
            NOTE_STATUS_MAP[activeNote.status]?.label
          }}</span>
          <h2 class="m-0 flex-1 truncate text-16px font-600 leading-22px text-ink">
            {{ activeNote.title || activeNote.topic }}
          </h2>
          <!-- 改版前详情头的删除（历史卡上也有一个）：同一个接口、同样的二次确认 -->
          <n-popconfirm @positive-click="removeItem(activeNote!)">
            <template #trigger>
              <IconButton label="删除笔记" variant="danger" class="flex-none">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5M10.5 11v5M13.5 11v5" /></svg>
              </IconButton>
            </template>
            确定删除这条笔记？
          </n-popconfirm>
        </div>
        <div class="mt-8px mb-14px text-11px leading-16px text-muted tabular-nums">
          {{ activeNote.note_type_label }} · 套图 {{ activeNote.image_count }}张 ·
          {{ formatTime(activeNote.create_time) }}
        </div>

        <!-- 两步进度：构思 → 确认 → 出图 -->
        <ol class="m-0 mb-14px p-0 list-none flex items-center gap-8px text-12px" aria-label="笔记进度">
          <li
            v-for="(step, i) in ['构思文案', '确认内容', '生成配图']"
            :key="step"
            class="flex items-center gap-6px"
            :class="i <= stepIndex ? 'text-violet-ink font-600' : 'text-muted'"
            :aria-current="i === stepIndex ? 'step' : undefined"
          >
            <span
              class="w-18px h-18px grid place-items-center rounded-full text-11px border border-solid"
              :class="i <= stepIndex ? 'border-violet-line bg-violet-soft' : 'border-line'"
              >{{ i + 1 }}</span
            >{{ step }}
            <span v-if="i < 2" class="w-16px h-1px bg-line" aria-hidden="true" />
          </li>
        </ol>

        <!-- 构思中 / 生成中 -->
        <div
          v-if="activeNote.status === 0 || activeNote.status === 3"
          class="bg-white rounded-lg border border-solid border-line shadow-card-v3 flex items-center justify-center gap-10px p-40px text-13px text-ink-2"
        >
          <n-spin size="small" />
          <span>{{ activeNote.status === 0 ? 'AI 构思中，标题正文马上就来…' : '图片生成中，请稍候…' }}</span>
        </div>

        <!-- 构思失败 / 生成失败 -->
        <div
          v-else-if="activeNote.status === 2 || activeNote.status === 5"
          class="bg-white rounded-lg border border-solid border-line shadow-card-v3 flex flex-col items-center justify-center gap-12px p-40px text-13px text-ink-2"
        >
          <p class="m-0 text-danger">
            {{ activeNote.fail_reason || (activeNote.status === 2 ? '构思失败' : '生成失败') }}
          </p>
          <n-button
            size="medium"
            type="primary"
            :loading="replanning || generating"
            @click="activeNote.status === 2 ? replan() : confirmGenerate()"
          >
            {{ activeNote.status === 2 ? '重新构思' : '重试生成' }}
          </n-button>
          <span v-if="activeNote.status === 5 && planCostText" class="text-12px text-muted">{{ planCostText }}</span>
        </div>

        <!-- 待确认：规划页 -->
        <template v-else-if="activeNote.status === 1">
          <div
            class="mb-14px rounded-8px border border-solid border-warning-line bg-warning-soft px-12px py-8px text-12px leading-18px text-alert-warning"
          >
            以下是 AI 构思的内容，可以修改后确认生成；也可以换个思路重新构思。
          </div>
          <div
            class="flex flex-col gap-12px p-16px rounded-lg border border-solid border-line bg-white shadow-card-v3"
          >
            <Field label="标题">
              <n-input
                v-model:value="editForm.title"
                size="small"
                maxlength="30"
                show-count
                placeholder="笔记标题"
              />
            </Field>
            <Field label="正文">
              <n-input
                v-model:value="editForm.content"
                type="textarea"
                :rows="8"
                show-count
                placeholder="笔记正文，话题用 # 或空格分隔写在下面"
              />
            </Field>
            <Field label="话题">
              <n-input
                v-model:value="editForm.tags"
                size="small"
                placeholder="用空格分隔，如：探店 咖啡 周末去哪儿"
              />
            </Field>
            <Field :label="`套图数量（最多 ${activeNote.image_count} 张，只能改少）`">
              <ChipGroup v-model="genCount" :options="genCountOptions" label="套图数量" />
            </Field>
            <Field v-if="activeNote.material_urls?.length" label="参考素材">
              <div class="flex flex-wrap gap-8px">
                <img
                  v-for="url in activeNote.material_urls"
                  :key="url"
                  :src="url"
                  alt=""
                  class="w-64px h-64px rounded-md object-cover border border-solid border-line-soft"
                />
              </div>
            </Field>
          </div>
          <div class="flex gap-8px mt-14px">
            <n-button size="medium" :loading="replanning" @click="replan">重新构思</n-button>
            <n-button size="medium" type="primary" :loading="generating" @click="confirmGenerate">确认生成</n-button>
            <span v-if="planCostText" class="self-center text-12px text-muted">{{ planCostText }}</span>
          </div>
        </template>

        <!-- 已完成 -->
        <template v-else-if="activeNote.status === 4">
          <div class="bg-white rounded-lg border border-solid border-line shadow-card-v3 p-14px">
            <template v-if="!editingResult">
              <div class="mb-8px text-16px font-600 leading-22px text-ink">{{ activeNote.title }}</div>
              <div class="mb-10px whitespace-pre-wrap text-13px leading-22px text-ink">
                {{ activeNote.content }}
              </div>
              <div v-if="activeNote.tags?.length" class="flex flex-wrap gap-x-8px gap-y-4px mb-12px">
                <span v-for="tag in activeNote.tags" :key="tag" class="text-12px text-violet-ink">#{{ tag }}</span>
              </div>
            </template>
            <div v-else class="flex flex-col gap-12px">
              <Field label="标题">
                <n-input
                  v-model:value="editForm.title"
                  size="small"
                  maxlength="30"
                  show-count
                  placeholder="笔记标题"
                />
              </Field>
              <Field label="正文">
                <n-input v-model:value="editForm.content" type="textarea" :rows="8" placeholder="笔记正文" />
              </Field>
              <Field label="话题">
                <n-input v-model:value="editForm.tags" size="small" placeholder="空格分隔" />
              </Field>
            </div>

            <!-- 校色舞台：点某张配图的「校色调整」后出现 -->
            <ColorFixStage
              v-if="colorFixHost.focused.value"
              class="mt-14px"
              :host="colorFixHost"
              stage-class="h-[min(56vh,560px)] min-h-280px"
            />
            <div class="grid grid-cols-3 gap-10px mt-14px">
              <!-- 校色来源 = image_urls[i]：与「下载配图」同一个地址，后端已按观看者档位下发（免费档是带水印的交付图） -->
              <ColorFixItem
                v-for="(url, i) in activeNote.image_urls"
                :key="url"
                v-slot="fx"
                :cf-key="noteCfKey(i)"
                :src="url"
                :index="i"
                :name="noteFileName(i)"
              >
                <div
                  class="group relative overflow-hidden rounded-8px cursor-pointer"
                  @click="openImage(fx.displaySrc, fx.previewStyle)"
                >
                  <img
                    :src="fx.displaySrc"
                    :crossorigin="fx.cors"
                    :style="fx.previewStyle"
                    alt=""
                    class="block w-full aspect-[3/4] object-cover"
                    @error="fx.onImgError()"
                  />
                  <IconButton
                    :label="fx.active ? '下载配图（校色后）' : '下载配图'"
                    variant="overlay"
                    class="!absolute bottom-6px right-6px"
                    @click.stop="fx.download()"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14" /></svg>
                  </IconButton>
                  <span
                    class="absolute top-6px left-6px w-20px h-20px flex items-center justify-center rounded-full bg-black/50 text-11px text-white"
                    >{{ i + 1 }}</span
                  >
                  <!-- 校色入口：悬停出现、触屏 / 键盘聚焦常显；校色过的常显「已校色」 -->
                  <ColorFixPill
                    class="absolute top-6px right-6px z-1"
                    :class="fx.touched || fx.focused ? '' : 'sx-reveal'"
                    :label="fx.touched ? '已校色' : '校色调整'"
                    :pressed="fx.focused"
                    @click.stop="fx.openFix()"
                  />
                  <span
                    v-if="fx.focused"
                    class="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_2px_#875f9a]"
                    aria-hidden="true"
                  />
                </div>
              </ColorFixItem>
            </div>
          </div>
          <div class="flex gap-8px mt-14px">
            <template v-if="!editingResult">
              <n-button size="medium" @click="beginEditResult">编辑文案</n-button>
              <n-button size="medium" :loading="replanning" @click="replan">重新生成</n-button>
            </template>
            <template v-else>
              <n-button size="medium" type="primary" :loading="savingResult" @click="saveResult">保存</n-button>
              <n-button size="medium" @click="editingResult = false">取消</n-button>
            </template>
          </div>
        </template>
      </div>
      <div v-else-if="current && detailErrorId === current.id" class="flex-1 grid place-items-center p-16px">
        <div class="flex flex-col items-center gap-10px text-13px leading-20px text-ink-2" role="status">
          笔记详情没有加载出来
          <n-button size="small" @click="openDetail(current.id)">重新加载</n-button>
        </div>
      </div>
      <div v-else-if="current" class="flex-1 grid place-items-center"><n-spin size="small" /></div>
      <ResultPreview v-else :active="false" />
    </template>
  </Workbench>

  <CopywritingPicker v-model:show="showCopyPicker" @select="pickCopy" />

  <n-modal v-model:show="imagePreviewShow" preset="card" class="!w-560px" title="笔记配图">
    <img v-if="previewUrl" :src="previewUrl" :style="previewStyle" class="block w-full rounded-8px" alt="" />
  </n-modal>
</template>
