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
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, useId, watch } from 'vue'
import { NConfigProvider, NInput, NModal, NPopover, NSpin, useDialog, useMessage } from 'naive-ui'
import { useRoute, useRouter } from 'vue-router'
import { llTheme } from '@/views/local-life/theme.ts'
import { toApiError } from '@/api'
import {
  AGENT_LANGUAGES,
  agentCancel,
  agentConversations,
  agentCreateConversation,
  agentDeleteConversation,
  agentGenerationRetry,
  agentImageQuote,
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
  IAgentImageQuote,
  IAgentMessage,
  IAgentQuestion,
  IAgentQuestionOption,
  IAgentReply,
  IAgentSkill,
  IAgentSkillGroup,
  IAgentStreamReq,
  IAgentToolResult,
  IUserSkill,
} from '@/api/agent.ts'
import AssetPickerModal from '@/views/studio/components/AssetPickerModal/index.vue'
import { DROP_PASTE_HINT, useFileDropPaste } from '@/composables/useFileDropPaste'
import { useStudioUploader } from '@/views/studio/components/StudioImageUpload/useStudioUploader.ts'
import { PromptWriteButton } from '@/components/PromptWrite'
import { canvasCreate, canvasUploadMedia } from '@/api/canvas-home.ts'
import { stashCanvasImport } from '@/utils/canvas-import-handoff.ts'
import { createSafeUuid } from '@/utils/utils.ts'
import { renderMiniMarkdown } from '@/utils/mini-markdown.ts'

/** 已定稿消息的 Markdown 渲染缓存（按原文）：流式每个 delta 只重解析正在生成的那条，不重扫全部历史 */
const mdCache = new Map<string, string>()
function renderReplyHtml(text: string, live?: boolean): string {
  if (live) return renderMiniMarkdown(text)
  let html = mdCache.get(text)
  if (html === undefined) {
    if (mdCache.size >= 300) mdCache.clear()
    html = renderMiniMarkdown(text)
    mdCache.set(text, html)
  }
  return html
}
import BatchHostingModal from './BatchHostingModal.vue'
import TemplateBrowser from './TemplateBrowser.vue'
import IconButton from '@/components/IconButton/index.vue'
import MediaLightbox from '@/components/MediaLightbox/index.vue'
import {
  ColorFixDialog,
  bakeForUpload,
  bakeStoredColorFix,
  hasStoredColorFix,
  triggerDownload,
  type ResultColorFix,
} from '@/components/ColorFix'
import { loadRegion } from '@/components/ColorFix/mask-store.ts'
import { colorFixFailureText, colorFixFilter, loadColorFix } from '@/utils/colorfix.ts'
import { downloadImage, downloadImagesAsZip } from '@/utils/download.ts'
import { getPointsBalance } from '@/api/points.ts'
import { BILLING_BLOCK_CODES, emitBillingBlock } from '@/utils/billing-guide'
import { findPlazaTemplate } from '@/api/plaza.ts'
import type { IPlazaTemplate } from '@/api/plaza.ts'

defineOptions({ name: 'agent-chat' })

const message = useMessage()
const dialog = useDialog()
const router = useRouter()
const route = useRoute()

/*
 * 按钮 / 弹窗常量：照原型 5185 AgentView.vue「按钮规范」(:2029-2049) 的白瓷材质（uno.config.ts sx-soft-*）。
 * 工具钮 28 高 r14、12px、灰字，悬停藤紫细线 + 藤紫字；主钮藤紫渐变；危险白底 #f0c9c7 线 #c24545 字。
 */
const BTN = 'sx-soft-btn'
const BTN_PRIMARY = 'sx-soft-btn sx-soft-btn-primary'
const BTN_TINT = 'sx-soft-btn sx-soft-btn-tint'
const BTN_DANGER = 'sx-soft-btn sx-soft-btn-danger'
/** 弹窗：r18 白瓷外壳（.agent-modal） */
const MODAL =
  'agent-modal sx-squircle flex max-h-[calc(100vh-48px)] max-w-[calc(100vw-48px)] flex-col overflow-hidden rounded-18px border border-solid border-line bg-white shadow-pop'
/** 弹窗头：52 高、内边距 0 10 0 18 */
const MODAL_HEAD =
  'relative flex h-52px flex-none items-center gap-8px border-b border-solid border-line pl-18px pr-10px'
/** 关闭钮：与全局 Naive 关闭钮同档——视觉 28、命中 32（触屏 40） */
const MODAL_X =
  'relative ml-auto grid h-28px w-28px flex-none place-items-center rounded-full border-none bg-transparent p-0 text-#8a919c cursor-pointer hover:(bg-surface3 text-ink) after:(content-empty absolute -inset-2px rounded-full) [@media(pointer:coarse)]:after:-inset-6px'
/** 文字链（加载更多等）：12px、28 高 */
const LINK_BTN =
  'h-28px rounded-14px border-none bg-transparent px-10px text-12px text-violet-ink cursor-pointer hover:(bg-violet-tint text-violet-press) disabled:(cursor-not-allowed opacity-50) sx-focus'
/** 首页快捷入口：32 高胶囊 */
const QUICK = '!h-32px !rounded-16px !px-14px !text-13px'
/** 会话卡（原型 .conv-card :1543-1546）：白瓷面、内边距 10 14 10 10；悬停加深描边 + 浮起；选中藤紫细线 + 白 → #faf4fd */
const CONV_CARD =
  'sx-squircle group relative flex items-center gap-10px rounded-18px border border-solid py-10px pl-10px pr-14px [transition:border-color_.11s,background_.11s,box-shadow_.11s] motion-reduce:transition-none'
const CONV_ON =
  'border-#dcc9e9 bg-[linear-gradient(#fff,#faf4fd)] shadow-[0_1px_2px_rgba(31,35,41,0.05),inset_0_1px_0_#fff]'
const CONV_OFF =
  'sx-soft hover:(border-#aeb4b9 shadow-[0_8px_18px_rgba(31,35,41,0.09),inset_0_1px_0_#fff,inset_0_-3px_6px_rgba(31,35,41,0.04)])'
/** 会话卡里的改名 / 删除：视觉 20 r4，命中外扩到 32（两颗之间 12，外扩 6 不互相覆盖） */
const CONV_ACT =
  'relative grid h-20px w-20px place-items-center rounded-4px border-none bg-transparent p-0 text-muted cursor-pointer after:(content-empty absolute -inset-6px) sx-focus'
/** 会话标题上限：与服务端 @Size(max=120) 一致（CreaftV1CoreAgentController 改名请求） */
const TITLE_MAX = 120
/** 消息悬停操作：视觉 22 圆钮，命中 32（竖排间距 10，外扩 5） */
const MSG_TOOL =
  'relative grid h-22px w-22px place-items-center rounded-full border border-solid border-line bg-white p-0 text-#a3a9b2 shadow-[0_1px_2px_rgba(31,35,41,0.04)] cursor-pointer hover:(border-control-hover text-ink) after:(content-empty absolute -inset-5px rounded-full) sx-focus'
/** 结果图悬停操作（原型 .shot-ops）：22 高白瓷，命中 32（间距 10，外扩 5） */
const SHOT_OP =
  'relative inline-grid h-22px flex-none place-items-center rounded-11px sx-soft p-0 text-12px leading-none text-ink-2 cursor-pointer [transition:transform_.1s,box-shadow_.1s,border-color_.1s,color_.1s] enabled:hover:(border-violet-line bg-none bg-white text-violet-ink) enabled:active:(translate-y-1px scale-96 shadow-[inset_0_2px_4px_rgba(31,35,41,0.14)]) disabled:(cursor-not-allowed opacity-60) after:(content-empty absolute -inset-5px rounded-[inherit]) sx-focus'
/** 表单选项（原型 .opt）：36 高 r18、单选圆点；选中藤紫细线 + 白 → #f8f3fc */
const OPT =
  'sx-squircle flex min-h-36px min-w-0 items-center gap-8px rounded-18px border border-solid px-14px py-6px text-left text-13px leading-20px cursor-pointer disabled:cursor-default [transition:border-color_.12s,background_.12s] motion-reduce:transition-none sx-focus'
const OPT_OFF = 'border-line bg-white text-ink-2 enabled:hover:border-control-hover'
const OPT_ON = 'border-violet-line bg-[linear-gradient(#fff,#f8f3fc)] font-500 text-ink'
/** 技能卡（原型 .skill-card）：64 高 r18 白瓷 */
const SKILL_CARD =
  'sx-squircle flex h-64px min-w-0 items-center gap-10px rounded-18px border border-solid px-14px text-left [transition:border-color_.11s,background_.11s,box-shadow_.11s] motion-reduce:transition-none'
const SKILL_ON = 'border-violet-line bg-[linear-gradient(#fff,#f8f3fc)] shadow-soft'
const SKILL_OFF = 'sx-soft hover:(border-control bg-[linear-gradient(#fff,#fbfcfd)])'
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
  doc: 'M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M9 13h6M9 17h6',
  copy: 'M9 9h10v11H9zM5 15V5a1 1 0 0 1 1-1h9',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  expand: 'M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7',
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
/** 弹窗右上角「搜索技能」：只在当前页签里按名称 / 说明过滤（接口无搜索参数） */
const skillQuery = ref('')
const skillMatch = (title?: string | null, desc?: string | null) => {
  const q = skillQuery.value.trim().toLowerCase()
  return !q || `${title ?? ''} ${desc ?? ''}`.toLowerCase().includes(q)
}
const tabSkills = computed(() =>
  (skillTabs.value.find((t) => t.name === skillTab.value)?.skills ?? []).filter((s) =>
    skillMatch(s.title, s.description),
  ),
)

function openSkillDialog() {
  if (streaming.value) return
  pendingSkillId.value = selectedSkillId.value
  skillQuery.value = ''
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

// 「收藏资产」页签已去掉：资产选择器没有「收藏」筛选，之前一直是置灰的死入口
const IMAGE_TABS = [
  { key: 'local', label: '本地上传' },
  { key: 'generated', label: '最近生成' },
  { key: 'upload', label: '最近上传' },
  { key: 'model', label: '模特库' },
] as const
type ImageTab = (typeof IMAGE_TABS)[number]['key']

const imageDialogShow = ref(false)
const imageTab = ref<ImageTab>('local')
const assetPickerShow = ref(false)
const imageDialogEl = ref<HTMLElement | null>(null)
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
}

function removeImage(i: number) {
  if (streaming.value) return
  attachments.value = attachments.value.filter((_, idx) => idx !== i)
}

function openImageDialog() {
  if (streaming.value) return
  imageTab.value = 'local'
  imageDialogShow.value = true
}

/** 本地 / 粘贴共用：格式按原型四种拦，余量与上传走商拍工作室同一条直传 */
const UPLOAD_BUSY = '图片还在上传，请稍候'

async function uploadLocal(files: File[]) {
  if (!files.length) return
  if (uploading.value) {
    // 上传器一次只跑一批：新选的这批不排队，明确告诉用户被忽略了
    message.warning(`上一批图片还在上传，新选的 ${files.length} 张未添加，请稍后再试`)
    return
  }
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

// 上传素材弹窗：整个弹窗都是放置 / 粘贴目标（任一页签下都能直接拖入或 Ctrl+V），资产选择器叠在上面时归它
const { dragging } = useFileDropPaste(imageDialogEl, {
  accept: 'image',
  multiple: true,
  full: () => imageRoom.value <= 0,
  rejectMessage: () => IMAGE_FORMATS,
  onFiles: (files) => void uploadLocal(files),
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
  cancelShare()
  clearTemplate()
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
    message.success('已保存')
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
  /** 重试时随同发送的广场模板（做同款） */
  retryTemplate?: IPlazaTemplate | null
  /** 本轮结果未知（断网 / 超时 / 5xx）时它用过的 X-Request-Id：重试原样沿用；确定失败为空（重试换新 key） */
  retryKey?: string
  /** 会话里的轮次号（从 1 起，按服务端消息顺序两条一轮，分享按它选）；本地新发、尚未回读的为空 */
  turnNo?: number
  /** 本轮的 turnId 与已收到的最大 sequence：续流时据此只取游标之后的帧 */
  turnId?: string
  lastSeq?: number
  /** 用户消息透传的表单数据（历史回读；表单续答的答案在 attribute.answers） */
  attribute?: Record<string, unknown>
  /** 本条回复带参数确认表单时的作答状态 */
  form?: FormState
  /** 思考过程展开 / 收起；未操作过（undefined）= 生成中展开、结束后收起 */
  thinkOpen?: boolean
}

interface FormState {
  answers: Record<string, IAgentAnswer>
  submitting: boolean
  /** 已提交（受理）或已被后续消息取代：只读 */
  done: boolean
  /** 没作答就被后面的消息取代（done 时区分「已确认」与「已失效」） */
  superseded?: boolean
  /** 提交未受理时的错误 */
  error: string
  /** 逐题作答：当前第几题（从 0 起） */
  step: number
  /** 当前题的行内提示（必填未答） */
  stepError: string
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
/** 页面已卸载：轮询、续流、新请求一律不再发起 */
let disposed = false

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

/** 回复带表单而还没有作答状态时建一份（按服务端默认值预选）；restored = 历史里该表单已提交的答案 */
function initForm(item: ChatItem, restored?: Record<string, IAgentAnswer> | null) {
  const form = item.reply.form
  if (!form || item.form) return
  const answers: Record<string, IAgentAnswer> = {}
  for (const q of form.questions) answers[q.id] = restored?.[q.id] ?? initialAnswer(q)
  item.form = { answers, submitting: false, done: false, error: '', step: 0, stepError: '' }
}

/** 历史回读后：给每张表单建状态；后面已有消息的表单视为已结束，下一条若是续答就读回答案 */
function seedForms(list: ChatItem[]) {
  list.forEach((item, i) => {
    if (item.role !== 'assistant' || !item.reply.form) return
    const next = list[i + 1]
    const restored = next?.role === 'user' ? answersFromAttribute(item.reply.form, next.attribute) : null
    const fresh = !item.form
    initForm(item, restored)
    if (next && item.form && !item.form.done) {
      item.form.done = true
      // 下一条是用户消息却不是本表单的续答（用户直接发了新消息）：已失效，不把服务端默认值当作「已确认」的答案。
      // 下一条是助手消息（续答那条用户消息被隐藏）时仍按已提交处理
      if (fresh && !restored && next.role === 'user') item.form.superseded = true
    }
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
  item.form!.stepError = ''
}

/** 两级题的子项：答案为 [父 id, 子 id] */
function pickChild(item: ChatItem, q: IAgentQuestion, parent: IAgentQuestionOption, child: IAgentQuestionOption) {
  if (!formOpen(item)) return
  formAnswer(item, q).selected = [parent.id, child.id]
  item.form!.error = ''
  item.form!.stepError = ''
}

function setAnswerText(item: ChatItem, q: IAgentQuestion, v: string) {
  if (!formOpen(item)) return
  formAnswer(item, q).text = v
  item.form!.error = ''
  item.form!.stepError = ''
}

const STEP_REQUIRED = '这道题是必填'

/** 当前题（越界时夹到最后一题） */
function formQuestion(item: ChatItem): IAgentQuestion | undefined {
  const qs = item.reply.form?.questions ?? []
  return qs[Math.min(item.form?.step ?? 0, qs.length - 1)]
}

function isLastStep(item: ChatItem): boolean {
  return (item.form?.step ?? 0) >= (item.reply.form?.questions.length ?? 1) - 1
}

function formPrev(item: ChatItem) {
  const s = item.form
  if (!s || s.step <= 0) return
  s.step -= 1
  s.stepError = ''
}

/** 下一步：必填题没答就停在本题并行内提示 */
function formNext(item: ChatItem) {
  const s = item.form
  const q = formQuestion(item)
  if (!s || !q || !formOpen(item)) return
  if (q.required && !answerReady(q, s.answers[q.id])) {
    s.stepError = STEP_REQUIRED
    return
  }
  s.stepError = ''
  s.step += 1
}

/** 表单回车 / 主按钮：不是最后一题就翻页；最后一题先跳到第一道没答的必填题，否则提交 */
function onFormSubmit(item: ChatItem) {
  const s = item.form
  const form = item.reply.form
  if (!s || !form || !formOpen(item)) return
  if (!isLastStep(item)) return formNext(item)
  const missing = form.questions.findIndex((q) => q.required && !answerReady(q, s.answers[q.id]))
  if (missing >= 0) {
    s.step = missing
    s.stepError = STEP_REQUIRED
    return
  }
  void submitForm(item)
}

/** 摘要卡一行的答案文字：选项名（两级题「父 / 子」）+ 补充文字；没答为空 */
function answerText(q: IAgentQuestion, a: IAgentAnswer | undefined): string {
  if (!a) return ''
  const labels: string[] = []
  if (isNestedQuestion(q)) {
    const parent = q.options.find((o) => o.id === a.selected[0])
    if (parent) {
      labels.push(parent.label)
      const child = parent.children.find((c) => c.id === a.selected[a.selected.length - 1])
      if (child) labels.push(child.label)
    }
  } else {
    for (const id of a.selected) {
      const o = q.options.find((x) => x.id === id)
      if (o) labels.push(o.label)
    }
  }
  const text = q.allowText ? a.text.trim() : ''
  return [labels.join(' / '), text].filter(Boolean).join(' · ')
}

function answeredCount(item: ChatItem): number {
  const form = item.reply.form
  return form ? form.questions.filter((q) => answerReady(q, item.form?.answers[q.id])).length : 0
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
  const ctrl = newController()
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
        signal: ctrl.signal,
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
    if (controller === ctrl) controller = null
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
  clearTemplate()
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

/** 建本次流的 AbortController；卸载后才建的（例如 await 建会话期间离开页面）立即中止 */
function newController(): AbortController {
  const c = new AbortController()
  if (disposed) c.abort()
  controller = c
  return c
}

/** 结果未知（服务端可能已受理）才沿用原 X-Request-Id：断网 / 超时 / 5001 / 无业务码 5xx / 非请求层错误 */
function outcomeUnknown(err: unknown): boolean {
  const e = toApiError(err)
  if (!e) return true
  if (e.isNetwork) return true
  if (e.code === 5001 || e.reason === 'SYSTEM_ERROR') return true
  return e.code === -1 && (e.httpStatus ?? 0) >= 500
}

const textareaEl = ref<HTMLTextAreaElement | null>(null)

/** 输入框随内容长高：最低 78（原型 .ref-composer textarea），最高 200 后内部滚动 */
const DRAFT_MAX_H = 200
function autosize() {
  const el = textareaEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, DRAFT_MAX_H)}px`
}

watch(draft, () => void nextTick(autosize))

function onDraftInput(v: string) {
  // 幂等 key 绑在失败的那一轮上（ChatItem.retryKey），打字不影响任何已存的重试 key
  draft.value = v
}

// ---------------- 输入框直接粘贴 / 拖入图片（复用本地上传的同一条直传与上限） ----------------

const ATTACH_BUSY = '回复生成中，稍后再添加图片'
const composerEl = ref<HTMLElement | null>(null)

// 整个输入框是放置目标；也是本页的主粘贴目标（没悬停在别的上传区上、焦点不在别的输入框时粘贴的图片都进这里）。
// 文本框里粘贴：剪贴板带文字按文字粘贴，只有图片时当附件上传（路由规则见 useFileDropPaste）
const { dragging: composerDragging } = useFileDropPaste(composerEl, {
  accept: 'image',
  multiple: true,
  pastePrimary: true,
  full: () => imageRoom.value <= 0,
  disabled: streaming,
  disabledMessage: ATTACH_BUSY,
  rejectMessage: () => IMAGE_FORMATS,
  onFiles: (files) => void uploadLocal(files),
})

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

// ---------------- 首页模板（广场模板「做同款」，StreamRequest.plazaTemplateId） ----------------

/**
 * 新对话首页 = 原型 5185 的模板首页：大标题 + 输入框 + 模板浏览。输入框只有一份，
 * 首页时用 Teleport 挪进标题下方的槽位，进入对话后回到底栏，状态 / ref 都不变。
 */
const isHome = computed(() => !msgLoading.value && !items.value.length)
const homeDockId = `agent-home-dock-${useId()}`
const homeDockEl = ref<HTMLElement | null>(null)

/**
 * 选中的广场模板：模板的提示词由服务端按 plazaTemplateId 从库里取（列表接口摘掉了 prompt），
 * 页面只负责带上 id、切到模板关联的技能，并在输入框为空时预填一句说明（服务端要求 content 非空）。
 * 本轮受理后清掉，模板只作用于这一轮。
 */
const selectedTemplate = ref<IPlazaTemplate | null>(null)
/** 上次预填进输入框的文字：用户没改过才允许换模板时覆盖 */
let templateFill = ''

function templatePrefill(t: IPlazaTemplate): string {
  const d = t.payload?.description
  const desc = typeof d === 'string' ? d.trim() : ''
  return desc ? `参考「${t.title}」模板做同款：${desc}` : `参考「${t.title}」模板做同款`
}

function pickTemplate(t: IPlazaTemplate) {
  if (streaming.value) return
  selectedTemplate.value = t
  // 与「选择技能」弹窗同一条路径：模板关联的技能在对话目录里才切换，否则沿用当前技能
  const sid = t.agentSkillId
  if (sid) {
    if (skills.value.some((s) => s.agentSkillId === sid)) pickSkill(sid)
    else if (skills.value.length) message.info('该模板关联的技能当前不可用，已沿用当前技能')
  }
  if (!draft.value.trim() || draft.value === templateFill) {
    templateFill = templatePrefill(t)
    onDraftInput(templateFill)
  }
  void nextTick(() => {
    homeDockEl.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    textareaEl.value?.focus({ preventScroll: true })
  })
}

/** 技能目录首次加载：深链选模板要等它，否则 pickTemplate 判不出模板关联的技能是否可用 */
let skillsReady: Promise<void> = Promise.resolve()
let deepLinkSeq = 0

/**
 * 创意广场「一键复刻」深链 /agent?plazaTemplateId=<id>：按 id 找到模板后走首页模板浏览同一条
 * pickTemplate 路径（切技能 + 预填）。
 * - 找到 / 确认找不到后才把参数从地址栏摘掉（刷新不会重复套用）；
 * - 网络 / 接口失败提示「模板加载失败，请稍后重试」并保留参数，下次进入页面（或刷新）自动再试；
 * - 确认不存在（下架 / 非法 id）提示「模板已下架或不可用」；
 * - 正在回复时先记下，等这轮回复结束再套用（见下方 streaming 的 watch），不直接丢弃。
 */
let deferredDeepLinkTemplate: IPlazaTemplate | null = null

async function applyPlazaTemplateQuery() {
  const raw = route.query.plazaTemplateId
  const idText = Array.isArray(raw) ? raw[0] : raw
  if (!idText) return
  const mine = ++deepLinkSeq
  const stripQuery = () => {
    if (route.query.plazaTemplateId !== raw) return
    const rest = { ...route.query }
    delete rest.plazaTemplateId
    void router.replace({ query: rest })
  }
  const id = Number(idText)
  if (!Number.isFinite(id) || id <= 0) {
    stripQuery()
    message.warning('模板已下架或不可用')
    return
  }
  let template: IPlazaTemplate | null
  try {
    ;[template] = await Promise.all([findPlazaTemplate(id), skillsReady])
  } catch {
    if (disposed || mine !== deepLinkSeq) return
    message.error('模板加载失败，请稍后重试')
    return
  }
  if (disposed || mine !== deepLinkSeq) return
  stripQuery()
  if (!template) {
    message.warning('模板已下架或不可用')
    return
  }
  applyDeepLinkTemplate(template)
}

function applyDeepLinkTemplate(template: IPlazaTemplate) {
  if (streaming.value) {
    deferredDeepLinkTemplate = template
    message.info('当前回复结束后将开启新对话并套用模板')
    return
  }
  // 模板只作用于新对话首页
  if (activeId.value || items.value.length) newConversation()
  pickTemplate(template)
}
watch(streaming, (on) => {
  if (on || !deferredDeepLinkTemplate || disposed) return
  const template = deferredDeepLinkTemplate
  deferredDeepLinkTemplate = null
  applyDeepLinkTemplate(template)
})
watch(
  () => route.query.plazaTemplateId,
  () => void applyPlazaTemplateQuery(),
)

function clearTemplate() {
  if (!selectedTemplate.value) return
  selectedTemplate.value = null
  templateFill = ''
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
    void send(draft.value, attachments.value, selectedTemplate.value, { fromDraft: true })
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

interface SendOptions {
  /** 内容来自输入框：受理前就清空草稿（重试传的是旧内容，不能动用户正在写的草稿） */
  fromDraft?: boolean
  /** 重试结果未知的那一轮：原样沿用它的 X-Request-Id；缺省 = 新的一轮，换新 key */
  retryKey?: string
}

/** 服务端要求 content 非空（只有表单续答可空），所以有图也得有文字 */
async function send(
  raw: string,
  images: string[] = attachments.value,
  template = selectedTemplate.value,
  opts: SendOptions = {},
) {
  const content = raw.trim()
  if (!content || streaming.value || disposed) return
  if (uploading.value) {
    message.info(UPLOAD_BUSY)
    return
  }
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

  const requestId = opts.retryKey || createSafeUuid()
  const imageUrls = [...images]
  const req: IAgentStreamReq = {
    conversationId,
    content,
    agentSkillId: selectedSkillId.value,
    ...(imageUrls.length ? { imageUrls } : {}),
    ...(template ? { plazaTemplateId: template.plazaTemplateId } : {}),
  }
  const language = selectedLanguage.value.value
  if (opts.fromDraft) draft.value = ''
  const wasHome = isHome.value
  // 新的一条消息发出：此前还开着、没作答的表单就此失效
  for (const it of items.value) {
    if (it.form && !it.form.done) {
      it.form.done = true
      it.form.superseded = true
    }
  }
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
  // 首页首发：输入框经 Teleport 挪回底栏会丢焦点，渲染后还给它
  if (wasHome) void nextTick(() => textareaEl.value?.focus({ preventScroll: true }))

  streamConvId = conversationId
  const ctrl = newController()
  let accepted = false
  let dropped = false
  try {
    await agentStream(
      { ...req, ...(language ? { language } : {}) },
      {
        requestId,
        signal: ctrl.signal,
        onFrame: (frame) => {
          if (frame.event === 'START') {
            accepted = true
            // 受理才移除本轮真正发出的图片与模板；失败时留着，便于改后重发。
            // 只摘掉发出的那几张：重试 / 生成中新加的附图不能被一并清掉
            attachments.value = attachments.value.filter((u) => !imageUrls.includes(u))
            if (opts.fromDraft && template && selectedTemplate.value?.plazaTemplateId === template.plazaTemplateId) {
              selectedTemplate.value = null
              templateFill = ''
            }
          }
          trackFrame(bot, frame)
          applyFrame(bot.reply, frame)
          scrollToBottom()
        },
      },
    )
    // 受理前拒绝只有一帧 ERROR：确定失败，重试换新 id（retryKey 留空）
    if (!accepted && bot.reply.error) {
      bot.retryContent = content
      bot.retryImages = imageUrls
      bot.retryTemplate = template
    }
  } catch (err) {
    if ((err as any)?.name !== 'AbortError') {
      if (accepted && toApiError(err)?.isNetwork && !bot.reply.finished && !bot.reply.error) {
        // 受理后断流：这一轮仍在服务端运行，改走续流接上，不报错、不重发
        dropped = true
      } else {
        bot.reply.error = errorText(err)
        if (!accepted) {
          bot.retryContent = content
          bot.retryImages = imageUrls
          bot.retryTemplate = template
          // 结果未知：key 绑在这一轮上，重试原样沿用；确定失败不留 key
          if (outcomeUnknown(err)) bot.retryKey = requestId
        }
      }
    }
  } finally {
    bot.live = false
    if (controller === ctrl) controller = null
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
  if (disposed || streaming.value) return
  const useCursor = mode === 'drop' && !!bot.turnId && (bot.lastSeq ?? 0) > 0
  let lastSeq = useCursor ? (bot.lastSeq ?? 0) : 0
  let swapped = useCursor
  let empty = false
  streaming.value = true
  stopping.value = false
  bot.live = true
  streamConvId = conversationId
  const ctrl = newController()
  try {
    await agentRecoverStream(
      {
        conversationId,
        ...(useCursor ? { turnId: bot.turnId, afterSequence: bot.lastSeq } : {}),
      },
      {
        signal: ctrl.signal,
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
    if (controller === ctrl) controller = null
    streaming.value = false
    stopping.value = false
    initForm(bot)
  }
  if (disposed || !empty || activeId.value !== conversationId) return
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

/**
 * @param fromEnd 消息悬停「选择该轮分享」：该轮在已加载轮次里倒数第几轮（从 1 起）。
 *   本地刚发的轮次要先回读重编号，回读只取最后一页，所以按倒数位置找回同一轮
 */
async function startShare(fromEnd?: number) {
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
  if (fromEnd) {
    const n = turnNoOf(turns.value[turns.value.length - fromEnd] ?? [])
    if (n) shareTurns.value = [n]
  }
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
  /** 失败格：服务端给的用户可读原因 */
  reason?: string
}

function resultTiles(tasks: IAgentGenTask[]): IResultTile[] {
  return tasks.flatMap((t): IResultTile[] => {
    if (t.imageUrls.length) return t.imageUrls.map((url, i) => ({ key: `${t.taskId}:${i}`, url, state: 'image' }))
    if (genTaskPending(t)) return [{ key: t.taskId, state: 'pending' }]
    return [{ key: t.taskId, state: 'failed', ...(t.failReason ? { reason: t.failReason } : {}) }]
  })
}

/** 失败任务的退点还在路上（预扣未结 / 结算失败待对账） */
const REFUND_PENDING = new Set(['HELD', 'SETTLEMENT_FAILED'])
const genTaskFailed = (t: IAgentGenTask) => !genTaskPending(t) && !t.imageUrls.length
/** 回读还要继续盯的任务：没到终态，或失败了但退点还没落定 */
const genTaskUnsettled = (t: IAgentGenTask) =>
  genTaskPending(t) || (genTaskFailed(t) && !!t.billingStatus && REFUND_PENDING.has(t.billingStatus))

/** 网格列数照原型：1–2 张两列，更多四列 */
function resultCols(n: number): string {
  return n <= 2 ? 'grid-cols-2' : 'grid-cols-4'
}

/**
 * 一轮回复里的结果卡（生图工具每次提交一张）。表头计数 = 已出图的格数 / 总格数：
 * 每张产物一格、没出图的任务各占一格——不是任务数（一个任务可能出多张）。
 */
interface IResultCard {
  key: string
  /** 对应 item.reply.tools 的下标（重试时就地换 taskId） */
  tool: IAgentToolResult
  tiles: IResultTile[]
  urls: string[]
  done: number
  failed: number
  pending: number
  /** 失败任务里服务端已退回的点数合计 */
  refunded: number
  /** 有失败任务的退点仍在处理（HELD / SETTLEMENT_FAILED） */
  refundPending: boolean
  /** 可「重试这 n 张」的失败任务 */
  retryable: IAgentGenTask[]
  /** 提示条文字 */
  stripText: string
}

function failStripText(done: number, failed: number, refunded: number, refundPending: boolean): string {
  const head = done ? `${failed} 张未出图` : '全部未出图'
  if (refundPending) return `${head}，点数退回处理中`
  if (refunded > 0) return `${head}，已退回 ${refunded} 点`
  return head
}

function resultCards(item: ChatItem): IResultCard[] {
  return item.reply.tools.flatMap((t, i): IResultCard[] => {
    if (!t.tasks.length) return []
    const tiles = resultTiles(t.tasks)
    const urls = tiles.flatMap((x) => (x.state === 'image' && x.url ? [x.url] : []))
    const failedTasks = t.tasks.filter(genTaskFailed)
    const refunded = failedTasks.reduce((sum, k) => sum + (k.refundedPoints ?? 0), 0)
    const refundPending = failedTasks.some((k) => !!k.billingStatus && REFUND_PENDING.has(k.billingStatus))
    const failed = tiles.filter((x) => x.state === 'failed').length
    return [
      {
        key: `${item.key}:r${i}`,
        tool: t,
        tiles,
        urls,
        done: urls.length,
        failed,
        pending: tiles.filter((x) => x.state === 'pending').length,
        refunded,
        refundPending,
        retryable: failedTasks.filter((k) => k.retryable === true),
        stripText: failStripText(urls.length, failed, refunded, refundPending),
      },
    ]
  })
}

// 多选下载：同一时刻只有一张结果卡在多选态
const multiCard = ref('')
const multiPicks = ref<string[]>([])

function toggleMulti(cardKey: string) {
  multiCard.value = multiCard.value === cardKey ? '' : cardKey
  multiPicks.value = []
}

function togglePick(url: string) {
  const i = multiPicks.value.indexOf(url)
  if (i >= 0) multiPicks.value.splice(i, 1)
  else multiPicks.value.push(url)
}

async function downloadPicked() {
  const urls = [...multiPicks.value]
  if (!urls.length) return
  multiCard.value = ''
  multiPicks.value = []
  message.success(`开始下载 ${urls.length} 张`)
  await downloadImagesAsZip(urls)
}

/** 点格子：多选态切换选中，否则打开大图 */
function onTileClick(cardKey: string, urls: string[], url: string) {
  if (multiCard.value === cardKey) return togglePick(url)
  openLightbox(urls, urls.indexOf(url))
}

// 大图预览（共用 MediaLightbox：n/N、←/→、Esc、下载）
const lightboxShow = ref(false)
const lightboxIndex = ref(0)
const lightboxItems = ref<{ url: string; type?: 'image' | 'video'; name?: string }[]>([])

function openLightbox(urls: string[], index: number) {
  if (!urls.length) return
  lightboxItems.value = urls.map((url) => ({ url, type: 'image' as const }))
  lightboxIndex.value = Math.max(0, Math.min(index, urls.length - 1))
  lightboxShow.value = true
}

/** 引用前的检查：回复中 / 已在参考图里 / 没余量（与「添加图片」同一套上限与去重） */
function canQuote(url?: string): boolean {
  if (streaming.value) {
    message.info('回复生成中，稍后再引用')
    return false
  }
  if (url && attachments.value.includes(url)) {
    message.info('这张已经在参考图里了')
    return false
  }
  if (imageRoom.value <= 0) {
    message.warning(`参考图${LIMIT_TEXT}，先移除一张`)
    return false
  }
  return true
}

/** 引用编辑：把结果图放进输入框的参考图 */
function quoteImage(url: string) {
  if (!canQuote(url)) return
  addImages([url])
  message.success('已放进参考图')
  void nextTick(() => textareaEl.value?.focus({ preventScroll: true }))
}

/** 引用编辑（校色后）：烘好的 PNG 先走参考图同一个上传口（≤10M），再放进参考图 */
async function quoteFile(file: File) {
  if (!canQuote()) return
  let added = false
  await uploadFiles([file], imageRoom.value, MAX_IMAGES, (url) => {
    addImages([url])
    added = true
  })
  if (!added) return
  message.success('已把校色后的图放进参考图')
  void nextTick(() => textareaEl.value?.focus({ preventScroll: true }))
}

async function downloadOne(url: string) {
  await downloadImage(url)
}

// ---------------- 结果图校色（components/ColorFixDialog；键 agent:<taskId>:<index>，参数 / 选区存本机） ----------------

/** 走 10M 上传口（参考图）时导出长边上限：4096 的无损 PNG 容易超 10M */
const QUOTE_MAX_SIDE = 2048

const fixKeyOf = (tile: IResultTile) => `agent:${tile.key}`
const fixShow = ref(false)
const fixTarget = ref<{ key: string; url: string; index: number }>({ key: '', url: '', index: 0 })
/** 弹窗关掉后 +1：结果格重读本机存的校色（整图校色用 CSS filter 即时显示，局部校色只打「已校色」标） */
const fixVersion = ref(0)
const fixWorking = ref(false)

// 免费档水印：校色来源（弹窗 src / 按存的参数烘图）一律 = tile.url，与结果格「下载」（downloadOne）同一个地址——
// 智能体结果图由后端按观看者档位下发，不另取原件
function openColorFix(tile: IResultTile, index: number) {
  if (!tile.url) return
  fixTarget.value = { key: fixKeyOf(tile), url: tile.url, index }
  fixShow.value = true
}

/** 这格存过的校色：null = 没校色；filter 有值 = 整图校色可直接挂 CSS filter 预览 */
function tileFix(tile: IResultTile): { filter?: string } | null {
  void fixVersion.value
  const key = fixKeyOf(tile)
  const params = loadColorFix(key)
  if (!params) return null
  const region = loadRegion(key)
  return !region || region.mode === 'whole' ? { filter: colorFixFilter(params) } : {}
}

/**
 * 这格校色过就烘出 PNG；没校色返回 null，烘失败提示后也返回 null（调用方退回原图）。
 * fallback = 退回原图时提示里的后半句（下载是「已下载原图」）。
 */
async function bakedTileFile(tile: IResultTile, maxSide?: number, fallback = '已改用原图'): Promise<File | null> {
  if (!tile.url) return null
  const key = fixKeyOf(tile)
  try {
    const file = await bakeStoredColorFix(key, tile.url, { name: '校色图', maxSide })
    // 存过校色却烘不出来：涂抹 / 点选的蒙版只在本机（换设备 / 清了站点数据 / 被淘汰），或自动识别这次没成功
    if (!file && hasStoredColorFix(key)) {
      const mode = loadRegion(key)?.mode
      message.warning(
        mode === 'paint' || mode === 'point' ? `本机选区已丢失，${fallback}` : `选区识别失败，${fallback}`,
      )
    }
    return file
  } catch (err) {
    message.warning(`${colorFixFailureText(err, '校色效果未能写入')}，${fallback}`)
    return null
  }
}

async function downloadTile(tile: IResultTile) {
  if (!tile.url || fixWorking.value) return
  fixWorking.value = true
  try {
    const file = await bakedTileFile(tile, undefined, '已下载原图')
    if (file) triggerDownload(file, file.name)
    else await downloadOne(tile.url)
  } finally {
    fixWorking.value = false
  }
}

async function quoteTile(tile: IResultTile) {
  if (!tile.url || fixWorking.value) return
  if (!hasStoredColorFix(fixKeyOf(tile))) return quoteImage(tile.url)
  if (!canQuote()) return
  fixWorking.value = true
  try {
    const file = await bakedTileFile(tile, QUOTE_MAX_SIDE)
    if (file) await quoteFile(file)
    else quoteImage(tile.url)
  } finally {
    fixWorking.value = false
  }
}

/** 校色后的图先传到画布素材口（与画布节点上传同一通道），再按地址交接给新画布 */
async function openFileInCanvas(file: File) {
  try {
    await openInCanvas([await canvasUploadMedia(file)])
  } catch (err) {
    reportError(err, '校色图上传失败，请稍后重试')
  }
}

async function openTileInCanvas(tile: IResultTile) {
  if (!tile.url || fixWorking.value || openingCanvas.value) return
  if (!hasStoredColorFix(fixKeyOf(tile))) return openInCanvas([tile.url])
  fixWorking.value = true
  try {
    const file = await bakeForUpload((side) => bakedTileFile(tile, side))
    if (file) await openFileInCanvas(file)
    else await openInCanvas([tile.url])
  } finally {
    fixWorking.value = false
  }
}

/** 弹窗底栏：校色开着用烘好的图，没校色就用原图 */
async function fixDialogQuote(cf: ResultColorFix, bakeFile: (name?: string, maxSide?: number) => Promise<File | null>) {
  const url = fixTarget.value.url
  if (fixWorking.value) return
  if (!cf.active.value) {
    quoteImage(url)
    fixShow.value = false
    return
  }
  if (!canQuote()) return
  fixWorking.value = true
  try {
    const file = await bakeFile('校色图', QUOTE_MAX_SIDE)
    if (!file) return
    await quoteFile(file)
    fixShow.value = false
  } finally {
    fixWorking.value = false
  }
}

async function fixDialogCanvas(
  cf: ResultColorFix,
  bakeFile: (name?: string, maxSide?: number) => Promise<File | null>,
) {
  if (fixWorking.value || openingCanvas.value) return
  if (!cf.active.value) {
    fixShow.value = false
    await openInCanvas([fixTarget.value.url])
    return
  }
  fixWorking.value = true
  try {
    const file = await bakeForUpload((side) => bakeFile('校色图', side))
    if (!file) return
    fixShow.value = false
    await openFileInCanvas(file)
  } finally {
    fixWorking.value = false
  }
}

/** 复制图片：优先把图片本身写进剪贴板（PNG）；跨域拿不到图或浏览器不支持时退回复制地址 */
async function copyImage(url: string) {
  try {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('unsupported')
    const png = fetch(url, { mode: 'cors' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.blob()
      })
      .then((b) => (b.type === 'image/png' ? b : toPng(b)))
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
    message.success('图片已复制')
  } catch {
    try {
      await navigator.clipboard.writeText(url)
      message.success('图片不支持直接复制，已复制图片地址')
    } catch {
      message.warning('复制失败，请右键图片另存')
    }
  }
}

/** 剪贴板只稳定支持 PNG：其它格式经 canvas 转一次 */
async function toPng(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bmp.width
  canvas.height = bmp.height
  canvas.getContext('2d')?.drawImage(bmp, 0, 0)
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'),
  )
}

/** 消息悬停「复制消息」：用户消息复制原文，助手消息复制正文 */
async function copyMessage(item: ChatItem) {
  const text = item.role === 'user' ? item.text : item.reply.text
  if (!text.trim()) return
  try {
    await navigator.clipboard.writeText(text)
    message.success('消息已复制')
  } catch {
    message.warning('复制失败，请手动选择文字复制')
  }
}

/** 工具清单的状态归类：已完成 / 进行中 / 失败 / 等待执行 */
type ToolState = 'ok' | 'run' | 'fail' | 'idle'
function toolState(status: string, item?: ChatItem): ToolState {
  const s = status.toLowerCase()
  if (['completed', 'success', 'succeeded', 'done'].includes(s)) return 'ok'
  // 参数确认（question_asker）在发起表单的那一轮恒为 interrupted；表单已提交后这一步就算完成，
  // 否则这轮的执行清单永远停在「进行中 1/2」
  if (s === 'interrupted') return item?.form?.done && !item.form.superseded ? 'ok' : 'run'
  if (['failed', 'error'].includes(s)) return 'fail'
  if (['pending', 'waiting', 'queued'].includes(s)) return 'idle'
  return 'run'
}
const TOOL_STATE_TEXT: Record<ToolState, string> = { ok: '已完成', run: '进行中', fail: '失败', idle: '等待执行' }

/** 思考过程：没手动开合过时，生成中展开、结束后收起 */
function thinkingOpen(item: ChatItem): boolean {
  return item.thinkOpen ?? !!item.live
}

/** 还没出图的任务：每 5 秒回读一次消息（只读、不计费），把最新任务状态并回已加载的结果卡 */
const RESULT_POLL_MS = 5000
/** 页面隐藏时的回读间隔 */
const RESULT_POLL_HIDDEN_MS = 15000
/** 一次进入会话最多回读的次数（约 10 分钟），之后停在当前状态，重新打开会话再继续 */
const RESULT_POLL_MAX = 120
let resultTimer: ReturnType<typeof setTimeout> | null = null
let resultPolls = 0

const hasPendingResults = () => items.value.some((it) => it.reply.tools.some((t) => t.tasks.some(genTaskUnsettled)))

function stopResultPoll() {
  if (resultTimer) clearTimeout(resultTimer)
  resultTimer = null
}

function scheduleResultPoll(reset = false) {
  if (reset) resultPolls = 0
  stopResultPoll()
  if (disposed || !activeId.value || resultPolls >= RESULT_POLL_MAX || !hasPendingResults()) return
  const id = activeId.value
  // 页面在后台时放慢（切回前台由 onResultPollVisibility 立即补一轮）
  const delay = document.visibilityState === 'hidden' ? RESULT_POLL_HIDDEN_MS : RESULT_POLL_MS
  resultTimer = setTimeout(() => void refreshResults(id), delay)
}

/** 切回前台：有还没出图的任务就立即回读一次，不用干等下一个 5 秒 */
function onResultPollVisibility() {
  if (!resultTimer) return
  if (document.visibilityState === 'visible' && activeId.value) {
    stopResultPoll()
    void refreshResults(activeId.value)
  } else scheduleResultPoll()
}
document.addEventListener('visibilitychange', onResultPollVisibility)
onUnmounted(() => document.removeEventListener('visibilitychange', onResultPollVisibility))

/** 回读已加载范围内的消息页，按 taskId 把任务状态与出图地址并回各结果卡 */
async function refreshResults(id: string) {
  resultTimer = null
  if (disposed || id !== activeId.value) return
  resultPolls += 1
  if (streaming.value) return scheduleResultPoll()
  const seq = msgSeq
  try {
    const first = await agentMessages(id, { page: 1, size: MSG_SIZE })
    const pages = first.data?.pages ?? 0
    const rows = [...(first.data?.data ?? [])]
    // 其余已加载的页互不依赖：并发拉（原来逐页串行，页多时一轮要等 n 个往返），按页序拼回
    const rest: number[] = []
    for (let p = Math.max(2, msgPage.value || 1); p <= pages; p++) rest.push(p)
    const more = await Promise.all(rest.map((p) => agentMessages(id, { page: p, size: MSG_SIZE })))
    for (const res of more) rows.push(...(res.data?.data ?? []))
    if (seq !== msgSeq || id !== activeId.value) return
    const latest = new Map<string, IAgentGenTask>()
    for (const m of rows) {
      if (m.role !== 'assistant' || !m.sseEvents) continue
      for (const t of replyFromFrames(m.sseEvents).tools) for (const k of t.tasks) latest.set(k.taskId, k)
    }
    for (const it of items.value) {
      for (const t of it.reply.tools) {
        if (t.tasks.some(genTaskUnsettled)) t.tasks = t.tasks.map((k) => latest.get(k.taskId) ?? k)
      }
    }
  } catch {
    // 只读回读失败按网络抖动处理：下一次再试
  }
  scheduleResultPoll()
}

watch(activeId, () => scheduleResultPoll(true))
// 每一轮受理 / 收尾（流结束）都重置回读预算：新出的任务重新拥有完整的 120 次
watch(streaming, (on) => {
  if (!on) scheduleResultPoll(true)
})

// ---------------- 结果卡「重试这 n 张」（POST /agent/conversations/{id}/generation-retry） ----------------

const retryingCard = ref('')

async function retryFailed(card: IResultCard) {
  const conversationId = activeId.value
  const tasks = card.retryable
  if (!conversationId || !tasks.length || retryingCard.value || streaming.value) return
  const n = Math.min(tasks.length, 50)
  const picked = tasks.slice(0, n)
  // 报价：失败格子的标价合计（与重试逐张冻结同一处计价）；有缺价的就不报数
  const priced = picked.every((k) => typeof k.pricePoints === 'number')
  const total = priced ? picked.reduce((sum, k) => sum + (k.pricePoints ?? 0), 0) : null
  let balance: number | null = null
  try {
    const res = await getPointsBalance()
    if (typeof res.data?.balance === 'number') balance = res.data.balance
  } catch {
    // 余额拿不到不拦重试，只是不显示
  }
  const cost = total != null ? `，约 ${total} 点数` : ''
  const bal = balance != null ? `（当前余额 ${balance}）` : ''
  dialog.warning({
    title: `重试这 ${n} 张`,
    content: `将重新生成 ${n} 张${cost}${bal}`,
    positiveText: '确认重试',
    negativeText: '取消',
    onPositiveClick: () => {
      void doRetry(
        card,
        conversationId,
        picked.map((k) => k.taskId),
      )
    },
  })
}

async function doRetry(card: IResultCard, conversationId: string, taskIds: string[]) {
  retryingCard.value = card.key
  try {
    const res = await agentGenerationRetry(conversationId, taskIds)
    const view = res.data
    if (disposed || activeId.value !== conversationId) return
    const next = new Map((view?.tasks ?? []).map((t) => [t.retryOf, t]))
    // 就地把失败格换成新任务（排队中），服务端回读时按新 taskId 并回结果
    card.tool.tasks = card.tool.tasks.map((k): IAgentGenTask => {
      const r = next.get(k.taskId)
      if (!r) return k
      return {
        taskId: r.taskId,
        status: 'queued',
        imageUrls: [],
        retryOf: k.taskId,
        ...(typeof r.pricePoints === 'number' ? { pricePoints: r.pricePoints } : {}),
      }
    })
    const failed = view?.failed ?? []
    if (next.size) message.success(`已重新提交 ${next.size} 张`)
    if (failed.length) {
      const reasons = [...new Set(failed.map((f) => f.reason).filter(Boolean))].join('；')
      message.warning(`${failed.length} 张未能重试${reasons ? `：${reasons}` : ''}`)
    }
    scheduleResultPoll(true)
  } catch (err) {
    const e = toApiError(err)
    // HTTP 200 + 3003 已由拦截器弹了引导购买框（BILLING_GUARD_PATTERNS），这里不重复；
    // 走 HTTP 错误分支的点数不足（402）拦截器不处理，补发同一个引导信号
    if (e?.httpStatus && (e.httpStatus === 402 || BILLING_BLOCK_CODES.has(e.code) || e.code === 402)) {
      emitBillingBlock(BILLING_BLOCK_CODES.has(e.code) ? e.code : 3003)
    } else {
      reportError(err, '重试失败，请稍后再试')
    }
  } finally {
    retryingCard.value = ''
  }
}

// ---------------- 参数表单报价（POST /agent/image-quote） ----------------

const RES_IDS = ['1k', '2k', '4k'] as const
type QuoteResolution = (typeof RES_IDS)[number]
const asRes = (v: string | undefined): QuoteResolution | undefined => {
  const x = (v ?? '').trim().toLowerCase()
  return (RES_IDS as readonly string[]).includes(x) ? (x as QuoteResolution) : undefined
}
const RATIO_RE = /^\d{1,2}:\d{1,2}$/

/** 题目定位：只认服务端固定的题 id（image_spec / resolution / aspect_ratio / num），对不上就不报价 */
function questionById(item: ChatItem, id: string): IAgentQuestion | undefined {
  return item.reply.form?.questions.find((q) => q.id === id)
}

/**
 * 把表单当前答案映射成报价入参：分辨率来自两级题 image_spec（父 = 1k/2k/4k，子 = 1k__3:4）或 resolution 题，
 * 张数来自 num 题（选项 id / 标签里的数字，或补充文字）；缺分辨率或张数就返回 null（不报价）。
 */
function quoteBodyOf(item: ChatItem) {
  const s = item.form
  if (!s) return null
  let resolution: QuoteResolution | undefined
  let aspectRatio: string | undefined
  const spec = questionById(item, 'image_spec')
  if (spec) {
    const sel = s.answers[spec.id]?.selected ?? []
    resolution = asRes(sel[0])
    const [, ratio] = (sel[sel.length - 1] ?? '').split('__')
    if (ratio && RATIO_RE.test(ratio)) aspectRatio = ratio
  }
  const resQ = questionById(item, 'resolution')
  if (!resolution && resQ) resolution = asRes(s.answers[resQ.id]?.selected[0])
  const ratioQ = questionById(item, 'aspect_ratio')
  if (!aspectRatio && ratioQ) {
    const r = s.answers[ratioQ.id]?.selected[0]
    if (r && RATIO_RE.test(r)) aspectRatio = r
  }
  const numQ = questionById(item, 'num')
  let num: number | undefined
  if (numQ) {
    const a = s.answers[numQ.id]
    const text = numQ.allowText ? (a?.text ?? '').trim() : ''
    const id = a?.selected[0]
    const label = numQ.options.find((o) => o.id === id)?.label
    for (const v of [text, id, label]) {
      const m = /\d+/.exec(v ?? '')
      if (m) {
        num = Number(m[0])
        break
      }
    }
  }
  if (!resolution || !num || num < 1 || num > 50) return null
  // 参考图：表单所属这一轮的用户消息带的图（图生图按参考图计价）
  const idx = items.value.indexOf(item)
  let referenceCount = 0
  for (let i = idx - 1; i >= 0; i--) {
    const it = items.value[i]
    if (it?.role === 'user') {
      referenceCount = it.images?.length ?? 0
      break
    }
  }
  return { resolution, ...(aspectRatio ? { aspectRatio } : {}), num, referenceCount, includeTurn: true }
}

/** 当前报价：只给最后一条、开着且停在最后一题的表单报 */
const formQuote = ref<{ key: string; sig: string; data: IAgentImageQuote } | null>(null)
let quoteTimer: ReturnType<typeof setTimeout> | null = null
let quoteSeq = 0

const quoteTarget = computed(() => {
  const item = items.value[items.value.length - 1]
  if (!item || !item.form || !formOpen(item) || !isLastStep(item)) return null
  const body = quoteBodyOf(item)
  return body ? { key: item.key, body, sig: `${item.key}|${JSON.stringify(body)}` } : null
})

watch(
  () => quoteTarget.value?.sig ?? '',
  (sig) => {
    if (quoteTimer) clearTimeout(quoteTimer)
    quoteTimer = null
    const target = quoteTarget.value
    if (!sig || !target) {
      quoteSeq++
      formQuote.value = null
      return
    }
    if (formQuote.value && formQuote.value.key !== target.key) formQuote.value = null
    quoteTimer = setTimeout(async () => {
      quoteTimer = null
      const id = ++quoteSeq
      try {
        const res = await agentImageQuote(target.body)
        if (id !== quoteSeq || disposed) return
        formQuote.value = res.data ? { key: target.key, sig, data: res.data } : null
      } catch {
        // 静默：报价失败就隐藏这一行（接口已登记 SILENT_ERROR_URLS，不弹 toast）
        if (id === quoteSeq) formQuote.value = null
      }
    }, 300)
  },
)

function quoteFor(item: ChatItem): IAgentImageQuote | null {
  const q = formQuote.value
  return q && q.key === item.key && q.sig === quoteTarget.value?.sig ? q.data : null
}

/** 点数不足时「改成 1K」：把分辨率答案换成更便宜的档位（两级题保留同比例的子项，没有就只选父项） */
function canApplyCheaper(item: ChatItem, res: string): boolean {
  return !!(questionById(item, 'image_spec') || questionById(item, 'resolution')) && !!asRes(res)
}

function applyCheaper(item: ChatItem, res: string) {
  const s = item.form
  const target = asRes(res)
  if (!s || !target || !formOpen(item)) return
  const spec = questionById(item, 'image_spec')
  if (spec) {
    const parent = spec.options.find((o) => o.id.toLowerCase() === target)
    if (!parent) return
    const sel = s.answers[spec.id]?.selected ?? []
    const [, ratio] = (sel[sel.length - 1] ?? '').split('__')
    const child = parent.children.find((c) => c.id === `${parent.id}__${ratio}`)
    s.answers[spec.id] = { selected: child ? [parent.id, child.id] : [parent.id], text: s.answers[spec.id]?.text ?? '' }
    // 两级题只选到父项不能提交：跳回这道题让用户补选比例
    if (!child) s.step = item.reply.form!.questions.indexOf(spec)
  } else {
    const resQ = questionById(item, 'resolution')
    const opt = resQ?.options.find((o) => o.id.toLowerCase() === target)
    if (!resQ || !opt) return
    s.answers[resQ.id] = { selected: [opt.id], text: s.answers[resQ.id]?.text ?? '' }
  }
  s.error = ''
  s.stepError = ''
}

function openRecharge() {
  emitBillingBlock(3003)
}

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
const visibleUserSkills = computed(() => userSkills.value.filter((u) => skillMatch(u.title)))
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
  if (uploading.value) {
    message.info(UPLOAD_BUSY)
    return
  }
  const idx = items.value.indexOf(item)
  if (idx > 0) items.value.splice(idx - 1, 2)
  // 每个失败轮次带自己的 key：两轮都失败时各自重试互不串号；不碰用户当前的草稿与附图
  void send(content, item.retryImages ?? [], item.retryTemplate ?? null, { retryKey: item.retryKey })
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

// ---------------- 外壳：会话历史收起 / 窄屏抽屉、悬浮钮、浮起输入框 ----------------

/** <1280 时会话历史改为浮层抽屉（同一颗「展开历史」钮开合），宽屏则在布局内收起 / 展开 */
const NARROW_QUERY = '(max-width: 1279px)'
const narrow = ref(false)
const drawerOpen = ref(false)
let narrowMql: MediaQueryList | null = null
const onNarrowChange = () => {
  narrow.value = !!narrowMql?.matches
  drawerOpen.value = false
}
const dirShown = computed(() => (narrow.value ? drawerOpen.value : !sidebarCollapsed.value))

function setDir(open: boolean) {
  if (narrow.value) drawerOpen.value = open
  else sidebarCollapsed.value = !open
}

/** 窄屏抽屉里点了会话：切过去并收起抽屉 */
function pickConversation(id: string) {
  void selectConversation(id)
  if (narrow.value) drawerOpen.value = false
}

function onRootKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && narrow.value && drawerOpen.value) {
    drawerOpen.value = false
  }
}

// 窄屏抽屉焦点管理：打开聚焦搜索框、Tab 圈在抽屉内、Esc 任意处关闭、关闭后焦点还给「展开历史」
const dirEl = ref<HTMLElement | null>(null)
const dirSearchEl = ref<HTMLInputElement | null>(null)
const expandBtnEl = ref<HTMLButtonElement | null>(null)
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

function onDirKeydown(e: KeyboardEvent) {
  if (!narrow.value || !drawerOpen.value) return
  if (e.key === 'Escape') {
    // 抽屉里的输入框（搜索 / 改名）也能直接 Esc 关；不再冒泡给外层重复处理
    e.preventDefault()
    e.stopPropagation()
    drawerOpen.value = false
    return
  }
  if (e.key !== 'Tab' || !dirEl.value) return
  const nodes = Array.from(dirEl.value.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (n) => n.offsetParent !== null || n === document.activeElement,
  )
  if (!nodes.length) return
  const first = nodes[0]!
  const last = nodes[nodes.length - 1]!
  const active = document.activeElement
  if (e.shiftKey && (active === first || !dirEl.value.contains(active))) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (active === last || !dirEl.value.contains(active))) {
    e.preventDefault()
    first.focus()
  }
}

watch(drawerOpen, (open) => {
  if (open) {
    void nextTick(() => dirSearchEl.value?.focus({ preventScroll: true }))
    return
  }
  // 只在焦点原本就在抽屉里（或已掉到 body）时还回去；断点切换收起抽屉不抢焦点
  const active = document.activeElement
  const inside = !active || active === document.body || !!dirEl.value?.contains(active)
  if (inside && narrow.value) void nextTick(() => expandBtnEl.value?.focus({ preventScroll: true }))
})

/**
 * 右上悬浮钮组：悬停 / 聚焦时展开成带名字的胶囊。展开终宽按各自文字量出来定死（宽度动到 auto 会卡），
 * 按钮集合变化（首页 ↔ 对话多一颗「回到创意广场」）或字体加载完后重量一次。
 */
const floatActsEl = ref<HTMLElement | null>(null)
function sizeFloatLabels() {
  floatActsEl.value?.querySelectorAll<HTMLElement>('.glass-ic').forEach((btn) => {
    const lbl = btn.querySelector<HTMLElement>('.glass-lbl')
    if (!lbl) return
    const prev = lbl.style.maxWidth
    lbl.style.maxWidth = 'none'
    const lw = lbl.scrollWidth
    lbl.style.maxWidth = prev
    const iw = btn.querySelector('svg')?.getBoundingClientRect().width || 15
    btn.style.setProperty('--w', `${Math.ceil(11 + iw + 6 + lw + 11 + 4)}px`)
  })
}
watch(isHome, () => void nextTick(sizeFloatLabels))

/** 对话态输入框浮在消息上：量它的实际高度，消息区底部留白、「回到底部」与分享条都据此让位 */
const composerAreaEl = ref<HTMLElement | null>(null)
const composerAreaH = ref(246)
let composerRo: ResizeObserver | null = null
const streamPadBottom = computed(() => Math.max(composerAreaH.value - 30, 120) + (shareMode.value ? 56 : 0))

onMounted(() => {
  skillsReady = loadSkills()
  void loadConversations(true)
  void applyPlazaTemplateQuery()
  narrowMql = window.matchMedia(NARROW_QUERY)
  narrow.value = narrowMql.matches
  narrowMql.addEventListener('change', onNarrowChange)
  void nextTick(sizeFloatLabels)
  void document.fonts?.ready.then(sizeFloatLabels)
  if (typeof ResizeObserver !== 'undefined') {
    composerRo = new ResizeObserver(() => {
      const h = composerAreaEl.value?.offsetHeight ?? 0
      if (h > 0) composerAreaH.value = h
    })
    if (composerAreaEl.value) composerRo.observe(composerAreaEl.value)
  }
})

onUnmounted(() => {
  disposed = true
  msgSeq++
  controller?.abort()
  stopResultPoll()
  narrowMql?.removeEventListener('change', onNarrowChange)
  composerRo?.disconnect()
})
</script>

<template>
  <n-config-provider :theme-overrides="llTheme" abstract>
    <div class="agent-root relative flex h-full min-h-0 bg-page text-ink" @keydown="onRootKeydown">
      <!-- 窄屏（<1280）会话历史是浮层抽屉：点遮罩收起 -->
      <Transition name="agent-mask">
        <div
          v-if="narrow && drawerOpen"
          class="absolute inset-0 z-19 bg-[rgba(31,35,41,0.32)]"
          aria-hidden="true"
          @click="drawerOpen = false"
        />
      </Transition>

      <!-- 会话目录：灰底上一张白卡，卡里一条条白瓷会话卡（原型 .agent-dir / .dir-card / .conv-card） -->
      <Transition name="agent-dir">
        <aside
          v-show="dirShown"
          :class="[
            'agent-dir flex w-280px flex-none min-h-0 py-20px pl-20px',
            narrow ? 'is-drawer absolute inset-y-0 left-0 z-20' : '',
          ]"
          ref="dirEl"
          aria-label="会话历史"
          v-bind="narrow && drawerOpen ? { role: 'dialog', 'aria-modal': 'true' } : {}"
          @keydown="onDirKeydown"
        >
          <section
            class="dir-card sx-squircle flex min-h-0 min-w-0 flex-1 flex-col rounded-18px border border-solid border-line bg-white p-12px shadow-card"
          >
            <div class="flex h-28px flex-none items-center gap-6px px-1px">
              <h1 class="m-0 text-13px font-600 leading-18px text-ink">会话</h1>
              <span class="text-11px leading-16px text-muted tabular-nums">{{ listTotal }}</span>
              <span class="flex-1" />
              <button
                type="button"
                :disabled="streaming || !activeId"
                :class="[activeId ? BTN_TINT : BTN, '!px-10px']"
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
              <span class="agent-tip-wrap">
                <button
                  type="button"
                  aria-label="收起历史"
                  class="grid h-28px w-28px flex-none place-items-center rounded-full sx-soft p-0 text-muted cursor-pointer [transition:border-color_.12s,color_.12s,box-shadow_.12s] hover:(border-violet-line text-violet-ink shadow-soft-hover) sx-focus"
                  @click="setDir(false)"
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
                <span class="agent-tip" aria-hidden="true">收起历史</span>
              </span>
            </div>
            <div class="relative mt-8px flex flex-none items-center">
              <svg
                class="pointer-events-none absolute left-10px z-1 h-13px w-13px text-placeholder"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
              >
                <path :d="ICON.search" />
              </svg>
              <input
                ref="dirSearchEl"
                v-model="keyword"
                type="search"
                placeholder="搜索会话"
                aria-label="搜索会话"
                class="sx-soft-input w-full !pl-28px"
              />
            </div>
            <ul class="m-0 flex min-h-0 flex-1 list-none flex-col gap-8px overflow-y-auto p-0 pt-10px pb-2px">
              <!-- 未开会话：一张选中态「新的对话」占位卡 -->
              <li v-if="!activeId && !keyword.trim()">
                <div :class="[CONV_CARD, CONV_ON]" aria-current="true">
                  <span
                    class="grid h-44px w-44px flex-none place-items-center rounded-14px border border-solid border-line bg-surface3 text-violet-ink"
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
                    CONV_CARD,
                    activeId === c.agentConversationId ? CONV_ON : CONV_OFF,
                    deleteId === c.agentConversationId ? 'flex-wrap' : '',
                  ]"
                >
                  <!-- 整卡可点：透明按钮铺满卡面，焦点环画在卡外沿 -->
                  <button
                    v-if="editingId !== c.agentConversationId"
                    type="button"
                    :disabled="streaming && activeId !== c.agentConversationId"
                    :aria-current="activeId === c.agentConversationId ? 'true' : undefined"
                    :aria-label="c.title"
                    class="absolute inset-0 rounded-18px border-none bg-transparent p-0 cursor-pointer disabled:cursor-not-allowed sx-focus"
                    @click="pickConversation(c.agentConversationId)"
                  />
                  <!-- 缩略图：列表接口的 coverImageUrl（最近一次生图结果的第一张），没有图时星芒占位 -->
                  <span
                    class="pointer-events-none grid h-44px w-44px flex-none place-items-center overflow-hidden rounded-14px border border-solid border-line bg-surface3 text-violet-ink"
                    aria-hidden="true"
                  >
                    <img
                      v-if="c.coverImageUrl"
                      :src="c.coverImageUrl"
                      alt=""
                      loading="lazy"
                      class="block h-full w-full object-cover"
                    />
                    <svg
                      v-else
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
                      :maxlength="TITLE_MAX"
                      autofocus
                      aria-label="对话标题"
                      @keydown.enter.prevent="commitRename(c)"
                      @keydown.esc.prevent="editingId = ''"
                      @blur="commitRename(c)"
                    />
                    <p v-else class="m-0 truncate text-13px font-500 leading-18px text-ink" aria-hidden="true">
                      {{ c.title }}
                    </p>
                    <p v-if="c.lastMessage" class="m-0 truncate text-11px leading-16px text-muted">
                      {{ c.lastMessage }}
                    </p>
                    <div class="flex min-h-16px items-center gap-6px">
                      <span class="whitespace-nowrap text-11px leading-16px text-placeholder tabular-nums"
                        >{{ dayLabel(c.updatedAt || c.createdAt) }} · {{ roundsOf(c) }} 轮</span
                      >
                      <div
                        v-if="editingId !== c.agentConversationId"
                        class="pointer-events-auto relative ml-auto flex gap-12px opacity-55 [transition:opacity_0.12s] group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 motion-reduce:transition-none"
                      >
                        <button
                          type="button"
                          title="编辑标题"
                          :aria-label="`编辑标题：${c.title}`"
                          :class="[CONV_ACT, 'hover:(bg-surface3 text-ink)']"
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
                          :class="[CONV_ACT, 'hover:(bg-#fdf1f0 text-danger)']"
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
                    <div class="flex justify-end gap-8px">
                      <button type="button" :class="[BTN, '!px-10px']" @click="deleteId = ''">取消</button>
                      <button
                        type="button"
                        :disabled="deleting"
                        :aria-busy="deleting"
                        :class="[BTN_DANGER, '!px-10px']"
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
              <li v-else-if="listPage < listPages" class="py-4px text-center">
                <button type="button" :class="LINK_BTN" @click="loadConversations(false)">加载更多</button>
              </li>
            </ul>
          </section>
        </aside>
      </Transition>

      <!-- 宽对话主区：一张工作台卡；顶部不占位，功能钮浮在消息层上 -->
      <section class="flex min-w-0 flex-1 flex-col p-20px" aria-label="对话">
        <div
          :class="[
            'agent-chat sx-squircle relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-18px border border-solid border-line shadow-card',
            isHome ? 'bg-white' : 'is-conv',
            shareMode ? 'is-sharing' : '',
          ]"
        >
          <!-- 悬浮条：左上「展开历史」，右上一组磨砂圆钮（悬停 / 键盘聚焦展开成带名字的胶囊） -->
          <div class="pointer-events-none absolute inset-x-20px top-14px z-7 flex items-start gap-8px">
            <span v-if="!dirShown" class="agent-tip-wrap pointer-events-auto agent-fade-in">
              <button
                ref="expandBtnEl"
                type="button"
                aria-label="展开历史"
                class="glass-ic sx-focus"
                @click="setDir(true)"
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
              <span class="agent-tip" aria-hidden="true">展开历史</span>
            </span>
            <div
              ref="floatActsEl"
              role="toolbar"
              aria-label="对话操作"
              class="float-acts pointer-events-auto ml-auto flex flex-none gap-8px"
            >
              <button
                v-if="!isHome"
                type="button"
                aria-label="回到创意广场"
                :disabled="streaming"
                :title="streaming ? '回复生成中，稍后再切换' : undefined"
                class="glass-ic sx-focus"
                @click="newConversation"
              >
                <svg
                  class="h-15px w-15px"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path :d="ICON.sparkle" />
                </svg>
                <span class="glass-lbl" aria-hidden="true">回到创意广场</span>
              </button>
              <button type="button" aria-label="一键铺货" class="glass-ic sx-focus" @click="openBatch">
                <svg
                  class="h-15px w-15px"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <path :d="ICON.grid" />
                </svg>
                <span class="glass-lbl" aria-hidden="true">一键铺货</span>
              </button>
              <button
                type="button"
                aria-label="在画布中打开"
                :disabled="!conversationImages.length || openingCanvas"
                :title="!conversationImages.length ? '对话里还没有图片' : undefined"
                class="glass-ic sx-focus"
                @click="openInCanvas(conversationImages)"
              >
                <svg
                  class="h-15px w-15px"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <path :d="ICON.expand" />
                </svg>
                <span class="glass-lbl" aria-hidden="true">在画布中打开</span>
              </button>
              <button
                type="button"
                aria-label="分享"
                :aria-pressed="shareMode"
                :disabled="!activeId || streaming || msgLoading"
                :title="!activeId ? '先开始一段对话' : undefined"
                class="glass-ic sx-focus"
                @click="shareMode ? cancelShare() : startShare()"
              >
                <svg
                  class="h-15px w-15px"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <path :d="ICON.share" />
                </svg>
                <span class="glass-lbl" aria-hidden="true">分享</span>
              </button>
            </div>
          </div>

          <div v-if="msgLoading && !items.length" class="flex flex-1 items-center justify-center">
            <n-spin size="small" />
          </div>

          <!-- 空态 = 模板首页（原型 5185）：大标题 → 输入框（底栏那一份经 Teleport 挪进 dock）→ 快捷入口 / 上次做到这里 → 模板浏览 -->
          <div
            v-else-if="!items.length"
            class="min-h-0 flex-1 overflow-y-auto px-28px pb-40px [scrollbar-gutter:stable]"
          >
            <div class="mx-auto flex w-full max-w-1040px flex-col">
              <section class="relative pb-6px pt-60px text-center">
                <span
                  class="pointer-events-none absolute inset-x-0 top-0 h-340px bg-[radial-gradient(rgba(107,72,124,0.11)_1px,transparent_1.2px)] bg-[length:14px_14px] [mask-image:radial-gradient(ellipse_56%_72%_at_50%_26%,#000_20%,transparent_76%)]"
                  aria-hidden="true"
                />
                <span
                  class="pointer-events-none absolute left-1/2 top-[-70px] h-380px w-[min(940px,100%)] -translate-x-1/2 bg-[radial-gradient(50%_60%_at_50%_40%,rgba(135,95,154,0.10),transparent_70%)]"
                  aria-hidden="true"
                />
                <h2 class="agent-rise relative z-1 m-0 text-28px font-600 leading-38px tracking-[.02em] text-ink">
                  挑选一个爆款模板
                </h2>
                <p class="relative z-1 m-0 mt-8px text-12px leading-18px text-muted">
                  别人卖爆的那张图，照着复刻一版，打爆你的店铺
                </p>
              </section>
              <!-- 输入框槽位：滚动时吸顶（原型 home-dock 停靠） -->
              <div :id="homeDockId" ref="homeDockEl" class="agent-rise sticky top-56px z-5 mb-16px mt-26px py-2px" />
              <div class="flex flex-wrap justify-center gap-8px" role="group" aria-label="快捷开始">
                <button
                  type="button"
                  :disabled="streaming"
                  :class="[BTN_TINT, QUICK]"
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
                  :class="[BTN, QUICK]"
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
                <button type="button" :class="[BTN, QUICK]" @click="openBatch">
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
                  :class="[BTN, QUICK]"
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
              <div v-if="recentConversation" class="mx-auto mt-16px w-full max-w-520px text-left">
                <span class="mb-6px ml-2px block text-11px leading-16px text-placeholder">上次做到这里</span>
                <div class="sx-squircle flex items-center gap-12px rounded-18px sx-soft py-8px pl-12px pr-10px">
                  <span
                    class="grid h-40px w-30px flex-none place-items-center overflow-hidden rounded-6px border border-solid border-line bg-surface3 text-violet-ink"
                    aria-hidden="true"
                  >
                    <img
                      v-if="recentConversation.coverImageUrl"
                      :src="recentConversation.coverImageUrl"
                      alt=""
                      class="block h-full w-full object-cover"
                    />
                    <svg
                      v-else
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
                    :class="BTN"
                    @click="pickConversation(recentConversation.agentConversationId)"
                  >
                    继续这轮
                  </button>
                </div>
              </div>
              <!-- 「模板 / 本周头条」Tab 标题在 TemplateBrowser 里（15/22，原型 .ref-tabs） -->
              <TemplateBrowser
                class="mt-28px"
                :picked-id="selectedTemplate?.plazaTemplateId ?? null"
                :disabled="streaming"
                @pick="pickTemplate"
              />
            </div>
          </div>

          <!-- 消息区：#fafafa + 点阵（往上化开），顶部 56px 渐隐；内容从浮起的输入框下面滚过去 -->
          <div v-else class="relative z-1 flex min-h-0 flex-1 flex-col">
            <span class="stream-fade pointer-events-none absolute inset-x-1px top-0 z-3 h-56px" aria-hidden="true" />
            <div
              ref="listEl"
              role="log"
              :aria-live="streaming ? 'polite' : 'off'"
              :aria-busy="streaming"
              class="min-h-0 flex-1 overflow-y-auto px-30px pt-88px [scrollbar-gutter:stable]"
              :style="{ paddingBottom: `${streamPadBottom}px` }"
              @scroll.passive="onListScroll"
            >
              <!-- 铺满宽度：38 的左槽留给头像，AI 内容从左沿起，用户气泡贴右沿；轮间 36、轮内 18 -->
              <div class="flex flex-col gap-36px pl-38px pr-6px">
                <div v-if="msgPage > 1" class="text-center">
                  <button type="button" :disabled="msgLoading" :class="LINK_BTN" @click="loadEarlier">加载更多</button>
                </div>
                <div
                  v-for="(turn, ti) in turns"
                  :key="turn[0]?.key ?? ti"
                  :class="['relative flex flex-col gap-18px', shareMode && turnNoOf(turn) ? 'pr-22px' : '']"
                >
                  <!-- 分享模式：每轮右上一个 16px 勾选框 -->
                  <button
                    v-if="shareMode && turnNoOf(turn)"
                    type="button"
                    role="checkbox"
                    :aria-checked="shareTurns.includes(turnNoOf(turn) ?? 0)"
                    :aria-label="`选择第 ${turnNoOf(turn)} 轮分享`"
                    :title="`第 ${turnNoOf(turn)} 轮`"
                    :class="[
                      'absolute right-0 top-4px z-2 grid h-16px w-16px place-items-center rounded-3px border border-solid p-0 text-white cursor-pointer after:(content-empty absolute -inset-8px) sx-focus',
                      shareTurns.includes(turnNoOf(turn) ?? 0)
                        ? 'border-violet bg-violet'
                        : 'border-control bg-white hover:border-violet-line',
                    ]"
                    @click="pickRound(turnNoOf(turn) ?? 0)"
                  >
                    <svg
                      v-if="shareTurns.includes(turnNoOf(turn) ?? 0)"
                      class="h-10px w-10px"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="3"
                      aria-hidden="true"
                    >
                      <path :d="ICON.check" />
                    </svg>
                  </button>
                  <template v-for="item in turn" :key="item.key">
                    <!-- 用户气泡：白瓷、右下收一角 -->
                    <div
                      v-if="item.role === 'user'"
                      v-show="item.text || item.images?.length"
                      class="msg-wrap relative flex flex-col"
                    >
                      <div
                        class="sx-squircle max-w-460px self-end rounded-[18px_18px_6px_18px] border border-solid border-soft-line sx-soft-bg px-20px py-14px text-13px leading-20px text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]"
                      >
                        <div v-if="item.text" class="whitespace-pre-wrap break-words">{{ item.text }}</div>
                        <div v-if="item.images?.length" :class="['flex gap-4px', item.text ? 'mt-6px' : '']">
                          <button
                            v-for="(url, i) in item.images.slice(0, MAX_IMAGES)"
                            :key="i"
                            type="button"
                            :aria-label="`查看图片 ${i + 1}`"
                            class="sx-squircle block h-50px w-38px flex-none overflow-hidden rounded-9px border border-solid border-white bg-surface3 p-0 cursor-zoom-in sx-focus"
                            @click="openLightbox(item.images.slice(0, MAX_IMAGES), i)"
                          >
                            <img :src="url" alt="" loading="lazy" class="block h-full w-full object-cover" />
                          </button>
                        </div>
                      </div>
                      <div class="msg-tools absolute right-[-26px] top-2px flex flex-col gap-10px">
                        <button
                          v-if="item.text.trim()"
                          type="button"
                          title="复制消息"
                          aria-label="复制消息"
                          :class="MSG_TOOL"
                          @click="copyMessage(item)"
                        >
                          <svg
                            class="h-11px w-11px"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            aria-hidden="true"
                          >
                            <path :d="ICON.copy" />
                          </svg>
                        </button>
                        <button
                          v-if="activeId && !streaming && !shareMode"
                          type="button"
                          title="选择该轮分享"
                          aria-label="选择该轮分享"
                          :class="MSG_TOOL"
                          @click="startShare(turns.length - ti)"
                        >
                          <svg
                            class="h-11px w-11px"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            aria-hidden="true"
                          >
                            <path :d="ICON.share" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    <!-- 智能体：头像挂在左槽，正文与各卡片同一条左沿 -->
                    <!-- 顺序（对齐原型）：思考 → 正文 → 清单 → 表单 → 结果。仅调整模板块次序，数据与逻辑不动 -->
                    <div v-else class="msg-wrap relative flex flex-col gap-18px">
                      <span class="ai-avatar" aria-hidden="true"><img src="/brand/xiaoqi-mark.svg" alt="" /></span>
                      <div v-if="item.reply.thinking" class="max-w-800px self-start">
                        <button
                          type="button"
                          :aria-expanded="thinkingOpen(item)"
                          class="-ml-8px inline-flex h-28px items-center gap-5px rounded-14px border-none bg-transparent px-8px text-12px text-muted cursor-pointer hover:(bg-surface3 text-ink) sx-focus"
                          @click="item.thinkOpen = !thinkingOpen(item)"
                        >
                          <svg
                            class="h-12px w-12px text-violet"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.8"
                            stroke-linejoin="round"
                            aria-hidden="true"
                          >
                            <path :d="ICON.sparkle" />
                          </svg>
                          {{ item.live ? '思考中' : '思考过程' }}
                          <svg
                            :class="[
                              'h-10px w-10px [transition:transform_.18s] motion-reduce:transition-none',
                              thinkingOpen(item) ? 'rotate-180' : '',
                            ]"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            aria-hidden="true"
                          >
                            <path :d="ICON.chevronDown" />
                          </svg>
                        </button>
                        <p
                          v-show="thinkingOpen(item)"
                          class="m-0 mt-4px whitespace-pre-wrap break-words border-l-2 border-l-solid border-l-line pl-10px text-12px leading-18px text-placeholder"
                        >
                          {{ item.reply.thinking }}
                        </p>
                      </div>
                      <!-- 生成中：思考胶囊（虚线圆 1.4s 一圈） -->
                      <div
                        v-if="item.live && !item.reply.text"
                        role="status"
                        class="inline-flex h-26px items-center gap-6px self-start rounded-13px sx-soft px-12px text-11px text-muted"
                      >
                        <svg
                          class="think-spin h-12px w-12px flex-none"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#6b487c"
                          stroke-width="2"
                          stroke-linecap="round"
                          aria-hidden="true"
                        >
                          <circle cx="12" cy="12" r="9" stroke-dasharray="6 6" />
                        </svg>
                        正在思考
                      </div>
                      <!-- 正文气泡：白瓷、左侧小嘴；轻量 Markdown（先转义再白名单标签，见 utils/miniMarkdown） -->
                      <div
                        v-if="item.reply.text"
                        :class="[
                          'ai-body md-body agent-tail sx-squircle relative w-fit max-w-800px break-words rounded-16px sx-soft px-12px py-8px text-13px leading-21px text-ink-2',
                          item.live ? 'is-streaming' : '',
                        ]"
                        v-html="renderReplyHtml(item.reply.text, item.live)"
                      ></div>
                      <!-- 执行清单：白瓷卡 + 小嘴；状态圆圈 已完成 / 进行中 / 失败 / 等待执行 -->
                      <div
                        v-if="item.reply.tools.length"
                        class="agent-tail sx-squircle relative max-w-480px rounded-18px sx-soft px-18px py-14px"
                      >
                        <div
                          class="mb-3px flex min-h-23px items-center gap-8px text-13px font-600 leading-23px text-ink"
                        >
                          <svg
                            class="h-14px w-14px flex-none text-violet"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linejoin="round"
                            aria-hidden="true"
                          >
                            <path :d="ICON.doc" />
                          </svg>
                          执行清单
                          <span class="ml-auto text-11px font-400 leading-16px text-placeholder tabular-nums">
                            {{ item.reply.tools.filter((t) => toolState(t.status, item) === 'ok').length }} /
                            {{ item.reply.tools.length }}
                          </span>
                        </div>
                        <ul class="m-0 list-none p-0">
                          <li
                            v-for="(t, i) in item.reply.tools"
                            :key="i"
                            :title="t.message || undefined"
                            class="flex h-23px items-center gap-8px text-12px text-ink-2"
                          >
                            <span
                              :class="[
                                'st-ic grid h-14px w-14px flex-none place-items-center',
                                `is-${toolState(t.status, item)}`,
                              ]"
                              aria-hidden="true"
                            >
                              <svg
                                class="h-14px w-14px"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                              >
                                <circle
                                  v-if="toolState(t.status, item) === 'run'"
                                  class="st-track"
                                  cx="12"
                                  cy="12"
                                  r="9"
                                />
                                <circle class="st-r" cx="12" cy="12" r="9" stroke="currentColor" />
                                <path
                                  v-if="toolState(t.status, item) === 'ok'"
                                  d="M8 12.4l2.6 2.6L16 9.6"
                                  stroke="currentColor"
                                />
                                <path
                                  v-else-if="toolState(t.status, item) === 'fail'"
                                  d="M9 9l6 6M15 9l-6 6"
                                  stroke="currentColor"
                                />
                              </svg>
                            </span>
                            <span
                              :class="[
                                'min-w-0 flex-1 truncate',
                                toolState(t.status, item) === 'ok' ? 'text-#8a919c' : '',
                              ]"
                              >{{ t.name }}</span
                            >
                            <span
                              v-if="toolState(t.status, item) === 'fail'"
                              class="max-w-[50%] flex-none truncate text-11px leading-16px text-#c24545"
                              >{{ t.message || '失败' }}</span
                            >
                            <span v-else class="flex-none text-11px leading-16px text-#a3a9b2 tabular-nums">{{
                              TOOL_STATE_TEXT[toolState(t.status, item)]
                            }}</span>
                          </li>
                        </ul>
                      </div>
                      <!-- 参数确认表单（question_asker 中断）：逐题作答，最后一题「确认并生成」续跑本轮；提交后收成摘要卡 -->
                      <form
                        v-if="item.reply.form && item.form"
                        :class="[
                          'form-card sx-squircle overflow-hidden rounded-18px sx-soft',
                          item.form.done ? 'is-done max-w-480px' : 'max-w-820px pb-12px',
                        ]"
                        :aria-busy="item.form.submitting"
                        @submit.prevent="onFormSubmit(item)"
                      >
                        <template v-if="item.form.done && item.form.superseded">
                          <!-- 没作答就被后面的消息取代：只读「已失效」，不把服务端默认值当答案展示 -->
                          <div
                            class="flex items-center gap-8px border-b border-solid border-line bg-#f3f4f6 px-18px py-12px text-13px font-600 leading-20px text-ink-2"
                          >
                            <svg
                              class="h-14px w-14px flex-none"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              stroke-linejoin="round"
                              aria-hidden="true"
                            >
                              <path :d="ICON.doc" />
                            </svg>
                            <span class="min-w-0 truncate">{{ item.reply.form.title || '参数确认' }}</span>
                            <span
                              class="inline-flex h-18px flex-none items-center rounded-3px bg-#e5e7eb px-6px text-11px font-500 leading-18px text-muted"
                              >已失效</span
                            >
                          </div>
                          <p class="form-sub m-0 px-18px py-10px text-12px leading-18px text-placeholder">
                            未作答，已被后续消息取代（共 {{ item.reply.form.questions.length }} 题）
                          </p>
                        </template>
                        <template v-else-if="item.form.done">
                          <div
                            class="flex items-center gap-8px border-b border-solid border-#5d3d6e bg-[linear-gradient(#815c97,#6b487c)] px-18px py-12px text-13px font-600 leading-20px text-white"
                          >
                            <svg
                              class="h-14px w-14px flex-none"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              aria-hidden="true"
                            >
                              <path :d="ICON.checkCircle" />
                            </svg>
                            设置已确认
                            <span
                              class="inline-flex h-18px flex-none items-center rounded-3px bg-white/20 px-6px text-11px font-500 leading-18px"
                              >{{ answeredCount(item) }} 题已答</span
                            >
                          </div>
                          <div
                            class="form-sub flex flex-col gap-2px px-18px py-10px text-12px leading-18px text-placeholder"
                          >
                            <div v-for="q in item.reply.form.questions" :key="q.id" class="break-words">
                              {{ q.title }}：<b class="font-500 text-ink-2">{{
                                answerText(q, item.form.answers[q.id]) || '已跳过'
                              }}</b>
                            </div>
                          </div>
                        </template>
                        <template v-else>
                          <div
                            class="flex items-center gap-8px border-b border-solid border-#5d3d6e bg-[linear-gradient(#815c97,#6b487c)] px-18px py-12px text-13px font-600 leading-20px text-white"
                          >
                            <svg
                              class="h-14px w-14px flex-none"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              stroke-linejoin="round"
                              aria-hidden="true"
                            >
                              <path :d="ICON.doc" />
                            </svg>
                            <span class="min-w-0 truncate">{{ item.reply.form.title || '请确认这次的设置' }}</span>
                            <span
                              class="inline-flex h-18px flex-none items-center rounded-3px bg-white/20 px-6px text-11px font-500 leading-18px"
                              >{{ item.reply.form.questions.length }} 题表单</span
                            >
                          </div>
                          <p
                            v-if="item.reply.form.message && item.reply.form.message !== item.reply.text.trim()"
                            class="m-0 mx-18px mt-10px text-12px leading-18px text-muted"
                          >
                            {{ item.reply.form.message }}
                          </p>
                          <fieldset
                            v-for="q in formQuestion(item) ? [formQuestion(item)!] : []"
                            :key="q.id"
                            :disabled="!formOpen(item)"
                            class="m-0 mx-18px mt-12px min-w-0 border-none p-0"
                          >
                            <legend class="sr-only">{{ q.title }}</legend>
                            <div class="mb-9px flex items-center justify-between gap-10px">
                              <div
                                class="flex min-w-0 flex-wrap items-center gap-5px text-13px font-600 leading-20px text-ink"
                                aria-hidden="true"
                              >
                                {{ q.title }}<i v-if="q.required" class="ml-4px not-italic font-600 text-#c24545">*</i>
                              </div>
                              <span class="flex-none text-11px leading-16px text-#a3a9b2 tabular-nums"
                                >第 {{ item.form.step + 1 }} / {{ item.reply.form.questions.length }} 步</span
                              >
                            </div>
                            <p v-if="q.message" class="m-0 mb-9px mt-[-4px] text-12px leading-18px text-placeholder">
                              {{ q.message }}
                            </p>
                            <div
                              v-if="!isTextQuestion(q)"
                              :role="q.type === 'multi_select' ? 'group' : 'radiogroup'"
                              :aria-label="q.title"
                              class="grid grid-cols-2 gap-6px max-sm:grid-cols-1"
                            >
                              <button
                                v-for="o in q.options"
                                :key="o.id"
                                type="button"
                                :role="q.type === 'multi_select' ? 'checkbox' : 'radio'"
                                :aria-checked="optionPicked(item, q, o)"
                                :class="[OPT, optionPicked(item, q, o) ? OPT_ON : OPT_OFF]"
                                @click="pickOption(item, q, o)"
                              >
                                <span
                                  v-if="q.type === 'multi_select'"
                                  :class="[
                                    'grid h-13px w-13px flex-none place-items-center rounded-3px border border-solid',
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
                                <span
                                  v-else
                                  :class="[
                                    'h-13px w-13px flex-none rounded-full border border-solid',
                                    optionPicked(item, q, o)
                                      ? 'border-violet bg-violet shadow-[inset_0_0_0_2px_#fff]'
                                      : 'border-control bg-white',
                                  ]"
                                  aria-hidden="true"
                                />
                                <span class="min-w-0">
                                  <span class="block truncate">{{ o.label }}</span>
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
                              class="mt-8px grid grid-cols-2 gap-6px border-l-2 border-l-solid border-l-violet-line pl-10px max-sm:grid-cols-1"
                            >
                              <button
                                v-for="c in nestedParent(item, q)?.children ?? []"
                                :key="c.id"
                                type="button"
                                role="radio"
                                :aria-checked="optionPicked(item, q, c)"
                                :class="[OPT, optionPicked(item, q, c) ? OPT_ON : OPT_OFF]"
                                @click="pickChild(item, q, nestedParent(item, q)!, c)"
                              >
                                <span
                                  :class="[
                                    'h-13px w-13px flex-none rounded-full border border-solid',
                                    optionPicked(item, q, c)
                                      ? 'border-violet bg-violet shadow-[inset_0_0_0_2px_#fff]'
                                      : 'border-control bg-white',
                                  ]"
                                  aria-hidden="true"
                                />
                                <span class="min-w-0">
                                  <span class="block truncate">{{ c.label }}</span>
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
                              :placeholder="q.placeholder || (isTextQuestion(q) ? '请输入' : '也可以直接输入')"
                              :aria-label="q.placeholder || q.title"
                              class="sx-soft-input mt-8px w-full !h-34px disabled:(cursor-not-allowed opacity-60)"
                              @input="setAnswerText(item, q, ($event.target as HTMLInputElement).value)"
                            />
                          </fieldset>
                          <div class="mx-18px mt-12px flex items-center gap-6px">
                            <span class="flex min-w-0 flex-1 items-center gap-10px">
                              <span class="inline-flex flex-none items-center gap-3px" aria-hidden="true">
                                <i
                                  v-for="(_q, k) in item.reply.form.questions"
                                  :key="k"
                                  :class="[
                                    'block h-5px [transition:width_.18s] motion-reduce:transition-none',
                                    k === item.form.step
                                      ? 'w-12px rounded-2px bg-ink'
                                      : 'w-5px rounded-full bg-#e0e2e6',
                                  ]"
                                />
                              </span>
                              <span
                                v-if="item.form.stepError || item.form.error"
                                role="alert"
                                class="min-w-0 truncate text-12px leading-18px text-#c24545"
                                :title="item.form.stepError || item.form.error"
                                >{{ item.form.stepError || item.form.error }}</span
                              >
                            </span>
                            <n-spin v-if="item.form.submitting" :size="14" />
                            <button
                              type="button"
                              :disabled="!formOpen(item) || item.form.step === 0"
                              :class="BTN"
                              @click="formPrev(item)"
                            >
                              上一步
                            </button>
                            <button type="submit" :disabled="!formOpen(item)" :class="BTN_PRIMARY">
                              {{ isLastStep(item) ? '确认并生成' : '下一步' }}
                            </button>
                          </div>
                          <!-- 最后一题的报价行：只读估价，失败就不显示；点数不足给「改成更便宜档位」与「去充值」 -->
                          <div
                            v-if="isLastStep(item) && quoteFor(item)"
                            aria-live="polite"
                            class="mx-18px mt-8px flex flex-wrap items-center justify-end gap-8px text-12px leading-18px text-muted tabular-nums"
                          >
                            <template v-if="quoteFor(item)!.sufficient">
                              <span
                                >本次约 {{ quoteFor(item)!.totalPoints }} 点数 · 余额
                                {{ quoteFor(item)!.balance }} 点数</span
                              >
                            </template>
                            <template v-else>
                              <span class="text-#c24545">点数不足</span>
                              <span
                                >本次约 {{ quoteFor(item)!.totalPoints }} 点数 · 余额
                                {{ quoteFor(item)!.balance }} 点数</span
                              >
                              <button
                                v-if="
                                  quoteFor(item)!.cheaperOption &&
                                  canApplyCheaper(item, quoteFor(item)!.cheaperOption!.resolution)
                                "
                                type="button"
                                :class="BTN"
                                @click="applyCheaper(item, quoteFor(item)!.cheaperOption!.resolution)"
                              >
                                改成 {{ quoteFor(item)!.cheaperOption!.resolution.toUpperCase() }} 约
                                {{ quoteFor(item)!.cheaperOption!.totalPoints }} 点数
                              </button>
                              <button type="button" :class="BTN" @click="openRecharge">去充值</button>
                            </template>
                          </div>
                        </template>
                      </form>
                      <!-- 结果卡：生图工具每次提交一张；已出图的格可放大 / 引用编辑 / 下载 / 复制 / 在画布中打开 -->
                      <div
                        v-for="card in resultCards(item)"
                        :key="card.key"
                        class="agent-tail sx-squircle relative max-w-800px rounded-18px sx-soft px-16px py-14px"
                      >
                        <div class="flex items-center gap-8px text-13px font-600 leading-20px text-ink">
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
                            >{{ card.done }} / {{ card.tiles.length }} 张</span
                          >
                        </div>
                        <div
                          :class="['mt-10px grid gap-8px', resultCols(card.tiles.length)]"
                          :aria-busy="card.pending > 0"
                        >
                          <div
                            v-for="(tile, k) in card.tiles"
                            :key="tile.key"
                            :class="[
                              'shot sx-squircle group relative aspect-[3/4] overflow-hidden rounded-12px border',
                              tile.state === 'image'
                                ? 'border-solid border-line bg-#f3f4f5 shadow-[0_1px_2px_rgba(31,35,41,0.05)]'
                                : tile.state === 'pending'
                                  ? 'flex flex-col items-center justify-center gap-8px border-dashed border-#d9c9e4 bg-[linear-gradient(160deg,#faf7fc,#f1ebf6)] text-violet-ink'
                                  : 'flex flex-col items-center justify-center gap-6px border-solid border-#ecd9d9 bg-[repeating-linear-gradient(135deg,#fbf7f7_0_8px,#f7f0f0_8px_16px)] text-#a24a4a',
                            ]"
                          >
                            <template v-if="tile.state === 'image' && tile.url">
                              <button
                                type="button"
                                :aria-label="multiCard === card.key ? `选择第 ${k + 1} 张` : `查看大图：第 ${k + 1} 张`"
                                :aria-pressed="multiCard === card.key ? multiPicks.includes(tile.url) : undefined"
                                :class="[
                                  'absolute inset-0 block h-full w-full border-none bg-transparent p-0 sx-focus !outline-offset-[-2px]',
                                  multiCard === card.key ? 'cursor-pointer' : 'cursor-zoom-in',
                                ]"
                                @click="onTileClick(card.key, card.urls, tile.url)"
                              >
                                <img
                                  :src="tile.url"
                                  alt=""
                                  loading="lazy"
                                  class="block h-full w-full object-cover"
                                  :style="tileFix(tile)?.filter ? { filter: tileFix(tile)?.filter } : undefined"
                                />
                              </button>
                              <span
                                v-if="tileFix(tile)"
                                class="pointer-events-none absolute left-8px top-8px z-2 rounded-9px bg-white/84 px-6px py-2px text-11px leading-14px text-violet-ink shadow-[0_1px_3px_rgba(0,0,0,0.14)] backdrop-blur-4px"
                                >已校色</span
                              >
                              <template v-if="multiCard === card.key">
                                <span
                                  v-if="multiPicks.includes(tile.url)"
                                  class="pointer-events-none absolute inset-0 z-1 rounded-[inherit] shadow-[inset_0_0_0_2px_#875f9a]"
                                  aria-hidden="true"
                                />
                                <span
                                  :class="[
                                    'pointer-events-none absolute right-8px top-8px z-3 grid h-20px w-20px place-items-center rounded-full border border-solid backdrop-blur-4px [transition:background_.12s,border-color_.12s]',
                                    multiPicks.includes(tile.url)
                                      ? 'border-violet bg-violet text-white'
                                      : 'border-white/90 bg-[rgba(20,20,24,0.34)] text-transparent',
                                  ]"
                                  aria-hidden="true"
                                >
                                  <svg
                                    class="h-11px w-11px"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="3"
                                  >
                                    <path :d="ICON.check" />
                                  </svg>
                                </span>
                              </template>
                              <div
                                v-else
                                class="absolute inset-x-0 bottom-0 z-2 flex flex-wrap items-center justify-end gap-8px bg-[linear-gradient(transparent,rgba(15,20,25,0.5))] px-6px pb-6px pt-14px opacity-0 [transition:opacity_.12s] group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 motion-reduce:transition-none"
                              >
                                <button
                                  type="button"
                                  :class="[SHOT_OP, 'px-9px']"
                                  :aria-label="`校色：第 ${k + 1} 张`"
                                  @click="openColorFix(tile, k)"
                                >
                                  校色
                                </button>
                                <button
                                  type="button"
                                  :disabled="fixWorking"
                                  :class="[SHOT_OP, 'px-9px']"
                                  @click="quoteTile(tile)"
                                >
                                  引用编辑
                                </button>
                                <IconButton
                                  size="sm"
                                  variant="overlay"
                                  :label="tileFix(tile) ? '下载校色后的图' : '下载'"
                                  :disabled="fixWorking"
                                  @click="downloadTile(tile)"
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path :d="ICON.download" />
                                  </svg>
                                </IconButton>
                                <IconButton size="sm" variant="overlay" label="复制图片" @click="copyImage(tile.url)">
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path :d="ICON.copy" />
                                  </svg>
                                </IconButton>
                                <IconButton
                                  size="sm"
                                  variant="overlay"
                                  label="在画布中打开"
                                  :disabled="openingCanvas || fixWorking"
                                  @click="openTileInCanvas(tile)"
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path :d="ICON.expand" />
                                  </svg>
                                </IconButton>
                              </div>
                            </template>
                            <template v-else-if="tile.state === 'pending'">
                              <span
                                class="w-spin box-border h-16px w-16px rounded-full border-2 border-solid border-#e0d3ea border-t-violet-ink"
                                aria-hidden="true"
                              />
                              <span class="text-11px leading-16px">生成中</span>
                            </template>
                            <template v-else>
                              <span
                                class="grid h-18px w-18px place-items-center rounded-full bg-#f3dede text-11px font-700"
                                aria-hidden="true"
                                >!</span
                              >
                              <span
                                class="max-w-full px-8px text-center text-11px leading-16px"
                                :title="tile.reason || undefined"
                                >生成失败<span v-if="tile.reason" class="sr-only">：{{ tile.reason }}</span></span
                              >
                            </template>
                          </div>
                        </div>
                        <!-- 失败提示条：退回点数（历史回读才有 refundedPoints / billingStatus）+ 可重试的失败格「重试这 n 张」 -->
                        <div
                          v-if="!card.pending && card.failed"
                          role="status"
                          :class="[
                            'mt-10px flex items-center gap-8px rounded-10px border border-solid px-10px py-8px text-12px leading-18px',
                            card.done
                              ? 'border-#ecdfc8 bg-#fdf9f1 text-#8a6a2f'
                              : 'border-#ecd9d9 bg-#fdf6f6 text-#a24a4a',
                          ]"
                        >
                          <span
                            :class="[
                              'grid h-16px w-16px flex-none place-items-center rounded-full text-10px font-700',
                              card.done ? 'bg-#f3e3c6' : 'bg-#f3dede',
                            ]"
                            aria-hidden="true"
                            >!</span
                          >
                          <span class="min-w-0 flex-1">{{ card.stripText }}</span>
                          <button
                            v-if="card.retryable.length"
                            type="button"
                            :disabled="!!retryingCard || streaming"
                            :aria-busy="retryingCard === card.key"
                            :class="BTN"
                            @click="retryFailed(card)"
                          >
                            {{
                              retryingCard === card.key ? '提交中…' : `重试这 ${Math.min(card.retryable.length, 50)} 张`
                            }}
                          </button>
                        </div>
                        <div v-if="card.urls.length > 1" class="mt-10px flex items-center gap-8px">
                          <span class="text-11px leading-16px text-#a3a9b2 tabular-nums"
                            >{{ card.urls.length }} 张</span
                          >
                          <span class="flex-1" />
                          <template v-if="multiCard === card.key">
                            <button type="button" :class="BTN" @click="toggleMulti(card.key)">取消</button>
                            <button
                              type="button"
                              :disabled="!multiPicks.length"
                              :class="BTN_PRIMARY"
                              @click="downloadPicked"
                            >
                              下载所选 {{ multiPicks.length }}
                            </button>
                          </template>
                          <button v-else type="button" :class="BTN" @click="toggleMulti(card.key)">
                            <svg
                              class="h-12px w-12px"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              aria-hidden="true"
                            >
                              <path :d="ICON.download" />
                            </svg>
                            多选下载
                          </button>
                        </div>
                      </div>
                      <div v-if="item.stopped" class="text-12px leading-18px text-placeholder">已停止</div>
                      <div v-if="item.reply.error" role="alert" class="flex flex-wrap items-center gap-8px">
                        <span
                          class="sx-squircle inline-flex items-center rounded-10px border border-solid border-#ecd9d9 bg-#fdf6f6 px-10px py-6px text-12px leading-18px text-#a24a4a"
                          >{{ item.reply.error }}</span
                        >
                        <button v-if="item.retryContent && !streaming" type="button" :class="BTN" @click="retry(item)">
                          重试
                        </button>
                      </div>
                      <div v-if="!item.live" class="msg-tools absolute right-[-26px] top-2px flex flex-col gap-10px">
                        <button
                          v-if="item.reply.text.trim()"
                          type="button"
                          title="复制消息"
                          aria-label="复制消息"
                          :class="MSG_TOOL"
                          @click="copyMessage(item)"
                        >
                          <svg
                            class="h-11px w-11px"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            aria-hidden="true"
                          >
                            <path :d="ICON.copy" />
                          </svg>
                        </button>
                        <button
                          v-if="activeId && !streaming && !shareMode"
                          type="button"
                          title="选择该轮分享"
                          aria-label="选择该轮分享"
                          :class="MSG_TOOL"
                          @click="startShare(turns.length - ti)"
                        >
                          <svg
                            class="h-11px w-11px"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            aria-hidden="true"
                          >
                            <path :d="ICON.share" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </div>

          <!-- 回到底部：32 磨砂圆钮，让开浮起的输入框 -->
          <button
            v-if="!atBottom && items.length"
            type="button"
            title="回到底部"
            aria-label="回到底部"
            class="glass-round absolute right-26px z-6 grid h-32px w-32px place-items-center rounded-full p-0 cursor-pointer hover:text-ink sx-focus"
            :style="{ bottom: `${composerAreaH - 40 + (shareMode ? 56 : 0)}px` }"
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

          <!-- 分享模式条：浮在输入框上方，44 高 r10 藤紫磨砂 -->
          <div
            v-if="shareMode"
            role="toolbar"
            aria-label="分享对话"
            class="share-bar sx-squircle absolute left-1/2 z-7 flex h-44px w-[min(1040px,calc(100%-64px))] -translate-x-1/2 items-center gap-8px rounded-10px border border-solid border-violet-line px-14px"
            :style="{ bottom: `${composerAreaH - 21}px` }"
          >
            <span class="text-12px text-violet-ink tabular-nums">已选 {{ shareTurns.length }} 轮</span>
            <button type="button" :class="BTN" @click="selectAllRounds">全选</button>
            <span class="flex-1" />
            <label class="inline-flex items-center gap-6px text-12px text-violet-ink">
              有效期
              <select
                v-model.number="shareExpireDays"
                class="sx-soft-input !h-28px !rounded-14px !px-10px cursor-pointer sx-focus"
              >
                <option v-for="o in SHARE_EXPIRE_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </label>
            <button type="button" :class="BTN" @click="cancelShare">取消</button>
            <button type="button" :disabled="!shareTurns.length || sharing" :class="BTN_PRIMARY" @click="doShare">
              {{ sharing ? '分享中…' : '分享' }}
            </button>
          </div>

          <!-- 输入框：首页 / 对话共用一份。对话态浮在消息上（外层不占位、只接收输入框本身的指针）；
               首页时经 Teleport 挪到标题下方的 dock（defer：dock 与本节点同一轮渲染） -->
          <div
            v-show="!isHome"
            ref="composerAreaEl"
            class="pointer-events-none absolute inset-x-0 bottom-0 z-6 px-32px pb-10px pt-30px"
          >
            <Teleport defer :to="isHome ? `#${homeDockId}` : 'body'" :disabled="!isHome">
              <div :class="isHome ? 'w-full' : 'pointer-events-auto mx-auto max-w-1040px'">
                <div
                  :class="[
                    'composer sx-squircle relative flex flex-col rounded-18px border border-solid px-18px pb-14px pt-16px',
                    isHome ? 'is-home' : 'is-chat',
                    composerDragging ? 'is-drop' : '',
                  ]"
                  ref="composerEl"
                >
                  <div v-if="selectedTemplate" class="mb-8px self-start">
                    <span
                      class="inline-flex h-24px max-w-full items-center gap-5px whitespace-nowrap rounded-12px border border-solid border-#e3d3ee bg-[linear-gradient(#fff,#fbf8fd)] pl-9px pr-4px text-12px text-violet-ink shadow-[0_1px_2px_rgba(31,35,41,0.05)]"
                    >
                      <svg
                        class="h-11px w-11px flex-none text-violet"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        <path :d="ICON.layers" />
                      </svg>
                      <span class="max-w-240px truncate">模板：{{ selectedTemplate.title }}</span>
                      <button
                        type="button"
                        title="移除模板"
                        :aria-label="`移除模板：${selectedTemplate.title}`"
                        :disabled="streaming"
                        class="relative grid h-16px w-16px flex-none place-items-center rounded-full border-none bg-transparent p-0 text-#a3a9b2 cursor-pointer hover:(bg-[rgba(107,72,124,0.10)] text-violet-ink) after:(content-empty absolute -inset-8px rounded-full) disabled:(cursor-not-allowed opacity-50) sx-focus"
                        @click="clearTemplate"
                      >
                        <svg
                          class="h-10px w-10px"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2.6"
                          aria-hidden="true"
                        >
                          <path :d="ICON.x" />
                        </svg>
                      </button>
                    </span>
                  </div>
                  <ul
                    v-if="attachments.length"
                    class="m-0 mb-8px flex list-none gap-8px self-start p-0"
                    aria-label="已添加的图片"
                  >
                    <li v-for="(url, i) in attachments" :key="url" class="relative h-53px w-40px flex-none">
                      <img
                        :src="url"
                        :alt="`图片 ${i + 1}`"
                        class="block h-full w-full rounded-3px border border-solid border-line object-cover"
                      />
                      <button
                        type="button"
                        title="移除图片"
                        :aria-label="`移除图片 ${i + 1}`"
                        :disabled="streaming"
                        class="absolute right-1px top-1px grid h-20px w-20px place-items-center rounded-3px border-none bg-[rgba(31,35,41,0.72)] p-0 text-12px leading-none text-white cursor-pointer after:(content-empty absolute -inset-6px rounded-[inherit]) disabled:(cursor-not-allowed opacity-50) sx-focus"
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
                    :placeholder="
                      isHome
                        ? '也可以直接描述你要做什么，智能体会先拆步骤、再跟你确认设置'
                        : '描述你的创作目标、风格方向或产品卖点'
                    "
                    aria-label="输入消息"
                    class="box-border block min-h-78px w-full flex-1 resize-none border-none bg-transparent p-0 font-sans text-13px leading-21px text-ink outline-none placeholder:text-placeholder"
                    :style="{ maxHeight: `${DRAFT_MAX_H}px` }"
                    @input="onDraftInput(($event.target as HTMLTextAreaElement).value)"
                    @keydown="onKeydown"
                  />
                  <div class="mt-8px flex flex-wrap items-center gap-6px">
                    <button
                      ref="imagePillEl"
                      type="button"
                      aria-haspopup="dialog"
                      :aria-label="`添加图片，已添加 ${attachments.length}/${MAX_IMAGES}`"
                      :disabled="streaming"
                      :class="[BTN, '!px-11px']"
                      @click="openImageDialog"
                    >
                      <n-spin v-if="uploading" :size="12" />
                      <svg
                        v-else
                        class="h-14px w-14px"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.8"
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
                        BTN,
                        '!px-11px max-w-[260px]',
                        selectedSkill ? '' : '!border-warning-line !text-warning',
                      ]"
                      @click="openSkillDialog"
                    >
                      <svg
                        class="h-14px w-14px flex-none"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        <path :d="ICON.sparkle" />
                      </svg>
                      <span class="truncate">{{ selectedSkill ? selectedSkill.title : '选择技能' }}</span>
                      <span
                        v-if="versionLabel(selectedSkill)"
                        class="flex-none rounded-3px bg-violet-soft px-3px text-10px leading-14px text-violet-ink"
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
                          :aria-label="`输出语言：${selectedLanguage.name}，点击更换`"
                          :disabled="streaming"
                          :class="[BTN, '!px-11px']"
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
                        aria-label="选择输出语言"
                        class="agent-pop sx-squircle mb-8px grid w-492px max-w-[calc(100vw-48px)] grid-cols-4 gap-4px rounded-14px border border-solid border-soft-line sx-soft-bg p-8px shadow-[0_18px_40px_rgba(31,35,41,0.14),inset_0_1px_0_#fff] max-sm:grid-cols-2"
                        @keydown.esc.stop.prevent="closeLanguage"
                      >
                        <div class="col-span-full px-6px pb-6px pt-2px text-11px leading-16px text-placeholder">
                          输出语言 · {{ AGENT_LANGUAGES.length }} 种
                        </div>
                        <button
                          v-for="l in AGENT_LANGUAGES"
                          :key="l.code"
                          type="button"
                          :aria-pressed="languageCode === l.code"
                          :class="[
                            'sx-squircle flex h-30px min-w-0 items-center gap-6px rounded-15px border border-solid px-9px text-left text-12px cursor-pointer [transition:background_.12s,border-color_.12s,color_.12s] motion-reduce:transition-none sx-focus',
                            languageCode === l.code
                              ? 'border-#dcc9e9 bg-[linear-gradient(#fff,#faf4fd)] font-600 text-violet-ink'
                              : 'border-transparent bg-transparent text-ink-2 hover:(border-soft-line bg-[linear-gradient(#fff,#fbfcfd)])',
                          ]"
                          @click="pickLanguage(l.code)"
                        >
                          <span
                            :class="[
                              'min-w-26px flex-none rounded-6px px-4px text-center text-10px leading-15px',
                              languageCode === l.code ? 'bg-#f3e9f9 text-violet-ink' : 'bg-#f4f5f7 text-#8a919c',
                            ]"
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
                      class="mr-4px flex-none text-12px text-warning"
                      >{{ SKILL_REQUIRED }}</span
                    >
                    <button
                      v-if="streaming"
                      type="button"
                      title="停止"
                      aria-label="停止"
                      :disabled="stopping"
                      :aria-busy="stopping"
                      class="ml-2px grid h-36px w-36px flex-none place-items-center rounded-full sx-soft p-0 text-ink-2 cursor-pointer [transition:border-color_.12s,color_.12s] enabled:hover:(border-violet-line text-violet-ink) disabled:(cursor-not-allowed opacity-60) sx-focus"
                      @click="stop"
                    >
                      <svg class="h-14px w-14px" viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" />
                      </svg>
                    </button>
                    <button
                      v-else
                      type="button"
                      title="发送"
                      aria-label="发送"
                      :disabled="!draft.trim() || skillMissing"
                      :aria-describedby="skillMissing ? 'agent-skill-required' : undefined"
                      class="ml-2px grid h-36px w-36px flex-none place-items-center rounded-full border border-solid border-violet-border bg-[linear-gradient(#8a639f,#7a548c)] p-0 text-white shadow-btn cursor-pointer [transition:background_.12s,box-shadow_.12s] enabled:hover:bg-[linear-gradient(#9a6fae,#875c9a)] disabled:(border-violet-line bg-none bg-#e2d7ea shadow-none cursor-not-allowed) sx-focus"
                      @click="send(draft, attachments, selectedTemplate, { fromDraft: true })"
                    >
                      <svg
                        class="h-16px w-16px"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.2"
                        aria-hidden="true"
                      >
                        <path :d="ICON.arrowUp" />
                      </svg>
                    </button>
                  </div>
                </div>
                <p v-if="!isHome" class="m-0 mt-6px text-center text-11px leading-16px text-#a3a9b2">
                  AI 生成内容仅供参考，请仔细甄别
                </p>
              </div>
            </Teleport>
          </div>
        </div>
      </section>
    </div>

    <!-- 选择技能：照原型 .skill-modal（780 宽、最高 640；头部居中分段 + 右侧搜索；两列 64 高白瓷技能卡） -->
    <n-modal v-model:show="skillDialogShow" @after-leave="skillPillEl?.focus()">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-skill-dialog-title"
        :class="[MODAL, 'skill-modal relative w-780px max-h-[min(640px,calc(100vh-48px))]']"
      >
        <div :class="MODAL_HEAD">
          <strong
            id="agent-skill-dialog-title"
            class="flex-none whitespace-nowrap text-15px font-600 leading-20px text-ink"
            >选择技能</strong
          >
          <span v-if="skillForm" class="flex-none rounded-3px bg-surface3 px-5px py-1px text-11px text-#a3a9b2">{{
            skillForm.id ? '编辑技能' : '新建技能'
          }}</span>
          <div
            v-if="!skillForm"
            role="group"
            aria-label="技能分类"
            class="sx-squircle absolute left-1/2 top-1/2 flex max-w-[330px] -translate-x-1/2 -translate-y-1/2 gap-2px overflow-x-auto rounded-18px sx-soft p-3px [scrollbar-width:none] max-md:(static max-w-none translate-x-0 translate-y-0)"
          >
            <button
              v-for="t in skillTabs"
              :key="t.name"
              type="button"
              :aria-pressed="skillTab === t.name"
              :class="[
                'sx-squircle h-28px flex-none whitespace-nowrap rounded-16px border border-solid px-12px text-12px cursor-pointer [transition:border-color_300ms_cubic-bezier(.4,0,.2,1),background-color_300ms_cubic-bezier(.4,0,.2,1),box-shadow_300ms_cubic-bezier(.4,0,.2,1),color_300ms_cubic-bezier(.4,0,.2,1)] motion-reduce:transition-none sx-focus',
                skillTab === t.name
                  ? 'border-violet-line bg-[linear-gradient(#fff,#f8f3fc)] font-600 text-violet-ink shadow-[0_1px_2px_rgba(31,35,41,0.05)]'
                  : 'border-transparent bg-transparent text-muted hover:text-ink',
              ]"
              @click="skillTab = t.name"
            >
              {{ t.name }}
            </button>
          </div>
          <label v-if="!skillForm" class="relative ml-auto w-170px flex-none">
            <span class="sr-only">搜索技能</span>
            <input v-model="skillQuery" type="search" placeholder="搜索技能" class="sx-soft-input w-full !pr-28px" />
            <svg
              class="pointer-events-none absolute right-10px top-8px h-13px w-13px text-placeholder"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path :d="ICON.search" />
            </svg>
          </label>
          <button
            type="button"
            aria-label="关闭"
            :class="[MODAL_X, skillForm ? '' : '!ml-0']"
            @click="skillDialogShow = false"
          >
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
        <!-- 新建 / 编辑自建技能：技能标题 0/20、提示词 0/10000、AI 帮写、取消 / 创建 -->
        <form
          v-if="skillForm"
          class="relative z-1 flex min-h-0 flex-1 flex-col gap-4px px-16px pb-12px pt-2px"
          @submit.prevent="saveSkillForm"
        >
          <label for="agent-user-skill-title" class="mt-10px flex justify-between text-12px leading-16px text-muted">
            技能标题<span class="text-placeholder tabular-nums"
              >{{ skillForm.title.length }} / {{ USER_SKILL_TITLE_MAX }}</span
            >
          </label>
          <input
            id="agent-user-skill-title"
            v-model="skillForm.title"
            :maxlength="USER_SKILL_TITLE_MAX"
            placeholder="例如：小红书爆款封面"
            class="sx-soft-input w-full !h-34px !text-13px"
          />
          <div class="mt-10px flex items-center justify-between gap-8px">
            <label for="agent-user-skill-prompt" class="text-12px leading-16px text-muted">提示词</label>
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
            class="sx-squircle box-border min-h-140px w-full flex-1 resize-none rounded-14px sx-soft px-12px py-10px text-13px leading-20px text-ink outline-none placeholder:text-placeholder focus:(border-#b9bfc4 shadow-soft-focus)"
          />
          <div class="mt-10px flex justify-end gap-8px">
            <button type="button" :class="BTN" @click="skillForm = null">取消</button>
            <button type="submit" :disabled="!skillFormValid || skillSaving || skillWriting" :class="BTN_PRIMARY">
              {{ skillSaving ? '保存中…' : skillForm.id ? '保存' : '创建' }}
            </button>
          </div>
        </form>
        <div v-else class="relative z-1 flex min-h-0 flex-1 flex-col px-16px pb-4px pt-12px">
          <div
            class="grid min-h-0 flex-1 grid-cols-2 content-start gap-8px overflow-y-auto pb-18px pt-2px max-sm:grid-cols-1"
          >
            <button
              v-if="skillTab === MY_SKILL_GROUP"
              type="button"
              :class="[
                SKILL_CARD,
                'cursor-pointer border-dashed border-soft-line bg-transparent hover:(border-violet-line bg-#fcfafd) sx-focus',
              ]"
              @click="openSkillCreate"
            >
              <span class="flex min-w-0 flex-1 flex-col gap-2px">
                <span class="flex items-center gap-6px text-13px font-500 leading-18px text-ink">
                  <svg
                    class="h-12px w-12px flex-none text-violet-ink"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    aria-hidden="true"
                  >
                    <path :d="ICON.plus" />
                  </svg>
                  新建技能
                </span>
                <span class="truncate text-11px leading-16px text-muted">写下标题和提示词，存成自己的技能</span>
              </span>
            </button>
            <button
              v-for="s in tabSkills"
              :key="s.agentSkillId"
              type="button"
              :aria-pressed="pendingSkillId === s.agentSkillId"
              :class="[SKILL_CARD, 'cursor-pointer sx-focus', pendingSkillId === s.agentSkillId ? SKILL_ON : SKILL_OFF]"
              @click="pendingSkillId = s.agentSkillId"
              @dblclick="confirmSkill"
            >
              <span
                :class="[
                  'grid h-32px w-32px flex-none place-items-center rounded-full border border-solid border-line text-12px font-600 tracking-[-.02em] text-violet-ink',
                  pendingSkillId === s.agentSkillId
                    ? 'bg-[linear-gradient(135deg,#f1e6f8,#e9daf2)]'
                    : 'bg-[linear-gradient(135deg,#f6effa,#efe6f5)]',
                ]"
                aria-hidden="true"
                >{{ skillInitial(s) }}</span
              >
              <span class="flex min-w-0 flex-1 flex-col gap-2px">
                <span
                  :class="[
                    'flex items-center gap-6px text-13px leading-18px',
                    pendingSkillId === s.agentSkillId ? 'font-600 text-violet-ink' : 'font-500 text-ink',
                  ]"
                >
                  <span class="truncate">{{ s.title }}</span>
                  <span
                    v-if="versionLabel(s)"
                    class="flex-none rounded-2px bg-violet-soft px-3px text-10px font-400 leading-14px text-violet-ink"
                    >{{ versionLabel(s) }}</span
                  >
                </span>
                <span class="truncate text-11px leading-16px text-muted">{{ s.description || '　' }}</span>
              </span>
              <svg
                v-if="pendingSkillId === s.agentSkillId"
                class="h-15px w-15px flex-none text-violet"
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
              <div v-for="u in visibleUserSkills" :key="`u${u.userSkillId}`" :class="[SKILL_CARD, SKILL_OFF]">
                <span
                  class="grid h-32px w-32px flex-none place-items-center rounded-full border border-solid border-line bg-[linear-gradient(135deg,#f6effa,#efe6f5)] text-12px font-600 text-violet-ink"
                  aria-hidden="true"
                  >{{ Array.from(u.title?.trim() || '技')[0] }}</span
                >
                <span class="flex min-w-0 flex-1 flex-col gap-2px">
                  <span class="truncate text-13px font-500 leading-18px text-ink">{{ u.title }}</span>
                  <span class="truncate text-11px leading-16px text-muted">{{
                    skillDeleteId === u.userSkillId
                      ? '确认删除？删除后不可恢复'
                      : dayLabel(u.updatedAt || u.createdAt) || '自建技能'
                  }}</span>
                </span>
                <template v-if="skillDeleteId === u.userSkillId">
                  <button type="button" :class="[BTN, '!px-10px']" @click="skillDeleteId = null">取消</button>
                  <button
                    type="button"
                    :disabled="skillDeleting"
                    :aria-busy="skillDeleting"
                    :class="[BTN_DANGER, '!px-10px']"
                    @click="confirmSkillDelete(u)"
                  >
                    删除
                  </button>
                </template>
                <span v-else class="flex flex-none gap-8px">
                  <IconButton
                    size="sm"
                    variant="quiet"
                    :label="`编辑技能：${u.title}`"
                    :loading="skillFormLoading"
                    @click="openSkillEdit(u)"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path :d="ICON.edit" />
                    </svg>
                  </IconButton>
                  <IconButton
                    size="sm"
                    variant="danger"
                    :label="`删除技能：${u.title}`"
                    @click="skillDeleteId = u.userSkillId"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path :d="ICON.trash" />
                    </svg>
                  </IconButton>
                </span>
              </div>
              <div v-if="userSkillPage < userSkillPages" class="col-span-full py-4px text-center">
                <button type="button" :disabled="userSkillLoading" :class="LINK_BTN" @click="loadUserSkills()">
                  加载更多
                </button>
              </div>
              <div v-if="userSkillLoading && !userSkills.length" class="col-span-full flex justify-center py-26px">
                <n-spin size="small" />
              </div>
            </template>
            <div
              v-if="
                !tabSkills.length && (skillTab !== MY_SKILL_GROUP || (!visibleUserSkills.length && !userSkillLoading))
              "
              class="col-span-full px-12px py-26px text-center text-12px leading-18px text-placeholder"
            >
              {{
                skillQuery.trim()
                  ? '没有匹配的技能，换个词试试'
                  : skillTab === MY_SKILL_GROUP
                    ? '暂无自建技能'
                    : '暂无技能'
              }}
            </div>
          </div>
          <span
            class="pointer-events-none absolute bottom-0 left-0 right-0 h-18px bg-[linear-gradient(rgba(255,255,255,0),#fff)]"
            aria-hidden="true"
          />
        </div>
        <div
          v-if="!skillForm"
          class="relative z-1 flex flex-none justify-end gap-8px border-t border-solid border-line-soft bg-white px-18px py-10px"
        >
          <button type="button" :class="BTN" @click="skillDialogShow = false">取消</button>
          <button type="button" :disabled="!pendingSkillId" :class="BTN_PRIMARY" @click="confirmSkill">确认</button>
        </div>
      </div>
    </n-modal>

    <!-- 分享链接：生成后自动复制，复制失败时可在这里手动复制 -->
    <n-modal v-model:show="shareLinkShow">
      <div role="dialog" aria-modal="true" aria-labelledby="agent-share-dialog-title" :class="[MODAL, 'w-480px']">
        <div :class="MODAL_HEAD">
          <strong id="agent-share-dialog-title" class="text-15px font-600 leading-20px text-ink">分享链接</strong>
          <button type="button" aria-label="关闭" :class="MODAL_X" @click="shareLinkShow = false">
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
          <label for="agent-share-link" class="text-12px leading-16px text-muted"
            >拿到链接的人无需登录即可查看所选轮次</label
          >
          <input
            id="agent-share-link"
            ref="shareLinkInputEl"
            :value="shareLink"
            readonly
            class="sx-soft-input w-full !h-34px text-ink-2"
            @focus="($event.target as HTMLInputElement).select()"
          />
        </div>
        <div class="flex flex-none justify-end gap-8px border-t border-solid border-line-soft px-18px py-10px">
          <button type="button" :class="BTN" @click="shareLinkShow = false">完成</button>
          <button type="button" :class="BTN_PRIMARY" @click="copyShareLink">复制链接</button>
        </div>
      </div>
    </n-modal>

    <!-- 上传素材：820×600、白瓷胶囊页签、虚线投放区；本地上传走商拍工作室同一条直传，资产页签复用资产选择器 -->
    <n-modal v-model:show="imageDialogShow" @after-leave="imagePillEl?.focus()">
      <div
        ref="imageDialogEl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-image-dialog-title"
        :class="[MODAL, 'h-600px w-820px']"
      >
        <div :class="MODAL_HEAD">
          <strong id="agent-image-dialog-title" class="text-15px font-600 leading-20px text-ink">上传素材</strong>
          <span class="rounded-3px bg-surface3 px-5px py-1px text-11px text-#a3a9b2">{{ DROP_PASTE_HINT }}</span>
          <button type="button" aria-label="关闭" :class="MODAL_X" @click="imageDialogShow = false">
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
        <div role="group" aria-label="素材来源" class="flex flex-none flex-wrap gap-8px px-18px pb-10px pt-12px">
          <button
            v-for="t in IMAGE_TABS"
            :key="t.key"
            type="button"
            :aria-pressed="imageTab === t.key"
            :class="[
              'sx-squircle h-32px rounded-16px border border-solid px-14px text-13px cursor-pointer [transition:border-color_.12s,background_.12s,color_.12s] motion-reduce:transition-none sx-focus',
              imageTab === t.key
                ? 'border-#dcc9e9 bg-[linear-gradient(#fff,#faf4fd)] font-600 text-violet-ink shadow-[0_1px_2px_rgba(31,35,41,0.05)]'
                : 'border-soft-line sx-soft-bg text-muted hover:(border-#aeb4b9 text-ink)',
            ]"
            @click="imageTab = t.key"
          >
            {{ t.label }}
          </button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto px-18px pb-14px">
          <div
            v-if="imageTab === 'local'"
            :class="[
              'sx-squircle box-border flex h-full min-h-340px flex-col items-center justify-center gap-8px rounded-14px border border-dashed text-12px text-#a3a9b2',
              dragging ? 'border-violet bg-violet-soft' : 'border-soft-line bg-#fcfcfd',
            ]"
          >
            <span
              class="grid h-44px w-44px place-items-center rounded-12px bg-surface3 text-#b3b9c2"
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
            <b class="text-13px font-500 text-ink-2">选择本地图片</b>
            <span>{{ IMAGE_FORMATS }}</span>
            <span>当前还能添加 {{ imageRoom }} 张图片</span>
            <button
              type="button"
              :disabled="uploading"
              :aria-busy="uploading"
              :class="BTN_PRIMARY"
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
            class="sx-squircle box-border flex h-full min-h-340px flex-col items-center justify-center gap-8px rounded-14px border border-dashed border-soft-line bg-#fcfcfd text-12px text-#a3a9b2"
          >
            <span>当前还能添加 {{ imageRoom }} 张图片</span>
            <button type="button" :class="BTN_PRIMARY" @click="openAssetPicker">从资产库添加</button>
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

    <MediaLightbox v-model:show="lightboxShow" v-model:index="lightboxIndex" :items="lightboxItems" />
    <!-- 结果图校色：参数 + 局部选区 + 对比；引用编辑 / 在画布中打开 用烘好的图 -->
    <ColorFixDialog
      v-model:show="fixShow"
      :src="fixTarget.url"
      :color-key="fixTarget.key"
      :title="`图片校色 · 第 ${fixTarget.index + 1} 张`"
      file-name="生成图-校色"
      @closed="fixVersion += 1"
    >
      <template #actions="{ cf, bakeFile }">
        <button type="button" class="sx-btn" :disabled="fixWorking || uploading" @click="fixDialogQuote(cf, bakeFile)">
          引用编辑
        </button>
        <button
          type="button"
          class="sx-btn-primary"
          :disabled="fixWorking || openingCanvas"
          :aria-busy="fixWorking || openingCanvas"
          @click="fixDialogCanvas(cf, bakeFile)"
        >
          在画布中打开
        </button>
      </template>
    </ColorFixDialog>
  </n-config-provider>
</template>

<style scoped>
/*
 * 智能体页材质与动效：对齐原型 5185 AgentView.vue <style>（:1523-2085）。
 * 原子类写不了的部分落这里：伪元素（小嘴 / 点阵 / 头像细环 / 光标）、磨砂、悬浮钮展开、入场动效、开合过渡。
 */
.agent-root,
.agent-modal {
  /* 白瓷材质（定稿 A）：面 / 线 / 影（原型 :2079） */
  --soft-bg: linear-gradient(#fff, #f8f9fa);
  --soft-line: #c9cdd0;
  --soft-shadow: 0 6px 16px rgba(31, 35, 41, 0.08), inset 0 1px 0 #fff, inset 0 -3px 6px rgba(31, 35, 41, 0.04);
}

/* 曲率：页内元素一律超椭圆（原型 :2073）；正圆（rounded-full）不挂，转圈的 / 头像要保持正圆 */
.agent-root :where(*):not(.rounded-full),
.agent-modal :where(*):not(.rounded-full) {
  corner-shape: squircle;
}

/* ---- 会话历史：收起时脱流停在原地淡出（聊天区同一帧拿到整块宽度），展开时原位淡入（原型 setDir :280-312） ---- */
.agent-dir-enter-active {
  animation: agent-dir-in 240ms cubic-bezier(0.4, 0, 0.2, 1) both;
}
.agent-dir-leave-active {
  animation: agent-dir-out 240ms cubic-bezier(0.4, 0, 0.2, 1) both;
  pointer-events: none;
}
.agent-dir-leave-active:not(.is-drawer) {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 9;
}
@keyframes agent-dir-in {
  from {
    opacity: 0;
    transform: translateX(-12px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@keyframes agent-dir-out {
  0% {
    opacity: 1;
    transform: none;
  }
  /* 前 40% 保持不透明：聊天区在同一帧变宽的那一下压在面板后面 */
  40% {
    opacity: 1;
    transform: translateX(-2px);
  }
  100% {
    opacity: 0;
    transform: translateX(-12px);
  }
}
.agent-dir.is-drawer .dir-card {
  box-shadow:
    0 12px 24px rgba(31, 35, 41, 0.14),
    0 2px 6px rgba(31, 35, 41, 0.06);
}
.agent-mask-enter-active,
.agent-mask-leave-active {
  transition: opacity 160ms ease;
}
.agent-mask-enter-from,
.agent-mask-leave-to {
  opacity: 0;
}

/* ---- 悬浮圆钮：和输入框同一种磨砂；整组悬停 / 键盘聚焦时展开成带名字的胶囊（原型 :1573-1585） ---- */
.glass-ic {
  box-sizing: border-box;
  width: 34px;
  height: 34px;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.92);
  border-radius: 17px;
  background: linear-gradient(rgba(255, 255, 255, 0.94), rgba(246, 246, 247, 0.84));
  box-shadow:
    0 8px 20px rgba(31, 35, 41, 0.14),
    0 2px 5px rgba(31, 35, 41, 0.06),
    inset 0 1px 0 #fff,
    inset 0 -2px 4px rgba(31, 35, 41, 0.05);
  color: #4b5563;
  cursor: pointer;
  overflow: hidden;
  will-change: width;
  transition:
    width 0.24s cubic-bezier(0.22, 0.8, 0.24, 1),
    padding 0.24s cubic-bezier(0.22, 0.8, 0.24, 1),
    gap 0.24s cubic-bezier(0.22, 0.8, 0.24, 1),
    background 0.12s,
    box-shadow 0.12s,
    color 0.12s;
}
.glass-ic svg {
  flex: none;
}
.glass-ic:hover:not(:disabled) {
  background: linear-gradient(rgba(255, 255, 255, 0.94), rgba(246, 241, 250, 0.82));
  box-shadow:
    0 10px 24px rgba(31, 35, 41, 0.18),
    0 2px 5px rgba(31, 35, 41, 0.07),
    inset 0 1px 0 #fff,
    inset 0 -2px 4px rgba(31, 35, 41, 0.05);
  color: #6b487c;
}
.glass-ic[aria-pressed='true'] {
  color: #6b487c;
  background: linear-gradient(rgba(255, 255, 255, 0.96), rgba(243, 237, 248, 0.9));
}
.glass-ic:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.glass-lbl {
  max-width: 0;
  opacity: 0;
  overflow: hidden;
  white-space: nowrap;
  font-size: 12px;
  line-height: 16px;
  letter-spacing: 0.01em;
  transition:
    max-width 0.24s cubic-bezier(0.22, 0.8, 0.24, 1),
    opacity 0.16s ease 0.04s;
}
/* 终宽由 sizeFloatLabels 按文字量出（--w），宽度动到 auto 会卡 */
.float-acts:hover .glass-ic,
.float-acts:has(:focus-visible) .glass-ic {
  width: var(--w, 34px);
  gap: 6px;
  padding: 0 11px;
}
.float-acts:hover .glass-lbl,
.float-acts:has(:focus-visible) .glass-lbl {
  max-width: 120px;
  opacity: 1;
}

/* 回到底部：32 磨砂圆钮（原型 :1596） */
.glass-round {
  border: 1px solid rgba(255, 255, 255, 0.78);
  background: rgba(255, 255, 255, 0.7);
  -webkit-backdrop-filter: blur(18px) saturate(180%);
  backdrop-filter: blur(18px) saturate(180%);
  box-shadow: 0 6px 18px rgba(31, 35, 41, 0.1);
  color: #5f6673;
}

/* 悬浮提示：按钮下方的小黑片（原型 :2066-2068） */
.agent-tip-wrap {
  position: relative;
  display: inline-flex;
  flex: none;
}
.agent-tip {
  position: absolute;
  left: 50%;
  top: calc(100% + 7px);
  z-index: 40;
  transform: translateX(-50%) translateY(-2px);
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(31, 35, 41, 0.94);
  color: #fff;
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
  box-shadow: 0 6px 16px rgba(31, 35, 41, 0.18);
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.12s ease,
    transform 0.12s ease;
}
.agent-tip-wrap:hover .agent-tip,
.agent-tip-wrap:focus-within .agent-tip {
  opacity: 1;
  transform: translateX(-50%);
}

/* ---- 对话背景：中性近白 + 28px 点阵从下往上化开；顶部 56px 渐隐（原型 bg-b :1591-1592、:1600） ---- */
.agent-chat.is-conv {
  background: #fafafa;
}
.agent-chat.is-conv::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-image: radial-gradient(circle, #dadce0 1px, transparent 1px);
  background-size: 28px 28px;
  background-position: 50% 100%;
  -webkit-mask-image: radial-gradient(
    ellipse 96% 92% at 50% 100%,
    #000 10%,
    rgba(0, 0, 0, 0.62) 52%,
    rgba(0, 0, 0, 0) 88%
  );
  mask-image: radial-gradient(ellipse 96% 92% at 50% 100%, #000 10%, rgba(0, 0, 0, 0.62) 52%, rgba(0, 0, 0, 0) 88%);
}
.stream-fade {
  background: linear-gradient(rgba(250, 250, 250, 0.72), transparent);
}

/* ---- 输入框：首页与对话同一个框，只换材质（原型 .home .ref-composer :1615 / .chat-composer :1875） ---- */
.composer {
  transition:
    box-shadow 0.12s,
    border-color 0.12s;
}
.composer.is-home {
  border-color: #c9cdd0;
  background: linear-gradient(rgba(255, 255, 255, 0.86), rgba(246, 246, 247, 0.7));
  -webkit-backdrop-filter: blur(16px) saturate(170%);
  backdrop-filter: blur(16px) saturate(170%);
  box-shadow:
    0 16px 40px rgba(31, 35, 41, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.95),
    inset 0 0 0 1px rgba(201, 207, 214, 0.22);
}
.composer.is-home:focus-within {
  border-color: #b9bfc4;
  box-shadow:
    inset 0 2px 6px rgba(31, 35, 41, 0.1),
    inset 0 1px 2px rgba(31, 35, 41, 0.06),
    0 16px 40px rgba(31, 35, 41, 0.1);
}
.composer.is-chat {
  border-color: rgba(255, 255, 255, 0.9);
  background: linear-gradient(rgba(255, 255, 255, 0.82), rgba(246, 246, 247, 0.64));
  -webkit-backdrop-filter: blur(16px) saturate(170%);
  backdrop-filter: blur(16px) saturate(170%);
  box-shadow:
    0 16px 40px rgba(31, 35, 41, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.95),
    inset 0 0 0 1px rgba(201, 207, 214, 0.22);
}
.composer.is-chat:focus-within {
  border-color: #c9cdd0;
  box-shadow:
    0 16px 40px rgba(31, 35, 41, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.95),
    inset 0 0 0 1px rgba(201, 207, 214, 0.34);
}
/* 拖入图片：藤紫虚线 + 柔紫底（不占位） */
.composer.is-drop {
  outline: 1px dashed #875f9a;
  outline-offset: -1px;
  background: #f3edf8;
}

/* 分享模式条：藤紫磨砂（原型 :1862） */
.share-bar {
  background: rgba(248, 243, 252, 0.88);
  -webkit-backdrop-filter: blur(18px) saturate(160%);
  backdrop-filter: blur(18px) saturate(160%);
  box-shadow: 0 8px 22px rgba(31, 35, 41, 0.1);
}

/* ---- 消息 ---- */
/* AI 头像：玻璃圆片 + 细环，挂在左槽（原型 :2082-2084） */
.ai-avatar {
  position: absolute;
  left: -48px;
  top: -7px;
  box-sizing: border-box;
  width: 38px;
  height: 38px;
  display: block;
  padding: 5px;
  border-radius: 50%;
  corner-shape: round;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.98);
  background: linear-gradient(180deg, #fff 0%, #fbfbfc 52%, #f0f1f3 100%);
  box-shadow:
    0 0 0 1px rgba(31, 35, 41, 0.055),
    0 6px 14px rgba(31, 35, 41, 0.12),
    inset 0 1px 0 #fff,
    inset 0 -4px 6px rgba(31, 35, 41, 0.09);
}
.ai-avatar::after {
  content: '';
  position: absolute;
  inset: 4px;
  border-radius: 50%;
  box-shadow:
    0 0 0 1px rgba(31, 35, 41, 0.06),
    inset 0 -2px 4px rgba(31, 35, 41, 0.1);
  pointer-events: none;
}
.ai-avatar img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  border-radius: 50%;
  corner-shape: round;
}
/* 小嘴：卡片 top 16，正文气泡 top 7（原型 :1714、:1729） */
.agent-tail::before {
  content: '';
  position: absolute;
  left: -5px;
  top: 16px;
  width: 9px;
  height: 9px;
  transform: rotate(45deg);
  background: #fff;
  border-left: 1px solid var(--soft-line);
  border-bottom: 1px solid var(--soft-line);
  border-bottom-left-radius: 2px;
}
.ai-body::before {
  top: 7px;
}
/* 流式光标：2px 藤紫竖条，1s 一次闪烁 */
.ai-body.is-streaming::after {
  content: '';
  display: inline-block;
  width: 2px;
  height: 13px;
  margin-left: 2px;
  vertical-align: -2px;
  background: #6b487c;
  animation: agent-caret 1s steps(1) infinite;
}
@keyframes agent-caret {
  50% {
    opacity: 0;
  }
}

/* 执行清单状态圆圈：同一个圆框只换笔画和颜色（原型 :1761-1777） */
.st-ic.is-ok {
  color: #3f7a56;
}
.st-ic.is-fail {
  color: #c24545;
}
.st-ic.is-idle {
  color: #c8ccd1;
}
.st-ic.is-run {
  color: #875f9a;
}
.st-ic.is-run svg {
  animation: agent-spin 0.9s linear infinite;
}
.st-ic.is-run .st-r {
  stroke-dasharray: 15 42;
}
.st-track {
  stroke: rgba(135, 95, 154, 0.22);
}
.think-spin {
  animation: agent-spin 1.4s linear infinite;
}
.w-spin {
  animation: agent-spin 0.9s linear infinite;
}
@keyframes agent-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 每块的悬停操作挂在右槽，触屏常显 */
.msg-tools {
  opacity: 0;
  transition: opacity 0.12s;
}
.msg-wrap:hover .msg-tools,
.msg-wrap:focus-within .msg-tools {
  opacity: 1;
}
@media (hover: none) {
  .msg-tools {
    opacity: 1;
  }
}

/* 表单：提交后收成摘要卡（820 → 480，340ms） */
.form-card {
  transition: max-width 0.34s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.form-card.is-done .form-sub {
  animation: agent-fade 0.26s ease both;
}

/* 技能弹层：底部一层点阵往上化开（原型 :1910） */
.skill-modal::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 190px;
  z-index: 0;
  pointer-events: none;
  background-image: radial-gradient(circle, #d8dade 1px, transparent 1px);
  background-size: 24px 24px;
  background-position: 50% 100%;
  -webkit-mask-image: linear-gradient(180deg, transparent, #000 72%);
  mask-image: linear-gradient(180deg, transparent, #000 72%);
}

/* ---- 入场：消息上浮淡入 260ms；结果图逐张错开 0/45/90/135ms；弹层 220ms（原型 :2052-2063） ---- */
@keyframes agent-rise {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.994);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@keyframes agent-pop-in {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.986);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@keyframes agent-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
.msg-wrap,
.agent-rise {
  animation: agent-rise 0.26s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
.shot {
  animation: agent-rise 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
.shot:nth-child(2) {
  animation-delay: 0.045s;
}
.shot:nth-child(3) {
  animation-delay: 0.09s;
}
.shot:nth-child(4) {
  animation-delay: 0.135s;
}
.agent-modal,
.agent-pop {
  animation: agent-pop-in 0.22s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
.agent-fade-in {
  animation: agent-fade 0.18s ease both;
}

@media (prefers-reduced-motion: reduce) {
  .msg-wrap,
  .agent-rise,
  .shot,
  .agent-modal,
  .agent-pop,
  .agent-fade-in,
  .form-card.is-done .form-sub,
  .agent-dir-enter-active,
  .agent-dir-leave-active,
  .ai-body.is-streaming::after {
    animation: none;
  }
  /* 加载转圈是状态指示不是装饰：减弱动效下照转，只放慢 */
  .think-spin,
  .w-spin,
  .st-ic.is-run svg {
    animation-duration: 2.4s;
  }
  .glass-ic,
  .glass-lbl,
  .agent-tip,
  .composer,
  .form-card,
  .msg-tools,
  .agent-mask-enter-active,
  .agent-mask-leave-active {
    transition: none;
  }
}
</style>
