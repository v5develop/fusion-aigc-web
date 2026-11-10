<script setup lang="ts">
/**
 * AI文案工作台。
 *
 * 三种产出方式对应后端三条口：
 * - AI帮写：source=AI_WRITE，按主题异步生成（轮询详情）；
 * - 爆款仿写：source=IMITATE，粘一篇对标文案仿写；
 * - 自主撰写：直接保存，可用「AI帮写」同步润色底稿。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import Workbench from '../components/Workbench/index.vue'
import ShopProfileSelect from '../components/ShopProfileSelect/index.vue'
import FormCard from '../components/FormCard/index.vue'
import Field from '../components/Field/index.vue'
import SegTabs from '../components/SegTabs/index.vue'
import ChipGroup from '../components/ChipGroup/index.vue'
import PromptBox from '../components/PromptBox/index.vue'
import PromptActions from '../components/PromptActions/index.vue'
import SettingsBar from '../components/SettingsBar/index.vue'
import {
  llCopywritingAiWrite,
  llCopywritingGenerate,
  llCopywritingList,
  llCopywritingPut,
  llCopywritingRegenerate,
  llCopywritingRemove,
  llCopywritingDetail,
  llCopywritingDerivatives,
  llCopywritingOptions,
  llCopywritingSave,
  llIdempotencyHeaders,
} from '@/api/localLife.ts'
import type { ILCopywriting, ILCopywritingOptions, ILDerivative } from '@/api/localLifeTypes.ts'
import HistoryList from '../components/HistoryList/index.vue'
import HistoryCard from '../components/HistoryList/HistoryCard.vue'
import ResultPreview from '../components/ResultPreview/index.vue'
import { useLLQuote } from '../components/Workbench/useLLQuote.ts'
import { useAgreement, useLLList, usePollingWhile } from '../hooks.ts'
import { COPY_STATUS_MAP, DERIVATIVE_KIND_MAP, formatTime, isCopyRunning } from '../constants.ts'

defineOptions({ name: 'local-life-copywriting' })

const message = useMessage()
const { ensureAgreed } = useAgreement()

// ---------------- 表单 ----------------

type Mode = 'AI_WRITE' | 'IMITATE' | 'MANUAL'
const mode = ref<Mode>('AI_WRITE')
/** desc 是写法卡的一行说明（原型 AiCopyContent MODES） */
const modeTabs = [
  { key: 'AI_WRITE', label: 'AI帮写', desc: '输入需求，AI 直接生成文案' },
  { key: 'IMITATE', label: '爆款仿写', desc: '参考范文，仿写同款风格文案' },
  { key: 'MANUAL', label: '自主撰写', desc: '从零手写，随心调整文案细节' },
] as { key: Mode; label: string; desc: string }[]
const activeModeTab = computed(() => modeTabs.find((t) => t.key === mode.value) ?? modeTabs[0]!)

const options = ref<ILCopywritingOptions | null>(null)
const form = reactive({
  content_type: '',
  style: '',
  industry: '',
  target_words: undefined as string | undefined,
  topic: '',
  reference_text: '',
  title: '',
  body: '',
  shop_profile_id: undefined as number | undefined,
})

const toOptions = (list?: { label: string; code: string }[]) =>
  (list ?? []).map((o) => ({ label: o.label, value: o.code }))
const contentTypeOptions = computed(() => toOptions(options.value?.content_types))
const styleOptions = computed(() => toOptions(options.value?.styles))
const industryOptions = computed(() => toOptions(options.value?.industries))
/** 「生成设置」里的目标字数：首项「不限」= 不传 target_words（原下拉清空的效果） */
const targetWordSettingOptions = computed(() =>
  (options.value?.word_counts?.length ? [{ label: '不限', value: '' }] : []).concat(
    toOptions(options.value?.word_counts),
  ),
)

onMounted(async () => {
  const res = await llCopywritingOptions()
  const data = res.data ?? null
  options.value = data
  if (data?.content_types?.length) form.content_type = data.content_types[0]?.code ?? ''
})

const aiWriting = ref(false)
/** 同步 AI帮写：把润色结果填进正文，继续走自主撰写保存 */
async function aiWriteDraft() {
  const context = form.body.trim() || form.topic.trim()
  if (!context) return message.warning('请先填写主题或正文底稿')
  aiWriting.value = true
  try {
    const res = await llCopywritingAiWrite({
      scene: 'topic',
      content_type: form.content_type || undefined,
      industry: form.industry || undefined,
      context,
    })
    form.body = res.data?.text ?? ''
    message.success('AI帮写完成，可继续编辑')
  } finally {
    aiWriting.value = false
  }
}

// 提交前报价：只挂在「生成文案」提交上——AI帮写（source=AI_WRITE）/ 爆款仿写一次生成按一次计（重新生成算新的一次）。
// 不挂价：手动输入只是保存；自主撰写里的「AI帮写」润色按钮（aiWriteDraft → /copywriting/ai-write）是免费的同步辅助
const { estimate } = useLLQuote(() => (mode.value === 'MANUAL' ? null : { tool: 'copywriting' }))

const submitting = ref(false)

async function submit() {
  if (submitting.value) return

  if (mode.value === 'MANUAL') {
    if (!form.body.trim()) return message.warning('请输入正文')
    submitting.value = true
    try {
      const res = await llCopywritingSave({ title: form.title.trim() || undefined, body: form.body })
      message.success('已保存')
      form.title = ''
      form.body = ''
      // 三栏里历史列一直可见：刷一次列表让新文案马上出现（改版前回到列表视图时才会看到）
      void listCtl.refresh()
      await openDetail(res.data.id, { silent: true })
    } finally {
      submitting.value = false
    }
    return
  }

  if (mode.value === 'AI_WRITE') {
    if (!form.topic.trim()) return message.warning('请输入主题')
  } else {
    if (!form.reference_text.trim()) return message.warning('请粘贴要仿写的爆款文案')
  }

  if (!(await ensureAgreed())) return

  submitting.value = true
  try {
    const res = await llCopywritingGenerate(
      {
        source: mode.value as 'AI_WRITE' | 'IMITATE',
        content_type: form.content_type || undefined,
        style: form.style || undefined,
        industry: form.industry || undefined,
        target_words: form.target_words ? Number(form.target_words) : undefined,
        topic: form.topic.trim() || undefined,
        reference_text: form.reference_text.trim() || undefined,
        shop_profile_id: form.shop_profile_id,
      },
      llIdempotencyHeaders(),
    )
    message.success('已提交生成')
    await listCtl.refresh()
    await openDetail(res.data.id, { silent: true })
  } finally {
    submitting.value = false
  }
}

// ---------------- 右侧：我的文案列表 ----------------

const statusFilter = ref<number | null>(null)
const keyword = ref('')
const statusOptions = [
  { value: null, label: '全部' },
  { value: 0, label: '生成中' },
  { value: 1, label: '已完成' },
  { value: 2, label: '失败' },
]

const listCtl = useLLList<ILCopywriting>(
  (params) =>
    llCopywritingList({
      ...params,
      status: statusFilter.value ?? -1,
      keyword: keyword.value.trim() || undefined,
    }),
  isCopyRunning,
)

const runningCount = computed(() => listCtl.items.value.filter(isCopyRunning).length)

onMounted(() => void listCtl.reload())

watch(statusFilter, () => void listCtl.reload())

function search() {
  void listCtl.reload()
}

async function removeItem(item: ILCopywriting) {
  await llCopywritingRemove(item.id)
  message.success('已删除')
  if (detailId === item.id) {
    // 删的是右栏这条：右栏回到空态（与改版前删除后回列表一致），轮询与在途请求一并作废
    openSeq++
    detailId = null
    stopDetailPoll()
    detail.value = null
    editing.value = false
    derivatives.value = []
  }
  void listCtl.refresh()
}

// ---------------- 右侧：详情 ----------------

const detail = ref<ILCopywriting | null>(null)
const detailLoading = ref(false)
const editing = ref(false)
const editForm = reactive({ title: '', body: '' })
const derivatives = ref<ILDerivative[]>([])

const { start: startDetailPoll, stop: stopDetailPoll } = usePollingWhile(
  () => llCopywritingDetail(detailId!),
  (data) => {
    if (!data) return true
    // 兜底：回来的不是右栏当前这条（已切走）就收掉这条链
    if (data.id !== detailId) return false
    detail.value = data
    if (data.status === 0) return true
    // 到终态：列表与点数同步刷一遍
    void listCtl.refresh()
    if (data.status === 1) void loadDerivatives(data.id)
    message.success(data.status === 1 ? '文案已生成' : '文案生成失败')
    return false
  },
)

/** 右栏正在展示 / 正在载入的文案 id（比 detail 早一步更新，用来判断「是不是同一条」与丢弃过期响应） */
let detailId: number | null = null
let openSeq = 0

async function openDetail(id: number, opts: { silent?: boolean } = {}) {
  const seq = ++openSeq
  // 切到别的文案：停掉上一条的轮询（在途结果也作废），清掉上一条的衍生成品，免得串到新文案下面
  if (detailId !== id) {
    stopDetailPoll()
    derivatives.value = []
  }
  detailId = id
  detailLoading.value = !opts.silent
  editing.value = false
  try {
    const res = await llCopywritingDetail(id)
    if (seq !== openSeq) return // 期间又切了别的，丢弃过期结果
    detail.value = res.data
    if (res.data?.status === 0) startDetailPoll()
    if (res.data?.status === 1) void loadDerivatives(id)
  } catch {
    // 失败提示由请求层弹出；右栏仍是上一条，把「当前 id」与它的轮询还原回去
    if (seq === openSeq && detail.value) {
      detailId = detail.value.id
      if (detail.value.status === 0) startDetailPoll()
      else if (detail.value.status === 1) void loadDerivatives(detail.value.id)
    }
  } finally {
    if (seq === openSeq) detailLoading.value = false
  }
}

/** 点历史卡：右栏已经是这条就不重载（编辑到一半的内容不能被冲掉）；其余照旧打开详情 */
function onSelectItem(item: ILCopywriting) {
  if (detailId === item.id && detail.value?.id === item.id) return
  void openDetail(item.id)
}

async function loadDerivatives(id: number) {
  const res = await llCopywritingDerivatives(id)
  if (detailId !== id) return // 已切到别的文案
  derivatives.value = res.data?.list ?? []
}

function startEdit() {
  if (!detail.value) return
  editForm.title = detail.value.title
  editForm.body = detail.value.body
  editing.value = true
}

const saving = ref(false)
async function saveEdit() {
  if (!detail.value || saving.value) return
  if (!editForm.body.trim()) return message.warning('正文不能为空')
  const id = detail.value.id
  saving.value = true
  try {
    const res = await llCopywritingPut(id, {
      title: editForm.title.trim() || undefined,
      body: editForm.body,
    })
    if (detailId === id) {
      detail.value = res.data
      editing.value = false
    }
    message.success('已保存')
    void listCtl.refresh()
  } finally {
    saving.value = false
  }
}

async function regenerate() {
  if (!detail.value) return
  const id = detail.value.id
  await llCopywritingRegenerate(id, llIdempotencyHeaders())
  message.success('已重新提交生成')
  // 等待期间切到了别的文案就不把右栏拉回来，列表刷新会反映这条的新状态
  if (detailId === id) await openDetail(id, { silent: true })
  void listCtl.refresh()
}

async function copyBody() {
  if (!detail.value) return
  await navigator.clipboard.writeText(detail.value.body)
  message.success('已复制')
}

function openDerivative(d: ILDerivative) {
  window.open(d.result_url, '_blank')
}
</script>

<template>
  <Workbench
    title="AI文案"
    :submit="submit"
    :loading="submitting"
    :submit-text="mode === 'MANUAL' ? '保存文案' : '生成文案'"
    :estimate="estimate"
    :history-count="listCtl.total.value"
  >
    <template #default>
      <FormCard title="写法" :hint="activeModeTab.desc">
        <SegTabs v-model="mode" :options="modeTabs" label="写法" size="md" />
      </FormCard>

      <FormCard v-if="mode === 'AI_WRITE'" title="主题" required>
        <PromptBox
          v-model="form.topic"
          label="主题"
          size="lg"
          :max-length="options?.max_topic_len || 500"
          placeholder="想写什么？如：新店开业暖场活动宣传"
        />
      </FormCard>

      <FormCard v-if="mode === 'IMITATE'" title="爆款原文" required>
        <PromptBox
          v-model="form.reference_text"
          label="爆款原文"
          size="lg"
          :max-length="options?.max_reference_len || 2000"
          placeholder="粘贴一篇对标爆款文案，AI 会仿写同款结构的新文案"
        />
      </FormCard>

      <template v-if="mode === 'MANUAL'">
        <FormCard title="标题" hint="选填">
          <n-input v-model:value="form.title" size="small" maxlength="100" show-count placeholder="请输入文案标题" />
        </FormCard>
        <FormCard title="正文" required>
          <PromptBox v-model="form.body" label="正文" size="lg" placeholder="自己写，或点左下角让 AI 帮你起草">
            <template #actions>
              <PromptActions :loading="aiWriting" :picker="false" @ai="aiWriteDraft" />
            </template>
          </PromptBox>
        </FormCard>
      </template>

      <FormCard v-else title="参数">
        <Field label="内容类型">
          <ChipGroup v-model="form.content_type" :options="contentTypeOptions" label="内容类型" />
        </Field>
        <Field label="风格">
          <ChipGroup v-model="form.style" :options="styleOptions" label="风格" empty-label="不限" />
        </Field>
        <Field label="行业">
          <ChipGroup v-model="form.industry" :options="industryOptions" label="行业" empty-label="不限" />
        </Field>
        <Field label="关联店铺档案">
          <ShopProfileSelect v-model:value="form.shop_profile_id" />
        </Field>
      </FormCard>
    </template>

    <template v-if="mode !== 'MANUAL'" #settings>
      <SettingsBar
        v-model:data="form"
        :fields="[{ field: 'target_words', label: '目标字数', options: targetWordSettingOptions }]"
      />
    </template>

    <!-- 三栏：左中栏历史（筛选 + 搜索放在列表上方），点卡在右栏打开该条文案详情 -->
    <template #history>
      <div class="flex-1 min-h-0 flex flex-col">
        <div class="flex-none flex flex-col gap-8px px-12px pt-10px">
          <div class="sx-seg self-start" role="group" aria-label="状态筛选">
            <button
              v-for="opt in statusOptions"
              :key="String(opt.label)"
              type="button"
              class="sx-seg-item !px-10px !text-12px bg-transparent hover:text-ink sx-focus"
              :class="{ 'sx-seg-on': statusFilter === opt.value }"
              :aria-pressed="statusFilter === opt.value"
              @click="statusFilter = opt.value"
            >
              {{ opt.label }}
            </button>
          </div>
          <n-input
            v-model:value="keyword"
            size="small"
            placeholder="搜索关键词"
            clearable
            @keydown.enter="search"
            @clear="search"
          >
            <template #suffix
              ><span class="ll-link transition-colors duration-fast" @click="search">搜索</span></template
            >
          </n-input>
        </div>
        <HistoryList
          :count="listCtl.total.value"
          :running="runningCount"
          :loading="listCtl.loading.value"
          :has-more="listCtl.hasMore.value"
          :loading-more="listCtl.loadingMore.value"
          @load-more="listCtl.loadMore()"
        >
          <HistoryCard
            v-for="item in listCtl.items.value"
            :key="item.id"
            :title="item.title || '未命名文案'"
            :status="COPY_STATUS_MAP[item.status]?.type ?? 'running'"
            :status-label="COPY_STATUS_MAP[item.status]?.label ?? '未知'"
            :time="item.create_time"
            placeholder="文案"
            :fail-reason="item.status === 2 ? item.fail_reason || '生成失败' : ''"
            :eta-sec="30"
            :summary="item.body"
            :selected="detail?.id === item.id"
            @select="onSelectItem(item)"
          />
        </HistoryList>
      </div>
    </template>

    <template #preview>
      <ResultPreview v-if="!detail" :active="false" empty-text="点中间的历史记录查看文案详情；左边提交后会自动打开新文案" />
      <div v-else class="flex-1 min-h-0 flex flex-col">
        <header class="flex-none flex items-center gap-8px min-h-56px px-16px py-12px box-border border-b border-b-solid border-b-line-soft">
          <div class="min-w-0 flex-1 flex flex-col gap-2px">
            <h2 class="m-0 truncate text-14px font-600 leading-20px text-ink" :title="detail.title || '未命名文案'">
              {{ detail.title || '未命名文案' }}
            </h2>
            <span class="flex items-center gap-8px min-w-0 text-11px leading-16px text-muted tabular-nums">
              <span class="sx-chip flex-none" :class="`ll-chip-${COPY_STATUS_MAP[detail.status]?.type}`">
                {{ COPY_STATUS_MAP[detail.status]?.label }}
              </span>
              <span class="truncate">
                {{ detail.content_type_label }}<template v-if="detail.style"> · {{ detail.style }}</template>
                <template v-if="detail.word_count"> · {{ detail.word_count }}字</template> ·
                {{ formatTime(detail.create_time) }}
              </span>
            </span>
          </div>
        </header>
        <div v-loading="detailLoading" class="flex-1 min-h-0 overflow-auto p-16px [scrollbar-width:thin]">
          <div
            v-if="detail.status === 0"
            class="bg-white rounded-lg border border-solid border-line shadow-card-v3 flex items-center justify-center gap-10px p-40px text-13px text-ink-2"
          >
            <n-spin size="small" />
            <span>文案生成中，请稍候…</span>
          </div>
          <div
            v-else-if="detail.status === 2"
            class="bg-white rounded-lg border border-solid border-line shadow-card-v3 flex items-center justify-center gap-10px p-40px text-13px text-danger"
          >
            {{ detail.fail_reason || '生成失败' }}
          </div>

          <template v-else>
            <div
              v-if="!editing"
              class="bg-white rounded-lg border border-solid border-line shadow-card-v3 p-14px whitespace-pre-wrap text-14px leading-24px text-ink"
            >
              {{ detail.body }}
            </div>
            <div v-else class="flex flex-col gap-10px">
              <n-input v-model:value="editForm.title" size="small" maxlength="100" placeholder="标题" />
              <n-input v-model:value="editForm.body" type="textarea" :rows="12" placeholder="正文" />
            </div>

            <div class="flex gap-8px mt-14px">
              <template v-if="!editing">
                <n-button size="small" @click="copyBody">复制</n-button>
                <n-button size="small" @click="startEdit">编辑</n-button>
                <n-button size="small" @click="regenerate">重新生成</n-button>
                <n-popconfirm @positive-click="removeItem(detail!)">
                  <template #trigger><n-button size="small" quaternary type="error">删除</n-button></template>
                  确定删除这条文案？
                </n-popconfirm>
              </template>
              <template v-else>
                <n-button size="small" type="primary" :loading="saving" @click="saveEdit">保存</n-button>
                <n-button size="small" @click="editing = false">取消</n-button>
              </template>
            </div>

            <div v-if="derivatives.length" class="mt-20px">
              <div class="mb-8px sx-title-card">用这条文案生成过</div>
              <div class="flex flex-wrap gap-10px">
                <div
                  v-for="d in derivatives"
                  :key="d.kind + d.id"
                  class="relative w-96px overflow-hidden rounded-8px border border-solid border-line bg-white cursor-pointer transition-[border-color,box-shadow] duration-mid ease-[ease] motion-reduce:transition-none hover:(border-violet-line shadow-raised-hover)"
                  @click="openDerivative(d)"
                >
                  <img v-if="d.cover_url" class="block w-full aspect-square object-cover" :src="d.cover_url" alt="" />
                  <video
                    v-else-if="d.is_video && d.result_url"
                    class="block w-full aspect-square object-cover"
                    :src="d.result_url"
                    muted
                  />
                  <div class="absolute inset-x-0 bottom-0 py-2px bg-black/45 text-center text-11px text-white">
                    {{ DERIVATIVE_KIND_MAP[d.kind] ?? d.kind }}
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </template>
  </Workbench>
</template>
