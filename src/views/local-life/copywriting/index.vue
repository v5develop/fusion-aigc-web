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
import { useAgreement, useLLList, usePollingWhile } from '../hooks.ts'
import { COPY_STATUS_MAP, DERIVATIVE_KIND_MAP, formatTime, isCopyRunning } from '../constants.ts'

defineOptions({ name: 'local-life-copywriting' })

const message = useMessage()
const { ensureAgreed } = useAgreement()

// ---------------- 表单 ----------------

type Mode = 'AI_WRITE' | 'IMITATE' | 'MANUAL'
const mode = ref<Mode>('AI_WRITE')
const modeTabs = [
  { key: 'AI_WRITE', label: 'AI帮写' },
  { key: 'IMITATE', label: '爆款仿写' },
  { key: 'MANUAL', label: '自主撰写' },
] as { key: Mode; label: string }[]

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

const targetWordOptions = computed(() =>
  (options.value?.word_counts ?? []).map((o) => ({ label: o.label, value: o.code })),
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
      view.value = 'list'
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

const view = ref<'list' | 'detail'>('list')
const statusFilter = ref<number | null>(null)
const keyword = ref('')

const listCtl = useLLList<ILCopywriting>(
  (params) =>
    llCopywritingList({
      ...params,
      status: statusFilter.value ?? -1,
      keyword: keyword.value.trim() || undefined,
    }),
  isCopyRunning,
)

onMounted(() => void listCtl.reload())

watch(statusFilter, () => void listCtl.reload())

function search() {
  void listCtl.reload()
}

async function removeItem(item: ILCopywriting) {
  await llCopywritingRemove(item.id)
  message.success('已删除')
  if (detail.value?.id === item.id) {
    view.value = 'list'
    detail.value = null
  }
  void listCtl.refresh()
}

// ---------------- 右侧：详情 ----------------

const detail = ref<ILCopywriting | null>(null)
const detailLoading = ref(false)
const editing = ref(false)
const editForm = reactive({ title: '', body: '' })
const derivatives = ref<ILDerivative[]>([])

const { start: startDetailPoll } = usePollingWhile(
  () => llCopywritingDetail(detail.value!.id),
  (data) => {
    if (!data) return true
    detail.value = data
    if (data.status === 0) return true
    // 到终态：列表与积分同步刷一遍
    void listCtl.refresh()
    message.success(data.status === 1 ? '文案已生成' : '文案生成失败')
    return false
  },
)

async function openDetail(id: number, opts: { silent?: boolean } = {}) {
  view.value = 'detail'
  detailLoading.value = !opts.silent
  editing.value = false
  try {
    const res = await llCopywritingDetail(id)
    detail.value = res.data
    if (res.data?.status === 0) startDetailPoll()
    if (res.data?.status === 1) void loadDerivatives(id)
  } finally {
    detailLoading.value = false
  }
}

async function loadDerivatives(id: number) {
  const res = await llCopywritingDerivatives(id)
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
  saving.value = true
  try {
    const res = await llCopywritingPut(detail.value.id, {
      title: editForm.title.trim() || undefined,
      body: editForm.body,
    })
    detail.value = res.data
    editing.value = false
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
  await openDetail(id, { silent: true })
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
  >
    <template #default>
      <div class="flex flex-wrap gap-8px mb-16px">
        <div
          v-for="tab in modeTabs"
          :key="tab.key"
          class="ll-pill"
          :class="{ 'll-pill-active': mode === tab.key }"
          @click="mode = tab.key"
        >
          {{ tab.label }}
        </div>
      </div>

      <template v-if="mode !== 'MANUAL'">
        <div class="mb-14px">
          <div class="ll-label">内容类型</div>
          <n-select
            v-model:value="form.content_type"
            size="small"
            :options="(options?.content_types ?? []).map((o) => ({ label: o.label, value: o.code }))"
            placeholder="请选择"
          />
        </div>
        <div class="mb-14px grid grid-cols-2 gap-10px">
          <div>
            <div class="ll-label">风格</div>
            <n-select
              v-model:value="form.style"
              size="small"
              clearable
              :options="(options?.styles ?? []).map((o) => ({ label: o.label, value: o.code }))"
              placeholder="选填"
            />
          </div>
          <div>
            <div class="ll-label">行业</div>
            <n-select
              v-model:value="form.industry"
              size="small"
              clearable
              :options="(options?.industries ?? []).map((o) => ({ label: o.label, value: o.code }))"
              placeholder="选填"
            />
          </div>
        </div>
        <div class="mb-14px">
          <div class="ll-label">目标字数</div>
          <n-select
            v-model:value="form.target_words"
            size="small"
            clearable
            :options="targetWordOptions"
            placeholder="不限"
          />
        </div>
      </template>

      <div v-if="mode === 'AI_WRITE'" class="mb-14px">
        <div class="ll-label">主题</div>
        <n-input
          v-model:value="form.topic"
          type="textarea"
          :maxlength="options?.max_topic_len || 500"
          show-count
          :rows="3"
          placeholder="想写什么？如：新店开业暖场活动宣传"
        />
      </div>

      <div v-if="mode === 'IMITATE'" class="mb-14px">
        <div class="ll-label">爆款原文</div>
        <n-input
          v-model:value="form.reference_text"
          type="textarea"
          :maxlength="options?.max_reference_len || 2000"
          show-count
          :rows="6"
          placeholder="粘贴一篇对标爆款文案，AI 会仿写同款结构的新文案"
        />
      </div>

      <template v-if="mode === 'MANUAL'">
        <div class="mb-14px">
          <div class="ll-label">标题</div>
          <n-input v-model:value="form.title" size="small" maxlength="100" placeholder="选填" />
        </div>
        <div class="mb-14px">
          <div class="ll-label">
            正文
            <span class="ll-link" :class="{ 'opacity-60 cursor-not-allowed': aiWriting }" @click="aiWriteDraft">
              {{ aiWriting ? 'AI帮写中…' : '✨ AI帮写' }}
            </span>
          </div>
          <n-input v-model:value="form.body" type="textarea" :rows="8" placeholder="自己写，或点右上角让 AI 帮你起草" />
        </div>
      </template>

      <div v-if="mode !== 'MANUAL'" class="mb-14px">
        <div class="ll-label">关联店铺档案</div>
        <ShopProfileSelect v-model:value="form.shop_profile_id" />
      </div>
    </template>

    <template #right>
      <div class="h-full min-h-0 flex flex-col">
        <!-- 列表视图 -->
        <template v-if="view === 'list'">
          <div class="flex flex-none items-center gap-10px mb-14px">
            <div class="flex gap-6px">
              <span
                v-for="opt in [
                  { value: null, label: '全部' },
                  { value: 0, label: '生成中' },
                  { value: 1, label: '已完成' },
                  { value: 2, label: '失败' },
                ]"
                :key="String(opt.label)"
                class="ll-pill"
                :class="{ 'll-pill-active': statusFilter === opt.value }"
                @click="statusFilter = opt.value"
                >{{ opt.label }}</span
              >
            </div>
            <n-input
              v-model:value="keyword"
              class="!w-200px"
              size="small"
              placeholder="搜索关键词"
              clearable
              @keydown.enter="search"
              @clear="search"
            >
              <template #suffix><span class="ll-link" @click="search">搜索</span></template>
            </n-input>
          </div>

          <div v-loading="listCtl.loading.value" class="flex-1 min-h-0 overflow-auto flex flex-col gap-10px">
            <div
              v-for="item in listCtl.items.value"
              :key="item.id"
              class="ll-card flex-none px-16px py-12px cursor-pointer transition-[border-color,box-shadow] duration-[0.18s] ease-[ease] hover:(border-violet-line shadow-[0_4px_16px_rgba(31,35,41,0.08)])"
              @click="openDetail(item.id)"
            >
              <div class="flex items-center gap-8px mb-6px">
                <span class="flex-1 min-w-0 truncate text-14px font-600 leading-20px text-ink">{{
                  item.title || '未命名文案'
                }}</span>
                <span class="ll-chip" :class="`ll-chip-${COPY_STATUS_MAP[item.status]?.type}`">
                  {{ COPY_STATUS_MAP[item.status]?.label ?? '未知' }}
                </span>
              </div>
              <div class="line-clamp-2 mb-8px text-12px leading-18px text-ink-2">{{ item.body || '生成中…' }}</div>
              <div class="flex justify-between gap-8px text-12px text-muted">
                <span
                  >{{ item.content_type_label
                  }}<template v-if="item.word_count"> · {{ item.word_count }}字</template></span
                >
                <span class="flex-none">{{ formatTime(item.create_time) }}</span>
              </div>
            </div>
            <div v-if="!listCtl.loading.value && !listCtl.items.value.length" class="ll-empty py-80px">
              还没有文案，左侧开始创作吧
            </div>
            <div
              v-if="listCtl.hasMore.value && !listCtl.loadingMore.value"
              class="ll-link block text-center py-8px"
              @click="listCtl.loadMore()"
            >
              加载更多
            </div>
          </div>
        </template>

        <!-- 详情视图 -->
        <template v-else>
          <div
            class="flex-none w-fit mb-12px text-13px text-ink-2 cursor-pointer hover:text-violet-ink"
            @click="view = 'list'"
          >
            ← 返回列表
          </div>
          <div v-if="detail" v-loading="detailLoading" class="flex-1 min-h-0 overflow-auto">
            <div class="flex items-center gap-10px">
              <span class="ll-chip" :class="`ll-chip-${COPY_STATUS_MAP[detail.status]?.type}`">
                {{ COPY_STATUS_MAP[detail.status]?.label }}
              </span>
              <h2 class="m-0 text-16px font-600 leading-22px text-ink">{{ detail.title || '未命名文案' }}</h2>
            </div>
            <div class="mt-8px mb-16px text-12px text-muted">
              {{ detail.content_type_label }}<template v-if="detail.style"> · {{ detail.style }}</template>
              <template v-if="detail.word_count"> · {{ detail.word_count }}字</template> ·
              {{ formatTime(detail.create_time) }}
            </div>

            <div
              v-if="detail.status === 0"
              class="ll-card flex items-center justify-center gap-10px p-40px text-13px text-ink-2"
            >
              <n-spin size="small" />
              <span>文案生成中，请稍候…</span>
            </div>
            <div
              v-else-if="detail.status === 2"
              class="ll-card flex items-center justify-center gap-10px p-40px text-13px text-danger"
            >
              {{ detail.fail_reason || '生成失败' }}
            </div>

            <template v-else>
              <div v-if="!editing" class="ll-card p-16px whitespace-pre-wrap text-14px leading-24px text-ink">
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
                <div class="ll-section-title">用这条文案生成过</div>
                <div class="flex flex-wrap gap-10px">
                  <div
                    v-for="d in derivatives"
                    :key="d.kind + d.id"
                    class="relative w-96px overflow-hidden rounded-8px border border-solid border-line bg-white cursor-pointer transition-[border-color,box-shadow] duration-[0.18s] ease-[ease] hover:(border-violet-line shadow-[0_4px_16px_rgba(31,35,41,0.08)])"
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
        </template>
      </div>
    </template>
  </Workbench>
</template>
