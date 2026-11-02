<script setup lang="ts">
/**
 * 智能体（Java /api/v1/agent/*）MVP：左侧会话列表（分页 / 新建 / 改名 / 删除），
 * 右侧消息流（历史消息 + SSE 流式回复 + 停止），输入框上方是技能入口。
 *
 * <p>技能语义照 StreamRequest.agentSkillId：技能决定本轮的提示词、工具集与计费，是每轮请求带的 id，
 * 不是一段可预填的文字；目录非空（v2 已开放）时必须带一条，界面默认选中第一条。
 * 目录为空时不能带（旧链路有值即拒）。workflow 形态的技能选进对话会被拒，不展示。
 *
 * <p>计费与重试：流式对话受理即预扣。客户端不自动重试；受理前结果未知（断网 / 超时）时
 * 沿用同一个 X-Request-Id（服务端据它幂等），用户点「重试」才重发；确定失败或已受理则换新 id。
 */
import { nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'
import { NConfigProvider, NDropdown, NInput, NSpin, useDialog, useMessage } from 'naive-ui'
import { llTheme } from '@/views/local-life/theme.ts'
import { toApiError } from '@/api'
import {
  agentCancel,
  agentConversations,
  agentCreateConversation,
  agentDeleteConversation,
  agentMessages,
  agentRenameConversation,
  agentSkills,
  agentStream,
  applyFrame,
  emptyReply,
  replyFromFrames,
} from '@/api/agent.ts'
import type { IAgentConversation, IAgentMessage, IAgentReply, IAgentSkill } from '@/api/agent.ts'
import { useIdempotentSubmit } from '@/views/studio/hooks.ts'

defineOptions({ name: 'agent-chat' })

const message = useMessage()
const dialog = useDialog()

const FOCUS = 'focus-visible:(outline outline-2 outline-violet outline-offset-2)'
const LIST_SIZE = 20
const MSG_SIZE = 50

/** 业务失败（code≠0）请求层已 toast，这里只补传输层失败与非请求错误 */
function reportError(err: unknown, fallback = '操作失败，请重试') {
  const apiErr = toApiError(err)
  if (apiErr && apiErr.code !== -1 && !apiErr.httpStatus) return
  message.error(errorText(err, fallback))
}

function errorText(err: unknown, fallback = '操作失败，请重试') {
  const apiErr = toApiError(err)
  if (apiErr?.isNetwork) return '网络异常或请求超时，请稍后在历史记录里确认是否已提交'
  return err instanceof Error && err.message ? err.message : fallback
}

/** LocalDateTime 出网可能是 ISO 串或数组，统一成 MM-DD HH:mm */
function fmtTime(v: unknown): string {
  if (!v) return ''
  if (Array.isArray(v)) {
    const [, mo = 1, d = 1, h = 0, mi = 0] = v as number[]
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(mo)}-${p(d)} ${p(h)}:${p(mi)}`
  }
  return String(v).replace('T', ' ').slice(5, 16)
}

// ---------------- 技能 ----------------

const skills = ref<IAgentSkill[]>([])
const selectedSkillId = ref('')
const idem = useIdempotentSubmit()

async function loadSkills() {
  try {
    const res = await agentSkills()
    const groups = res.data ?? {}
    skills.value = Object.values(groups)
      .flat()
      .filter((s) => s.enabled !== false && s.executionShape !== 'workflow')
    selectedSkillId.value = skills.value[0]?.agentSkillId ?? ''
  } catch {
    // 目录拉失败不挡对话：不带 agentSkillId，服务端要求时会回 ERROR 帧
    skills.value = []
  }
}

function pickSkill(id: string) {
  if (selectedSkillId.value === id) return
  selectedSkillId.value = id
  idem.invalidate()
}

// ---------------- 会话列表 ----------------

const conversations = ref<IAgentConversation[]>([])
const listPage = ref(0)
const listPages = ref(0)
const listLoading = ref(false)
const activeId = ref('')

async function loadConversations(reset = false) {
  if (listLoading.value) return
  listLoading.value = true
  const page = reset ? 1 : listPage.value + 1
  try {
    const res = await agentConversations({ page, size: LIST_SIZE })
    const rows = res.data?.data ?? []
    if (reset) {
      conversations.value = rows
    } else {
      const seen = new Set(conversations.value.map((c) => c.agentConversationId))
      conversations.value.push(...rows.filter((c) => !seen.has(c.agentConversationId)))
    }
    listPage.value = page
    listPages.value = res.data?.pages ?? 0
  } catch (err) {
    reportError(err)
  } finally {
    listLoading.value = false
  }
}

function newConversation() {
  if (streaming.value) return
  activeId.value = ''
  items.value = []
  msgPage.value = 0
  msgSeq++
  msgLoading.value = false
  idem.invalidate()
}

// 改名（列表项内联编辑）
const editingId = ref('')
const editingTitle = ref('')
let renaming = false

function startRename(c: IAgentConversation) {
  editingId.value = c.agentConversationId
  editingTitle.value = c.title
}

async function commitRename(c: IAgentConversation) {
  if (renaming || editingId.value !== c.agentConversationId) return
  const title = editingTitle.value.trim()
  if (!title || title === c.title) {
    editingId.value = ''
    return
  }
  renaming = true
  try {
    await agentRenameConversation(c.agentConversationId, title)
    c.title = title
    editingId.value = ''
  } catch (err) {
    reportError(err)
  } finally {
    renaming = false
  }
}

function confirmDelete(c: IAgentConversation) {
  dialog.warning({
    title: '删除对话',
    content: '确定删除这个对话？',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await agentDeleteConversation(c.agentConversationId)
        conversations.value = conversations.value.filter((x) => x.agentConversationId !== c.agentConversationId)
        if (activeId.value === c.agentConversationId) newConversation()
      } catch (err) {
        reportError(err)
        return false
      }
    },
  })
}

const MENU_OPTIONS = [
  { label: '重命名', key: 'rename' },
  { label: '删除', key: 'delete' },
]

function onMenu(key: string, c: IAgentConversation) {
  if (key === 'rename') startRename(c)
  else if (key === 'delete') confirmDelete(c)
}

// ---------------- 消息 ----------------

interface ChatItem {
  key: string
  role: 'user' | 'assistant'
  text: string
  reply: IAgentReply
  /** 本条回复的流仍在进行 */
  live?: boolean
  stopped?: boolean
  /** 受理前失败：可用同一条内容重试 */
  retryContent?: string
}

const items = ref<ChatItem[]>([])
const msgPage = ref(0)
const msgLoading = ref(false)
const listEl = ref<HTMLElement | null>(null)
let msgSeq = 0
let localKey = 0

function toItem(m: IAgentMessage): ChatItem | null {
  if (m.role === 'user') {
    if (m.hidden) return null
    return { key: `m${m.id}`, role: 'user', text: typeof m.content === 'string' ? m.content : '', reply: emptyReply() }
  }
  if (m.role === 'assistant') {
    const reply = m.sseEvents ? replyFromFrames(m.sseEvents) : emptyReply()
    if (!m.sseEvents && typeof m.content === 'string') reply.text = m.content
    return { key: `m${m.id}`, role: 'assistant', text: '', reply }
  }
  return null
}

function scrollToBottom() {
  void nextTick(() => {
    const el = listEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

async function fetchMessagePage(id: string, page: number) {
  const res = await agentMessages(id, { page, size: MSG_SIZE })
  return {
    pages: res.data?.pages ?? 0,
    rows: (res.data?.data ?? []).map(toItem).filter((x): x is ChatItem => !!x),
  }
}

/** 消息按顺序号升序分页：先取总页数，再从最后一页往前加载 */
async function selectConversation(id: string) {
  if (streaming.value || id === activeId.value) return
  activeId.value = id
  items.value = []
  msgPage.value = 0
  idem.invalidate()
  const seq = ++msgSeq
  msgLoading.value = true
  try {
    const first = await fetchMessagePage(id, 1)
    if (seq !== msgSeq) return
    if (first.pages <= 1) {
      items.value = first.rows
      msgPage.value = 1
    } else {
      const last = await fetchMessagePage(id, first.pages)
      if (seq !== msgSeq) return
      items.value = last.rows
      msgPage.value = first.pages
    }
    scrollToBottom()
  } catch (err) {
    if (seq === msgSeq) reportError(err)
  } finally {
    if (seq === msgSeq) msgLoading.value = false
  }
}

async function loadEarlier() {
  if (msgLoading.value || msgPage.value <= 1 || !activeId.value) return
  const id = activeId.value
  const seq = msgSeq
  msgLoading.value = true
  try {
    const prev = await fetchMessagePage(id, msgPage.value - 1)
    if (seq !== msgSeq) return
    items.value = [...prev.rows, ...items.value]
    msgPage.value -= 1
  } catch (err) {
    reportError(err)
  } finally {
    if (seq === msgSeq) msgLoading.value = false
  }
}

// ---------------- 发送 / 流 / 停止 ----------------

const draft = ref('')
const streaming = ref(false)
const stopping = ref(false)
let controller: AbortController | null = null
let streamConvId = ''

function onDraftInput(v: string) {
  draft.value = v
  // 用户改了内容：上次结果未知的幂等身份作废
  idem.invalidate()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    void send(draft.value)
  }
}

async function ensureConversation(content: string): Promise<string> {
  if (activeId.value) return activeId.value
  const res = await agentCreateConversation({ category: 'chat', title: content.slice(0, 30) })
  const id = res.data.conversationId
  activeId.value = id
  msgSeq++
  conversations.value.unshift({
    agentConversationId: id,
    title: content.slice(0, 30),
    meta: null,
    messageTotal: 0,
    lastMessage: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
  return id
}

function bumpConversation(id: string) {
  const idx = conversations.value.findIndex((c) => c.agentConversationId === id)
  if (idx < 0) return
  const [c] = conversations.value.splice(idx, 1)
  if (!c) return
  c.updatedAt = new Date().toISOString()
  conversations.value.unshift(c)
}

async function send(raw: string) {
  const content = raw.trim()
  if (!content || streaming.value) return
  streaming.value = true

  let conversationId: string
  try {
    conversationId = await ensureConversation(content)
  } catch (err) {
    reportError(err)
    streaming.value = false
    return
  }

  const requestId = idem.take()
  draft.value = ''
  const user = reactive<ChatItem>({ key: `l${++localKey}`, role: 'user', text: content, reply: emptyReply() })
  const bot = reactive<ChatItem>({
    key: `l${++localKey}`,
    role: 'assistant',
    text: '',
    reply: emptyReply(),
    live: true,
  })
  items.value.push(user, bot)
  scrollToBottom()

  streamConvId = conversationId
  controller = new AbortController()
  let accepted = false
  try {
    await agentStream(
      {
        conversationId,
        content,
        ...(selectedSkillId.value ? { agentSkillId: selectedSkillId.value } : {}),
      },
      {
        requestId,
        signal: controller.signal,
        onFrame: (frame) => {
          if (frame.event === 'START') {
            accepted = true
            idem.settle()
          }
          applyFrame(bot.reply, frame)
          scrollToBottom()
        },
      },
    )
    // 受理前拒绝只有一帧 ERROR：确定失败，下次换新 id
    if (!accepted) {
      idem.settle()
      if (bot.reply.error) bot.retryContent = content
    }
  } catch (err) {
    if ((err as any)?.name !== 'AbortError') {
      bot.reply.error = errorText(err)
      if (!accepted) {
        idem.fail(err)
        bot.retryContent = content
      }
    }
  } finally {
    bot.live = false
    controller = null
    streaming.value = false
    stopping.value = false
    bumpConversation(conversationId)
  }
}

/** 重试：去掉失败的这一问一答，用原内容重发（结果未知时沿用原 X-Request-Id） */
function retry(item: ChatItem) {
  const content = item.retryContent
  if (!content || streaming.value) return
  const idx = items.value.indexOf(item)
  if (idx > 0) items.value.splice(idx - 1, 2)
  void send(content)
}

async function stop() {
  if (!streaming.value || stopping.value) return
  stopping.value = true
  try {
    await agentCancel(streamConvId)
  } catch (err) {
    reportError(err)
  } finally {
    const live = items.value.find((i) => i.live)
    if (live) live.stopped = true
    controller?.abort()
  }
}

onMounted(() => {
  void loadSkills()
  void loadConversations(true)
})

onUnmounted(() => controller?.abort())
</script>

<template>
  <n-config-provider :theme-overrides="llTheme" abstract>
    <div class="grid h-full min-h-0 gap-12px p-12px bg-page text-ink grid-cols-[280px_minmax(0,1fr)]">
      <!-- 左：会话列表 -->
      <section class="ll-card flex min-h-0 flex-col overflow-hidden" aria-label="对话列表">
        <div class="flex flex-none items-center justify-between gap-8px pt-14px px-14px pb-10px">
          <h1 class="m-0 text-15px font-600 text-ink">智能体</h1>
          <button
            type="button"
            :disabled="streaming"
            :class="['ll-btn-primary h-30px px-14px text-13px', FOCUS]"
            @click="newConversation"
          >
            新建对话
          </button>
        </div>
        <ul class="m-0 flex-1 min-h-0 list-none overflow-y-auto px-8px pb-10px">
          <li v-for="c in conversations" :key="c.agentConversationId" class="mb-4px">
            <div
              :class="[
                'group flex items-center gap-6px rounded-8px px-10px py-8px border border-solid',
                activeId === c.agentConversationId
                  ? 'bg-violet-soft border-violet-line'
                  : 'border-transparent hover:bg-surface2',
              ]"
            >
              <n-input
                v-if="editingId === c.agentConversationId"
                v-model:value="editingTitle"
                size="small"
                :maxlength="120"
                autofocus
                aria-label="对话标题"
                @keydown.enter.prevent="commitRename(c)"
                @keydown.esc.prevent="editingId = ''"
                @blur="commitRename(c)"
              />
              <button
                v-else
                type="button"
                :disabled="streaming && activeId !== c.agentConversationId"
                :aria-current="activeId === c.agentConversationId ? 'true' : undefined"
                :class="[
                  'min-w-0 flex-1 border-none bg-transparent p-0 text-left cursor-pointer disabled:cursor-not-allowed',
                  FOCUS,
                ]"
                @click="selectConversation(c.agentConversationId)"
              >
                <span
                  :class="[
                    'block truncate text-13px',
                    activeId === c.agentConversationId ? 'text-violet-ink font-600' : 'text-ink',
                  ]"
                >
                  {{ c.title }}
                </span>
                <span class="mt-2px block text-11px text-muted">{{ fmtTime(c.updatedAt || c.createdAt) }}</span>
              </button>
              <n-dropdown
                v-if="editingId !== c.agentConversationId"
                trigger="click"
                :options="MENU_OPTIONS"
                @select="(key: string | number) => onMenu(String(key), c)"
              >
                <button
                  type="button"
                  aria-label="更多操作"
                  :class="[
                    'grid h-24px w-24px flex-none place-items-center rounded-4px border-none bg-transparent text-muted cursor-pointer hover:(bg-surface3 text-ink)',
                    FOCUS,
                  ]"
                >
                  <svg class="h-14px w-14px" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <circle cx="5" cy="12" r="1.8" />
                    <circle cx="12" cy="12" r="1.8" />
                    <circle cx="19" cy="12" r="1.8" />
                  </svg>
                </button>
              </n-dropdown>
            </div>
          </li>
          <li v-if="!conversations.length && !listLoading" class="ll-empty py-24px">暂无对话</li>
          <li v-if="listLoading" class="flex justify-center py-12px"><n-spin size="small" /></li>
          <li v-else-if="listPage < listPages" class="py-6px text-center">
            <button
              type="button"
              :class="['ll-link border-none bg-transparent', FOCUS]"
              @click="loadConversations(false)"
            >
              加载更多
            </button>
          </li>
        </ul>
      </section>

      <!-- 右：对话 -->
      <section class="ll-card flex min-h-0 flex-col overflow-hidden" aria-label="对话">
        <div
          ref="listEl"
          role="log"
          :aria-live="streaming ? 'polite' : 'off'"
          :aria-busy="streaming"
          class="flex-1 min-h-0 overflow-y-auto px-20px py-16px"
        >
          <div v-if="msgPage > 1" class="mb-12px text-center">
            <button
              type="button"
              :disabled="msgLoading"
              :class="['ll-link border-none bg-transparent', FOCUS]"
              @click="loadEarlier"
            >
              加载更多
            </button>
          </div>
          <div v-if="msgLoading && !items.length" class="flex justify-center py-40px"><n-spin size="small" /></div>
          <div v-else-if="!items.length" class="ll-empty py-80px">暂无消息</div>

          <div
            v-for="item in items"
            :key="item.key"
            :class="['mb-14px flex', item.role === 'user' ? 'justify-end' : 'justify-start']"
          >
            <div
              v-if="item.role === 'user'"
              class="max-w-[75%] whitespace-pre-wrap break-words rounded-10px bg-violet-soft px-12px py-8px text-14px text-ink"
            >
              {{ item.text }}
            </div>
            <div
              v-else
              class="max-w-[85%] rounded-10px border border-solid border-line bg-surface2 px-12px py-8px text-14px text-ink"
            >
              <p v-if="item.reply.thinking" class="m-0 mb-6px whitespace-pre-wrap break-words text-12px text-muted">
                {{ item.reply.thinking }}
              </p>
              <ul v-if="item.reply.tools.length" class="m-0 mb-6px flex list-none flex-wrap gap-6px p-0">
                <li
                  v-for="(t, i) in item.reply.tools"
                  :key="i"
                  :class="['ll-chip', t.status === 'failed' ? 'll-chip-error' : 'll-chip-success']"
                  :title="t.message"
                >
                  {{ t.name }}
                </li>
              </ul>
              <div v-if="item.reply.text" class="whitespace-pre-wrap break-words">{{ item.reply.text }}</div>
              <span v-else-if="item.live" class="animate-pulse text-muted" aria-label="生成中">…</span>
              <div v-if="item.stopped" class="mt-6px text-12px text-muted">已停止</div>
              <div v-if="item.reply.error" role="alert" class="mt-6px flex items-center gap-8px">
                <span class="ll-chip ll-chip-error">{{ item.reply.error }}</span>
                <button
                  v-if="item.retryContent && !streaming"
                  type="button"
                  :class="['ll-link border-none bg-transparent', FOCUS]"
                  @click="retry(item)"
                >
                  重试
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="flex-none border-t border-solid border-line-soft px-14px pt-10px pb-12px">
          <div
            v-if="skills.length"
            class="mb-8px flex max-h-64px flex-wrap gap-6px overflow-y-auto"
            role="group"
            aria-label="技能"
          >
            <button
              v-for="s in skills"
              :key="s.agentSkillId"
              type="button"
              :title="s.description"
              :aria-pressed="selectedSkillId === s.agentSkillId"
              :disabled="streaming"
              :class="['ll-pill', selectedSkillId === s.agentSkillId ? 'll-pill-active' : '', FOCUS]"
              @click="pickSkill(s.agentSkillId)"
            >
              {{ s.title }}
            </button>
          </div>
          <div class="flex items-end gap-10px">
            <n-input
              :value="draft"
              type="textarea"
              :autosize="{ minRows: 2, maxRows: 6 }"
              :maxlength="12000"
              :disabled="streaming"
              placeholder="输入消息，Enter 发送，Shift+Enter 换行"
              aria-label="输入消息"
              @update:value="onDraftInput"
              @keydown="onKeydown"
            />
            <button
              v-if="streaming"
              type="button"
              :disabled="stopping"
              :class="[
                'inline-flex h-36px flex-none items-center justify-center rounded-999px border border-solid border-line-strong bg-white px-18px text-14px text-ink cursor-pointer hover:border-violet-line disabled:cursor-not-allowed',
                FOCUS,
              ]"
              @click="stop"
            >
              停止
            </button>
            <button
              v-else
              type="button"
              :disabled="!draft.trim()"
              :class="['ll-btn-primary h-36px flex-none px-18px', FOCUS]"
              @click="send(draft)"
            >
              发送
            </button>
          </div>
        </div>
      </section>
    </div>
  </n-config-provider>
</template>
