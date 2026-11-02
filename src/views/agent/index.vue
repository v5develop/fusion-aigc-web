<script setup lang="ts">
/**
 * 智能体（Java /api/v1/agent/*）：左侧会话栏（分页 / 新建 / 改名 / 删除 / 本地搜索 / 收起），
 * 右侧顶栏 + 消息流（历史消息 + SSE 流式回复 + 停止）+ 底部输入框（技能选择在工具栏）。
 *
 * <p>技能语义照 StreamRequest.agentSkillId：技能决定本轮的提示词、工具集与计费，是每轮请求带的 id，
 * 不是一段可预填的文字；目录非空（v2 已开放）时必须带一条，界面默认选中第一条。
 * 目录为空时不能带（旧链路有值即拒）。workflow 形态的技能选进对话会被拒，不展示。
 *
 * <p>计费与重试：流式对话受理即预扣。客户端不自动重试；受理前结果未知（断网 / 超时）时
 * 沿用同一个 X-Request-Id（服务端据它幂等），用户点「重试」才重发；确定失败或已受理则换新 id。
 */
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'
import { NConfigProvider, NDropdown, NImage, NInput, NSpin, useDialog, useMessage } from 'naive-ui'
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

/** 界面上尚无对应能力的入口：置灰 + 悬停提示 */
const SOON = '即将开放'

/** 线条图标（24×24 viewBox，stroke 绘制） */
const ICON = {
  sparkle:
    'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  plus: 'M12 5v14M5 12h14',
  chevronLeft: 'M15 18l-6-6 6-6',
  chevronRight: 'M9 18l6-6-6-6',
  chevronDown: 'M6 9l6 6 6-6',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM20 20l-3.5-3.5',
  bag: 'M6 7h12l-1 13H7zM9 7a3 3 0 0 1 6 0',
  canvas: 'M4 4h16v16H4zM4 10h16M10 10v10',
  share: 'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 3v13M7 8l5-5 5 5',
  checkCircle: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM8 12l3 3 5-6',
  xCircle: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM9 9l6 6M15 9l-6 6',
  x: 'M6 6l12 12M18 6L6 18',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
} as const

const HEADER_ACTIONS = [
  { label: '一键铺货', icon: ICON.bag },
  { label: '在画布中打开', icon: ICON.canvas },
  { label: '分享', icon: ICON.share },
]

/** LocalDateTime 出网可能是 ISO 串或数组 */
function toDate(v: unknown): Date | null {
  if (!v) return null
  if (Array.isArray(v)) {
    const [y = 1970, mo = 1, d = 1, h = 0, mi = 0] = v as number[]
    return new Date(y, mo - 1, d, h, mi)
  }
  const d = new Date(String(v).replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? null : d
}

/** 今天 HH:mm / 昨天 HH:mm / MM月DD日 */
function dayLabel(v: unknown): string {
  const d = toDate(v)
  if (!d) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.floor((today.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86400000)
  if (diff === 0) return `今天 ${p(d.getHours())}:${p(d.getMinutes())}`
  if (diff === 1) return `昨天 ${p(d.getHours())}:${p(d.getMinutes())}`
  return `${p(d.getMonth() + 1)}月${p(d.getDate())}日`
}

/** 每轮落一条用户消息 + 一条助手消息（messageTotal 两条都计），轮数按二者折半向上取整 */
function roundsOf(c: IAgentConversation | undefined): number {
  return c ? Math.ceil((c.messageTotal || 0) / 2) : 0
}

function versionLabel(s: IAgentSkill | undefined): string {
  const v = s?.version?.trim()
  if (!v) return ''
  return /^v/i.test(v) ? v : `v${v}`
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

const selectedSkill = computed(() => skills.value.find((s) => s.agentSkillId === selectedSkillId.value))
const skillOptions = computed(() =>
  skills.value.map((s) => ({ key: s.agentSkillId, label: [s.title, versionLabel(s)].filter(Boolean).join(' ') })),
)

// ---------------- 会话列表 ----------------

const conversations = ref<IAgentConversation[]>([])
const listPage = ref(0)
const listPages = ref(0)
const listTotal = ref(0)
const listLoading = ref(false)
const activeId = ref('')
const sidebarCollapsed = ref(false)
const keyword = ref('')

/** 只在已加载的会话里按标题 / 摘要过滤（列表接口没有搜索参数） */
const visibleConversations = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return conversations.value
  return conversations.value.filter(
    (c) => c.title?.toLowerCase().includes(k) || (c.lastMessage ?? '').toLowerCase().includes(k),
  )
})

const activeConversation = computed(() => conversations.value.find((c) => c.agentConversationId === activeId.value))
const headerMeta = computed(() => {
  const parts = [selectedSkill.value?.title, versionLabel(selectedSkill.value)]
  if (activeConversation.value) parts.push(`${roundsOf(activeConversation.value)} 轮`)
  return parts.filter(Boolean).join(' · ')
})

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
    listTotal.value = res.data?.total ?? conversations.value.length
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
        listTotal.value = Math.max(0, listTotal.value - 1)
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
  /** 用户消息附带的图片（历史消息的 imageUrls） */
  images?: string[]
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
    return {
      key: `m${m.id}`,
      role: 'user',
      text: typeof m.content === 'string' ? m.content : '',
      images: (m.imageUrls ?? []).filter(Boolean),
      reply: emptyReply(),
    }
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
  listTotal.value += 1
  return id
}

function bumpConversation(id: string, accepted = false) {
  const idx = conversations.value.findIndex((c) => c.agentConversationId === id)
  if (idx < 0) return
  const [c] = conversations.value.splice(idx, 1)
  if (!c) return
  c.updatedAt = new Date().toISOString()
  // 受理后服务端落了本轮的用户与助手消息：本地计数同步，轮数展示不必等刷新
  if (accepted) c.messageTotal = (c.messageTotal || 0) + 2
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
    bumpConversation(conversationId, accepted)
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
    <div class="flex h-full min-h-0 bg-page text-ink">
      <!-- 左：会话栏 -->
      <aside
        v-if="sidebarCollapsed"
        class="flex w-52px flex-none flex-col items-center gap-8px border-r border-solid border-line bg-white py-14px"
        aria-label="对话列表"
      >
        <button
          type="button"
          aria-label="展开会话列表"
          :class="[
            'grid h-28px w-28px place-items-center rounded-8px border border-solid border-line bg-white text-muted cursor-pointer hover:(text-ink border-line-strong)',
            FOCUS,
          ]"
          @click="sidebarCollapsed = false"
        >
          <svg
            class="h-14px w-14px"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path :d="ICON.chevronRight" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="新建"
          :disabled="streaming"
          :class="[
            'grid h-28px w-28px place-items-center rounded-999px border border-solid border-violet-line bg-white text-violet-ink cursor-pointer hover:bg-violet-soft disabled:(cursor-not-allowed opacity-50)',
            FOCUS,
          ]"
          @click="newConversation"
        >
          <svg
            class="h-14px w-14px"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path :d="ICON.plus" />
          </svg>
        </button>
      </aside>
      <aside
        v-else
        class="flex w-255px flex-none min-h-0 flex-col border-r border-solid border-line bg-white"
        aria-label="对话列表"
      >
        <div class="flex flex-none items-center gap-8px px-14px pt-14px pb-10px">
          <h1 class="m-0 flex flex-1 items-baseline gap-4px text-15px font-600 text-ink">
            会话<span class="text-12px font-400 text-muted">{{ listTotal }}</span>
          </h1>
          <button
            type="button"
            :disabled="streaming"
            :class="[
              'inline-flex h-26px items-center gap-2px rounded-999px border border-solid border-violet-line bg-white px-10px text-12px text-violet-ink cursor-pointer hover:bg-violet-soft disabled:(cursor-not-allowed opacity-50)',
              FOCUS,
            ]"
            @click="newConversation"
          >
            <svg
              class="h-12px w-12px"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path :d="ICON.plus" />
            </svg>
            新建
          </button>
          <button
            type="button"
            aria-label="收起会话列表"
            :class="[
              'grid h-26px w-26px place-items-center rounded-8px border border-solid border-line bg-white text-muted cursor-pointer hover:(text-ink border-line-strong)',
              FOCUS,
            ]"
            @click="sidebarCollapsed = true"
          >
            <svg
              class="h-14px w-14px"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path :d="ICON.chevronLeft" />
            </svg>
          </button>
        </div>
        <div class="flex-none px-14px pb-10px">
          <n-input v-model:value="keyword" size="small" clearable placeholder="搜索会话" aria-label="搜索会话">
            <template #prefix>
              <svg
                class="h-14px w-14px text-muted"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
              >
                <path :d="ICON.search" />
              </svg>
            </template>
          </n-input>
        </div>
        <ul class="m-0 flex-1 min-h-0 list-none overflow-y-auto px-8px pb-10px">
          <li v-for="c in visibleConversations" :key="c.agentConversationId" class="mb-4px">
            <div
              :class="[
                'group relative flex items-center gap-10px rounded-12px border border-solid px-8px py-8px',
                activeId === c.agentConversationId
                  ? 'bg-violet-soft border-violet-line'
                  : 'border-transparent hover:bg-surface2',
              ]"
            >
              <span
                class="grid h-40px w-40px flex-none place-items-center rounded-8px bg-violet-soft-2 text-violet"
                aria-hidden="true"
              >
                <svg
                  class="h-18px w-18px"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linejoin="round"
                >
                  <path :d="ICON.sparkle" />
                </svg>
              </span>
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
                  'flex min-w-0 flex-1 items-start gap-8px border-none bg-transparent p-0 text-left cursor-pointer disabled:cursor-not-allowed',
                  FOCUS,
                ]"
                @click="selectConversation(c.agentConversationId)"
              >
                <span class="min-w-0 flex-1">
                  <span
                    :class="[
                      'block truncate text-13px font-600',
                      activeId === c.agentConversationId ? 'text-violet-ink' : 'text-ink',
                    ]"
                  >
                    {{ c.title }}
                  </span>
                  <span v-if="c.lastMessage" class="mt-2px block truncate text-12px text-muted">{{
                    c.lastMessage
                  }}</span>
                </span>
                <span class="flex flex-none flex-col items-end gap-2px text-11px text-muted">
                  <span>{{ dayLabel(c.updatedAt || c.createdAt) }}</span>
                  <span>{{ roundsOf(c) }} 轮</span>
                </span>
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
                    'absolute right-6px top-6px grid h-22px w-22px place-items-center rounded-4px border border-solid border-line bg-white text-muted cursor-pointer opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-ink',
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
          <li v-if="!visibleConversations.length && !listLoading" class="ll-empty py-24px">暂无对话</li>
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
      </aside>

      <!-- 右：对话 -->
      <section class="flex min-w-0 flex-1 min-h-0 flex-col" aria-label="对话">
        <header class="flex flex-none items-center gap-10px border-b border-solid border-line bg-white px-20px py-10px">
          <span
            class="grid h-36px w-36px flex-none place-items-center rounded-12px bg-violet-soft text-violet"
            aria-hidden="true"
          >
            <svg
              class="h-18px w-18px"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linejoin="round"
            >
              <path :d="ICON.sparkle" />
            </svg>
          </span>
          <div class="min-w-0 flex-1">
            <h2 class="m-0 truncate text-15px font-600 text-ink">{{ activeConversation?.title || '智能体' }}</h2>
            <p v-if="headerMeta" class="m-0 mt-2px truncate text-12px text-muted">{{ headerMeta }}</p>
          </div>
          <div class="flex flex-none items-center gap-8px">
            <span v-for="a in HEADER_ACTIONS" :key="a.label" :title="SOON" class="inline-flex">
              <button
                type="button"
                disabled
                class="inline-flex h-28px items-center gap-4px rounded-8px border border-solid border-line bg-white px-10px text-12px text-ink-2 cursor-not-allowed opacity-60"
              >
                <svg
                  class="h-13px w-13px"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <path :d="a.icon" />
                </svg>
                {{ a.label }}
              </button>
            </span>
          </div>
        </header>

        <div
          ref="listEl"
          role="log"
          :aria-live="streaming ? 'polite' : 'off'"
          :aria-busy="streaming"
          class="flex-1 min-h-0 overflow-y-auto px-20px py-20px"
        >
          <div class="mx-auto max-w-[680px]">
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
              :class="['mb-18px flex', item.role === 'user' ? 'justify-end' : 'justify-start gap-10px']"
            >
              <!-- 用户 -->
              <div v-if="item.role === 'user'" class="max-w-[80%] rounded-12px bg-violet-soft px-14px py-10px">
                <div class="whitespace-pre-wrap break-words text-14px text-ink">{{ item.text }}</div>
                <div v-if="item.images?.length" class="mt-8px flex gap-6px">
                  <n-image
                    v-for="(url, i) in item.images.slice(0, 4)"
                    :key="i"
                    :src="url"
                    :width="52"
                    :height="52"
                    object-fit="cover"
                    class="overflow-hidden rounded-8px border border-solid border-violet-line bg-white"
                  />
                </div>
              </div>

              <!-- 助手 -->
              <template v-else>
                <span
                  class="grid h-28px w-28px flex-none place-items-center rounded-999px bg-violet text-white"
                  aria-hidden="true"
                >
                  <svg
                    class="h-14px w-14px"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linejoin="round"
                  >
                    <path :d="ICON.sparkle" />
                  </svg>
                </span>
                <div class="min-w-0 flex-1 pt-4px text-14px text-ink">
                  <p v-if="item.reply.thinking" class="m-0 mb-8px whitespace-pre-wrap break-words text-12px text-muted">
                    {{ item.reply.thinking }}
                  </p>
                  <div
                    v-if="item.reply.tools.length"
                    class="mb-10px rounded-12px border border-solid border-line bg-white px-14px py-10px"
                  >
                    <div class="mb-6px flex items-center gap-6px text-13px font-600 text-ink">
                      <svg
                        class="h-15px w-15px text-success"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        aria-hidden="true"
                      >
                        <path :d="ICON.checkCircle" />
                      </svg>
                      <span class="flex-1">执行清单</span>
                      <span class="text-12px font-400 text-muted">
                        {{ item.reply.tools.filter((t) => t.status === 'completed').length }} /
                        {{ item.reply.tools.length }}
                      </span>
                    </div>
                    <ul class="m-0 list-none p-0">
                      <li
                        v-for="(t, i) in item.reply.tools"
                        :key="i"
                        :title="t.message"
                        class="flex items-center gap-8px py-4px text-13px"
                      >
                        <svg
                          :class="[
                            'h-14px w-14px flex-none',
                            t.status === 'completed'
                              ? 'text-success'
                              : t.status === 'failed'
                                ? 'text-danger'
                                : 'text-muted',
                          ]"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          aria-hidden="true"
                        >
                          <path :d="t.status === 'failed' ? ICON.xCircle : ICON.checkCircle" />
                        </svg>
                        <span class="min-w-0 flex-1 truncate text-ink">{{ t.name }}</span>
                        <span v-if="t.status === 'completed'" class="flex-none text-12px text-muted">已完成</span>
                        <span v-else-if="t.message" class="max-w-[50%] flex-none truncate text-12px text-danger">
                          {{ t.message }}
                        </span>
                      </li>
                    </ul>
                  </div>
                  <div v-if="item.reply.text" class="whitespace-pre-wrap break-words leading-relaxed">
                    {{ item.reply.text }}
                  </div>
                  <span v-if="item.live" class="mt-4px inline-flex items-center gap-4px" aria-label="生成中">
                    <span class="h-6px w-6px rounded-999px bg-violet animate-pulse" />
                    <span class="h-6px w-6px rounded-999px bg-violet animate-pulse [animation-delay:150ms]" />
                    <span class="h-6px w-6px rounded-999px bg-violet animate-pulse [animation-delay:300ms]" />
                  </span>
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
              </template>
            </div>
          </div>
        </div>

        <!-- 输入框 -->
        <div class="flex-none border-t border-solid border-line bg-white px-20px pt-12px pb-8px">
          <div class="mx-auto max-w-[720px]">
            <div
              class="rounded-14px border border-solid border-line bg-white px-12px pt-10px pb-8px focus-within:border-violet-line"
            >
              <div v-if="selectedSkill" class="mb-6px flex">
                <span
                  class="inline-flex items-center gap-4px rounded-999px border border-solid border-violet-line bg-violet-soft py-2px pl-8px pr-4px text-12px text-violet-ink"
                >
                  <svg
                    class="h-12px w-12px"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path :d="ICON.sparkle" />
                  </svg>
                  {{ selectedSkill.title }}
                </span>
              </div>
              <n-input
                :value="draft"
                type="textarea"
                :bordered="false"
                :autosize="{ minRows: 1, maxRows: 4 }"
                :maxlength="12000"
                :disabled="streaming"
                placeholder="描述你的创作目标、风格方向或产品卖点"
                aria-label="输入消息"
                @update:value="onDraftInput"
                @keydown="onKeydown"
              />
              <div class="mt-6px flex items-center gap-8px">
                <span :title="SOON" class="inline-flex">
                  <button
                    type="button"
                    disabled
                    class="inline-flex h-28px items-center gap-4px rounded-8px border border-solid border-line bg-white px-8px text-12px text-ink-2 cursor-not-allowed opacity-60"
                  >
                    <svg
                      class="h-13px w-13px"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      aria-hidden="true"
                    >
                      <path :d="ICON.image" />
                    </svg>
                    图片 0/4
                  </button>
                </span>
                <n-dropdown
                  v-if="skills.length"
                  trigger="click"
                  :options="skillOptions"
                  :disabled="streaming"
                  @select="(key: string | number) => pickSkill(String(key))"
                >
                  <button
                    type="button"
                    aria-label="技能"
                    :title="selectedSkill?.description"
                    :disabled="streaming"
                    :class="[
                      'inline-flex h-28px max-w-[200px] items-center gap-4px rounded-8px border border-solid border-line bg-white px-8px text-12px text-ink-2 cursor-pointer hover:border-violet-line disabled:cursor-not-allowed',
                      FOCUS,
                    ]"
                  >
                    <span class="truncate">{{ selectedSkill ? selectedSkill.title : '技能' }}</span>
                    <span v-if="versionLabel(selectedSkill)" class="flex-none text-muted">{{
                      versionLabel(selectedSkill)
                    }}</span>
                    <svg
                      class="h-12px w-12px flex-none text-muted"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      aria-hidden="true"
                    >
                      <path :d="ICON.chevronDown" />
                    </svg>
                  </button>
                </n-dropdown>
                <span :title="SOON" class="inline-flex">
                  <button
                    type="button"
                    disabled
                    class="inline-flex h-28px items-center gap-4px rounded-8px border border-solid border-line bg-white px-8px text-12px text-ink-2 cursor-not-allowed opacity-60"
                  >
                    ZH 中文
                    <svg
                      class="h-12px w-12px text-muted"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      aria-hidden="true"
                    >
                      <path :d="ICON.chevronDown" />
                    </svg>
                  </button>
                </span>
                <span class="flex-1" />
                <button
                  v-if="streaming"
                  type="button"
                  :disabled="stopping"
                  :class="[
                    'inline-flex h-32px flex-none items-center justify-center rounded-999px border border-solid border-line-strong bg-white px-16px text-13px text-ink cursor-pointer hover:border-violet-line disabled:cursor-not-allowed',
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
                  :class="['ll-btn-primary h-32px flex-none gap-4px px-16px text-13px', FOCUS]"
                  @click="send(draft)"
                >
                  <svg
                    class="h-14px w-14px"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.2"
                    aria-hidden="true"
                  >
                    <path :d="ICON.arrowUp" />
                  </svg>
                  发送
                </button>
              </div>
            </div>
            <p class="m-0 mt-6px text-center text-11px text-muted">AI 生成内容仅供参考，请仔细甄别</p>
          </div>
        </div>
      </section>
    </div>
  </n-config-provider>
</template>
