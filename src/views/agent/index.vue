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
import { NConfigProvider, NImage, NInput, NModal, NPopover, NSpin, useMessage } from 'naive-ui'
import { useRouter } from 'vue-router'
import { llTheme } from '@/views/local-life/theme.ts'
import { toApiError } from '@/api'
import {
  AGENT_LANGUAGES,
  agentCancel,
  agentConversations,
  agentCreateConversation,
  agentDeleteConversation,
  agentMessages,
  agentRecoverStream,
  agentRenameConversation,
  agentShareConversation,
  agentSkills,
  agentStream,
  answerReady,
  answersFromAttribute,
  applyFrame,
  buildAnswers,
  chatSkillGroups,
  emptyReply,
  formReady,
  genTaskPending,
  initialAnswer,
  isNestedQuestion,
  isTextQuestion,
  MY_SKILL_GROUP,
  replyFromFrames,
  userSkillCreate,
  userSkillDelete,
  userSkillDetail,
  userSkillList,
  userSkillUpdate,
} from '@/api/agent.ts'
import type {
  IAgentAnswer,
  IAgentConversation,
  IAgentFrame,
  IAgentGenTask,
  IAgentMessage,
  IAgentQuestion,
  IAgentQuestionOption,
  IAgentReply,
  IAgentSkill,
  IAgentSkillGroup,
  IUserSkill,
} from '@/api/agent.ts'
import { useIdempotentSubmit } from '@/views/studio/hooks.ts'
import AssetPickerModal from '@/views/studio/components/AssetPickerModal/index.vue'
import { useStudioUploader } from '@/views/studio/components/StudioImageUpload/useStudioUploader.ts'
import { PromptWriteButton } from '@/components/prompt-write'
import { canvasCreate } from '@/api/canvasHome.ts'
import { stashCanvasImport } from '@/utils/canvasImportHandoff.ts'
import { createSafeUuid } from '@/utils/utils.ts'
import BatchHostingModal from './BatchHostingModal.vue'

defineOptions({ name: 'agent-chat' })

const message = useMessage()
const router = useRouter()

const FOCUS = 'focus-visible:(outline outline-2 outline-violet outline-offset-2)'

/*
 * 原型 5183 AgentView.vue + sx-scoped.css（.sx-btn / --sm / --tint / --ghost / --primary）照抄：
 * 渐变、内高光、投影、过渡时长与曲线不估算。按钮过渡只有 background 走 cubic-bezier(.2,.7,.2,1)，其余是 ease。
 */
const T_BTN =
  '[transition:background_0.11s_cubic-bezier(0.2,0.7,0.2,1),border-color_0.11s,box-shadow_0.11s,color_0.11s] motion-reduce:transition-none'
/** .sx-btn--sm：32 高、内边距 0 10、11px、r3 */
const BTN_SM = `inline-flex h-32px flex-none items-center justify-center gap-6px rounded-3px border border-solid px-10px text-11px leading-none whitespace-nowrap cursor-pointer select-none ${T_BTN}`
/** .sx-btn：板材渐变 + 内高光 + 短投影；禁用 = 灰底无影 */
const BTN_DEFAULT =
  'border-control bg-[linear-gradient(#fff,#fbfcfc)] font-500 text-ink-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(31,35,41,0.04),0_1px_2px_rgba(31,35,41,0.05)] enabled:hover:(border-control-hover bg-[linear-gradient(#fff,#f7f8f9)] text-ink) enabled:active:(border-control-press bg-[linear-gradient(#f3f4f5,#f7f8f9)] shadow-press text-ink) disabled:(border-line bg-none bg-surface3 shadow-none text-placeholder cursor-default)'
/** .sx-btn--tint：白 → 紫 6% */
const BTN_TINT =
  'border-violet-line bg-[linear-gradient(180deg,#fff_0%,#f8f3fc_100%)] font-500 text-violet-ink shadow-[0_1px_2px_rgba(31,35,41,0.045)] enabled:hover:(border-#cdb7de bg-[linear-gradient(180deg,#fdfbff_0%,#f1e8f9_100%)]) enabled:active:(border-#c3aad6 bg-none bg-#f1e8f9 shadow-[inset_0_1px_2px_rgba(80,55,95,0.12)]) disabled:(bg-[linear-gradient(180deg,#fff_0%,#fbf8fd_100%)] text-#a893b8 cursor-default)'
/** .sx-btn--ghost */
const BTN_GHOST =
  'border-transparent bg-transparent font-500 text-ink-2 enabled:hover:(bg-surface3 text-ink) enabled:active:bg-ghost-press disabled:(text-placeholder cursor-default)'
/** .sx-btn--primary */
const BTN_PRIMARY =
  'border-violet-border bg-[linear-gradient(#8a639f,#7a548c)] font-600 text-white shadow-btn enabled:hover:(border-violet-press bg-[linear-gradient(#9a6fae,#875c9a)]) enabled:active:(border-#5c3d6b bg-none bg-violet-press shadow-[inset_0_1px_3px_rgba(40,24,48,0.35)]) disabled:(border-violet-line bg-none bg-violet-disabled shadow-none text-white/80 cursor-default)'
/** .sx-seg--picker 档位片：300ms 标准曲线 */
const T_SEG =
  '[transition:border-color_300ms_cubic-bezier(0.4,0,0.2,1),background-color_300ms_cubic-bezier(0.4,0,0.2,1),box-shadow_300ms_cubic-bezier(0.4,0,0.2,1),color_300ms_cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none'
/** 弹窗：r12 + 细描边 + 浮层投影（.agent-modal） */
const MODAL =
  'flex max-h-[calc(100vh-48px)] max-w-[calc(100vw-48px)] flex-col overflow-hidden rounded-12px border border-solid border-line bg-white shadow-pop'
/** 弹窗头：52 高、内边距 0 10 0 18 */
const MODAL_HEAD = 'flex h-52px flex-none items-center gap-8px border-b border-solid border-line pl-18px pr-10px'
const MODAL_X =
  'ml-auto grid h-26px w-26px place-items-center rounded-4px border-none bg-transparent p-0 text-#8a919c cursor-pointer hover:bg-surface3'
/** 会话卡（C-19）：卡片圆角按产品方定为 8 */
const T_CARD = '[transition:border-color_0.11s,background_0.11s,box-shadow_0.11s] motion-reduce:transition-none'
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
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
} as const

/**
 * 顶栏动作：「一键铺货」接 /batch-hosting/*（BatchHostingModal），「分享」接 POST /agent/conversations/{id}/share，
 * 「在画布中打开」新建画布 + 一次性交接图片地址（canvasImportHandoff），见 openInCanvas。
 */

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

/** 服务端每轮都要求 agentSkillId（> 0）：没有可用技能（未选、目录为空或拉取失败）就不发 */
const SKILL_REQUIRED = '请先选择技能'
const skillMissing = computed(() => !selectedSkillId.value)

async function loadSkills() {
  try {
    const res = await agentSkills()
    skillGroups.value = chatSkillGroups(res.data)
    selectedSkillId.value = skills.value[0]?.agentSkillId ?? ''
  } catch {
    // 目录拉失败：没有可用技能，发送按 skillMissing 禁用（服务端拒收不带 agentSkillId 的一轮）
    skillGroups.value = []
    selectedSkillId.value = ''
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
/** 功能卡副标题第一段：技能 · 版本 */
const headerSkill = computed(() =>
  [selectedSkill.value?.title, versionLabel(selectedSkill.value)].filter(Boolean).join(' · '),
)
/** 第二段：每轮受理后服务端即落库（用户 + 助手各一条），故标「按轮保存」；未开会话为「新对话」 */
const headerRounds = computed(() =>
  activeConversation.value ? `${roundsOf(activeConversation.value)} 轮 · 按轮保存` : '新对话',
)
/** 空态云影球：hover 弹一次（1300ms），弹跳中再移入不重播（原型 BounceBallIcon） */
const ballPlaying = ref(false)
let ballTimer: ReturnType<typeof setTimeout> | null = null
function playBall() {
  if (ballPlaying.value) return
  ballPlaying.value = true
  ballTimer = setTimeout(() => {
    ballPlaying.value = false
    ballTimer = null
  }, 1360)
}

/** 空态「上次做到这里」：最近一条会话 */
const recentConversation = computed(() => (activeId.value ? undefined : conversations.value[0]))

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
  cancelShare()
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

// 删除：照原型在卡内另起一行确认（.conv-confirm），不弹窗
const deleteId = ref('')
const deleting = ref(false)

async function confirmDelete(c: IAgentConversation) {
  if (deleting.value) return
  deleting.value = true
  try {
    await agentDeleteConversation(c.agentConversationId)
    conversations.value = conversations.value.filter((x) => x.agentConversationId !== c.agentConversationId)
    listTotal.value = Math.max(0, listTotal.value - 1)
    deleteId.value = ''
    if (activeId.value === c.agentConversationId) newConversation()
  } catch (err) {
    reportError(err)
  } finally {
    deleting.value = false
  }
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
  /** 会话里的轮次号（从 1 起，按服务端消息顺序两条一轮，分享按它选）；本地新发、尚未回读的为空 */
  turnNo?: number
  /** 本轮的 turnId 与已收到的最大 sequence：续流时据此只取游标之后的帧 */
  turnId?: string
  lastSeq?: number
  /** 用户消息透传的表单数据（历史回读；表单续答的答案在 attribute.answers） */
  attribute?: Record<string, unknown>
  /** 本条回复带参数确认表单时的作答状态 */
  form?: FormState
}

interface FormState {
  answers: Record<string, IAgentAnswer>
  submitting: boolean
  /** 已提交（受理）或已被后续消息取代：只读 */
  done: boolean
  /** 提交未受理时的错误 */
  error: string
}

const items = ref<ChatItem[]>([])
/** 按「轮」分组：一条用户消息 + 智能体这一轮的回复算一轮（轮内 8、轮间 24） */
const turns = computed(() => {
  const out: ChatItem[][] = []
  for (const it of items.value) {
    const last = out[out.length - 1]
    if (it.role === 'user' || !last) out.push([it])
    else last.push(it)
  }
  return out
})
const msgPage = ref(0)
const msgLoading = ref(false)
const listEl = ref<HTMLElement | null>(null)
let msgSeq = 0
let localKey = 0

/** 记下帧里的 turnId / sequence（续流游标） */
function trackFrame(item: ChatItem, frame: IAgentFrame) {
  const content = frame.data?.content ?? {}
  if (typeof content.turnId === 'string' && content.turnId) item.turnId = content.turnId
  const seq = Number(content.sequence)
  if (Number.isFinite(seq) && seq > (item.lastSeq ?? 0)) item.lastSeq = seq
}

/** @param index 该消息在整个会话里的顺序下标（从 0 起），两条一轮 */
function toItem(m: IAgentMessage, index: number): ChatItem | null {
  const turnNo = Math.floor(index / 2) + 1
  if (m.role === 'user') {
    if (m.hidden) return null
    return {
      key: `m${m.id}`,
      role: 'user',
      text: typeof m.content === 'string' ? m.content : '',
      images: (m.imageUrls ?? []).filter(Boolean),
      reply: emptyReply(),
      turnNo,
      ...(m.attribute ? { attribute: m.attribute } : {}),
    }
  }
  if (m.role === 'assistant') {
    const reply = m.sseEvents ? replyFromFrames(m.sseEvents) : emptyReply()
    if (!m.sseEvents && typeof m.content === 'string') reply.text = m.content
    const item: ChatItem = { key: `m${m.id}`, role: 'assistant', text: '', reply, turnNo }
    for (const f of m.sseEvents ?? []) trackFrame(item, f)
    return item
  }
  return null
}

// ---------------- 参数确认表单 ----------------

/** 表单控件的 3px 焦点环（同搜索框 focus 的紫环） */
const RING3 = 'shadow-[0_0_0_3px_rgba(135,95,154,0.14)]'
const T_CHIP =
  '[transition:border-color_0.11s,background_0.11s,box-shadow_0.11s,color_0.11s] motion-reduce:transition-none'
const CHIP = `inline-flex min-h-30px max-w-full items-center gap-6px rounded-4px border border-solid px-10px py-5px text-left text-12px leading-18px cursor-pointer outline-none disabled:cursor-default focus-visible:(border-violet ${RING3}) ${T_CHIP}`
const CHIP_ON = 'border-violet-line bg-violet-soft text-violet-ink'
const CHIP_OFF = 'border-line bg-white text-ink-2 enabled:hover:(border-control-hover text-ink)'
const FORM_INPUT = `box-border h-32px w-full rounded-4px border border-solid border-control bg-white px-10px text-12px text-ink shadow-inset-input outline-none placeholder:text-placeholder hover:border-control-hover focus:(border-violet ${RING3}) disabled:(bg-surface3 text-muted) ${T_CHIP}`

/** 回复带表单而还没有作答状态时建一份（按服务端默认值预选）；restored = 历史里该表单已提交的答案 */
function initForm(item: ChatItem, restored?: Record<string, IAgentAnswer> | null) {
  const form = item.reply.form
  if (!form || item.form) return
  const answers: Record<string, IAgentAnswer> = {}
  for (const q of form.questions) answers[q.id] = restored?.[q.id] ?? initialAnswer(q)
  item.form = { answers, submitting: false, done: false, error: '' }
}

/** 历史回读后：给每张表单建状态；后面已有消息的表单视为已结束，下一条若是续答就读回答案 */
function seedForms(list: ChatItem[]) {
  list.forEach((item, i) => {
    if (item.role !== 'assistant' || !item.reply.form) return
    const next = list[i + 1]
    if (!item.form && next?.role === 'user') initForm(item, answersFromAttribute(item.reply.form, next.attribute))
    else initForm(item)
    if (next && item.form) item.form.done = true
  })
}

/** 表单可作答：本轮已收尾、无错误、是会话最后一条、没有流在跑 */
function formOpen(item: ChatItem): boolean {
  const s = item.form
  if (!s || s.done || s.submitting || streaming.value) return false
  if (!item.reply.finished || item.reply.error) return false
  return items.value[items.value.length - 1] === item
}

function formAnswer(item: ChatItem, q: IAgentQuestion): IAgentAnswer {
  const s = item.form as FormState
  return (s.answers[q.id] ??= { selected: [], text: '' })
}

function optionPicked(item: ChatItem, q: IAgentQuestion, o: IAgentQuestionOption): boolean {
  return item.form?.answers[q.id]?.selected.includes(o.id) ?? false
}

/** 两级题当前选中的父项 */
function nestedParent(item: ChatItem, q: IAgentQuestion): IAgentQuestionOption | undefined {
  const first = item.form?.answers[q.id]?.selected[0]
  return q.options.find((o) => o.id === first)
}

function pickOption(item: ChatItem, q: IAgentQuestion, o: IAgentQuestionOption) {
  if (!formOpen(item)) return
  const a = formAnswer(item, q)
  if (q.type === 'multi_select') {
    const i = a.selected.indexOf(o.id)
    if (i >= 0) a.selected.splice(i, 1)
    else a.selected.push(o.id)
  } else {
    a.selected = [o.id]
  }
  item.form!.error = ''
}

/** 两级题的子项：答案为 [父 id, 子 id] */
function pickChild(item: ChatItem, q: IAgentQuestion, parent: IAgentQuestionOption, child: IAgentQuestionOption) {
  if (!formOpen(item)) return
  formAnswer(item, q).selected = [parent.id, child.id]
  item.form!.error = ''
}

function setAnswerText(item: ChatItem, q: IAgentQuestion, v: string) {
  if (!formOpen(item)) return
  formAnswer(item, q).text = v
  item.form!.error = ''
}

/**
 * 提交表单：同一会话发一轮 content 为空、带 attribute.answers（+ interruptId）的流式请求，续跑被中断的那一轮。
 * 服务端按 interruptId 幂等（同一表单重复提交接回原轮次），X-Request-Id 每次新取即可。
 * 受理前被拒只有一帧 ERROR；表单类拒收（已提交 / 已失效 / 仍在处理）的 detail 与 message 同句，
 * 此时提示原文并回读消息，以服务端当前状态为准。
 */
async function submitForm(item: ChatItem) {
  const form = item.reply.form
  const state = item.form
  const conversationId = activeId.value
  if (!form || !state || !conversationId || !formOpen(item) || !formReady(form, state.answers)) return
  if (skillMissing.value) {
    message.warning(SKILL_REQUIRED)
    return
  }
  streaming.value = true
  state.submitting = true
  state.error = ''
  const language = selectedLanguage.value.value
  const bot = reactive<ChatItem>({
    key: `l${++localKey}`,
    role: 'assistant',
    text: '',
    reply: emptyReply(),
    live: true,
  })
  items.value.push(bot)
  scrollToBottom()

  streamConvId = conversationId
  controller = new AbortController()
  let accepted = false
  let dropped = false
  let formRejected = false
  try {
    await agentStream(
      {
        conversationId,
        content: '',
        agentSkillId: selectedSkillId.value,
        ...(language ? { language } : {}),
        attribute: { answers: buildAnswers(form, state.answers) },
        ...(form.interruptId ? { interruptId: form.interruptId } : {}),
      },
      {
        requestId: createSafeUuid(),
        signal: controller.signal,
        onFrame: (frame) => {
          if (frame.event === 'START') {
            accepted = true
            state.done = true
          } else if (frame.event === 'ERROR' && !accepted) {
            const c = frame.data?.content ?? {}
            formRejected = !!c.message && c.detail === c.message
          }
          trackFrame(bot, frame)
          applyFrame(bot.reply, frame)
          scrollToBottom()
        },
      },
    )
  } catch (err) {
    if ((err as any)?.name !== 'AbortError') {
      if (accepted && toApiError(err)?.isNetwork && !bot.reply.finished && !bot.reply.error) dropped = true
      else bot.reply.error = errorText(err)
    }
  } finally {
    bot.live = false
    controller = null
    streaming.value = false
    stopping.value = false
    state.submitting = false
    bumpConversation(conversationId, accepted)
    initForm(bot)
  }
  if (!accepted) {
    // 未受理：撤掉占位回复，错误留在表单上，可改后再提交
    const idx = items.value.indexOf(bot)
    if (idx >= 0) items.value.splice(idx, 1)
    state.error = bot.reply.error
    if (formRejected && activeId.value === conversationId) {
      message.error(bot.reply.error)
      if (await loadMessages(conversationId)) resumeIfRunning(conversationId)
    }
    return
  }
  if (dropped) void resumeTurn(conversationId, bot, 'drop')
}

/** 离底超过 16px 时出「回到底部」 */
const atBottom = ref(true)

function scrollToBottom() {
  void nextTick(() => {
    const el = listEl.value
    if (el) el.scrollTop = el.scrollHeight
    atBottom.value = true
  })
}

function onListScroll() {
  const el = listEl.value
  if (!el) return
  atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 16
}

async function fetchMessagePage(id: string, page: number) {
  const res = await agentMessages(id, { page, size: MSG_SIZE })
  return {
    pages: res.data?.pages ?? 0,
    rows: (res.data?.data ?? []).map((m, i) => toItem(m, (page - 1) * MSG_SIZE + i)).filter((x): x is ChatItem => !!x),
  }
}

/** 消息按顺序号升序分页：先取总页数，再从最后一页往前加载 */
async function selectConversation(id: string) {
  if (streaming.value || id === activeId.value) return
  activeId.value = id
  idem.invalidate()
  if (await loadMessages(id)) resumeIfRunning(id)
}

/** 取当前会话的消息（从最后一页起）；返回是否加载成功且仍是当前会话 */
async function loadMessages(id: string): Promise<boolean> {
  items.value = []
  msgPage.value = 0
  cancelShare()
  const seq = ++msgSeq
  msgLoading.value = true
  try {
    const first = await fetchMessagePage(id, 1)
    if (seq !== msgSeq) return false
    if (first.pages <= 1) {
      items.value = first.rows
      msgPage.value = 1
    } else {
      const last = await fetchMessagePage(id, first.pages)
      if (seq !== msgSeq) return false
      items.value = last.rows
      msgPage.value = first.pages
    }
    seedForms(items.value)
    scrollToBottom()
    scheduleResultPoll(true)
    return true
  } catch (err) {
    if (seq === msgSeq) reportError(err)
    return false
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
    seedForms(items.value)
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

const textareaEl = ref<HTMLTextAreaElement | null>(null)

/** 输入框随内容长高：38–120（原型 .agent-field textarea） */
function autosize() {
  const el = textareaEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`
}

watch(draft, () => void nextTick(autosize))

function onDraftInput(v: string) {
  draft.value = v
  // 用户改了内容：上次结果未知的幂等身份作废
  idem.invalidate()
}

/** 空态场景按钮：把示例需求填进输入框（原型 .scenes） */
function fillDraft(v: string) {
  onDraftInput(v)
  void nextTick(() => textareaEl.value?.focus())
}

/** 空态「我的技能」：打开技能弹窗并停在「我的技能」页签 */
function openMySkills() {
  openSkillDialog()
  if (skillDialogShow.value) skillTab.value = MY_SKILL_GROUP
}

/** 语言胶囊照原型写「代码 名称」，「无语言」不带代码 */
const languageLabel = computed(() =>
  selectedLanguage.value.value
    ? `${selectedLanguage.value.code} ${selectedLanguage.value.name}`
    : selectedLanguage.value.name,
)

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
  let dropped = false
  try {
    await agentStream(
      {
        conversationId,
        content,
        agentSkillId: selectedSkillId.value,
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
          trackFrame(bot, frame)
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
      if (accepted && toApiError(err)?.isNetwork && !bot.reply.finished && !bot.reply.error) {
        // 受理后断流：这一轮仍在服务端运行，改走续流接上，不报错、不重发
        dropped = true
      } else {
        bot.reply.error = errorText(err)
        if (!accepted) {
          idem.fail(err)
          bot.retryContent = content
          bot.retryImages = imageUrls
        }
      }
    }
  } finally {
    bot.live = false
    controller = null
    streaming.value = false
    stopping.value = false
    bumpConversation(conversationId, accepted)
    initForm(bot)
  }
  if (dropped) void resumeTurn(conversationId, bot, 'drop')
}

// ---------------- 续流（POST /agent/recover-stream） ----------------

/** 打开会话时最后一轮还没收尾（助手消息只在终态落库，运行中只有用户那条）：试着接上运行中的流 */
function resumeIfRunning(id: string) {
  const last = items.value[items.value.length - 1]
  if (!last || streaming.value) return
  if (last.role === 'assistant') {
    if (!last.reply.finished && !last.reply.error && !last.stopped) void resumeTurn(id, last, 'open')
    return
  }
  const bot = reactive<ChatItem>({ key: `l${++localKey}`, role: 'assistant', text: '', reply: emptyReply() })
  items.value.push(bot)
  void resumeTurn(id, bot, 'open', true)
}

/**
 * 续接运行中的一轮：复用同一套 SSE 解析与帧归并，按 sequence 去重。
 * - drop（受理后断流）：带 turnId + afterSequence 只取游标之后的帧；没有运行中的流时回读消息拿终态。
 * - open（刷新 / 重进会话）：整轮重放进一份新回复，收到首个内容帧才替换（已结束的轮次不闪空）。
 * @param placeholder 本条是为续流临时补的助手占位：没有运行中的流就移除
 */
async function resumeTurn(conversationId: string, bot: ChatItem, mode: 'drop' | 'open', placeholder = false) {
  if (streaming.value) return
  const useCursor = mode === 'drop' && !!bot.turnId && (bot.lastSeq ?? 0) > 0
  let lastSeq = useCursor ? (bot.lastSeq ?? 0) : 0
  let swapped = useCursor
  let empty = false
  streaming.value = true
  stopping.value = false
  bot.live = true
  streamConvId = conversationId
  controller = new AbortController()
  try {
    await agentRecoverStream(
      {
        conversationId,
        ...(useCursor ? { turnId: bot.turnId, afterSequence: bot.lastSeq } : {}),
      },
      {
        signal: controller.signal,
        onFrame: (frame) => {
          if (frame.event === 'RECOVER_EMPTY') {
            empty = true
            return
          }
          const content = frame.data?.content ?? {}
          const seq = Number(content.sequence)
          if (frame.event === 'PROCESSING' && Number.isFinite(seq)) {
            if (seq <= lastSeq) return
            lastSeq = seq
          }
          if (typeof content.turnId === 'string' && content.turnId) bot.turnId = content.turnId
          if (frame.event === 'START') return
          if (!swapped) {
            bot.reply = emptyReply()
            bot.stopped = false
            swapped = true
          }
          bot.lastSeq = Math.max(bot.lastSeq ?? 0, lastSeq)
          applyFrame(bot.reply, frame)
          if (atBottom.value) scrollToBottom()
        },
      },
    )
  } catch (err) {
    if ((err as any)?.name !== 'AbortError') {
      bot.reply.error = errorText(err, '续接回复失败，请稍后刷新查看')
    }
  } finally {
    bot.live = false
    controller = null
    streaming.value = false
    stopping.value = false
    initForm(bot)
  }
  if (!empty || activeId.value !== conversationId) return
  if (placeholder) {
    const idx = items.value.indexOf(bot)
    if (idx >= 0 && !swapped) items.value.splice(idx, 1)
  } else if (mode === 'drop') {
    // 断流期间这一轮已结束：回读消息，以服务端落库的终态为准
    void loadMessages(conversationId)
  }
}

// ---------------- 分享（POST /agent/conversations/{id}/share） ----------------

const shareMode = ref(false)
const shareTurns = ref<number[]>([])
const sharing = ref(false)
/** 有效天数，0 = 永不过期 */
const shareExpireDays = ref(7)
const SHARE_EXPIRE_OPTIONS = [
  { label: '7 天', value: 7 },
  { label: '30 天', value: 30 },
  { label: '永久有效', value: 0 },
] as const
const shareLink = ref('')
const shareLinkShow = ref(false)
const shareLinkInputEl = ref<HTMLInputElement | null>(null)

/** 一组（用户 + 助手）的轮次号：只有助手回复已落库（终态）的轮才能分享 */
function turnNoOf(group: ChatItem[]): number | undefined {
  const bot = group.find((i) => i.role === 'assistant' && !i.live && i.turnNo)
  return bot?.turnNo
}

const shareableTurns = computed(() => turns.value.map(turnNoOf).filter((n): n is number => typeof n === 'number'))

async function startShare() {
  if (!activeId.value || streaming.value) {
    message.warning('当前还没有可分享的完整对话')
    return
  }
  // 本地刚发的轮次没有轮次号：先回读一次消息，按服务端顺序编号
  if (items.value.some((i) => !i.turnNo)) {
    const ok = await loadMessages(activeId.value)
    if (!ok) return
  }
  if (!shareableTurns.value.length) {
    message.warning('当前还没有可分享的完整对话')
    return
  }
  shareTurns.value = []
  shareMode.value = true
}

function pickRound(n: number) {
  const i = shareTurns.value.indexOf(n)
  if (i >= 0) shareTurns.value.splice(i, 1)
  else shareTurns.value.push(n)
}

function selectAllRounds() {
  shareTurns.value = [...shareableTurns.value]
}

function cancelShare() {
  shareMode.value = false
  shareTurns.value = []
}

async function doShare() {
  const id = activeId.value
  if (!id || !shareTurns.value.length || sharing.value) return
  sharing.value = true
  try {
    const res = await agentShareConversation(id, {
      turnNos: [...shareTurns.value].sort((a, b) => a - b),
      expireDays: shareExpireDays.value,
    })
    const token = res.data?.token
    if (!token) throw new Error('分享失败，请重试')
    const href = router.resolve({ name: 'agent-share', query: { token } }).href
    shareLink.value = new URL(href, window.location.href).toString()
    cancelShare()
    shareLinkShow.value = true
    await copyShareLink()
  } catch (err) {
    reportError(err, '分享失败，请重试')
  } finally {
    sharing.value = false
  }
}

async function copyShareLink() {
  try {
    await navigator.clipboard.writeText(shareLink.value)
    message.success('分享链接已复制')
  } catch {
    shareLinkInputEl.value?.select()
    message.warning('复制失败，请手动复制链接')
  }
}

// ---------------- 在画布中打开（/api/v1/canvas/canvases + canvasImportHandoff） ----------------

/** 一轮回复里生图工具已出的图（按工具、任务、产物顺序） */
function replyImages(reply: IAgentReply): string[] {
  return reply.tools.flatMap((t) => t.tasks.flatMap((k) => k.imageUrls))
}

/**
 * 会话里已加载消息的图片（去重、按出现顺序）：用户消息附带的 imageUrls + 生图工具已出的图。
 * 结果卡上每张图另有单张的「在画布中打开」。
 */
const conversationImages = computed(() => [
  ...new Set(items.value.flatMap((it) => [...(it.images ?? []), ...replyImages(it.reply)])),
])
const openingCanvas = ref(false)

/**
 * 新建画布只收 title、带不了初始快照：先建空画布，把图片地址交给编辑器，编辑器首次加载完逐张建图片节点并自动保存。
 * 建画布失败不跳转（业务失败请求层已 toast，这里只补传输层失败）。
 */
async function openInCanvas(urls: string[]) {
  if (openingCanvas.value || !urls.length) return
  openingCanvas.value = true
  try {
    const title = activeConversation.value?.title?.trim()
    const res = await canvasCreate(title ? { title } : {})
    const id = res.data?.id
    if (!id) throw new Error('创建失败，请稍后重试')
    stashCanvasImport({ canvasId: id, urls })
    void router.push({ name: 'canvas-editor', params: { id } })
  } catch (err) {
    reportError(err, '创建失败，请稍后重试')
  } finally {
    openingCanvas.value = false
  }
}

// ---------------- 生图结果卡（tool_result 的 result.results，消息历史按任务状态现算） ----------------

/** 结果卡的一格：已出的图逐张一格；排队 / 生成中、失败的任务各占一格 */
interface IResultTile {
  key: string
  url?: string
  state: 'image' | 'pending' | 'failed'
}

function resultTiles(tasks: IAgentGenTask[]): IResultTile[] {
  return tasks.flatMap((t): IResultTile[] => {
    if (t.imageUrls.length) return t.imageUrls.map((url, i) => ({ key: `${t.taskId}:${i}`, url, state: 'image' }))
    return [{ key: t.taskId, state: genTaskPending(t) ? 'pending' : 'failed' }]
  })
}

/** 网格列数照原型：1–2 张两列，更多四列 */
function resultCols(n: number): string {
  return n <= 2 ? 'grid-cols-2' : 'grid-cols-4'
}

/** 还没出图的任务：每 5 秒回读一次消息（只读、不计费），把最新任务状态并回已加载的结果卡 */
const RESULT_POLL_MS = 5000
/** 一次进入会话最多回读的次数（约 10 分钟），之后停在当前状态，重新打开会话再继续 */
const RESULT_POLL_MAX = 120
let resultTimer: ReturnType<typeof setTimeout> | null = null
let resultPolls = 0

const hasPendingResults = () => items.value.some((it) => it.reply.tools.some((t) => t.tasks.some(genTaskPending)))

function stopResultPoll() {
  if (resultTimer) clearTimeout(resultTimer)
  resultTimer = null
}

function scheduleResultPoll(reset = false) {
  if (reset) resultPolls = 0
  stopResultPoll()
  if (!activeId.value || resultPolls >= RESULT_POLL_MAX || !hasPendingResults()) return
  const id = activeId.value
  resultTimer = setTimeout(() => void refreshResults(id), RESULT_POLL_MS)
}

/** 回读已加载范围内的消息页，按 taskId 把任务状态与出图地址并回各结果卡 */
async function refreshResults(id: string) {
  resultTimer = null
  if (id !== activeId.value) return
  resultPolls += 1
  if (streaming.value) return scheduleResultPoll()
  const seq = msgSeq
  try {
    const first = await agentMessages(id, { page: 1, size: MSG_SIZE })
    const pages = first.data?.pages ?? 0
    const rows = [...(first.data?.data ?? [])]
    for (let p = Math.max(2, msgPage.value || 1); p <= pages; p++) {
      const res = await agentMessages(id, { page: p, size: MSG_SIZE })
      rows.push(...(res.data?.data ?? []))
    }
    if (seq !== msgSeq || id !== activeId.value) return
    const latest = new Map<string, IAgentGenTask>()
    for (const m of rows) {
      if (m.role !== 'assistant' || !m.sseEvents) continue
      for (const t of replyFromFrames(m.sseEvents).tools) for (const k of t.tasks) latest.set(k.taskId, k)
    }
    for (const it of items.value) {
      for (const t of it.reply.tools) {
        if (t.tasks.some(genTaskPending)) t.tasks = t.tasks.map((k) => latest.get(k.taskId) ?? k)
      }
    }
  } catch {
    // 只读回读失败按网络抖动处理：下一次再试
  }
  scheduleResultPoll()
}

watch(activeId, () => scheduleResultPoll(true))
watch(streaming, (on) => {
  if (!on) scheduleResultPoll()
})

// ---------------- 一键铺货（/api/v1/batch-hosting/*，BatchHostingModal） ----------------

const batchShow = ref(false)

/** 批次的技能取对话页当前所选；未选时先提示 */
function openBatch() {
  if (!selectedSkillId.value) {
    message.warning(SKILL_REQUIRED)
    return
  }
  batchShow.value = true
}

// ---------------- 我的技能（/api/v1/user-skills） ----------------

const USER_SKILL_SIZE = 20
const USER_SKILL_TITLE_MAX = 20
const USER_SKILL_PROMPT_MAX = 10000
const userSkills = ref<IUserSkill[]>([])
const userSkillPage = ref(0)
const userSkillPages = ref(0)
const userSkillLoading = ref(false)
/** null = 列表；否则为新建（无 id）/ 编辑表单 */
const skillForm = ref<{ id?: number; title: string; prompt: string } | null>(null)
const skillFormLoading = ref(false)
const skillSaving = ref(false)
/** AI 帮写流式写入提示词期间：锁输入框与保存，避免存下半段 */
const skillWriting = ref(false)
// 表单关掉时帮写按钮随之卸载（中断流、不再回调 busy），这里一并复位
watch(
  () => !!skillForm.value,
  (open) => {
    if (!open) skillWriting.value = false
  },
)
const skillDeleteId = ref<number | null>(null)
const skillDeleting = ref(false)

async function loadUserSkills(reset = false) {
  if (userSkillLoading.value) return
  userSkillLoading.value = true
  const page = reset ? 1 : userSkillPage.value + 1
  try {
    const res = await userSkillList({ page, size: USER_SKILL_SIZE })
    const rows = res.data?.data ?? []
    if (reset) userSkills.value = rows
    else {
      const seen = new Set(userSkills.value.map((s) => s.userSkillId))
      userSkills.value.push(...rows.filter((s) => !seen.has(s.userSkillId)))
    }
    userSkillPage.value = page
    userSkillPages.value = res.data?.pages ?? 0
  } catch (err) {
    reportError(err)
  } finally {
    userSkillLoading.value = false
  }
}

watch([skillDialogShow, skillTab], ([open, tab]) => {
  if (!open) {
    skillForm.value = null
    skillDeleteId.value = null
    return
  }
  if (tab === MY_SKILL_GROUP) void loadUserSkills(true)
})

function openSkillCreate() {
  skillDeleteId.value = null
  skillForm.value = { title: '', prompt: '' }
}

async function openSkillEdit(s: IUserSkill) {
  if (skillFormLoading.value) return
  skillDeleteId.value = null
  skillFormLoading.value = true
  try {
    const res = await userSkillDetail(s.userSkillId)
    skillForm.value = { id: s.userSkillId, title: res.data?.title ?? s.title, prompt: res.data?.prompt ?? '' }
  } catch (err) {
    reportError(err)
  } finally {
    skillFormLoading.value = false
  }
}

const skillFormValid = computed(
  () => !!skillForm.value && !!skillForm.value.title.trim() && !!skillForm.value.prompt.trim(),
)

async function saveSkillForm() {
  const form = skillForm.value
  if (!form || !skillFormValid.value || skillSaving.value || skillWriting.value) return
  skillSaving.value = true
  const data = { title: form.title.trim(), prompt: form.prompt.trim() }
  try {
    if (form.id) await userSkillUpdate(form.id, data)
    else await userSkillCreate(data)
    message.success(form.id ? '技能已保存' : '新技能已创建')
    skillForm.value = null
    void loadUserSkills(true)
  } catch (err) {
    reportError(err)
  } finally {
    skillSaving.value = false
  }
}

async function confirmSkillDelete(s: IUserSkill) {
  if (skillDeleting.value) return
  skillDeleting.value = true
  try {
    await userSkillDelete([s.userSkillId])
    userSkills.value = userSkills.value.filter((x) => x.userSkillId !== s.userSkillId)
    skillDeleteId.value = null
  } catch (err) {
    // 走裸 fetch，业务失败不经拦截器 toast：这里统一提示
    message.error(errorText(err, '删除失败，请重试'))
  } finally {
    skillDeleting.value = false
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
  stopResultPoll()
  if (ballTimer) clearTimeout(ballTimer)
  document.removeEventListener('paste', onPaste)
})
</script>

<template>
  <n-config-provider :theme-overrides="llTheme" abstract>
    <div class="flex h-full min-h-0 bg-page text-ink">
      <!-- 会话目录：照原型 C-19 历史卡——灰底上一张白卡，卡里一条条会话卡 -->
      <aside v-if="!sidebarCollapsed" class="flex w-280px flex-none min-h-0 py-20px pl-20px" aria-label="对话列表">
        <section
          class="flex min-h-0 min-w-0 flex-1 flex-col rounded-8px border border-solid border-line bg-white p-12px shadow-card"
        >
          <div class="flex h-28px flex-none items-center gap-6px px-1px">
            <h1 class="m-0 text-13px font-600 leading-18px text-ink">会话</h1>
            <span class="text-11px leading-16px text-muted tabular-nums">{{ listTotal }}</span>
            <span class="flex-1" />
            <button
              type="button"
              :disabled="streaming || !activeId"
              :class="[BTN_SM, '!h-26px !px-8px', activeId ? BTN_TINT : BTN_DEFAULT, FOCUS]"
              @click="newConversation"
            >
              <svg
                class="h-13px w-13px"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
              >
                <path :d="ICON.plus" />
              </svg>
              {{ activeId ? '新建' : '已是新对话' }}
            </button>
            <button
              type="button"
              title="收起会话列表"
              aria-label="收起会话列表"
              :class="[
                'grid h-26px w-26px flex-none place-items-center rounded-4px border border-solid border-transparent bg-transparent p-0 text-muted cursor-pointer hover:(border-line bg-surface3 text-ink)',
                T_BTN,
                FOCUS,
              ]"
              @click="sidebarCollapsed = true"
            >
              <svg
                class="h-12px w-12px"
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
          <div class="relative mt-8px flex flex-none items-center">
            <svg
              class="pointer-events-none absolute left-9px h-13px w-13px text-placeholder"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path :d="ICON.search" />
            </svg>
            <input
              v-model="keyword"
              type="search"
              placeholder="搜索会话"
              aria-label="搜索会话"
              class="box-border h-30px w-full rounded-4px border border-solid border-control bg-white pl-26px pr-8px text-11px text-ink shadow-inset-input outline-none placeholder:text-placeholder hover:border-control-hover focus:(border-violet shadow-[0_0_0_3px_rgba(135,95,154,0.14),inset_0_1px_2px_rgba(31,35,41,0.055),inset_0_0_0_1px_rgba(255,255,255,0.7)]) [transition:border-color_0.11s,box-shadow_0.11s] motion-reduce:transition-none"
            />
          </div>
          <ul class="m-0 flex min-h-0 flex-1 list-none flex-col gap-8px overflow-y-auto p-0 pt-10px pb-2px">
            <!-- 未开会话：一张选中态「新的对话」占位卡 -->
            <li v-if="!activeId && !keyword.trim()">
              <div
                class="flex items-center gap-10px rounded-8px border border-solid border-violet-line bg-[linear-gradient(#fff,#f8f3fc)] p-10px shadow-[0_1px_2px_rgba(31,35,41,0.05)]"
                aria-current="true"
              >
                <span
                  class="grid h-44px w-44px flex-none place-items-center rounded-6px border border-solid border-line bg-surface3 text-violet-ink"
                  aria-hidden="true"
                >
                  <svg
                    class="h-16px w-16px"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linejoin="round"
                  >
                    <path :d="ICON.sparkle" />
                  </svg>
                </span>
                <div class="flex min-w-0 flex-1 flex-col">
                  <p class="m-0 truncate text-13px font-500 leading-18px text-ink">新的对话</p>
                  <p class="m-0 truncate text-11px leading-16px text-muted">输入第一条消息，开始交流</p>
                  <span class="text-11px leading-16px text-placeholder tabular-nums">刚刚 · 0 轮</span>
                </div>
              </div>
            </li>
            <li v-for="c in visibleConversations" :key="c.agentConversationId">
              <div
                :class="[
                  'group relative flex items-center gap-10px rounded-8px border border-solid p-10px',
                  activeId === c.agentConversationId
                    ? 'border-violet-line bg-[linear-gradient(#fff,#f8f3fc)] shadow-[0_1px_2px_rgba(31,35,41,0.05)]'
                    : 'border-line bg-white hover:(border-control shadow-[0_1px_2px_rgba(31,35,41,0.05)])',
                  deleteId === c.agentConversationId ? 'flex-wrap' : '',
                  T_CARD,
                ]"
              >
                <!-- 整卡可点：透明按钮铺满卡面，焦点环画在卡外沿 -->
                <button
                  v-if="editingId !== c.agentConversationId"
                  type="button"
                  :disabled="streaming && activeId !== c.agentConversationId"
                  :aria-current="activeId === c.agentConversationId ? 'true' : undefined"
                  :aria-label="c.title"
                  :class="[
                    'absolute inset-0 rounded-8px border-none bg-transparent p-0 cursor-pointer disabled:cursor-not-allowed',
                    FOCUS,
                  ]"
                  @click="selectConversation(c.agentConversationId)"
                />
                <!-- 缩略图：会话列表接口暂无封面字段，先用星芒占位；有封面后在此换成图片 -->
                <span
                  class="pointer-events-none grid h-44px w-44px flex-none place-items-center rounded-6px border border-solid border-line bg-surface3 text-violet-ink"
                  aria-hidden="true"
                >
                  <svg
                    class="h-16px w-16px"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linejoin="round"
                  >
                    <path :d="ICON.sparkle" />
                  </svg>
                </span>
                <div
                  :class="[
                    'flex min-w-0 flex-1 flex-col',
                    editingId === c.agentConversationId ? 'relative' : 'pointer-events-none',
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
                  <p v-else class="m-0 truncate text-13px font-500 leading-18px text-ink" aria-hidden="true">
                    {{ c.title }}
                  </p>
                  <p v-if="c.lastMessage" class="m-0 truncate text-11px leading-16px text-muted">{{ c.lastMessage }}</p>
                  <div class="flex min-h-16px items-center gap-6px">
                    <span class="whitespace-nowrap text-11px leading-16px text-placeholder tabular-nums"
                      >{{ dayLabel(c.updatedAt || c.createdAt) }} · {{ roundsOf(c) }} 轮</span
                    >
                    <div
                      v-if="editingId !== c.agentConversationId"
                      class="pointer-events-auto relative ml-auto flex gap-2px opacity-55 [transition:opacity_0.12s] group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none"
                    >
                      <button
                        type="button"
                        title="编辑标题"
                        :aria-label="`编辑标题：${c.title}`"
                        :class="[
                          'grid h-20px w-20px place-items-center rounded-4px border-none bg-transparent p-0 text-muted cursor-pointer hover:(bg-surface3 text-ink)',
                          FOCUS,
                        ]"
                        @click="startRename(c)"
                      >
                        <svg
                          class="h-13px w-13px"
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
                        title="删除"
                        :aria-label="`删除：${c.title}`"
                        :aria-expanded="deleteId === c.agentConversationId"
                        :class="[
                          'grid h-20px w-20px place-items-center rounded-4px border-none bg-transparent p-0 text-muted cursor-pointer hover:(bg-danger-soft text-danger)',
                          FOCUS,
                        ]"
                        @click="deleteId = c.agentConversationId"
                      >
                        <svg
                          class="h-13px w-13px"
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
                <!-- 行内确认：在卡里另起一行，不浮在内容上 -->
                <div
                  v-if="deleteId === c.agentConversationId"
                  role="alert"
                  class="relative mt-8px flex flex-[1_0_100%] flex-col gap-8px border-t border-solid border-line-soft pt-8px text-11px leading-16px text-muted"
                >
                  <span>删除后不可撤销，请谨慎操作。</span>
                  <div class="flex justify-end gap-6px">
                    <button
                      type="button"
                      :class="[BTN_SM, '!h-26px !px-9px', BTN_DEFAULT, FOCUS]"
                      @click="deleteId = ''"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      :disabled="deleting"
                      :aria-busy="deleting"
                      :class="[
                        BTN_SM,
                        '!h-26px !px-9px font-500 border-danger-line bg-[linear-gradient(#fff7f6,#fdf1f0)] text-danger shadow-plate enabled:hover:(border-#e0b3af bg-none bg-danger-soft) enabled:active:(bg-none bg-#f9e5e3 shadow-press) disabled:cursor-default',
                        FOCUS,
                      ]"
                      @click="confirmDelete(c)"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            </li>
            <li
              v-if="!visibleConversations.length && !listLoading && keyword.trim()"
              class="px-12px py-26px text-center text-11px leading-18px text-placeholder"
            >
              没有找到匹配的对话<br />换个关键词试试
            </li>
            <li v-if="listLoading" class="flex justify-center py-12px"><n-spin size="small" /></li>
            <li v-else-if="listPage < listPages" class="py-6px text-center">
              <button
                type="button"
                :class="['ll-link border-none bg-transparent text-11px', FOCUS]"
                @click="loadConversations(false)"
              >
                加载更多
              </button>
            </li>
          </ul>
        </section>
      </aside>

      <!-- 宽对话主区：一张工作台卡（功能条 + 对话 + 输入） -->
      <section class="flex min-w-0 flex-1 flex-col p-20px" aria-label="对话">
        <div
          class="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-8px border border-solid border-line bg-white shadow-card"
        >
          <!-- 功能切换卡：64 高 / 藤紫细描边 / 白 → 紫 6% -->
          <div class="flex-none px-12px pt-12px">
            <header
              class="flex h-64px items-center gap-12px rounded-8px border border-solid border-#e9dff2 bg-[linear-gradient(#fff,#fbf7fe)] px-14px py-12px shadow-[0_1px_2px_rgba(31,35,41,0.05)]"
            >
              <button
                v-if="sidebarCollapsed"
                type="button"
                title="展开会话列表"
                aria-label="展开会话列表"
                :class="[BTN_SM, BTN_DEFAULT, FOCUS]"
                @click="sidebarCollapsed = false"
              >
                <svg
                  class="h-12px w-12px"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <path :d="ICON.chevronRight" />
                </svg>
              </button>
              <span
                class="grid h-40px w-56px flex-none place-items-center rounded-6px border border-solid border-line bg-[linear-gradient(135deg,#f6effa,#efe6f5)] text-violet-ink"
                aria-hidden="true"
              >
                <svg
                  class="h-20px w-20px"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linejoin="round"
                >
                  <path :d="ICON.sparkle" />
                </svg>
              </span>
              <div class="flex min-w-0 flex-col gap-2px">
                <h2 class="m-0 truncate text-15px font-600 leading-20px text-ink">
                  {{ activeConversation?.title || '智能体' }}
                </h2>
                <p class="m-0 inline-flex items-center gap-6px text-11px leading-16px tracking-[.01em] text-muted">
                  <template v-if="headerSkill">
                    {{ headerSkill }}
                    <i class="h-2px w-2px flex-none rounded-full bg-control" aria-hidden="true" />
                  </template>
                  {{ headerRounds }}
                  <template v-if="streaming">
                    <i class="h-2px w-2px flex-none rounded-full bg-control" aria-hidden="true" />
                    <i class="inline-block h-5px w-5px rounded-full bg-violet" aria-hidden="true" />执行中
                  </template>
                </p>
              </div>
              <div class="ml-auto flex flex-none gap-6px">
                <button type="button" :class="[BTN_SM, BTN_DEFAULT, FOCUS]" @click="openBatch">
                  <svg
                    class="h-13px w-13px"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    aria-hidden="true"
                  >
                    <path :d="ICON.grid" />
                  </svg>
                  一键铺货
                </button>
                <button
                  type="button"
                  :disabled="!conversationImages.length || openingCanvas"
                  :class="[BTN_SM, BTN_DEFAULT, FOCUS]"
                  @click="openInCanvas(conversationImages)"
                >
                  <svg
                    class="h-13px w-13px"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    aria-hidden="true"
                  >
                    <path :d="ICON.external" />
                  </svg>
                  在画布中打开
                </button>
                <button
                  type="button"
                  :disabled="!activeId || streaming || msgLoading"
                  :aria-pressed="shareMode"
                  :class="[BTN_SM, shareMode ? BTN_TINT : BTN_DEFAULT, FOCUS]"
                  @click="shareMode ? cancelShare() : startShare()"
                >
                  <svg
                    class="h-13px w-13px"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    aria-hidden="true"
                  >
                    <path :d="ICON.share" />
                  </svg>
                  分享
                </button>
              </div>
            </header>
          </div>

          <div v-if="msgLoading && !items.length" class="flex flex-1 items-center justify-center">
            <n-spin size="small" />
          </div>

          <!-- 空态：C-36 云影球（hover 会弹） -->
          <div
            v-else-if="!items.length"
            class="flex flex-1 flex-col items-center justify-center px-24px pb-[8vh] text-center"
          >
            <span class="relative grid h-84px w-64px place-items-center" aria-hidden="true" @pointerenter="playBall">
              <span
                class="pointer-events-none absolute bottom-5px left-1/2 z-1 ml-[-19.2px] h-[11.2px] w-[38.4px] rounded-full bg-[rgba(31,35,41,0.32)] opacity-75 blur-[7.2px] scale-x-85 scale-y-80 motion-reduce:animate-none"
                :class="ballPlaying ? 'animate-[agent-ball-ground_1300ms_both]' : ''"
              />
              <span
                class="relative z-2 h-48px w-48px motion-reduce:animate-none"
                :class="ballPlaying ? 'animate-[agent-ball-jump_1300ms_both]' : ''"
              >
                <span
                  class="absolute inset-0 box-border rounded-full border border-solid border-#dfe3e8 bg-[radial-gradient(circle_at_50%_35%,#fff_0_55%,#fbfbfc_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] origin-[50%_100%] motion-reduce:animate-none"
                  :class="ballPlaying ? 'animate-[agent-ball-shell_1300ms_both]' : ''"
                />
                <span
                  class="pointer-events-none absolute inset-0 z-1 grid place-items-center text-ink-2 -translate-y-2px"
                >
                  <svg
                    class="h-[35.2px] w-[35.2px] overflow-visible"
                    viewBox="-0.4 -0.56 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M6.5 18a4.5 4.5 0 0 1-.7-8.95A6 6 0 0 1 17.5 10.5a3.75 3.75 0 0 1 0 7.5z" />
                    <path d="M12 11v7" />
                    <path d="M9.5 13.5 12 11l2.5 2.5" />
                  </svg>
                </span>
              </span>
            </span>
            <h2 class="m-0 mt-2px text-16px font-600 leading-22px text-ink">开启新话题</h2>
            <p class="m-0 mt-4px max-w-420px text-12px leading-18px text-muted">
              描述你要做什么，智能体会先拆步骤、再跟你确认设置，最后出图。
            </p>
            <div class="mt-16px flex flex-wrap justify-center gap-8px">
              <button
                type="button"
                :disabled="streaming"
                :class="[BTN_SM, '!h-32px !px-12px !rounded-4px !text-13px', BTN_TINT, FOCUS]"
                @click="fillDraft('帮我做 4 张淘宝主图，白底，突出卖点')"
              >
                <svg
                  class="h-14px w-14px"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path :d="ICON.sparkle" />
                </svg>
                电商出图
              </button>
              <button
                type="button"
                :disabled="streaming"
                :class="[BTN_SM, '!h-32px !px-12px !rounded-4px !text-13px', BTN_DEFAULT, FOCUS]"
                @click="fillDraft('把这 4 张图做成小红书封面，文字干净一点')"
              >
                <svg
                  class="h-14px w-14px"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path :d="ICON.edit" />
                </svg>
                创意设计
              </button>
              <button
                type="button"
                :class="[BTN_SM, '!h-32px !px-12px !rounded-4px !text-13px', BTN_DEFAULT, FOCUS]"
                @click="openBatch"
              >
                <svg
                  class="h-14px w-14px"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <path :d="ICON.grid" />
                </svg>
                批量铺货
              </button>
              <button
                v-if="skills.length"
                type="button"
                :disabled="streaming"
                :class="[BTN_SM, '!h-32px !px-12px !rounded-4px !text-13px', BTN_DEFAULT, FOCUS]"
                @click="openMySkills"
              >
                <svg
                  class="h-14px w-14px"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path :d="ICON.layers" />
                </svg>
                我的技能
              </button>
            </div>
            <div v-if="recentConversation" class="mt-24px w-full max-w-520px text-left">
              <span class="mb-6px ml-2px block text-11px leading-16px text-placeholder">上次做到这里</span>
              <div
                class="flex items-center gap-12px rounded-8px border border-solid border-line bg-white py-8px pl-12px pr-10px shadow-card"
              >
                <span
                  class="grid h-40px w-30px flex-none place-items-center rounded-3px border border-solid border-line bg-surface3 text-violet-ink"
                  aria-hidden="true"
                >
                  <svg
                    class="h-14px w-14px"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linejoin="round"
                  >
                    <path :d="ICON.sparkle" />
                  </svg>
                </span>
                <span class="flex min-w-0 flex-1 flex-col gap-1px">
                  <b class="truncate text-13px font-500 leading-18px text-ink">{{ recentConversation.title }}</b>
                  <span class="text-11px leading-16px text-placeholder"
                    >{{ dayLabel(recentConversation.updatedAt || recentConversation.createdAt) }} ·
                    {{ roundsOf(recentConversation) }} 轮</span
                  >
                </span>
                <button
                  type="button"
                  :disabled="streaming"
                  :class="[BTN_SM, BTN_DEFAULT, FOCUS]"
                  @click="selectConversation(recentConversation.agentConversationId)"
                >
                  继续这轮
                </button>
              </div>
            </div>
          </div>

          <!-- 消息区：顶部 30px 渐隐，滚上去的内容不硬切 -->
          <div v-else class="relative flex min-h-0 flex-1 flex-col">
            <span
              class="pointer-events-none absolute left-1px right-1px top-0 z-2 h-30px bg-[linear-gradient(#fff_0_8px,rgba(255,255,255,0.9)_14px,rgba(255,255,255,0))]"
              aria-hidden="true"
            />
            <div
              ref="listEl"
              role="log"
              :aria-live="streaming ? 'polite' : 'off'"
              :aria-busy="streaming"
              class="min-h-0 flex-1 overflow-y-auto px-20px pt-16px pb-10px [scrollbar-gutter:stable]"
              @scroll.passive="onListScroll"
            >
              <!-- 34 的左槽留给头像：正文、清单都从同一条左沿起 -->
              <div class="mx-auto flex max-w-780px flex-col gap-24px pl-34px">
                <div v-if="msgPage > 1" class="text-center">
                  <button
                    type="button"
                    :disabled="msgLoading"
                    :class="['ll-link border-none bg-transparent text-11px', FOCUS]"
                    @click="loadEarlier"
                  >
                    加载更多
                  </button>
                </div>
                <div v-for="(turn, ti) in turns" :key="turn[0]?.key ?? ti" class="flex flex-col gap-8px">
                  <button
                    v-if="shareMode && turnNoOf(turn)"
                    type="button"
                    role="checkbox"
                    :aria-checked="shareTurns.includes(turnNoOf(turn) ?? 0)"
                    title="选择该轮分享"
                    :class="[
                      'inline-flex h-24px items-center gap-6px self-start rounded-4px border border-solid px-8px text-11px cursor-pointer',
                      shareTurns.includes(turnNoOf(turn) ?? 0)
                        ? 'border-violet-line bg-violet-soft text-violet-ink'
                        : 'border-line bg-white text-muted hover:text-ink',
                      FOCUS,
                    ]"
                    @click="pickRound(turnNoOf(turn) ?? 0)"
                  >
                    <span
                      :class="[
                        'grid h-12px w-12px place-items-center rounded-2px border border-solid',
                        shareTurns.includes(turnNoOf(turn) ?? 0)
                          ? 'border-violet bg-violet text-white'
                          : 'border-control bg-white',
                      ]"
                      aria-hidden="true"
                    >
                      <svg
                        v-if="shareTurns.includes(turnNoOf(turn) ?? 0)"
                        class="h-9px w-9px"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="3"
                      >
                        <path :d="ICON.check" />
                      </svg>
                    </span>
                    第 {{ turnNoOf(turn) }} 轮
                  </button>
                  <template v-for="item in turn" :key="item.key">
                    <!-- 用户气泡：藤紫浅底、右下收一角 -->
                    <template v-if="item.role === 'user'">
                      <div
                        v-if="item.text || item.images?.length"
                        class="max-w-520px self-end rounded-[10px_10px_3px_10px] border border-solid border-#ebdff3 bg-[linear-gradient(#f8f3fc,#f2ebf8)] px-12px py-9px text-13px leading-20px text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]"
                      >
                        <div class="whitespace-pre-wrap break-words">{{ item.text }}</div>
                        <div v-if="item.images?.length" class="mt-6px flex gap-4px">
                          <n-image
                            v-for="(url, i) in item.images.slice(0, 4)"
                            :key="i"
                            :src="url"
                            :width="38"
                            :height="50"
                            object-fit="cover"
                            class="overflow-hidden rounded-3px border border-solid border-white"
                          />
                        </div>
                      </div>
                    </template>

                    <!-- 智能体：头像挂在左槽，正文与清单同一条左沿 -->
                    <div v-else class="relative flex flex-col gap-8px">
                      <span
                        class="absolute left-[-34px] top-[-2px] grid h-24px w-24px place-items-center rounded-full border border-solid border-line bg-violet-soft text-violet-ink shadow-[inset_0_1px_0_#fff]"
                        aria-hidden="true"
                      >
                        <svg
                          class="h-11px w-11px"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linejoin="round"
                        >
                          <path :d="ICON.sparkle" />
                        </svg>
                      </span>
                      <p
                        v-if="item.reply.thinking"
                        class="m-0 whitespace-pre-wrap break-words text-11px leading-16px text-placeholder"
                      >
                        {{ item.reply.thinking }}
                      </p>
                      <!-- 生成中：思考胶囊 -->
                      <div
                        v-if="item.live && !item.reply.text"
                        class="inline-flex h-24px items-center gap-6px self-start rounded-4px border border-solid border-line bg-#fafbfc px-8px text-11px text-placeholder"
                      >
                        <span class="inline-flex gap-3px" aria-hidden="true">
                          <i class="h-4px w-4px rounded-full bg-#b9a6c4" />
                          <i class="h-4px w-4px rounded-full bg-#b9a6c4" />
                          <i class="h-4px w-4px rounded-full bg-#b9a6c4" />
                        </span>
                        正在思考
                      </div>
                      <!-- 执行清单：沉在对话里的进度块，不抢卡面 -->
                      <div
                        v-if="item.reply.tools.length"
                        class="rounded-6px border border-solid border-#eceff2 bg-#fafbfc px-12px py-11px shadow-[inset_0_1px_2px_rgba(31,35,41,0.035)]"
                      >
                        <div class="flex items-center gap-7px text-13px font-600 leading-20px text-ink">
                          <svg
                            class="h-14px w-14px flex-none text-violet"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            aria-hidden="true"
                          >
                            <path :d="ICON.checkCircle" />
                          </svg>
                          执行清单
                          <span class="ml-auto text-11px font-400 leading-16px text-placeholder tabular-nums">
                            {{ item.reply.tools.filter((t) => t.status === 'completed').length }} /
                            {{ item.reply.tools.length }}
                          </span>
                        </div>
                        <ul class="m-0 list-none p-0">
                          <li
                            v-for="(t, i) in item.reply.tools"
                            :key="i"
                            :title="t.message"
                            class="flex h-26px items-center gap-8px text-12px text-ink-2"
                          >
                            <span
                              :class="[
                                'grid h-16px w-16px flex-none place-items-center rounded-full text-9px',
                                t.status === 'completed'
                                  ? 'bg-#eaf4ee text-#3f7a56'
                                  : t.status === 'failed'
                                    ? 'bg-danger-soft text-danger'
                                    : 'bg-violet-soft text-violet-ink',
                              ]"
                              aria-hidden="true"
                            >
                              <svg
                                v-if="t.status === 'completed' || t.status === 'failed'"
                                class="h-9px w-9px"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="3"
                              >
                                <path :d="t.status === 'failed' ? ICON.x : ICON.check" />
                              </svg>
                              <template v-else>{{ i + 1 }}</template>
                            </span>
                            <span
                              :class="['min-w-0 flex-1 truncate', t.status === 'completed' ? 'text-#8a919c' : '']"
                              >{{ t.name }}</span
                            >
                            <span
                              v-if="t.status === 'completed'"
                              class="flex-none text-11px leading-16px text-#a3a9b2 tabular-nums"
                              >已完成</span
                            >
                            <span
                              v-else-if="t.status === 'failed' && t.message"
                              class="max-w-[50%] flex-none truncate text-11px leading-16px text-danger"
                            >
                              {{ t.message }}
                            </span>
                            <span
                              v-else-if="t.status !== 'failed'"
                              class="flex-none text-11px leading-16px text-#a3a9b2"
                              >进行中</span
                            >
                          </li>
                        </ul>
                      </div>
                      <!-- 结果卡（原型 .result-card）：生图工具每次提交一张卡，没出图的任务显示生成中 / 生成失败 -->
                      <template v-for="(t, ti) in item.reply.tools" :key="`r${ti}`">
                        <div
                          v-if="t.tasks.length"
                          class="rounded-8px border border-solid border-line bg-white p-12px shadow-[0_1px_2px_rgba(31,35,41,0.035)]"
                        >
                          <div class="flex items-center gap-7px text-13px font-600 leading-20px text-ink">
                            <svg
                              class="h-14px w-14px flex-none text-violet"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              aria-hidden="true"
                            >
                              <path :d="ICON.image" />
                            </svg>
                            生成图片
                            <span class="text-11px font-400 leading-16px text-placeholder tabular-nums"
                              >{{ t.tasks.length }} 张</span
                            >
                          </div>
                          <div
                            :class="['mt-10px grid gap-8px', resultCols(resultTiles(t.tasks).length)]"
                            :aria-busy="t.tasks.some(genTaskPending)"
                          >
                            <div
                              v-for="tile in resultTiles(t.tasks)"
                              :key="tile.key"
                              class="group relative aspect-[3/4] overflow-hidden rounded-6px border border-solid border-line bg-surface3 shadow-[0_1px_2px_rgba(31,35,41,0.05)]"
                            >
                              <template v-if="tile.state === 'image' && tile.url">
                                <n-image
                                  :src="tile.url"
                                  object-fit="cover"
                                  class="block h-full w-full"
                                  :img-props="{ class: 'block h-full w-full object-cover', alt: '' }"
                                />
                                <div
                                  class="absolute inset-x-0 bottom-0 hidden justify-end gap-4px bg-[linear-gradient(transparent,rgba(15,20,25,0.5))] p-5px group-hover:flex group-focus-within:flex"
                                >
                                  <button
                                    type="button"
                                    :disabled="openingCanvas"
                                    :class="[
                                      'h-20px cursor-pointer rounded-3px border-none bg-white/94 px-6px text-10px text-#2b2420 disabled:cursor-default',
                                      FOCUS,
                                    ]"
                                    @click="openInCanvas([tile.url])"
                                  >
                                    在画布中打开
                                  </button>
                                </div>
                              </template>
                              <div
                                v-else
                                class="absolute inset-0 flex flex-col items-center justify-center gap-6px text-11px leading-16px"
                                :class="tile.state === 'failed' ? 'text-danger' : 'text-placeholder'"
                              >
                                <n-spin v-if="tile.state === 'pending'" :size="16" />
                                {{ tile.state === 'pending' ? '生成中' : '生成失败' }}
                              </div>
                            </div>
                          </div>
                        </div>
                      </template>
                      <div
                        v-if="item.reply.text"
                        class="whitespace-pre-wrap break-words text-13px leading-21px text-ink-2"
                      >
                        {{ item.reply.text }}
                      </div>
                      <!-- 参数确认表单（question_asker 中断）：选完点确认，续跑本轮 -->
                      <form
                        v-if="item.reply.form && item.form"
                        class="rounded-8px border border-solid border-line bg-white p-12px shadow-[0_1px_2px_rgba(31,35,41,0.035)]"
                        :aria-busy="item.form.submitting"
                        @submit.prevent="submitForm(item)"
                      >
                        <div class="flex items-center gap-7px text-13px font-600 leading-20px text-ink">
                          <svg
                            class="h-14px w-14px flex-none text-violet"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            aria-hidden="true"
                          >
                            <path :d="ICON.checkCircle" />
                          </svg>
                          {{ item.reply.form.title || item.reply.form.questions[0]?.title }}
                        </div>
                        <p
                          v-if="item.reply.form.message && item.reply.form.message !== item.reply.text.trim()"
                          class="m-0 mt-4px text-12px leading-18px text-muted"
                        >
                          {{ item.reply.form.message }}
                        </p>
                        <fieldset
                          v-for="q in item.reply.form.questions"
                          :key="q.id"
                          :disabled="!formOpen(item)"
                          class="m-0 mt-12px min-w-0 border-none p-0"
                        >
                          <legend class="flex items-center gap-4px p-0 text-12px font-600 leading-18px text-ink-2">
                            {{ q.title }}
                            <span v-if="q.required" class="text-danger" aria-hidden="true">*</span>
                            <svg
                              v-if="answerReady(q, item.form.answers[q.id])"
                              class="h-11px w-11px text-#3f7a56"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="3"
                              aria-hidden="true"
                            >
                              <path :d="ICON.check" />
                            </svg>
                          </legend>
                          <p v-if="q.message" class="m-0 mt-2px text-11px leading-16px text-placeholder">
                            {{ q.message }}
                          </p>
                          <div
                            v-if="!isTextQuestion(q)"
                            :role="q.type === 'multi_select' ? 'group' : 'radiogroup'"
                            :aria-label="q.title"
                            class="mt-8px flex flex-wrap gap-6px"
                          >
                            <button
                              v-for="o in q.options"
                              :key="o.id"
                              type="button"
                              :role="q.type === 'multi_select' ? 'checkbox' : 'radio'"
                              :aria-checked="optionPicked(item, q, o)"
                              :class="[CHIP, optionPicked(item, q, o) ? CHIP_ON : CHIP_OFF]"
                              @click="pickOption(item, q, o)"
                            >
                              <span
                                v-if="q.type === 'multi_select'"
                                :class="[
                                  'grid h-12px w-12px flex-none place-items-center rounded-2px border border-solid',
                                  optionPicked(item, q, o)
                                    ? 'border-violet bg-violet text-white'
                                    : 'border-control bg-white',
                                ]"
                                aria-hidden="true"
                              >
                                <svg
                                  v-if="optionPicked(item, q, o)"
                                  class="h-9px w-9px"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  stroke-width="3"
                                >
                                  <path :d="ICON.check" />
                                </svg>
                              </span>
                              <span class="min-w-0">
                                <span class="block">{{ o.label }}</span>
                                <span
                                  v-if="o.description && o.description !== o.label"
                                  class="block text-11px leading-16px text-placeholder"
                                  >{{ o.description }}</span
                                >
                              </span>
                            </button>
                          </div>
                          <div
                            v-if="isNestedQuestion(q) && nestedParent(item, q)?.children.length"
                            role="radiogroup"
                            :aria-label="nestedParent(item, q)?.label"
                            class="mt-6px flex flex-wrap gap-6px border-l-2 border-l-solid border-l-violet-line pl-8px"
                          >
                            <button
                              v-for="c in nestedParent(item, q)?.children ?? []"
                              :key="c.id"
                              type="button"
                              role="radio"
                              :aria-checked="optionPicked(item, q, c)"
                              :class="[CHIP, optionPicked(item, q, c) ? CHIP_ON : CHIP_OFF]"
                              @click="pickChild(item, q, nestedParent(item, q)!, c)"
                            >
                              <span class="min-w-0">
                                <span class="block">{{ c.label }}</span>
                                <span
                                  v-if="c.description && c.description !== c.label"
                                  class="block text-11px leading-16px text-placeholder"
                                  >{{ c.description }}</span
                                >
                              </span>
                            </button>
                          </div>
                          <input
                            v-if="q.allowText"
                            type="text"
                            :value="item.form.answers[q.id]?.text ?? ''"
                            :placeholder="q.placeholder"
                            :aria-label="q.placeholder || q.title"
                            :class="['mt-8px', FORM_INPUT]"
                            @input="setAnswerText(item, q, ($event.target as HTMLInputElement).value)"
                          />
                        </fieldset>
                        <div class="mt-12px flex items-center justify-end gap-8px">
                          <span
                            v-if="item.form.error"
                            role="alert"
                            class="ll-chip ll-chip-error mr-auto max-w-[70%] truncate"
                            :title="item.form.error"
                            >{{ item.form.error }}</span
                          >
                          <n-spin v-if="item.form.submitting" :size="14" />
                          <button
                            type="submit"
                            :disabled="!formOpen(item) || !formReady(item.reply.form, item.form.answers)"
                            :class="[BTN_SM, BTN_PRIMARY, FOCUS]"
                          >
                            {{ item.form.done ? '已确认' : '确认' }}
                          </button>
                        </div>
                      </form>
                      <div v-if="item.stopped" class="text-11px leading-16px text-placeholder">已停止</div>
                      <div v-if="item.reply.error" role="alert" class="flex items-center gap-8px">
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
          </div>

          <button
            v-if="!atBottom && items.length"
            type="button"
            title="回到底部"
            aria-label="回到底部"
            :class="[
              'absolute bottom-142px right-22px z-5 grid h-32px w-32px place-items-center rounded-full border border-solid border-line bg-white p-0 text-muted shadow-[0_4px_12px_rgba(31,35,41,0.10)] cursor-pointer hover:text-ink',
              FOCUS,
            ]"
            @click="scrollToBottom"
          >
            <svg
              class="h-14px w-14px"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path :d="ICON.arrowDown" />
            </svg>
          </button>

          <!-- 分享模式条：照原型 .share-bar（40 高、藤紫浅底、上描边），不浮在内容上 -->
          <div
            v-if="shareMode"
            role="toolbar"
            aria-label="分享对话"
            class="flex h-40px flex-none items-center gap-8px border-t border-solid border-violet-line bg-violet-soft px-20px"
          >
            <span class="text-11px text-violet-ink tabular-nums">已选 {{ shareTurns.length }} 轮</span>
            <button type="button" :class="[BTN_SM, BTN_DEFAULT, FOCUS]" @click="selectAllRounds">全选</button>
            <span class="flex-1" />
            <label class="inline-flex items-center gap-6px text-11px text-violet-ink">
              有效期
              <select
                v-model.number="shareExpireDays"
                :class="[
                  'h-28px rounded-3px border border-solid border-control bg-white px-6px text-11px text-ink-2 cursor-pointer',
                  FOCUS,
                ]"
              >
                <option v-for="o in SHARE_EXPIRE_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </label>
            <button type="button" :class="[BTN_SM, BTN_DEFAULT, FOCUS]" @click="cancelShare">取消</button>
            <button
              type="button"
              :disabled="!shareTurns.length || sharing"
              :class="[BTN_SM, BTN_PRIMARY, FOCUS]"
              @click="doShare"
            >
              {{ sharing ? '分享中…' : '分享' }}
            </button>
          </div>

          <!-- 输入：一体框（白 → #fbfcfc + 常驻内影；聚焦压深内影 + 3px 藤紫环） -->
          <!-- 右侧多留 10px = 消息区的滚动条槽，输入框和消息才是同一条左沿 -->
          <div class="flex-none border-t border-solid border-line-soft bg-white pb-8px pl-20px pr-30px pt-10px">
            <div class="mx-auto max-w-780px pl-34px">
              <div
                class="block rounded-6px border border-solid border-control bg-[linear-gradient(#fbfcfc,#fff)] px-10px pb-6px pt-10px shadow-[inset_0_0_10px_rgba(31,35,41,0.085),inset_0_1px_0_rgba(31,35,41,0.04)] [transition:box-shadow_0.11s,border-color_0.11s] focus-within:(border-violet shadow-[inset_0_0_16px_rgba(31,35,41,0.12),inset_0_1px_0_rgba(31,35,41,0.05),0_0_0_3px_rgba(135,95,154,0.14)]) motion-reduce:transition-none"
              >
                <div v-if="selectedSkill" class="mb-6px flex">
                  <span
                    class="inline-flex h-22px items-center gap-4px whitespace-nowrap rounded-3px border border-solid border-violet-line bg-violet-soft px-7px text-11px text-violet-ink"
                  >
                    <svg
                      class="h-11px w-11px"
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
                        'relative grid h-14px w-14px place-items-center rounded-full border-none bg-transparent p-0 text-inherit cursor-pointer after:(absolute -inset-6px content-empty) hover:bg-[rgba(107,72,124,0.10)] disabled:(cursor-not-allowed opacity-50)',
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
                <ul v-if="attachments.length" class="m-0 mb-6px flex list-none gap-5px p-0" aria-label="已添加的图片">
                  <li
                    v-for="(url, i) in attachments"
                    :key="url"
                    class="relative h-53px w-40px flex-none overflow-hidden rounded-3px border border-solid border-line"
                  >
                    <img :src="url" :alt="`图片 ${i + 1}`" class="block h-full w-full object-cover" />
                    <button
                      type="button"
                      title="移除图片"
                      :aria-label="`移除图片 ${i + 1}`"
                      :disabled="streaming"
                      :class="[
                        'absolute right-1px top-1px grid h-13px w-13px place-items-center rounded-2px border-none bg-[rgba(31,35,41,0.72)] p-0 text-8px leading-none text-white cursor-pointer disabled:(cursor-not-allowed opacity-50)',
                        FOCUS,
                      ]"
                      @click="removeImage(i)"
                    >
                      ×
                    </button>
                  </li>
                </ul>
                <textarea
                  ref="textareaEl"
                  :value="draft"
                  rows="1"
                  :maxlength="12000"
                  :disabled="streaming"
                  placeholder="描述你的创作目标、风格方向或产品卖点"
                  aria-label="输入消息"
                  class="box-border block max-h-120px min-h-38px w-full resize-none border-none bg-transparent p-0 pt-2px font-sans text-13px leading-20px text-ink outline-none placeholder:text-placeholder disabled:cursor-not-allowed"
                  @input="onDraftInput(($event.target as HTMLTextAreaElement).value)"
                  @keydown="onKeydown"
                />
                <div class="mt-4px flex h-28px items-center gap-2px">
                  <button
                    ref="imagePillEl"
                    type="button"
                    aria-haspopup="dialog"
                    :aria-label="`添加图片，已添加 ${attachments.length}/${MAX_IMAGES}`"
                    :disabled="streaming"
                    :class="[BTN_SM, '!h-28px', BTN_GHOST, FOCUS]"
                    @click="openImageDialog"
                  >
                    <svg
                      class="h-12px w-12px"
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
                    :class="[BTN_SM, '!h-28px max-w-[220px]', BTN_GHOST, FOCUS]"
                    @click="openSkillDialog"
                  >
                    <svg
                      class="h-12px w-12px flex-none"
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
                      class="-ml-4px flex-none rounded-2px bg-violet-soft px-3px text-9px text-violet-ink"
                      >{{ versionLabel(selectedSkill) }}</span
                    >
                    <svg
                      class="h-10px w-10px flex-none"
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
                    raw
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
                        :class="[BTN_SM, '!h-28px', BTN_GHOST, FOCUS]"
                      >
                        {{ languageLabel }}
                        <svg
                          class="h-10px w-10px"
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
                      class="mb-6px grid w-470px max-w-[calc(100vw-48px)] grid-cols-3 gap-3px rounded-8px border border-solid border-line bg-white p-8px shadow-pop"
                      @keydown.esc.stop.prevent="closeLanguage"
                    >
                      <button
                        v-for="l in AGENT_LANGUAGES"
                        :key="l.code"
                        type="button"
                        :aria-pressed="languageCode === l.code"
                        :class="[
                          'flex h-30px min-w-0 items-center gap-6px rounded-4px border border-solid px-8px text-left text-11.5px text-ink-2 cursor-pointer',
                          languageCode === l.code
                            ? 'border-line bg-[linear-gradient(#f3f4f5,#fafbfc)] font-500'
                            : 'border-transparent bg-transparent hover:bg-surface2',
                          FOCUS,
                        ]"
                        @click="pickLanguage(l.code)"
                      >
                        <span
                          class="min-w-34px flex-none rounded-2px bg-surface3 px-3px text-center text-9px text-#8a919c"
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
                    class="mr-4px flex-none text-11px text-warning"
                    >{{ SKILL_REQUIRED }}</span
                  >
                  <button
                    v-if="streaming"
                    type="button"
                    :disabled="stopping"
                    :class="[BTN_SM, '!h-30px !px-13px !text-12px', BTN_DEFAULT, FOCUS]"
                    @click="stop"
                  >
                    停止
                  </button>
                  <button
                    v-else
                    type="button"
                    :disabled="!draft.trim() || skillMissing"
                    :aria-describedby="skillMissing ? 'agent-skill-required' : undefined"
                    :class="[BTN_SM, '!h-30px !px-13px !text-12px', BTN_PRIMARY, FOCUS]"
                    @click="send(draft)"
                  >
                    <svg
                      class="h-12px w-12px"
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
              <p class="m-0 mt-6px text-center text-11px leading-16px text-#a3a9b2">AI 生成内容仅供参考，请仔细甄别</p>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 选择技能：照原型 .agent-modal.skill-modal（680×540、头 52、C-12 分段 + C-11 行） -->
    <n-modal v-model:show="skillDialogShow" @after-leave="skillPillEl?.focus()">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-skill-dialog-title"
        :class="[MODAL, 'h-540px w-680px']"
      >
        <div :class="MODAL_HEAD">
          <strong id="agent-skill-dialog-title" class="text-15px font-600 leading-20px text-ink">选择技能</strong>
          <span class="rounded-3px bg-surface3 px-5px py-1px text-10.5px text-#a3a9b2">{{
            skillForm
              ? skillForm.id
                ? '编辑技能'
                : '新建技能'
              : `${tabSkills.length + (skillTab === MY_SKILL_GROUP ? userSkills.length : 0)} 个技能`
          }}</span>
          <button type="button" aria-label="关闭" :class="[MODAL_X, FOCUS]" @click="skillDialogShow = false">
            <svg
              class="h-16px w-16px"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path :d="ICON.x" />
            </svg>
          </button>
        </div>
        <!-- 新建 / 编辑自建技能：照原型 .skill-form（技能标题 0/20、提示词 0/10000、取消 / 创建） -->
        <form
          v-if="skillForm"
          class="flex min-h-0 flex-1 flex-col gap-4px px-16px pb-12px pt-2px"
          @submit.prevent="saveSkillForm"
        >
          <label for="agent-user-skill-title" class="mt-10px flex justify-between text-11px leading-16px text-muted">
            技能标题<span class="text-placeholder tabular-nums"
              >{{ skillForm.title.length }} / {{ USER_SKILL_TITLE_MAX }}</span
            >
          </label>
          <input
            id="agent-user-skill-title"
            v-model="skillForm.title"
            :maxlength="USER_SKILL_TITLE_MAX"
            placeholder="例如：小红书爆款封面"
            :class="[
              'h-32px w-full rounded-4px border border-solid border-control bg-white px-10px text-13px text-ink outline-none focus:border-violet',
              FOCUS,
            ]"
          />
          <div class="mt-10px flex items-center justify-between gap-8px">
            <label for="agent-user-skill-prompt" class="text-11px leading-16px text-muted">提示词</label>
            <span class="flex items-center gap-8px">
              <PromptWriteButton
                v-model="skillForm.prompt"
                biz-type="user-skill"
                :disabled="skillSaving"
                @busy="skillWriting = $event"
              />
              <span class="text-11px leading-16px text-placeholder tabular-nums"
                >{{ skillForm.prompt.length }} / {{ USER_SKILL_PROMPT_MAX }}</span
              >
            </span>
          </div>
          <textarea
            id="agent-user-skill-prompt"
            v-model="skillForm.prompt"
            :readonly="skillWriting"
            :maxlength="USER_SKILL_PROMPT_MAX"
            rows="5"
            placeholder="请输入技能提示词，将作为该技能的系统指令"
            :class="[
              'min-h-140px w-full flex-1 resize-none rounded-4px border border-solid border-control bg-white px-10px py-8px text-13px leading-20px text-ink outline-none focus:border-violet',
              FOCUS,
            ]"
          />
          <div class="mt-10px flex justify-end gap-8px">
            <button type="button" :class="[BTN_SM, BTN_DEFAULT, FOCUS]" @click="skillForm = null">取消</button>
            <button
              type="submit"
              :disabled="!skillFormValid || skillSaving || skillWriting"
              :class="[BTN_SM, BTN_PRIMARY, FOCUS]"
            >
              {{ skillSaving ? '保存中…' : skillForm.id ? '保存' : '创建' }}
            </button>
          </div>
        </form>
        <div v-else class="flex min-h-0 flex-1 flex-col px-16px pb-4px pt-12px">
          <div
            role="group"
            aria-label="技能分类"
            class="mb-10px inline-flex max-w-full flex-none flex-nowrap gap-2px self-start overflow-x-auto rounded-6px border border-solid border-line bg-surface3 p-3px shadow-inset-input"
          >
            <button
              v-for="t in skillTabs"
              :key="t.name"
              type="button"
              :aria-pressed="skillTab === t.name"
              :class="[
                'h-30px flex-none whitespace-nowrap rounded-4px border border-solid px-14px text-11px tabular-nums cursor-pointer enabled:active:shadow-[inset_0_1px_2px_rgba(80,55,95,0.16)]',
                skillTab === t.name
                  ? 'border-violet-line bg-[linear-gradient(180deg,#fff_0%,#f8f3fc_100%)] font-600 text-violet-ink shadow-[0_1px_2px_rgba(31,35,41,0.05)]'
                  : 'border-transparent bg-transparent text-muted hover:text-ink',
                T_SEG,
                FOCUS,
              ]"
              @click="skillTab = t.name"
            >
              {{ t.name }}
            </button>
          </div>
          <div class="relative flex min-h-0 flex-1 flex-col">
            <div class="flex min-h-0 flex-1 flex-col gap-2px overflow-y-auto pb-10px pt-2px">
              <span v-if="skillTab === MY_SKILL_GROUP" class="mb-6px flex flex-none">
                <button
                  type="button"
                  :class="[
                    'flex h-34px w-full items-center justify-center gap-5px rounded-6px border border-dashed border-control bg-transparent text-12px text-muted cursor-pointer hover:(border-violet-line text-violet-ink)',
                    FOCUS,
                  ]"
                  @click="openSkillCreate"
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
                  新建技能
                </button>
              </span>
              <button
                v-for="s in tabSkills"
                :key="s.agentSkillId"
                type="button"
                :aria-pressed="pendingSkillId === s.agentSkillId"
                :class="[
                  'flex h-44px w-full flex-none items-center gap-10px rounded-6px border border-solid px-10px text-left cursor-pointer',
                  pendingSkillId === s.agentSkillId
                    ? 'border-violet-line bg-[linear-gradient(#fff,#f8f3fc)] shadow-[0_1px_2px_rgba(31,35,41,0.05)]'
                    : 'border-transparent bg-transparent hover:bg-surface2',
                  T_CARD,
                  FOCUS,
                ]"
                @click="pendingSkillId = s.agentSkillId"
              >
                <span
                  class="grid h-32px w-32px flex-none place-items-center rounded-6px border border-solid border-line bg-[linear-gradient(135deg,#f6effa,#efe6f5)] text-12px font-600 text-violet-ink"
                  aria-hidden="true"
                  >{{ skillInitial(s) }}</span
                >
                <span class="flex min-w-0 flex-1 flex-col gap-1px">
                  <span
                    :class="[
                      'flex items-center gap-5px text-13px leading-18px',
                      pendingSkillId === s.agentSkillId ? 'font-600 text-violet-ink' : 'font-500 text-ink',
                    ]"
                  >
                    <span class="truncate">{{ s.title }}</span>
                    <span
                      v-if="versionLabel(s)"
                      class="flex-none rounded-2px bg-violet-soft px-3px text-9px font-400 leading-14px text-violet-ink"
                      >{{ versionLabel(s) }}</span
                    >
                  </span>
                  <span v-if="s.description" class="truncate text-11px leading-16px text-muted">{{
                    s.description
                  }}</span>
                </span>
                <svg
                  v-if="pendingSkillId === s.agentSkillId"
                  class="h-14px w-14px flex-none text-violet"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <path :d="ICON.checkCircle" />
                </svg>
              </button>
              <template v-if="skillTab === MY_SKILL_GROUP">
                <div
                  v-for="u in userSkills"
                  :key="`u${u.userSkillId}`"
                  class="flex min-h-44px w-full flex-none items-center gap-10px rounded-6px border border-solid border-transparent px-10px hover:bg-surface2"
                >
                  <span
                    class="grid h-32px w-32px flex-none place-items-center rounded-6px border border-solid border-line bg-[linear-gradient(135deg,#f6effa,#efe6f5)] text-12px font-600 text-violet-ink"
                    aria-hidden="true"
                    >{{ Array.from(u.title?.trim() || '技')[0] }}</span
                  >
                  <span class="flex min-w-0 flex-1 flex-col gap-1px">
                    <span class="truncate text-13px font-500 leading-18px text-ink">{{ u.title }}</span>
                    <span v-if="u.updatedAt || u.createdAt" class="truncate text-11px leading-16px text-muted">{{
                      dayLabel(u.updatedAt || u.createdAt)
                    }}</span>
                  </span>
                  <template v-if="skillDeleteId === u.userSkillId">
                    <span class="flex-none text-11px text-muted">确认删除？</span>
                    <button
                      type="button"
                      :disabled="skillDeleting"
                      :class="[BTN_SM, '!h-26px !px-8px text-danger', BTN_DEFAULT, FOCUS]"
                      @click="confirmSkillDelete(u)"
                    >
                      删除
                    </button>
                    <button
                      type="button"
                      :class="[BTN_SM, '!h-26px !px-8px', BTN_GHOST, FOCUS]"
                      @click="skillDeleteId = null"
                    >
                      取消
                    </button>
                  </template>
                  <template v-else>
                    <button
                      type="button"
                      title="编辑"
                      :aria-label="`编辑技能：${u.title}`"
                      :disabled="skillFormLoading"
                      :class="[BTN_SM, '!h-26px !w-26px !px-0', BTN_GHOST, FOCUS]"
                      @click="openSkillEdit(u)"
                    >
                      <svg
                        class="h-13px w-13px"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        aria-hidden="true"
                      >
                        <path :d="ICON.edit" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      title="删除"
                      :aria-label="`删除技能：${u.title}`"
                      :class="[BTN_SM, '!h-26px !w-26px !px-0', BTN_GHOST, FOCUS]"
                      @click="skillDeleteId = u.userSkillId"
                    >
                      <svg
                        class="h-13px w-13px"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        aria-hidden="true"
                      >
                        <path :d="ICON.trash" />
                      </svg>
                    </button>
                  </template>
                </div>
                <div v-if="userSkillPage < userSkillPages" class="py-6px text-center">
                  <button
                    type="button"
                    :disabled="userSkillLoading"
                    :class="['ll-link border-none bg-transparent text-11px', FOCUS]"
                    @click="loadUserSkills()"
                  >
                    加载更多
                  </button>
                </div>
                <div v-if="userSkillLoading && !userSkills.length" class="flex justify-center py-26px">
                  <n-spin size="small" />
                </div>
              </template>
              <div
                v-if="!tabSkills.length && (skillTab !== MY_SKILL_GROUP || (!userSkills.length && !userSkillLoading))"
                class="px-12px py-26px text-center text-11px leading-18px text-placeholder"
              >
                {{ skillTab === MY_SKILL_GROUP ? '暂无自建技能' : '暂无技能' }}
              </div>
            </div>
            <span
              class="pointer-events-none absolute bottom-0 left-0 right-0 h-18px bg-[linear-gradient(rgba(255,255,255,0),#fff)]"
              aria-hidden="true"
            />
          </div>
        </div>
        <div
          v-if="!skillForm"
          class="flex flex-none justify-end gap-8px border-t border-solid border-line-soft px-18px py-10px"
        >
          <button type="button" :class="[BTN_SM, BTN_DEFAULT, FOCUS]" @click="skillDialogShow = false">取消</button>
          <button type="button" :disabled="!pendingSkillId" :class="[BTN_SM, BTN_PRIMARY, FOCUS]" @click="confirmSkill">
            确认
          </button>
        </div>
      </div>
    </n-modal>

    <!-- 分享链接：生成后自动复制，复制失败时可在这里手动复制 -->
    <n-modal v-model:show="shareLinkShow">
      <div role="dialog" aria-modal="true" aria-labelledby="agent-share-dialog-title" :class="[MODAL, 'w-480px']">
        <div :class="MODAL_HEAD">
          <strong id="agent-share-dialog-title" class="text-15px font-600 leading-20px text-ink">分享链接</strong>
          <button type="button" aria-label="关闭" :class="[MODAL_X, FOCUS]" @click="shareLinkShow = false">
            <svg
              class="h-16px w-16px"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path :d="ICON.x" />
            </svg>
          </button>
        </div>
        <div class="flex flex-col gap-8px px-18px py-16px">
          <label for="agent-share-link" class="text-11px leading-16px text-muted"
            >拿到链接的人无需登录即可查看所选轮次</label
          >
          <input
            id="agent-share-link"
            ref="shareLinkInputEl"
            :value="shareLink"
            readonly
            :class="[
              'h-32px w-full rounded-4px border border-solid border-control bg-surface3 px-10px text-12px text-ink-2 outline-none',
              FOCUS,
            ]"
            @focus="($event.target as HTMLInputElement).select()"
          />
        </div>
        <div class="flex flex-none justify-end gap-8px border-t border-solid border-line-soft px-18px py-10px">
          <button type="button" :class="[BTN_SM, BTN_DEFAULT, FOCUS]" @click="shareLinkShow = false">完成</button>
          <button type="button" :class="[BTN_SM, BTN_PRIMARY, FOCUS]" @click="copyShareLink">复制链接</button>
        </div>
      </div>
    </n-modal>

    <!-- 上传素材：照原型 .upload-modal（820×600、胶囊页签、虚线投放区）；本地上传走商拍工作室同一条直传，资产页签复用资产选择器 -->
    <n-modal v-model:show="imageDialogShow" @after-leave="imagePillEl?.focus()">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-image-dialog-title"
        :class="[MODAL, 'h-600px w-820px']"
      >
        <div :class="MODAL_HEAD">
          <strong id="agent-image-dialog-title" class="text-15px font-600 leading-20px text-ink">上传素材</strong>
          <span class="rounded-3px bg-surface3 px-5px py-1px text-10.5px text-#a3a9b2">Ctrl + V 粘贴图片</span>
          <button type="button" aria-label="关闭" :class="[MODAL_X, FOCUS]" @click="imageDialogShow = false">
            <svg
              class="h-16px w-16px"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path :d="ICON.x" />
            </svg>
          </button>
        </div>
        <div role="group" aria-label="素材来源" class="flex flex-none flex-wrap gap-4px px-18px pb-10px pt-12px">
          <span v-for="t in IMAGE_TABS" :key="t.key" :title="t.soon ? SOON : undefined" class="inline-flex">
            <button
              type="button"
              :disabled="t.soon"
              :aria-pressed="imageTab === t.key"
              :class="[
                'h-32px rounded-full border border-solid px-12px text-13px cursor-pointer disabled:(cursor-default opacity-45)',
                imageTab === t.key
                  ? 'border-violet-line bg-violet-soft font-600 text-violet-ink'
                  : 'border-line bg-white text-ink-2 enabled:hover:(border-control bg-surface2)',
                FOCUS,
              ]"
              @click="imageTab = t.key"
            >
              {{ t.label }}
            </button>
          </span>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto px-18px pb-14px">
          <div
            v-if="imageTab === 'local'"
            :class="[
              'box-border flex h-full min-h-340px flex-col items-center justify-center gap-8px rounded-8px border border-dashed text-11px text-#a3a9b2',
              dragging ? 'border-violet bg-violet-soft' : 'border-control bg-#fcfcfd',
            ]"
            @dragover.prevent="dragging = true"
            @dragleave.prevent="dragging = false"
            @drop.prevent="onDrop"
          >
            <span
              class="grid h-44px w-44px place-items-center rounded-10px bg-surface3 text-#b3b9c2"
              aria-hidden="true"
            >
              <n-spin v-if="uploading" size="small" />
              <svg
                v-else
                class="h-22px w-22px"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linejoin="round"
              >
                <path :d="ICON.image" />
              </svg>
            </span>
            <b class="text-12.5px font-500 text-ink-2">选择本地图片</b>
            <span>{{ IMAGE_FORMATS }}</span>
            <span>当前还能添加 {{ imageRoom }} 张图片</span>
            <button
              type="button"
              :disabled="uploading"
              :aria-busy="uploading"
              :class="[BTN_SM, BTN_PRIMARY, FOCUS]"
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
            class="box-border flex h-full min-h-340px flex-col items-center justify-center gap-8px rounded-8px border border-dashed border-control bg-#fcfcfd text-11px text-#a3a9b2"
          >
            <span>当前还能添加 {{ imageRoom }} 张图片</span>
            <button type="button" :class="[BTN_SM, BTN_PRIMARY, FOCUS]" @click="openAssetPicker">从资产库添加</button>
          </div>
        </div>
      </div>
    </n-modal>

    <BatchHostingModal
      v-model:show="batchShow"
      :skill-id="selectedSkillId"
      :skill-title="selectedSkill?.title ?? ''"
      :language-label="languageLabel"
      :language-name="selectedLanguage.value ? selectedLanguage.name : ''"
    />

    <AssetPickerModal v-model:show="assetPickerShow" :limit="Math.max(imageRoom, 1)" @select="onAssetSelect" />
  </n-config-provider>
</template>

<style>
/*
 * 只留 @keyframes：UnoCSS 的 animate-[…] 只引用名字，关键帧本身写不成原子类。
 * 不加 scoped——scoped 会给关键帧名加哈希，模板里的原子类就对不上了；名字带 agent- 前缀避免撞名。
 * 数值照抄原型 BounceBallIcon.vue（1300ms · 18px · 落地 1.10/.90 · 起跳 1.08/.92），空态云影球 hover 弹跳用。
 */
@keyframes agent-ball-jump {
  0% {
    transform: translateY(0);
    animation-timing-function: ease-in;
  }
  10% {
    transform: translateY(2px);
    animation-timing-function: cubic-bezier(0.16, 0.84, 0.44, 1);
  }
  20% {
    transform: translateY(-8px);
    animation-timing-function: ease-out;
  }
  40% {
    transform: translateY(-18px);
    animation-timing-function: cubic-bezier(0.55, 0, 0.85, 0.36);
  }
  60% {
    transform: translateY(-10px);
    animation-timing-function: ease-in;
  }
  72% {
    transform: translateY(-2px);
    animation-timing-function: cubic-bezier(0.55, 0, 0.85, 0.36);
  }
  78% {
    transform: translateY(0);
    animation-timing-function: cubic-bezier(0.16, 0.84, 0.44, 1);
  }
  88% {
    transform: translateY(-4px);
    animation-timing-function: ease-in;
  }
  95% {
    transform: translateY(0);
    animation-timing-function: ease-out;
  }
  100% {
    transform: translateY(0);
  }
}
@keyframes agent-ball-shell {
  0% {
    transform: scale(1, 1);
  }
  10% {
    transform: scale(1.08, 0.92);
  }
  20% {
    transform: scale(0.97, 1.05);
  }
  40% {
    transform: scale(1, 1);
  }
  60% {
    transform: scale(0.99, 1.02);
  }
  78% {
    transform: scale(1.1, 0.9);
  }
  88% {
    transform: scale(0.98, 1.03);
  }
  95% {
    transform: scale(1.05, 0.96);
  }
  100% {
    transform: scale(1, 1);
  }
}
@keyframes agent-ball-ground {
  0% {
    transform: scale(0.85, 0.8);
    opacity: 0.75;
  }
  10% {
    transform: scale(0.82, 0.9);
    opacity: 0.98;
  }
  20% {
    transform: scale(0.95, 0.75);
    opacity: 0.55;
  }
  40% {
    transform: scale(1.15, 0.75);
    opacity: 0.3;
  }
  60% {
    transform: scale(1.02, 0.8);
    opacity: 0.55;
  }
  78% {
    transform: scale(0.78, 0.95);
    opacity: 1;
  }
  88% {
    transform: scale(0.9, 0.8);
    opacity: 0.65;
  }
  95% {
    transform: scale(0.82, 0.9);
    opacity: 0.95;
  }
  100% {
    transform: scale(0.85, 0.8);
    opacity: 0.75;
  }
}
</style>
