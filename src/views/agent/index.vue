<script setup lang="ts">
/**
 * 智能体（Java /api/v1/agent/*）：左侧会话栏（分页 / 新建 / 改名 / 删除 / 本地搜索 / 收起），
 * 右侧顶栏 + 消息流（历史消息 + SSE 流式回复 + 停止）+ 底部输入框（技能选择在工具栏）。
 *
 * <p>技能语义照 StreamRequest.agentSkillId：技能决定本轮的提示词、工具集与计费，是每轮请求带的 id，
 * 不是一段可预填的文字；目录非空（v2 已开放）时必须带一条，界面默认选中第一条；用户移除后不发送。
 * 目录为空时不能带（旧链路有值即拒）。workflow 形态的技能选进对话会被拒，不展示。
 * 选择走「选择技能」弹窗，页签即目录接口的分类键。
 *
 * <p>计费与重试：流式对话受理即预扣。客户端不自动重试；受理前结果未知（断网 / 超时）时
 * 沿用同一个 X-Request-Id（服务端据它幂等），用户点「重试」才重发；确定失败或已受理则换新 id。
 */
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { NConfigProvider, NImage, NInput, NModal, NPopover, NSpin, useDialog, useMessage } from 'naive-ui'
import { llTheme } from '@/views/local-life/theme.ts'
import { toApiError } from '@/api'
import {
  AGENT_LANGUAGES,
  agentCancel,
  agentConversations,
  agentCreateConversation,
  agentDeleteConversation,
  agentMessages,
  agentRenameConversation,
  agentSkills,
  agentStream,
  applyFrame,
  chatSkillGroups,
  emptyReply,
  MY_SKILL_GROUP,
  replyFromFrames,
} from '@/api/agent.ts'
import type { IAgentConversation, IAgentMessage, IAgentReply, IAgentSkill, IAgentSkillGroup } from '@/api/agent.ts'
import { useIdempotentSubmit } from '@/views/studio/hooks.ts'
import AssetPickerModal from '@/views/studio/components/AssetPickerModal/index.vue'
import { useStudioUploader } from '@/views/studio/components/StudioImageUpload/useStudioUploader.ts'

defineOptions({ name: 'agent-chat' })

const message = useMessage()
const dialog = useDialog()

const FOCUS = 'focus-visible:(outline outline-2 outline-violet outline-offset-2)'

/*
 * 原型计算样式（proto-agent-visual-tokens.json）照抄：渐变、内高光、投影与过渡时长 / 曲线不估算。
 * 按钮过渡只有 background 走 cubic-bezier(0.2,0.7,0.2,1)，其余三项是 ease（原型即如此）。
 */
const T_BTN =
  '[transition:background_0.11s_cubic-bezier(0.2,0.7,0.2,1),border-color_0.11s_ease,box-shadow_0.11s_ease,color_0.11s_ease] motion-reduce:transition-none'
const T_ROW =
  '[transition:border-color_0.11s_ease,background_0.11s_ease,box-shadow_0.11s_ease] motion-reduce:transition-none'
/** 「新建」等描边按钮：白→淡紫竖向渐变 + 极浅投影 */
const BTN_SURFACE = 'bg-[linear-gradient(#fff_0%,#f8f3fc_100%)] shadow-[0_1px_2px_rgba(31,35,41,0.043)]'
/** 会话栏 / 对话区面板：顶部白内高光 + 底部灰内描边 + 下投影 */
const PANEL_SHADOW = 'shadow-[inset_0_1px_0_#fff,inset_0_-1px_0_#eff1f3,0_10px_16px_rgba(0,0,0,0.04)]'
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
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  share:
    'M18 3a3 3 0 1 0 0 6a3 3 0 1 0 0-6zM6 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6zM18 15a3 3 0 1 0 0 6a3 3 0 1 0 0-6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  checkCircle: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM8 12l3 3 5-6',
  xCircle: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM9 9l6 6M15 9l-6 6',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5 9-10',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
} as const

const HEADER_ACTIONS = [
  { label: '一键铺货', icon: ICON.grid },
  { label: '在画布中打开', icon: ICON.external },
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

const skillGroups = ref<IAgentSkillGroup[]>([])
const skills = computed(() => skillGroups.value.flatMap((g) => g.skills))
const selectedSkillId = ref('')
const idem = useIdempotentSubmit()

/** 目录非空时服务端拒绝不带技能的一轮：未选技能就不发 */
const SKILL_REQUIRED = '请先选择技能'
const skillMissing = computed(() => skills.value.length > 0 && !selectedSkillId.value)

async function loadSkills() {
  try {
    const res = await agentSkills()
    skillGroups.value = chatSkillGroups(res.data)
    selectedSkillId.value = skills.value[0]?.agentSkillId ?? ''
  } catch {
    // 目录拉失败不挡对话：不带 agentSkillId，服务端要求时会回 ERROR 帧
    skillGroups.value = []
  }
}

function pickSkill(id: string) {
  if (selectedSkillId.value === id) return
  selectedSkillId.value = id
  idem.invalidate()
}

function removeSkill() {
  if (!selectedSkillId.value || streaming.value) return
  selectedSkillId.value = ''
  idem.invalidate()
}

const selectedSkill = computed(() => skills.value.find((s) => s.agentSkillId === selectedSkillId.value))

/** 首字作为技能头像 */
function skillInitial(s: IAgentSkill): string {
  return Array.from(s.title?.trim() || '技')[0] ?? '技'
}

// 选择技能弹窗：分类页签 = 服务端分组（空组已去掉），「我的技能」恒在最后
const skillDialogShow = ref(false)
const skillTab = ref('')
const pendingSkillId = ref('')
const skillPillEl = ref<HTMLButtonElement | null>(null)

const skillTabs = computed<IAgentSkillGroup[]>(() => [
  ...skillGroups.value.filter((g) => g.name !== MY_SKILL_GROUP),
  { name: MY_SKILL_GROUP, skills: skillGroups.value.find((g) => g.name === MY_SKILL_GROUP)?.skills ?? [] },
])
const tabSkills = computed(() => skillTabs.value.find((t) => t.name === skillTab.value)?.skills ?? [])

function openSkillDialog() {
  if (streaming.value) return
  pendingSkillId.value = selectedSkillId.value
  const home = skillTabs.value.find((t) => t.skills.some((s) => s.agentSkillId === selectedSkillId.value))
  skillTab.value = (home ?? skillTabs.value[0])?.name ?? MY_SKILL_GROUP
  skillDialogShow.value = true
}

function confirmSkill() {
  if (!pendingSkillId.value) return
  pickSkill(pendingSkillId.value)
  skillDialogShow.value = false
}

// ---------------- 图片（StreamRequest.imageUrls） ----------------

/** 原型上限 4 张（服务端字段收 9 个，另有账号单次上限，超了回 ERROR 帧） */
const MAX_IMAGES = 4
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp'
const IMAGE_FORMATS = '支持 JPEG / JPG / PNG / WEBP'
const LIMIT_TEXT = `最多上传 ${MAX_IMAGES} 张`

const attachments = ref<string[]>([])
const imageRoom = computed(() => Math.max(0, MAX_IMAGES - attachments.value.length))
const { uploading, uploadFiles } = useStudioUploader()

const IMAGE_TABS = [
  { key: 'local', label: '本地上传', soon: false },
  { key: 'generated', label: '最近生成', soon: false },
  { key: 'upload', label: '最近上传', soon: false },
  // 资产选择器没有「收藏」筛选
  { key: 'favorite', label: '收藏资产', soon: true },
  { key: 'model', label: '模特库', soon: false },
] as const
type ImageTab = (typeof IMAGE_TABS)[number]['key']

const imageDialogShow = ref(false)
const imageTab = ref<ImageTab>('local')
const assetPickerShow = ref(false)
const dragging = ref(false)
const fileInputEl = ref<HTMLInputElement | null>(null)
const imagePillEl = ref<HTMLButtonElement | null>(null)

function addImages(urls: string[]) {
  const fresh = urls.filter((u) => /^https?:\/\//i.test(u) && !attachments.value.includes(u))
  if (!fresh.length) return
  if (imageRoom.value <= 0) {
    message.warning(LIMIT_TEXT)
    return
  }
  attachments.value = [...attachments.value, ...fresh.slice(0, imageRoom.value)]
  idem.invalidate()
}

function removeImage(i: number) {
  if (streaming.value) return
  attachments.value = attachments.value.filter((_, idx) => idx !== i)
  idem.invalidate()
}

function openImageDialog() {
  if (streaming.value) return
  imageTab.value = 'local'
  imageDialogShow.value = true
}

/** 本地 / 粘贴共用：格式按原型四种拦，余量与上传走商拍工作室同一条直传 */
async function uploadLocal(files: File[]) {
  if (!files.length || uploading.value) return
  const picked = files.filter((f) => IMAGE_TYPES.includes(f.type))
  if (picked.length < files.length) message.warning(IMAGE_FORMATS)
  if (!picked.length) return
  let added = 0
  await uploadFiles(picked, imageRoom.value, MAX_IMAGES, (url) => {
    const before = attachments.value.length
    addImages([url])
    if (attachments.value.length > before) added += 1
  })
  if (added && imageDialogShow.value) imageDialogShow.value = false
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  void uploadLocal(files)
}

function onDrop(e: DragEvent) {
  dragging.value = false
  void uploadLocal(Array.from(e.dataTransfer?.files ?? []))
}

function onPaste(e: ClipboardEvent) {
  if (!imageDialogShow.value || assetPickerShow.value) return
  const files = Array.from(e.clipboardData?.items ?? [])
    .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
    .map((it) => it.getAsFile())
    .filter((f): f is File => !!f)
  if (!files.length) return
  e.preventDefault()
  void uploadLocal(files)
}

watch(imageDialogShow, (open) => {
  if (open) document.addEventListener('paste', onPaste)
  else document.removeEventListener('paste', onPaste)
})

function openAssetPicker() {
  if (imageRoom.value <= 0) {
    message.warning(LIMIT_TEXT)
    return
  }
  assetPickerShow.value = true
}

function onAssetSelect(urls: string[]) {
  addImages(urls)
  imageDialogShow.value = false
}

// ---------------- 回答语言（StreamRequest.language） ----------------

const languageCode = ref('ZH')
const languageShow = ref(false)
const languagePillEl = ref<HTMLButtonElement | null>(null)
const selectedLanguage = computed(
  () => AGENT_LANGUAGES.find((l) => l.code === languageCode.value) ?? AGENT_LANGUAGES[0]!,
)

function pickLanguage(code: string) {
  languageShow.value = false
  languagePillEl.value?.focus()
  if (languageCode.value === code) return
  languageCode.value = code
  idem.invalidate()
}

function closeLanguage() {
  languageShow.value = false
  languagePillEl.value?.focus()
}

function onLanguageShow(open: boolean) {
  languageShow.value = open
  if (open) {
    void nextTick(() => {
      document.querySelector<HTMLButtonElement>('#agent-language-panel button[aria-pressed="true"]')?.focus()
    })
  }
}

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
  // 每轮受理后服务端即落库（用户 + 助手各一条），故标「按轮保存」
  if (activeConversation.value) parts.push(`${roundsOf(activeConversation.value)} 轮`, '按轮保存')
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
  /** 重试时随同发送的图片 */
  retryImages?: string[]
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

/** 服务端要求 content 非空（只有表单续答可空），所以有图也得有文字 */
async function send(raw: string, images: string[] = attachments.value) {
  const content = raw.trim()
  if (!content || streaming.value) return
  if (skillMissing.value) {
    message.warning(SKILL_REQUIRED)
    return
  }
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
  const imageUrls = [...images]
  const language = selectedLanguage.value.value
  draft.value = ''
  const user = reactive<ChatItem>({
    key: `l${++localKey}`,
    role: 'user',
    text: content,
    images: imageUrls,
    reply: emptyReply(),
  })
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
        ...(imageUrls.length ? { imageUrls } : {}),
        ...(language ? { language } : {}),
      },
      {
        requestId,
        signal: controller.signal,
        onFrame: (frame) => {
          if (frame.event === 'START') {
            accepted = true
            idem.settle()
            // 受理才清空已附图片；失败时留着，便于改后重发
            attachments.value = []
          }
          applyFrame(bot.reply, frame)
          scrollToBottom()
        },
      },
    )
    // 受理前拒绝只有一帧 ERROR：确定失败，下次换新 id
    if (!accepted) {
      idem.settle()
      if (bot.reply.error) {
        bot.retryContent = content
        bot.retryImages = imageUrls
      }
    }
  } catch (err) {
    if ((err as any)?.name !== 'AbortError') {
      bot.reply.error = errorText(err)
      if (!accepted) {
        idem.fail(err)
        bot.retryContent = content
        bot.retryImages = imageUrls
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
  if (skillMissing.value) {
    message.warning(SKILL_REQUIRED)
    return
  }
  const idx = items.value.indexOf(item)
  if (idx > 0) items.value.splice(idx - 1, 2)
  void send(content, item.retryImages ?? [])
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

onUnmounted(() => {
  controller?.abort()
  document.removeEventListener('paste', onPaste)
})
</script>

<template>
  <n-config-provider :theme-overrides="llTheme" abstract>
    <div class="flex h-full min-h-0 bg-page text-ink">
      <!-- 左：会话栏 -->
      <aside
        v-if="sidebarCollapsed"
        :class="[
          'flex w-52px flex-none flex-col items-center gap-8px border-r border-solid border-line bg-white py-14px',
          PANEL_SHADOW,
        ]"
        aria-label="对话列表"
      >
        <button
          type="button"
          aria-label="展开会话列表"
          :class="[
            'grid h-28px w-28px place-items-center rounded-8px border border-solid border-line bg-white text-muted cursor-pointer hover:(text-ink border-line-strong)',
            T_BTN,
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
            'grid h-28px w-28px place-items-center rounded-999px border border-solid border-violet-line text-violet-ink cursor-pointer hover:(bg-none bg-violet-soft) disabled:(cursor-not-allowed opacity-50)',
            BTN_SURFACE,
            T_BTN,
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
        :class="['flex w-260px flex-none min-h-0 flex-col border-r border-solid border-line bg-white', PANEL_SHADOW]"
        aria-label="对话列表"
      >
        <div class="flex flex-none items-center gap-6px px-14px pt-16px pb-10px">
          <h1 class="m-0 flex flex-1 items-baseline gap-6px text-15px font-600 text-ink">
            会话<span class="text-12px font-400 text-muted">{{ listTotal }}</span>
          </h1>
          <button
            type="button"
            :disabled="streaming"
            :class="[
              'inline-flex h-28px items-center gap-4px rounded-6px border border-solid border-line px-10px text-12px text-violet-ink cursor-pointer hover:(border-violet-line bg-none bg-violet-soft) disabled:(cursor-not-allowed opacity-50)',
              BTN_SURFACE,
              T_BTN,
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
              'grid h-28px w-28px place-items-center rounded-6px border-none bg-transparent text-muted cursor-pointer hover:(bg-surface2 text-ink)',
              T_BTN,
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
          <n-input
            v-model:value="keyword"
            size="small"
            clearable
            placeholder="搜索会话"
            aria-label="搜索会话"
            class="shadow-[inset_0_1px_2px_rgba(31,35,41,0.055),inset_0_0_0_1px_rgba(255,255,255,0.7)] ![transition:border-color_0.11s_ease,box-shadow_0.11s_ease] motion-reduce:!transition-none"
          >
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
        <ul class="m-0 flex-1 min-h-0 list-none overflow-y-auto px-10px pb-10px">
          <li v-for="c in visibleConversations" :key="c.agentConversationId" class="mb-6px">
            <div
              :class="[
                'flex items-start gap-10px rounded-10px border border-solid p-10px',
                activeId === c.agentConversationId
                  ? 'border-violet-line bg-[linear-gradient(#fff,#f8f3fc)] shadow-[0_1px_2px_rgba(31,35,41,0.05)]'
                  : 'border-transparent hover:bg-surface2',
                T_ROW,
              ]"
            >
              <!-- 缩略图：会话列表接口暂无封面字段，先用星芒占位块；有封面后在此换成图片 -->
              <span
                class="grid h-40px w-40px flex-none place-items-center rounded-8px border border-solid border-line bg-surface2 text-violet"
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
              <div class="flex min-w-0 flex-1 flex-col gap-4px">
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
                        'block truncate text-14px font-600 leading-20px',
                        activeId === c.agentConversationId ? 'text-violet-ink' : 'text-ink',
                      ]"
                    >
                      {{ c.title }}
                    </span>
                    <span v-if="c.lastMessage" class="mt-2px block truncate text-12px text-muted">{{
                      c.lastMessage
                    }}</span>
                  </span>
                  <span class="flex flex-none flex-col items-end gap-2px text-12px leading-20px text-muted">
                    <span>{{ dayLabel(c.updatedAt || c.createdAt) }}</span>
                    <span>· {{ roundsOf(c) }} 轮</span>
                  </span>
                </button>
                <div v-if="editingId !== c.agentConversationId" class="flex justify-end gap-2px">
                  <button
                    type="button"
                    :aria-label="`重命名：${c.title}`"
                    title="重命名"
                    :class="[
                      'grid h-22px w-22px place-items-center rounded-6px border-none bg-transparent text-muted cursor-pointer hover:(bg-violet-soft-2 text-violet-ink)',
                      T_BTN,
                      FOCUS,
                    ]"
                    @click="startRename(c)"
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
                      <path :d="ICON.edit" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    :aria-label="`删除：${c.title}`"
                    title="删除"
                    :class="[
                      'grid h-22px w-22px place-items-center rounded-6px border-none bg-transparent text-muted cursor-pointer hover:(bg-violet-soft-2 text-violet-ink)',
                      T_BTN,
                      FOCUS,
                    ]"
                    @click="confirmDelete(c)"
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
                      <path :d="ICON.trash" />
                    </svg>
                  </button>
                </div>
              </div>
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
      <section :class="['flex min-w-0 flex-1 min-h-0 flex-col', PANEL_SHADOW]" aria-label="对话">
        <header
          class="flex h-64px flex-none items-center gap-12px border-b border-solid border-line bg-[linear-gradient(#fff,#fbf7fe)] px-20px shadow-[0_1px_2px_rgba(31,35,41,0.05)]"
        >
          <span
            class="grid h-40px w-40px flex-none place-items-center rounded-10px bg-[linear-gradient(135deg,#f6effa,#efe6f5)] text-violet shadow-[inset_0_1px_0_#fff]"
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
            <h2 class="m-0 truncate text-16px font-600 leading-22px text-ink">
              {{ activeConversation?.title || '智能体' }}
            </h2>
            <p v-if="headerMeta" class="m-0 mt-2px truncate text-12px leading-18px text-muted">{{ headerMeta }}</p>
          </div>
          <div class="flex flex-none items-center gap-8px">
            <span v-for="a in HEADER_ACTIONS" :key="a.label" :title="SOON" class="inline-flex">
              <button
                type="button"
                disabled
                :class="[
                  'inline-flex h-32px items-center gap-6px rounded-8px border border-solid border-line bg-[linear-gradient(#fff,#fbfcfc)] px-12px text-12px text-ink-2 cursor-not-allowed opacity-60 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(31,35,41,0.04),0_1px_2px_rgba(31,35,41,0.05)]',
                  T_BTN,
                ]"
              >
                <svg
                  class="h-14px w-14px"
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
          <div class="mx-auto max-w-[760px]">
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
              <div
                v-if="item.role === 'user'"
                class="max-w-[80%] rounded-14px border border-solid border-violet-line bg-[linear-gradient(#f8f3fc,#f2ebf8)] px-14px py-10px shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]"
              >
                <div class="whitespace-pre-wrap break-words text-14px leading-22px text-ink">{{ item.text }}</div>
                <div v-if="item.images?.length" class="mt-8px flex gap-8px">
                  <n-image
                    v-for="(url, i) in item.images.slice(0, 4)"
                    :key="i"
                    :src="url"
                    :width="56"
                    :height="56"
                    object-fit="cover"
                    class="overflow-hidden rounded-8px border border-solid border-violet-line bg-white"
                  />
                </div>
              </div>

              <!-- 助手 -->
              <template v-else>
                <span
                  class="grid h-28px w-28px flex-none place-items-center rounded-999px bg-violet-soft-2 text-violet"
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
                    class="mb-10px rounded-12px border border-solid border-line bg-white px-14px py-10px shadow-[inset_0_1px_2px_rgba(31,35,41,0.035)]"
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
                        class="flex items-center gap-8px py-5px text-13px"
                      >
                        <span
                          :class="[
                            'grid h-16px w-16px flex-none place-items-center rounded-999px',
                            t.status === 'completed'
                              ? 'bg-success-soft text-success'
                              : t.status === 'failed'
                                ? 'bg-danger-soft text-danger'
                                : 'bg-surface3 text-muted',
                          ]"
                          aria-hidden="true"
                        >
                          <svg
                            class="h-10px w-10px"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="3"
                          >
                            <path :d="t.status === 'failed' ? ICON.x : ICON.check" />
                          </svg>
                        </span>
                        <span class="min-w-0 flex-1 truncate text-ink-2">{{ t.name }}</span>
                        <span v-if="t.status === 'completed'" class="flex-none text-12px text-muted">已完成</span>
                        <span v-else-if="t.message" class="max-w-[50%] flex-none truncate text-12px text-danger">
                          {{ t.message }}
                        </span>
                      </li>
                    </ul>
                  </div>
                  <!--
                    TODO(数据驱动)：结果卡「生成图片 N 张」放在这里——标题 + 「下载后为原图画质」提示、
                    4 列图片网格、「多选下载」「预览模板」。流式帧目前不返回生成图片，待后端给出数据后再接入；
                    无数据时不渲染空卡。
                  -->
                  <div v-if="item.reply.text" class="whitespace-pre-wrap break-words leading-relaxed">
                    {{ item.reply.text }}
                  </div>
                  <span v-if="item.live" class="mt-4px inline-flex items-center gap-4px" aria-label="生成中">
                    <span class="h-6px w-6px rounded-999px bg-violet animate-pulse motion-reduce:animate-none" />
                    <span
                      class="h-6px w-6px rounded-999px bg-violet animate-pulse [animation-delay:150ms] motion-reduce:animate-none"
                    />
                    <span
                      class="h-6px w-6px rounded-999px bg-violet animate-pulse [animation-delay:300ms] motion-reduce:animate-none"
                    />
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
        <div class="flex-none border-t border-solid border-line bg-white px-20px pt-12px pb-10px">
          <div class="mx-auto max-w-[760px]">
            <div
              class="rounded-14px border border-solid border-line bg-[linear-gradient(#fbfcfc,#fff)] px-12px pt-10px pb-10px shadow-[inset_0_0_10px_rgba(31,35,41,0.086),inset_0_1px_0_rgba(31,35,41,0.04)] [transition:box-shadow_0.11s_ease,border-color_0.11s_ease] focus-within:border-violet-line motion-reduce:transition-none"
            >
              <div v-if="selectedSkill" class="mb-6px flex">
                <span
                  class="inline-flex h-24px items-center gap-4px rounded-6px border border-solid border-violet-line bg-violet-soft pl-8px pr-4px text-12px text-violet-ink"
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
                  <button
                    type="button"
                    title="移除技能"
                    :aria-label="`移除技能：${selectedSkill.title}`"
                    :disabled="streaming"
                    :class="[
                      'grid h-16px w-16px place-items-center rounded-999px border-none bg-transparent p-0 text-violet-ink cursor-pointer hover:bg-violet-soft-2 disabled:(cursor-not-allowed opacity-50)',
                      FOCUS,
                    ]"
                    @click="removeSkill"
                  >
                    <svg
                      class="h-10px w-10px"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.4"
                      aria-hidden="true"
                    >
                      <path :d="ICON.x" />
                    </svg>
                  </button>
                </span>
              </div>
              <ul v-if="attachments.length" class="m-0 mb-6px flex list-none gap-8px p-0" aria-label="已添加的图片">
                <li v-for="(url, i) in attachments" :key="url" class="relative h-56px w-56px flex-none">
                  <img
                    :src="url"
                    :alt="`图片 ${i + 1}`"
                    class="block h-56px w-56px rounded-8px border border-solid border-line bg-surface2 object-cover"
                  />
                  <button
                    type="button"
                    title="移除图片"
                    :aria-label="`移除图片 ${i + 1}`"
                    :disabled="streaming"
                    :class="[
                      'absolute -right-6px -top-6px grid h-18px w-18px place-items-center rounded-999px border border-solid border-line bg-white p-0 text-ink-2 cursor-pointer hover:text-ink disabled:(cursor-not-allowed opacity-50)',
                      FOCUS,
                    ]"
                    @click="removeImage(i)"
                  >
                    <svg
                      class="h-10px w-10px"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.4"
                      aria-hidden="true"
                    >
                      <path :d="ICON.x" />
                    </svg>
                  </button>
                </li>
              </ul>
              <n-input
                :value="draft"
                type="textarea"
                :bordered="false"
                :autosize="{ minRows: 2, maxRows: 4 }"
                :maxlength="12000"
                :disabled="streaming"
                placeholder="描述你的创作目标、风格方向或产品卖点"
                aria-label="输入消息"
                class="!bg-transparent"
                @update:value="onDraftInput"
                @keydown="onKeydown"
              />
              <div class="mt-6px flex items-center gap-8px">
                <button
                  ref="imagePillEl"
                  type="button"
                  aria-haspopup="dialog"
                  :aria-label="`添加图片，已添加 ${attachments.length}/${MAX_IMAGES}`"
                  :disabled="streaming"
                  :class="[
                    'inline-flex h-28px items-center gap-4px rounded-999px border border-solid bg-white px-10px text-12px cursor-pointer shadow-[0_1px_2px_rgba(31,35,41,0.04)] hover:border-violet-line disabled:(cursor-not-allowed opacity-60)',
                    attachments.length ? 'border-violet-line text-violet-ink' : 'border-line text-ink-2',
                    T_BTN,
                    FOCUS,
                  ]"
                  @click="openImageDialog"
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
                  图片 {{ attachments.length }}/{{ MAX_IMAGES }}
                </button>
                <button
                  v-if="skills.length"
                  ref="skillPillEl"
                  type="button"
                  aria-haspopup="dialog"
                  :aria-label="selectedSkill ? `技能：${selectedSkill.title}，点击更换` : '选择技能'"
                  :title="selectedSkill?.description"
                  :disabled="streaming"
                  :class="[
                    'inline-flex h-28px max-w-[220px] items-center gap-4px rounded-999px border border-solid bg-white px-10px text-12px cursor-pointer shadow-[0_1px_2px_rgba(31,35,41,0.04)] hover:border-violet-line disabled:cursor-not-allowed',
                    selectedSkill ? 'border-line text-ink-2' : 'border-violet-line text-violet-ink',
                    T_BTN,
                    FOCUS,
                  ]"
                  @click="openSkillDialog"
                >
                  <svg
                    class="h-13px w-13px flex-none text-violet"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path :d="ICON.sparkle" />
                  </svg>
                  <span class="truncate">{{ selectedSkill ? selectedSkill.title : '选择技能' }}</span>
                  <span
                    v-if="versionLabel(selectedSkill)"
                    class="flex-none rounded-4px bg-violet-soft-2 px-5px text-11px leading-16px text-violet-ink"
                    >{{ versionLabel(selectedSkill) }}</span
                  >
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
                <n-popover
                  :show="languageShow"
                  trigger="click"
                  placement="top-start"
                  :show-arrow="false"
                  :disabled="streaming"
                  content-class="!p-0"
                  @update:show="onLanguageShow"
                >
                  <template #trigger>
                    <button
                      ref="languagePillEl"
                      type="button"
                      aria-haspopup="dialog"
                      :aria-expanded="languageShow"
                      :aria-label="`回答语言：${selectedLanguage.name}，点击更换`"
                      :disabled="streaming"
                      :class="[
                        'inline-flex h-28px items-center gap-4px rounded-999px border border-solid border-line bg-white px-10px text-12px text-ink-2 cursor-pointer shadow-[0_1px_2px_rgba(31,35,41,0.04)] hover:border-violet-line disabled:(cursor-not-allowed opacity-60)',
                        T_BTN,
                        FOCUS,
                      ]"
                    >
                      {{ selectedLanguage.name }}
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
                  </template>
                  <div
                    id="agent-language-panel"
                    role="dialog"
                    aria-label="选择语言"
                    class="grid w-480px max-w-[calc(100vw-48px)] grid-cols-3 gap-6px p-10px"
                    @keydown.esc.stop.prevent="closeLanguage"
                  >
                    <button
                      v-for="l in AGENT_LANGUAGES"
                      :key="l.code"
                      type="button"
                      :aria-pressed="languageCode === l.code"
                      :class="[
                        'flex h-36px min-w-0 items-center gap-8px rounded-8px border border-solid px-10px text-left text-13px text-ink cursor-pointer',
                        languageCode === l.code
                          ? 'border-violet bg-violet-soft'
                          : 'border-line bg-white hover:border-violet-line',
                        FOCUS,
                      ]"
                      @click="pickLanguage(l.code)"
                    >
                      <span
                        class="flex-none rounded-4px bg-surface3 px-5px text-11px font-600 leading-18px text-muted"
                        aria-hidden="true"
                        >{{ l.code }}</span
                      >
                      <span class="truncate">{{ l.name }}</span>
                    </button>
                  </div>
                </n-popover>
                <span class="flex-1" />
                <span
                  v-if="skillMissing && !streaming"
                  id="agent-skill-required"
                  class="flex-none text-12px text-warning"
                  >{{ SKILL_REQUIRED }}</span
                >
                <button
                  v-if="streaming"
                  type="button"
                  :disabled="stopping"
                  :class="[
                    'inline-flex h-32px flex-none items-center justify-center rounded-8px border border-solid border-line-strong px-16px text-13px text-ink cursor-pointer hover:border-violet-line disabled:cursor-not-allowed',
                    BTN_SURFACE,
                    T_BTN,
                    FOCUS,
                  ]"
                  @click="stop"
                >
                  停止
                </button>
                <button
                  v-else
                  type="button"
                  :disabled="!draft.trim() || skillMissing"
                  :aria-describedby="skillMissing ? 'agent-skill-required' : undefined"
                  :class="[
                    'll-btn-primary !rounded-8px h-32px flex-none gap-4px px-16px text-13px ![transition:background_0.11s_cubic-bezier(0.2,0.7,0.2,1),border-color_0.11s_ease,box-shadow_0.11s_ease,color_0.11s_ease] motion-reduce:!transition-none',
                    FOCUS,
                  ]"
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
            <p class="m-0 mt-8px text-center text-12px text-muted">AI 生成内容仅供参考，请仔细甄别</p>
          </div>
        </div>
      </section>
    </div>

    <!-- 选择技能：标题与关闭同一行；页签是单行分段控件（不换行、等高、文字垂直居中）；
         头 / 体 / 尾左右内边距同为 20px，列表行与标题左缘对齐 -->
    <n-modal
      v-model:show="skillDialogShow"
      preset="card"
      closable
      :bordered="false"
      :segmented="{ content: true, footer: true }"
      :style="{ width: '680px', maxWidth: 'calc(100vw - 48px)' }"
      header-style="padding: 16px 20px"
      content-style="padding: 16px 20px"
      footer-style="padding: 12px 20px"
      aria-labelledby="agent-skill-dialog-title"
      @after-leave="skillPillEl?.focus()"
    >
      <template #header>
        <div class="flex items-center gap-8px">
          <span id="agent-skill-dialog-title" class="text-16px font-600 leading-24px text-ink">选择技能</span>
          <span class="rounded-6px bg-surface3 px-8px text-12px font-400 leading-20px text-muted"
            >{{ tabSkills.length }} 个技能</span
          >
        </div>
      </template>

      <div class="flex flex-col gap-12px">
        <div class="flex min-w-0">
          <div
            role="group"
            aria-label="技能分类"
            class="inline-flex max-w-full flex-nowrap items-center gap-2px overflow-x-auto rounded-10px border border-solid border-line bg-surface2 p-3px"
          >
            <button
              v-for="t in skillTabs"
              :key="t.name"
              type="button"
              :aria-pressed="skillTab === t.name"
              :class="[
                'inline-flex h-30px flex-none items-center justify-center whitespace-nowrap rounded-8px border border-solid px-14px text-13px leading-none cursor-pointer',
                skillTab === t.name
                  ? 'border-line bg-white font-600 text-violet-ink shadow-[0_1px_2px_rgba(31,35,41,0.08)]'
                  : 'border-transparent bg-transparent text-ink-2 hover:text-ink',
                FOCUS,
              ]"
              @click="skillTab = t.name"
            >
              {{ t.name }}
            </button>
          </div>
        </div>

        <div class="flex max-h-420px min-h-160px flex-col gap-8px overflow-y-auto">
          <span v-if="skillTab === MY_SKILL_GROUP" :title="SOON" class="flex flex-none">
            <button
              type="button"
              disabled
              class="inline-flex h-40px w-full items-center justify-center gap-4px rounded-10px border border-dashed border-line-strong bg-white text-13px text-ink-2 cursor-not-allowed opacity-60"
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
              新建技能
            </button>
          </span>
          <button
            v-for="s in tabSkills"
            :key="s.agentSkillId"
            type="button"
            :aria-pressed="pendingSkillId === s.agentSkillId"
            :class="[
              'flex h-56px w-full flex-none items-center gap-12px rounded-10px border border-solid px-12px text-left cursor-pointer',
              pendingSkillId === s.agentSkillId
                ? 'bg-violet-soft border-violet-line'
                : 'bg-white border-transparent hover:bg-surface2',
              FOCUS,
            ]"
            @click="pendingSkillId = s.agentSkillId"
          >
            <span
              class="grid h-32px w-32px flex-none place-items-center rounded-8px bg-violet-soft-2 text-13px font-600 text-violet-ink"
              aria-hidden="true"
              >{{ skillInitial(s) }}</span
            >
            <span class="flex min-w-0 flex-1 flex-col gap-2px">
              <!-- 勾选图标放在名称行末尾：与名称行同一垂直中心，同时贴最右 -->
              <span class="flex h-20px items-center gap-6px">
                <span class="truncate text-14px font-600 leading-20px text-ink">{{ s.title }}</span>
                <span
                  v-if="versionLabel(s)"
                  class="flex-none rounded-4px bg-violet-soft-2 px-5px text-11px leading-16px text-violet-ink"
                  >{{ versionLabel(s) }}</span
                >
                <span class="flex-1" />
                <svg
                  v-if="pendingSkillId === s.agentSkillId"
                  class="h-16px w-16px flex-none text-violet"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <path :d="ICON.checkCircle" />
                </svg>
              </span>
              <span v-if="s.description" class="block truncate text-12px leading-18px text-muted">{{
                s.description
              }}</span>
            </span>
          </button>
          <div v-if="!tabSkills.length" class="ll-empty py-24px">
            {{ skillTab === MY_SKILL_GROUP ? '暂无自建技能' : '暂无技能' }}
          </div>
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end gap-12px">
          <button
            type="button"
            :class="[
              'inline-flex h-32px items-center rounded-8px border border-solid border-line-strong bg-white px-16px text-13px text-ink cursor-pointer hover:border-violet-line',
              FOCUS,
            ]"
            @click="skillDialogShow = false"
          >
            取消
          </button>
          <button
            type="button"
            :disabled="!pendingSkillId"
            :class="['ll-btn-primary !rounded-8px h-32px px-16px text-13px', FOCUS]"
            @click="confirmSkill"
          >
            确认
          </button>
        </div>
      </template>
    </n-modal>

    <!-- 上传素材：页签与选择技能同款分段控件；本地上传走商拍工作室同一条直传，资产页签复用资产选择器 -->
    <n-modal
      v-model:show="imageDialogShow"
      preset="card"
      closable
      :bordered="false"
      :segmented="{ content: true }"
      :style="{ width: '680px', maxWidth: 'calc(100vw - 48px)' }"
      header-style="padding: 16px 20px"
      content-style="padding: 16px 20px 20px"
      aria-labelledby="agent-image-dialog-title"
      @after-leave="imagePillEl?.focus()"
    >
      <template #header>
        <div class="flex items-center gap-8px">
          <span id="agent-image-dialog-title" class="text-16px font-600 leading-24px text-ink">上传素材</span>
          <span class="rounded-6px bg-surface3 px-8px text-12px font-400 leading-20px text-muted"
            >Ctrl + V 粘贴图片</span
          >
        </div>
      </template>

      <div class="flex flex-col gap-12px">
        <div class="flex min-w-0">
          <div
            role="group"
            aria-label="素材来源"
            class="inline-flex max-w-full flex-nowrap items-center gap-2px overflow-x-auto rounded-10px border border-solid border-line bg-surface2 p-3px"
          >
            <span v-for="t in IMAGE_TABS" :key="t.key" :title="t.soon ? SOON : undefined" class="inline-flex flex-none">
              <button
                type="button"
                :disabled="t.soon"
                :aria-pressed="imageTab === t.key"
                :class="[
                  'inline-flex h-30px flex-none items-center justify-center whitespace-nowrap rounded-8px border border-solid px-14px text-13px leading-none cursor-pointer disabled:(cursor-not-allowed opacity-50)',
                  imageTab === t.key
                    ? 'border-line bg-white font-600 text-violet-ink shadow-[0_1px_2px_rgba(31,35,41,0.08)]'
                    : 'border-transparent bg-transparent text-ink-2 hover:text-ink',
                  FOCUS,
                ]"
                @click="imageTab = t.key"
              >
                {{ t.label }}
              </button>
            </span>
          </div>
        </div>

        <div
          v-if="imageTab === 'local'"
          :class="[
            'flex min-h-240px flex-col items-center justify-center gap-8px rounded-12px border border-dashed px-20px py-24px text-center',
            dragging ? 'border-violet bg-violet-soft' : 'border-line-strong bg-surface2',
          ]"
          @dragover.prevent="dragging = true"
          @dragleave.prevent="dragging = false"
          @drop.prevent="onDrop"
        >
          <span
            class="grid h-44px w-44px place-items-center rounded-12px bg-violet-soft-2 text-violet"
            aria-hidden="true"
          >
            <n-spin v-if="uploading" size="small" />
            <svg
              v-else
              class="h-20px w-20px"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linejoin="round"
            >
              <path :d="ICON.upload" />
            </svg>
          </span>
          <p class="m-0 text-13px text-ink-2">{{ IMAGE_FORMATS }}</p>
          <p class="m-0 text-12px text-muted">当前还能添加 {{ imageRoom }} 张图片</p>
          <button
            type="button"
            :disabled="uploading"
            :aria-busy="uploading"
            :class="['ll-btn-primary !rounded-8px mt-4px h-32px px-16px text-13px', FOCUS]"
            @click="imageRoom > 0 ? fileInputEl?.click() : message.warning(LIMIT_TEXT)"
          >
            选择本地图片
          </button>
          <input
            ref="fileInputEl"
            type="file"
            multiple
            :accept="IMAGE_ACCEPT"
            class="hidden"
            tabindex="-1"
            aria-hidden="true"
            @change="onFileChange"
          />
        </div>

        <div
          v-else
          class="flex min-h-240px flex-col items-center justify-center gap-8px rounded-12px border border-solid border-line bg-surface2 px-20px py-24px text-center"
        >
          <p class="m-0 text-12px text-muted">当前还能添加 {{ imageRoom }} 张图片</p>
          <button
            type="button"
            :class="['ll-btn-primary !rounded-8px h-32px px-16px text-13px', FOCUS]"
            @click="openAssetPicker"
          >
            从资产选择
          </button>
        </div>
      </div>
    </n-modal>

    <AssetPickerModal v-model:show="assetPickerShow" :limit="Math.max(imageRoom, 1)" @select="onAssetSelect" />
  </n-config-provider>
</template>
