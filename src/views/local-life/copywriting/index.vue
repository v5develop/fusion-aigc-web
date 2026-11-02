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
import { llCopywritingAiWrite, llCopywritingGenerate, llCopywritingList, llCopywritingPut, llCopywritingRegenerate, llCopywritingRemove, llCopywritingDetail, llCopywritingDerivatives, llCopywritingOptions, llCopywritingSave, llIdempotencyHeaders } from '@/api/localLife.ts'
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
  <Workbench title="AI文案" :submit="submit" :loading="submitting" :submit-text="mode === 'MANUAL' ? '保存文案' : '生成文案'">
    <template #default>
      <div class="mode-tabs">
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
        <div class="field">
          <div class="label">内容类型</div>
          <n-select
            v-model:value="form.content_type"
            size="small"
            :options="(options?.content_types ?? []).map((o) => ({ label: o.label, value: o.code }))"
            placeholder="请选择"
          />
        </div>
        <div class="field two-col">
          <div>
            <div class="label">风格</div>
            <n-select
              v-model:value="form.style"
              size="small"
              clearable
              :options="(options?.styles ?? []).map((o) => ({ label: o.label, value: o.code }))"
              placeholder="选填"
            />
          </div>
          <div>
            <div class="label">行业</div>
            <n-select
              v-model:value="form.industry"
              size="small"
              clearable
              :options="(options?.industries ?? []).map((o) => ({ label: o.label, value: o.code }))"
              placeholder="选填"
            />
          </div>
        </div>
        <div class="field">
          <div class="label">目标字数</div>
          <n-select
            v-model:value="form.target_words"
            size="small"
            clearable
            :options="targetWordOptions"
            placeholder="不限"
          />
        </div>
      </template>

      <div v-if="mode === 'AI_WRITE'" class="field">
        <div class="label">主题</div>
        <n-input
          v-model:value="form.topic"
          type="textarea"
          :maxlength="options?.max_topic_len || 500"
          show-count
          :rows="3"
          placeholder="想写什么？如：新店开业暖场活动宣传"
        />
      </div>

      <div v-if="mode === 'IMITATE'" class="field">
        <div class="label">爆款原文</div>
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
        <div class="field">
          <div class="label">标题</div>
          <n-input v-model:value="form.title" size="small" maxlength="100" placeholder="选填" />
        </div>
        <div class="field">
          <div class="label">
            正文
            <span class="ai-write-link" :class="{ disabled: aiWriting }" @click="aiWriteDraft">
              {{ aiWriting ? 'AI帮写中…' : '✨ AI帮写' }}
            </span>
          </div>
          <n-input v-model:value="form.body" type="textarea" :rows="8" placeholder="自己写，或点右上角让 AI 帮你起草" />
        </div>
      </template>

      <div v-if="mode !== 'MANUAL'" class="field">
        <div class="label">关联店铺档案</div>
        <ShopProfileSelect v-model:value="form.shop_profile_id" />
      </div>
    </template>

    <template #right>
      <div class="right-inner">
        <!-- 列表视图 -->
        <template v-if="view === 'list'">
          <div class="list-bar">
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
              >{{ opt.label }}</span>
            </div>
            <n-input v-model:value="keyword" size="small" placeholder="搜索关键词" clearable @keydown.enter="search" @clear="search">
              <template #suffix><span class="search-btn" @click="search">搜索</span></template>
            </n-input>
          </div>

          <div class="copy-list" v-loading="listCtl.loading.value">
            <div v-for="item in listCtl.items.value" :key="item.id" class="copy-item" @click="openDetail(item.id)">
              <div class="head">
                <span class="title">{{ item.title || '未命名文案' }}</span>
                <span class="ll-chip" :class="`ll-chip-${COPY_STATUS_MAP[item.status]?.type}`">
                  {{ COPY_STATUS_MAP[item.status]?.label ?? '未知' }}
                </span>
              </div>
              <div class="body">{{ item.body || '生成中…' }}</div>
              <div class="foot">
                <span>{{ item.content_type_label }}<template v-if="item.word_count"> · {{ item.word_count }}字</template></span>
                <span class="time">{{ formatTime(item.create_time) }}</span>
              </div>
            </div>
            <div v-if="!listCtl.loading.value && !listCtl.items.value.length" class="empty">还没有文案，左侧开始创作吧</div>
            <div v-if="listCtl.hasMore.value && !listCtl.loadingMore.value" class="more" @click="listCtl.loadMore()">加载更多</div>
          </div>
        </template>

        <!-- 详情视图 -->
        <template v-else>
          <div class="back" @click="view = 'list'">← 返回列表</div>
          <div v-if="detail" class="detail" v-loading="detailLoading">
            <div class="detail-head">
              <span class="ll-chip" :class="`ll-chip-${COPY_STATUS_MAP[detail.status]?.type}`">
                {{ COPY_STATUS_MAP[detail.status]?.label }}
              </span>
              <h2>{{ detail.title || '未命名文案' }}</h2>
            </div>
            <div class="detail-meta">
              {{ detail.content_type_label }}<template v-if="detail.style"> · {{ detail.style }}</template>
              <template v-if="detail.word_count"> · {{ detail.word_count }}字</template> · {{ formatTime(detail.create_time) }}
            </div>

            <div v-if="detail.status === 0" class="generating">
              <n-spin size="small" />
              <span>文案生成中，请稍候…</span>
            </div>
            <div v-else-if="detail.status === 2" class="failed">{{ detail.fail_reason || '生成失败' }}</div>

            <template v-else>
              <div v-if="!editing" class="detail-body">{{ detail.body }}</div>
              <div v-else class="edit-area">
                <n-input v-model:value="editForm.title" size="small" maxlength="100" placeholder="标题" />
                <n-input v-model:value="editForm.body" type="textarea" :rows="12" placeholder="正文" />
              </div>

              <div class="detail-ops">
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

              <div v-if="derivatives.length" class="derivatives">
                <div class="sub-title">用这条文案生成过</div>
                <div class="deriv-list">
                  <div v-for="d in derivatives" :key="d.kind + d.id" class="deriv-item" @click="openDerivative(d)">
                    <img v-if="d.cover_url" :src="d.cover_url" alt="" />
                    <video v-else-if="d.is_video && d.result_url" :src="d.result_url" muted />
                    <div class="kind">{{ DERIVATIVE_KIND_MAP[d.kind] ?? d.kind }}</div>
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

<style scoped lang="less">
.mode-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.field {
  margin-bottom: 14px;

  .label {
    font-size: 13px;
    color: #1f2329;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    justify-content: space-between;

    .ai-write-link {
      color: #875f9a;
      font-size: 12px;
      cursor: pointer;

      &.disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    }
  }
}

.two-col {
  display: flex;
  gap: 10px;

  > div {
    flex: 1;
  }
}

.right-inner {
  height: 100%;
  padding: 24px 32px;
  display: flex;
  flex-direction: column;

  .list-bar {
    display: flex;
    gap: 10px;
    margin-bottom: 14px;
    flex-shrink: 0;

    > .n-input {
      width: 200px;
    }

    .search-btn {
      font-size: 12px;
      color: #875f9a;
      cursor: pointer;
    }
  }

  .copy-list {
    flex: 1;
    min-height: 0;
    overflow: auto;

    .copy-item {
      background: #fff;
      border-radius: 10px;
      padding: 12px 16px;
      margin-bottom: 10px;
      cursor: pointer;
      transition: box-shadow 0.2s;

      &:hover {
        box-shadow: 0 2px 8px 0 rgba(0, 0, 0, 0.08);
      }

      .head {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;

        .title {
          flex: 1;
          font-weight: 600;
          font-size: 14px;
          color: #1f2329;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      }

      .body {
        font-size: 12px;
        color: #4b5563;
        line-height: 18px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        margin-bottom: 8px;
      }

      .foot {
        display: flex;
        justify-content: space-between;
        font-size: 12px;
        color: #5f6673;

        .time {
          flex-shrink: 0;
        }
      }
    }

    .empty {
      text-align: center;
      color: #5f6673;
      font-size: 13px;
      padding: 80px 0;
    }

    .more {
      text-align: center;
      color: #875f9a;
      font-size: 12px;
      padding: 8px 0;
      cursor: pointer;
    }
  }

  .back {
    flex-shrink: 0;
    font-size: 13px;
    color: #4b5563;
    cursor: pointer;
    margin-bottom: 12px;
    width: fit-content;

    &:hover {
      color: #875f9a;
    }
  }

  .detail {
    flex: 1;
    min-height: 0;
    overflow: auto;

    .detail-head {
      display: flex;
      align-items: center;
      gap: 10px;

      h2 {
        font-size: 18px;
        color: #1f2329;
        margin: 0;
      }
    }

    .detail-meta {
      font-size: 12px;
      color: #5f6673;
      margin: 8px 0 16px;
    }

    .detail-body {
      white-space: pre-wrap;
      font-size: 14px;
      color: #1f2329;
      line-height: 24px;
      background: #fff;
      border-radius: 10px;
      padding: 16px;
    }

    .edit-area {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .generating,
    .failed {
      background: #fff;
      border-radius: 10px;
      padding: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      color: #4b5563;
      font-size: 13px;
    }

    .failed {
      color: #b4433e;
    }
    .detail-ops {
      display: flex;
      gap: 8px;
      margin-top: 14px;
    }

    .derivatives {
      margin-top: 20px;

      .sub-title {
        font-size: 14px;
        font-weight: 600;
        color: #1f2329;
        margin-bottom: 10px;
      }

      .deriv-list {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;

        .deriv-item {
          width: 96px;
          border-radius: 8px;
          overflow: hidden;
          cursor: pointer;
          position: relative;
          background: #fff;

          img,
          video {
            width: 100%;
            aspect-ratio: 1;
            object-fit: cover;
            display: block;
          }

          .kind {
            position: absolute;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.45);
            color: #fff;
            font-size: 11px;
            text-align: center;
            padding: 2px 0;
          }
        }
      }
    }
  }
}
</style>
