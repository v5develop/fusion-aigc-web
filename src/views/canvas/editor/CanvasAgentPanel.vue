<!--
  编辑器右侧「画布助手」面板：复用 /agent/stream（canvasId + 画布助手技能），渲染正文、工具调用过程、生成进度与点数。
  画布的刷新不在这里做：智能体改了画布，变更事件会让编辑器自动载入 / 合并并高亮改动节点（useCanvasSync + store）。
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  answerReady,
  answersFromAttribute,
  buildAnswers,
  formReady,
  initialAnswer,
  isNestedQuestion,
  type IAgentAnswer,
  type IAgentForm,
  type IAgentFrame,
  type IAgentQuestion,
} from '@/api/agent.ts'
import { ApiError, toApiError } from '@/api/index.ts'
import {
  CANVAS_AGENT_AUTO_PRESETS,
  CANVAS_ASSISTANT_SKILL_ID,
  cancelCanvasAgent,
  canvasAgentRecover,
  canvasAgentStream,
  clearCanvasAgentSession,
  createCanvasAgentConversation,
  findCanvasAgentConversation,
  getCanvasAgentActiveTurn,
  loadCanvasAgentMessages,
  readCanvasAgentAutoPrefs,
  readCanvasAgentSession,
  writeCanvasAgentAutoPrefs,
  writeCanvasAgentSession,
  type ICanvasAgentStreamReq,
} from '@/api/canvas-agent.ts'
import { createSafeUuid } from '@/utils/utils.ts'
import EditorIcon from './EditorIcon.vue'
import { useCanvasEditor } from './useCanvasEditor.ts'
import {
  applyCanvasFrame,
  canvasFrameCursor,
  canvasReplyFromSnapshot,
  canvasReplySnapshot,
  canvasTurnsFromMessages,
  composeCanvasContent,
  emptyCanvasReply,
  type ICanvasAgentReply,
  type ICanvasAgentStep,
  TURN_FORBIDDEN_CODE,
} from './canvas-agent-frames.ts'
import { FOCUS_RING } from './ui.ts'

export interface ICanvasAgentRef {
  id: string
  title: string
  kind: string
}

const props = defineProps<{
  canvasId: string
  /** 当前选中的节点（输入框可引用） */
  selected: ICanvasAgentRef[]
}>()
const emit = defineEmits<{ close: []; locate: [id: string] }>()

const store = useCanvasEditor()

interface ITurn {
  key: string
  content: string
  refs: ICanvasAgentRef[]
  reply: ICanvasAgentReply
  /** 续流游标：本轮的 turnId 与已收到的最大 PROCESSING sequence */
  turnId?: string
  lastSeq?: number
  /** 发起本轮的用户消息透传的 attribute（历史回读；表单续答的答案在 attribute.answers） */
  attribute?: Record<string, unknown>
  /** 本轮回复带确认 / 参数表单时的作答状态 */
  form?: IFormState
}

interface IFormState {
  answers: Record<string, IAgentAnswer>
  submitting: boolean
  /** 已提交（受理）或已被后续消息取代：只读 */
  done: boolean
  /** 没作答就被后面的消息取代 */
  superseded?: boolean
  /** 提交未受理时的错误 */
  error: string
}

const turns = ref<ITurn[]>([])
const input = ref('')
const refs = ref<ICanvasAgentRef[]>([])
const streaming = ref(false)
const disabled = ref(false)
const conversationId = ref('')
const listEl = ref<HTMLElement | null>(null)
/** 正在加载历史对话 / 加载失败（非「会话不存在」，可重试） */
const historyLoading = ref(false)
const historyError = ref(false)
let controller: AbortController | null = null
/**
 * 换画布 / 新对话 / 卸载时自增：在途的异步（建会话、读历史、流、续流）回来后发现代次变了就什么都不做，
 * 保证同一时刻只有一个流在写当前画布的对话
 */
let epoch = 0
/** 受理后断流且续流也因断网失败：等 online 事件再续 */
let resumePending = false

const EXAMPLES = [
  '帮我加一组秋季物料：两段文案和一个生成节点',
  '把主图生成的提示词改成极简白底风格',
  '整理一下画布布局',
]

const canSend = computed(() => !streaming.value && !historyLoading.value && !disabled.value && !!input.value.trim())

function addSelectedRefs() {
  const known = new Set(refs.value.map((item) => item.id))
  for (const item of props.selected) if (!known.has(item.id)) refs.value.push(item)
}
function removeRef(id: string) {
  refs.value = refs.value.filter((item) => item.id !== id)
}

/** 只断开本地的流（服务端那一轮继续跑，回到该画布时续上），并让在途的异步全部作废 */
function detach() {
  epoch++
  flushCursor()
  controller?.abort()
  controller = null
  streaming.value = false
  resumePending = false
}

// 换画布：断开本地流（不取消服务端那一轮），换成新画布记住的会话
watch(
  () => props.canvasId,
  () => {
    detach()
    turns.value = []
    refs.value = []
    conversationId.value = ''
    disabled.value = false
    historyError.value = false
    historyLoading.value = false
    void restore()
  },
)

function scrollToEnd() {
  void nextTick(() => {
    const el = listEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

// ---------------- 会话记录与续流游标（localStorage canvas-agent:conv:{canvasId}） ----------------

let cursorTimer: ReturnType<typeof setTimeout> | null = null
let cursorWrite: (() => void) | null = null

/**
 * 记下进行中那一轮：turnId + 已渲染的最后一帧 sequence + 归并到该帧为止的回复快照，三者同一次写入、始终对齐。
 * START 立即写；之后逐帧更新，落盘合并到每 500ms 一次（message_delta 很密），换画布 / 卸载 / pagehide 时立即落盘。
 */
function saveCursor(turn: ITurn, immediate = false) {
  const canvasId = props.canvasId
  const convId = conversationId.value
  if (!canvasId || !convId || !turn.turnId) return
  cursorWrite = () =>
    writeCanvasAgentSession(canvasId, {
      conversationId: convId,
      turnId: turn.turnId,
      lastSeq: turn.lastSeq ?? 0,
      snapshot: canvasReplySnapshot(turn.reply),
    })
  if (immediate) return flushCursor()
  cursorTimer ??= setTimeout(flushCursor, 500)
}
function flushCursor() {
  if (cursorTimer) clearTimeout(cursorTimer)
  cursorTimer = null
  const write = cursorWrite
  cursorWrite = null
  write?.()
}
/** 本轮已收尾：记录里只留会话 id */
function clearCursor() {
  if (cursorTimer) clearTimeout(cursorTimer)
  cursorTimer = null
  cursorWrite = null
  if (props.canvasId && conversationId.value) {
    writeCanvasAgentSession(props.canvasId, { conversationId: conversationId.value })
  }
}

/** 一帧进当前轮次：归并 + 改动节点高亮 + 「暂未开启」+ 游标 */
function ingest(live: ITurn, frame: IAgentFrame) {
  const before = live.reply.steps.length
  applyCanvasFrame(live.reply, frame)
  // 写类工具回的 changedNodeIds：等同步事件把节点落到画布后高亮（SSE 事件也会高亮，这里兜住事件晚到 / 走轮询）
  const last = live.reply.steps[live.reply.steps.length - 1]
  if (frame.event === 'PROCESSING' && live.reply.steps.length >= before && last?.changedNodeIds?.length) {
    const ids = last.changedNodeIds
    last.changedNodeIds = undefined
    setTimeout(() => store.flashNodes(ids), 700)
  }
  if (live.reply.disabled) disabled.value = true
  if (live.turnId) saveCursor(live)
  scrollToEnd()
}

/** 会话已不存在 / 不属于当前用户：业务失败（有业务码）或 404；断网 / 5xx 不算，保留记录 */
function isGone(err: unknown): boolean {
  const e = toApiError(err)
  if (!e || e.isNetwork) return false
  return e.httpStatus === 404 || (e.httpStatus == null && e.code !== -1)
}

// ---------------- 打开侧栏：载入本画布最近一次会话 ----------------

/**
 * 读本画布记住的会话（本地没有时按 canvasId 向 Java 查回），载入历史并查进行中的轮次（active-turn）：
 * 没有 → 只渲染历史；有 → 续流接上（本地有同一轮的快照就先渲染它、从快照的 sequence 之后续，否则从 0 整轮重放）。
 */
async function restore() {
  const my = epoch
  const canvasId = props.canvasId
  if (!canvasId || streaming.value) return
  const record = readCanvasAgentSession(canvasId)
  historyLoading.value = true
  historyError.value = false
  try {
    const convId = record?.conversationId || (await findCanvasAgentConversation(canvasId))
    if (my !== epoch || !convId) return
    const [messages, active] = await Promise.all([loadCanvasAgentMessages(convId), getCanvasAgentActiveTurn(convId)])
    if (my !== epoch || streaming.value) return
    conversationId.value = convId
    const list: ITurn[] = canvasTurnsFromMessages(messages)
    const last = list[list.length - 1]
    // 运行中的一轮只落了用户那条（助手消息终态才落库）：有进行中的轮次时它就是要续的那一轮
    const lastOpen = !!last && !last.reply.finished
    for (const turn of list) turn.reply.finished = true
    seedForms(list)
    if (!active) {
      turns.value = list
      // 记录里残留的进行中游标（那一轮在页面关闭期间已收尾）一并清掉
      writeCanvasAgentSession(canvasId, { conversationId: convId })
      scrollToEnd()
      return
    }
    let target: ITurn
    if (lastOpen && last) {
      target = last
      target.reply.finished = false
    } else {
      target = { key: `a${active.turnId}`, content: '', refs: [], reply: emptyCanvasReply() }
      list.push(target)
    }
    target.turnId = active.turnId
    const snapshot = record?.turnId === active.turnId ? canvasReplyFromSnapshot(record.snapshot) : null
    if (snapshot) target.reply = snapshot
    target.lastSeq = snapshot ? (record?.lastSeq ?? 0) : 0
    turns.value = list
    scrollToEnd()
    const live = turns.value[turns.value.length - 1]!
    void resumeTurn(live, live.lastSeq ?? 0)
  } catch (err) {
    if (my !== epoch) return
    if (isGone(err)) {
      clearCanvasAgentSession(canvasId)
    } else if (record?.conversationId) {
      // 读不到（断网 / 服务端异常）：仍沿用这个会话，新消息接在它后面；历史可重试
      conversationId.value = record.conversationId
      historyError.value = true
    }
  } finally {
    if (my === epoch) historyLoading.value = false
  }
}

/** 续流后发现那一轮已收尾：回读历史，以落库的终态为准（不再续流，免得来回打转） */
async function refreshHistory() {
  const my = epoch
  const convId = conversationId.value
  if (!convId) return
  try {
    const messages = await loadCanvasAgentMessages(convId)
    if (my !== epoch) return
    const next = canvasTurnsFromMessages(messages)
    // 没有助手回复的轮次（打断在开跑前 / 失败未落库）：按已收尾显示，不再转圈
    for (const turn of next) turn.reply.finished = true
    seedForms(next)
    turns.value = next
    scrollToEnd()
  } catch {
    if (my !== epoch) return
    const last = turns.value[turns.value.length - 1]
    if (last && !last.reply.finished) {
      last.reply.finished = true
      last.reply.error = '本轮回复读取失败，请稍后重新打开画布助手查看'
    }
  }
}

/** 续流回 FORBIDDEN（会话已删 / 不是本人的）：忘掉本画布的会话，下一条消息新建 */
function forgetConversation() {
  clearCanvasAgentSession(props.canvasId)
  conversationId.value = ''
  resumePending = false
}

// ---------------- 续流（POST /agent/recover-stream，clientCaps=canvas） ----------------

/**
 * 接上运行中的那一轮，按 sequence 去重。
 * afterSequence = 当前已渲染内容的最后一帧 sequence（live.reply 恰好归并到这一帧）：>0 时接在已渲染内容后面；
 * 0 时清空回复、整轮从 START 重放。不用 active-turn 的 lastSequence——那是服务端已落库的进度，不是本地已渲染的。
 * 没有运行中的流（RECOVER_EMPTY）→ 那一轮已收尾，回读历史。
 */
async function resumeTurn(live: ITurn, afterSequence: number) {
  const convId = conversationId.value
  if (streaming.value || !convId) return
  const my = epoch
  const expectTurn = live.turnId
  if (afterSequence <= 0) {
    live.reply = emptyCanvasReply()
    live.lastSeq = 0
  } else {
    live.reply.error = ''
    live.reply.finished = false
  }
  let lastSeq = Math.max(0, afterSequence)
  let empty = false
  let otherTurn = false
  resumePending = false
  streaming.value = true
  const ctrl = new AbortController()
  controller = ctrl
  try {
    await canvasAgentRecover(
      { conversationId: convId, ...(expectTurn ? { turnId: expectTurn } : {}), afterSequence: lastSeq },
      {
        signal: ctrl.signal,
        onFrame: (frame) => {
          if (frame.event === 'RECOVER_EMPTY') {
            empty = true
            return
          }
          const cursor = canvasFrameCursor(frame)
          // 运行中的已不是要续的那一轮（别处又发了一轮，Java 改为整轮重放最新轮）：作废，重新载入后再接
          if (expectTurn && cursor.turnId && cursor.turnId !== expectTurn) {
            otherTurn = true
            ctrl.abort()
            return
          }
          if (cursor.turnId) live.turnId = cursor.turnId
          if (frame.event === 'START') {
            saveCursor(live, true)
            return
          }
          if (cursor.seq != null) {
            if (cursor.seq <= lastSeq) return
            lastSeq = cursor.seq
            live.lastSeq = cursor.seq
          }
          ingest(live, frame)
        },
      },
    )
  } catch (err) {
    if (my !== epoch) return
    if ((err as { name?: string } | null)?.name === 'AbortError') {
      if (!otherTurn) {
        // 用户点了停止（stop 已发取消）
        live.reply.finished = true
        if (!live.reply.text) live.reply.text = '已停止。'
      }
    } else if (toApiError(err)?.isNetwork) {
      resumePending = true
      live.reply.error = '网络中断，恢复后会自动接上本轮回复。'
    } else {
      live.reply.error = err instanceof Error && err.message ? err.message : '续接回复失败，请稍后重新打开画布助手'
      live.reply.finished = true
    }
  } finally {
    if (controller === ctrl) controller = null
    if (my === epoch) streaming.value = false
  }
  if (my !== epoch || resumePending) return
  if (live.reply.errorCode === TURN_FORBIDDEN_CODE) {
    forgetConversation()
    return
  }
  if (otherTurn) {
    flushCursor()
    void restore()
    return
  }
  if (empty) {
    clearCursor()
    void refreshHistory()
    return
  }
  // 流收尾：END / ERROR（TURN_FAILED / TURN_INTERRUPTED）/ END{reason:interrupted} 已在帧归并里落了终态
  if (!live.reply.finished) live.reply.finished = true
  for (const step of live.reply.steps) if (step.status === 'running') step.status = 'done'
  initForm(live)
  clearCursor()
  scrollToEnd()
}

/** 网络恢复：有因断网没接上的那一轮就续上 */
function onOnline() {
  if (!resumePending || streaming.value) return
  const last = turns.value[turns.value.length - 1]
  if (last) void resumeTurn(last, last.lastSeq ?? 0)
}

// ---------------- 「自动执行」设置（按账号记住） ----------------

const autoPrefs = ref(readCanvasAgentAutoPrefs())
/** 自定义档：当前值不在预设里，或用户点了「自定义」 */
const autoCustom = ref(!(CANVAS_AGENT_AUTO_PRESETS as readonly number[]).includes(autoPrefs.value.points))
const autoCustomText = ref(String(autoPrefs.value.points))
const autoCustomInvalid = computed(() => autoCustom.value && !/^[1-9]\d{0,6}$/.test(autoCustomText.value.trim()))

function saveAutoPrefs() {
  writeCanvasAgentAutoPrefs(autoPrefs.value)
}
function toggleAuto(event: Event) {
  autoPrefs.value = { ...autoPrefs.value, enabled: (event.target as HTMLInputElement).checked }
  saveAutoPrefs()
}
function pickAutoPreset(points: number) {
  autoCustom.value = false
  autoPrefs.value = { ...autoPrefs.value, points }
  saveAutoPrefs()
}
function pickAutoCustom() {
  autoCustom.value = true
  autoCustomText.value = String(autoPrefs.value.points)
}
/** 自定义只收正整数：不合法时保留上一个有效值（发送仍按它），输入框标红 */
function onAutoCustomInput(event: Event) {
  autoCustomText.value = (event.target as HTMLInputElement).value
  if (autoCustomInvalid.value) return
  autoPrefs.value = { ...autoPrefs.value, points: Number(autoCustomText.value.trim()) }
  saveAutoPrefs()
}
/** 本轮的 autoApprovePoints：打开时带 N，关闭时不带 */
function autoApprovePoints(): number | undefined {
  return autoPrefs.value.enabled && autoPrefs.value.points > 0 ? autoPrefs.value.points : undefined
}

// ---------------- 确认 / 参数表单（question_asker 中断） ----------------

/** 回复带表单而还没有作答状态时建一份（按服务端默认值预选）；restored = 历史里该表单已提交的答案 */
function initForm(turn: ITurn, restored?: Record<string, IAgentAnswer> | null) {
  const form = turn.reply.form
  if (!form || turn.form) return
  const answers: Record<string, IAgentAnswer> = {}
  for (const q of form.questions) answers[q.id] = restored?.[q.id] ?? initialAnswer(q)
  turn.form = { answers, submitting: false, done: false, error: '' }
}

/** 历史回读后：后面已有轮次的表单视为已结束，下一轮若是续答就读回答案，否则算失效 */
function seedForms(list: ITurn[]) {
  list.forEach((turn, i) => {
    const form = turn.reply.form
    if (!form) return
    const next = list[i + 1]
    const restored = next ? answersFromAttribute(form, next.attribute) : null
    initForm(turn, restored)
    if (next && turn.form) {
      turn.form.done = true
      if (!restored) turn.form.superseded = true
    }
  })
}

/** 发新消息：此前还开着、没作答的表单就此失效 */
function supersedeOpenForms() {
  for (const turn of turns.value) {
    if (turn.form && !turn.form.done) {
      turn.form.done = true
      turn.form.superseded = true
    }
  }
}

function answerOf(turn: ITurn, q: IAgentQuestion): IAgentAnswer {
  const state = turn.form!
  state.answers[q.id] ??= { selected: [], text: '' }
  return state.answers[q.id]!
}

function formLocked(turn: ITurn): boolean {
  return !turn.form || turn.form.done || turn.form.submitting || streaming.value
}

/** 只有一道必选单选题、不带文字也没有二级选项（如超预算确认的 继续 / 不用了）：点选项即提交 */
function quickForm(form: IAgentForm): boolean {
  const q = form.questions[0]
  return form.questions.length === 1 && !!q && q.type === 'single_select' && !q.allowText && !isNestedQuestion(q)
}

function picked(turn: ITurn, q: IAgentQuestion, id: string): boolean {
  return !!turn.form?.answers[q.id]?.selected.includes(id)
}

function pickOption(turn: ITurn, q: IAgentQuestion, id: string) {
  if (formLocked(turn)) return
  const answer = answerOf(turn, q)
  if (q.type === 'multi_select') {
    answer.selected = answer.selected.includes(id) ? answer.selected.filter((x) => x !== id) : [...answer.selected, id]
  } else {
    answer.selected = [id]
  }
  turn.form!.error = ''
}

/** 两级题（分辨率 → 比例）：答案形如 [父 id, 子 id] */
function pickChild(turn: ITurn, q: IAgentQuestion, parentId: string, childId: string) {
  if (formLocked(turn)) return
  answerOf(turn, q).selected = [parentId, childId]
  turn.form!.error = ''
}

function childOptions(turn: ITurn, q: IAgentQuestion) {
  const parentId = turn.form?.answers[q.id]?.selected[0]
  return q.options.find((o) => o.id === parentId)?.children ?? []
}

/**
 * 提交表单：同一会话发一轮 content 为空、带 attribute.answers（+ interruptId）的流式请求（与智能体页同一接口），
 * 服务端按 interruptId 幂等续跑被中断的那一轮；新的一轮照常走实时流 / 断流续流。
 * @param quick 点选即提交的选项 id
 */
async function submitForm(turn: ITurn, quick?: string) {
  const form = turn.reply.form
  const state = turn.form
  if (!form || !state || state.done || state.submitting || streaming.value || historyLoading.value) return
  if (!conversationId.value) return
  const first = form.questions[0]
  if (quick && first) state.answers[first.id] = { selected: [quick], text: '' }
  if (!formReady(form, state.answers)) {
    const missing = form.questions.find((q) => q.required && !answerReady(q, state.answers[q.id]))
    state.error = missing ? `请先完成「${missing.title}」` : '请先完成必填项'
    return
  }
  state.submitting = true
  state.error = ''
  const my = epoch
  turns.value.push({ key: createSafeUuid(), content: '', refs: [], reply: emptyCanvasReply() })
  const live = turns.value[turns.value.length - 1]!
  const accepted = await runTurn(
    live,
    {
      content: '',
      attribute: { answers: buildAnswers(form, state.answers) },
      ...(form.interruptId ? { interruptId: form.interruptId } : {}),
    },
    () => {
      state.done = true
    },
  )
  state.submitting = false
  if (accepted || my !== epoch) return
  // 未受理：撤掉占位回复，错误留在表单上，可改后再提交
  const idx = turns.value.indexOf(live)
  if (idx >= 0) turns.value.splice(idx, 1)
  state.error = live.reply.error || '提交没有成功，请重试'
}

async function send(text = input.value) {
  const content = text.trim()
  if (!content || streaming.value || historyLoading.value || disabled.value || !props.canvasId) return
  const used = [...refs.value]
  supersedeOpenForms()
  const turn: ITurn = { key: createSafeUuid(), content, refs: used, reply: emptyCanvasReply() }
  turns.value.push(turn)
  const live = turns.value[turns.value.length - 1]!
  input.value = ''
  refs.value = []
  await runTurn(live, { content: composeCanvasContent(content, used) }, undefined, content)
}

/**
 * 跑一轮 /agent/stream（新消息与表单续答共用）：没有会话先建；受理（START）即记游标；
 * 受理后断流改走续流；收尾后给表单建作答状态。返回是否受理。
 */
async function runTurn(
  live: ITurn,
  body: Pick<ICanvasAgentStreamReq, 'content' | 'attribute' | 'interruptId'>,
  onAccepted?: () => void,
  title = body.content,
): Promise<boolean> {
  streaming.value = true
  scrollToEnd()
  const my = epoch
  const canvasId = props.canvasId
  const ctrl = new AbortController()
  controller = ctrl
  let accepted = false
  let dropped = false
  try {
    if (!conversationId.value) {
      const created = await createCanvasAgentConversation(title, canvasId)
      if (my !== epoch) return false
      conversationId.value = created
      if (created) writeCanvasAgentSession(canvasId, { conversationId: created })
    }
    if (!conversationId.value) throw new ApiError('会话创建失败，请稍后再试', { code: -1 })
    const auto = autoApprovePoints()
    await canvasAgentStream(
      {
        ...body,
        conversationId: conversationId.value,
        agentSkillId: CANVAS_ASSISTANT_SKILL_ID,
        canvasId,
        ...(auto ? { autoApprovePoints: auto } : {}),
      },
      {
        requestId: createSafeUuid(),
        signal: ctrl.signal,
        onFrame: (frame) => {
          const cursor = canvasFrameCursor(frame)
          if (cursor.turnId) live.turnId = cursor.turnId
          if (cursor.seq != null && cursor.seq > (live.lastSeq ?? 0)) live.lastSeq = cursor.seq
          if (frame.event === 'START') {
            accepted = true
            onAccepted?.()
            // 受理即记下进行中的轮次：刷新 / 关侧栏后据此续流
            saveCursor(live, true)
            return
          }
          ingest(live, frame)
        },
      },
    )
    if (my !== epoch) return accepted
    live.reply.finished = true
  } catch (err) {
    // 换画布 / 卸载导致的中断：服务端那一轮继续，记录里的游标留着，回来时续上
    if (my !== epoch) return accepted
    if ((err as { name?: string } | null)?.name === 'AbortError') {
      live.reply.finished = true
      if (!live.reply.text) live.reply.text = '已停止。'
    } else if (accepted && toApiError(err)?.isNetwork && !live.reply.finished && !live.reply.error) {
      // 受理后断流：这一轮仍在服务端运行，改走续流接上，不报错、不重发
      dropped = true
    } else if (err instanceof ApiError && err.isNetwork) {
      live.reply.error = '网络中断，本轮结果未知。画布上已生效的改动会自动同步过来，请先看一眼画布再决定是否重发。'
    } else {
      live.reply.error = err instanceof Error && err.message ? err.message : '画布助手暂时不可用'
    }
    if (!dropped) {
      live.reply.finished = true
      for (const step of live.reply.steps) if (step.status === 'running') step.status = 'failed'
    }
  } finally {
    if (controller === ctrl) controller = null
    if (my === epoch) {
      streaming.value = false
      if (!dropped) {
        clearCursor()
        initForm(live)
      }
      scrollToEnd()
    }
  }
  // 断流时已渲染的内容还在页面上，恰好归并到 live.lastSeq：从它之后续
  if (dropped && my === epoch) void resumeTurn(live, live.lastSeq ?? 0)
  return accepted
}

function stop() {
  if (!controller) return
  controller.abort()
  if (conversationId.value) void cancelCanvasAgent(conversationId.value).catch(() => undefined)
}

/** 新对话：取消进行中的一轮，忘掉本画布记住的会话（首条消息时再建） */
function newConversation() {
  stop()
  detach()
  turns.value = []
  conversationId.value = ''
  historyError.value = false
  historyLoading.value = false
  clearCanvasAgentSession(props.canvasId)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    void send()
  }
}

onMounted(() => {
  window.addEventListener('online', onOnline)
  // 刷新 / 关页前把合并中的游标与快照落盘
  window.addEventListener('pagehide', flushCursor)
  void restore()
})
onBeforeUnmount(() => {
  window.removeEventListener('online', onOnline)
  window.removeEventListener('pagehide', flushCursor)
  detach()
})

/** 生成步骤的实时进度：读编辑器里该节点的运行态（轮询器写回的 status / progress） */
function runState(step: ICanvasAgentStep): { label: string; progress: number; tone: string } | null {
  if (step.tool !== 'canvas_run_node' || step.status !== 'done' || !step.nodeId) return null
  const node = store.findNode(step.nodeId)
  const status = node?.data.status
  const progress = Math.max(0, Math.min(100, Number(node?.data.progress) || 0))
  if (status === 'done') return { label: '已出图', progress: 100, tone: 'ok' }
  if (status === 'error') return { label: '生成失败，冻结的点数会退回', progress: 0, tone: 'bad' }
  if (status === 'running') return { label: `生成中 ${progress}%`, progress, tone: 'run' }
  return { label: '排队中', progress: 0, tone: 'run' }
}

function stepIcon(step: ICanvasAgentStep): string {
  if (step.status === 'failed') return 'close'
  if (step.status === 'running' || step.status === 'unknown') return 'refresh'
  return 'check'
}
</script>

<template>
  <section class="flex flex-col h-full min-h-0 bg-surface" aria-label="画布助手">
    <header class="flex shrink-0 items-center gap-6px h-44px px-12px border-b border-b-solid border-line">
      <EditorIcon name="sparkles" :size="16" />
      <h2 class="m-0 text-14px font-600 text-ink">画布助手</h2>
      <button
        type="button"
        class="ml-auto h-26px px-8px rounded-6px border border-solid border-line bg-surface text-12px text-ink-2 cursor-pointer hover:bg-surface2"
        :class="FOCUS_RING"
        :disabled="streaming"
        @click="newConversation"
      >
        新对话
      </button>
      <button
        type="button"
        class="flex items-center justify-center w-26px h-26px rounded-6px border-none bg-transparent text-muted cursor-pointer hover:bg-surface2"
        :class="FOCUS_RING"
        aria-label="收起画布助手"
        title="收起"
        @click="emit('close')"
      >
        <EditorIcon name="chevronRight" :size="16" />
      </button>
    </header>

    <div
      v-if="disabled"
      class="shrink-0 m-12px mb-0 px-10px py-8px rounded-8px bg-warning-soft text-warning text-12px leading-18px"
      role="status"
    >
      画布助手暂未开启：画布能力还没有接通，暂时不能让助手修改画布。
    </div>

    <div ref="listEl" class="flex-1 min-h-0 overflow-y-auto px-12px py-12px">
      <p v-if="historyLoading" class="m-0 pt-8px text-12px text-muted" role="status">正在载入上次的对话…</p>
      <div
        v-else-if="historyError"
        class="flex items-center gap-6px mb-10px px-8px py-6px rounded-8px bg-surface2 text-12px text-muted"
        role="status"
      >
        上次的对话没有载入成功，新消息会接着这个会话
        <button
          type="button"
          class="ml-auto px-4px border-none bg-transparent text-violet text-12px cursor-pointer"
          :class="FOCUS_RING"
          :disabled="streaming"
          @click="restore()"
        >
          重试
        </button>
      </div>
      <div v-if="!turns.length && !historyLoading" class="flex flex-col gap-10px pt-8px">
        <p class="m-0 text-13px leading-20px text-muted">
          告诉我你想在画布上做什么：加节点、改提示词、连线、排版，或者让我帮你生成。改动会直接出现在画布上。
        </p>
        <button
          v-for="example in EXAMPLES"
          :key="example"
          type="button"
          class="text-left px-10px py-8px rounded-8px border border-solid border-line bg-surface2 text-13px text-ink-2 cursor-pointer hover:border-violet-line"
          :class="FOCUS_RING"
          :disabled="disabled"
          @click="send(example)"
        >
          {{ example }}
        </button>
      </div>

      <div v-for="turn in turns" :key="turn.key" class="mb-14px">
        <div v-if="turn.content || turn.refs.length" class="flex justify-end mb-8px">
          <div
            class="max-w-[88%] px-10px py-7px rounded-10px bg-violet-soft text-ink text-13px leading-20px whitespace-pre-wrap break-words"
          >
            {{ turn.content }}
            <div v-if="turn.refs.length" class="flex flex-wrap gap-4px mt-6px">
              <span
                v-for="item in turn.refs"
                :key="item.id"
                class="px-6px py-1px rounded-4px bg-surface text-11px text-muted"
                >@{{ item.title }}</span
              >
            </div>
          </div>
        </div>

        <ul v-if="turn.reply.steps.length" class="m-0 mb-6px p-0 list-none flex flex-col gap-4px">
          <li
            v-for="step in turn.reply.steps"
            :key="step.key"
            class="flex flex-col gap-3px px-8px py-6px rounded-8px bg-surface2 text-12px"
          >
            <div class="flex items-center gap-6px">
              <span
                class="flex items-center justify-center w-16px h-16px rounded-full shrink-0"
                :class="
                  step.status === 'failed'
                    ? 'bg-danger-soft text-danger'
                    : step.status === 'unknown'
                      ? 'bg-warning-soft text-warning'
                      : step.status === 'running'
                        ? 'bg-violet-soft text-violet agent-spin'
                        : 'bg-success-soft text-success'
                "
                aria-hidden="true"
              >
                <EditorIcon :name="stepIcon(step)" :size="11" />
              </span>
              <span class="text-ink-2">{{ step.text }}</span>
              <button
                v-if="step.nodeId && store.findNode(step.nodeId)"
                type="button"
                class="ml-auto px-4px border-none bg-transparent text-violet text-11px cursor-pointer"
                :class="FOCUS_RING"
                @click="emit('locate', step.nodeId)"
              >
                定位
              </button>
            </div>
            <span v-if="step.detail" class="pl-22px text-danger">{{ step.detail }}</span>
            <template v-if="step.tool === 'canvas_run_node' && step.status === 'done'">
              <span v-if="step.credits != null" class="pl-22px text-muted"
                >已冻结 {{ step.credits }} 点数，按实际结果结算，失败自动退回</span
              >
              <div v-if="runState(step)" class="flex items-center gap-6px pl-22px">
                <div class="flex-1 h-4px rounded-2px bg-line overflow-hidden">
                  <div
                    class="h-full rounded-2px"
                    :class="
                      runState(step)!.tone === 'bad'
                        ? 'bg-danger'
                        : runState(step)!.tone === 'ok'
                          ? 'bg-success'
                          : 'bg-violet'
                    "
                    :style="{ width: `${runState(step)!.progress}%` }"
                  />
                </div>
                <span class="text-muted whitespace-nowrap">{{ runState(step)!.label }}</span>
              </div>
            </template>
          </li>
        </ul>

        <div v-if="turn.reply.tasks.length" class="mb-6px px-8px py-6px rounded-8px bg-surface2 text-12px text-ink-2">
          已提交 {{ turn.reply.tasks.length }} 个生成任务
          <template v-if="turn.reply.tasks.some((t) => t.pricePoints != null)">
            · 约 {{ turn.reply.tasks.reduce((s, t) => s + (t.pricePoints ?? 0), 0) }} 点数
          </template>
          ，可在任务中心查看进度
        </div>

        <div v-if="turn.reply.text" class="text-13px leading-21px text-ink whitespace-pre-wrap break-words">
          {{ turn.reply.text }}
        </div>
        <div
          v-else-if="!turn.reply.finished && !turn.reply.steps.some((s) => s.status === 'running')"
          class="text-12px text-muted"
        >
          {{ turn.reply.thinking ? '正在规划…' : '正在思考…' }}
        </div>
        <div
          v-if="turn.reply.error"
          class="mt-6px px-8px py-6px rounded-8px bg-danger-soft text-danger text-12px leading-18px"
        >
          {{ turn.reply.error }}
        </div>

        <!-- 确认 / 参数表单（question_asker 中断）：点选提交后续跑被中断的那一轮 -->
        <div
          v-if="turn.reply.form && turn.form"
          class="mt-6px px-10px py-8px rounded-8px border border-solid border-line bg-surface2 text-12px leading-18px"
          role="group"
          :aria-label="turn.reply.form.title || '需要你确认'"
        >
          <p v-if="turn.reply.form.title" class="m-0 text-13px font-600 text-ink">{{ turn.reply.form.title }}</p>
          <p v-if="turn.reply.form.message" class="m-0 mt-2px text-muted">{{ turn.reply.form.message }}</p>
          <div v-for="q in turn.reply.form.questions" :key="q.id" class="mt-8px">
            <p v-if="!quickForm(turn.reply.form) || q.title !== turn.reply.form.title" class="m-0 text-ink-2">
              {{ q.title }}<span v-if="q.required" class="text-danger"> *</span>
            </p>
            <p v-if="q.message && q.message !== turn.reply.form.message" class="m-0 text-muted">{{ q.message }}</p>
            <div v-if="q.options.length" class="flex flex-wrap gap-4px mt-4px">
              <button
                v-for="opt in q.options"
                :key="opt.id"
                type="button"
                class="px-8px py-4px rounded-6px border border-solid text-12px cursor-pointer disabled:cursor-not-allowed"
                :class="[
                  FOCUS_RING,
                  picked(turn, q, opt.id)
                    ? 'border-violet bg-violet-soft text-violet-ink'
                    : 'border-line bg-surface text-ink-2 hover:border-violet-line',
                ]"
                :title="opt.description || undefined"
                :aria-pressed="picked(turn, q, opt.id)"
                :disabled="formLocked(turn)"
                @click="quickForm(turn.reply.form) ? submitForm(turn, opt.id) : pickOption(turn, q, opt.id)"
              >
                {{ opt.label }}
              </button>
            </div>
            <div v-if="childOptions(turn, q).length" class="flex flex-wrap gap-4px mt-4px pl-8px">
              <button
                v-for="child in childOptions(turn, q)"
                :key="child.id"
                type="button"
                class="px-8px py-4px rounded-6px border border-solid text-12px cursor-pointer disabled:cursor-not-allowed"
                :class="[
                  FOCUS_RING,
                  picked(turn, q, child.id)
                    ? 'border-violet bg-violet-soft text-violet-ink'
                    : 'border-line bg-surface text-ink-2 hover:border-violet-line',
                ]"
                :aria-pressed="picked(turn, q, child.id)"
                :disabled="formLocked(turn)"
                @click="pickChild(turn, q, turn.form.answers[q.id]?.selected[0] ?? '', child.id)"
              >
                {{ child.label }}
              </button>
            </div>
            <input
              v-if="q.allowText"
              v-model="answerOf(turn, q).text"
              type="text"
              maxlength="500"
              class="w-full box-border mt-4px h-28px px-8px rounded-6px border border-solid border-line bg-surface text-ink text-12px outline-none focus:border-violet"
              :placeholder="q.placeholder || '也可以直接输入'"
              :disabled="formLocked(turn)"
              :aria-label="q.title"
            />
          </div>
          <p v-if="turn.form.error" class="m-0 mt-6px text-danger" role="alert">{{ turn.form.error }}</p>
          <div v-if="!turn.form.done" class="flex items-center gap-6px mt-8px">
            <button
              v-if="!quickForm(turn.reply.form)"
              type="button"
              class="h-28px px-12px rounded-6px border-none bg-violet text-on-accent text-12px cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              :class="FOCUS_RING"
              :disabled="formLocked(turn) || !formReady(turn.reply.form, turn.form.answers)"
              @click="submitForm(turn)"
            >
              {{ turn.form.submitting ? '提交中…' : '提交' }}
            </button>
            <span v-else-if="turn.form.submitting" class="text-muted">提交中…</span>
          </div>
          <p v-else class="m-0 mt-6px text-muted">{{ turn.form.superseded ? '已失效（之后发了新消息）' : '已提交' }}</p>
        </div>
      </div>
    </div>

    <footer class="shrink-0 px-12px pt-8px pb-12px border-t border-t-solid border-line">
      <div class="flex flex-wrap items-center gap-4px mb-6px min-h-22px">
        <span
          v-for="item in refs"
          :key="item.id"
          class="flex items-center gap-2px h-22px pl-6px pr-2px rounded-4px bg-violet-soft text-violet-ink text-11px"
        >
          @{{ item.title }}
          <button
            type="button"
            class="flex items-center justify-center w-16px h-16px border-none bg-transparent text-violet-ink cursor-pointer"
            :aria-label="`移除引用 ${item.title}`"
            @click="removeRef(item.id)"
          >
            <EditorIcon name="close" :size="10" />
          </button>
        </span>
        <button
          v-if="selected.length"
          type="button"
          class="h-22px px-6px rounded-4px border border-dashed border-violet-line bg-transparent text-violet text-11px cursor-pointer"
          :class="FOCUS_RING"
          :title="selected.map((s) => s.title).join('、')"
          @click="addSelectedRefs"
        >
          + 引用选中的 {{ selected.length }} 个节点
        </button>
        <span v-else-if="!refs.length" class="text-11px text-placeholder">选中画布上的节点后可在这里引用</span>
      </div>
      <div class="flex items-end gap-6px">
        <textarea
          v-model="input"
          rows="2"
          maxlength="2000"
          class="flex-1 min-h-40px max-h-140px px-8px py-6px rounded-8px border border-solid border-line bg-surface text-ink text-13px leading-20px resize-none outline-none focus:border-violet"
          :placeholder="disabled ? '画布助手暂未开启' : '让助手改画布…（Enter 发送，Shift+Enter 换行）'"
          :disabled="disabled"
          aria-label="给画布助手的消息"
          @keydown="onKeydown"
        />
        <button
          v-if="streaming"
          type="button"
          class="h-36px px-12px rounded-8px border border-solid border-line bg-surface text-ink text-13px cursor-pointer"
          :class="FOCUS_RING"
          @click="stop"
        >
          停止
        </button>
        <button
          v-else
          type="button"
          class="h-36px px-14px rounded-8px border-none bg-violet text-on-accent text-13px cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          :class="FOCUS_RING"
          :disabled="!canSend"
          @click="send()"
        >
          发送
        </button>
      </div>
      <div class="flex flex-wrap items-center gap-4px mt-6px text-11px text-muted">
        <label class="flex items-center gap-4px cursor-pointer select-none">
          <input
            type="checkbox"
            class="m-0 accent-violet"
            :checked="autoPrefs.enabled"
            aria-label="自动执行"
            @change="toggleAuto"
          />
          自动执行
        </label>
        <template v-if="autoPrefs.enabled">
          <span>· 每轮不超过</span>
          <button
            v-for="n in CANVAS_AGENT_AUTO_PRESETS"
            :key="n"
            type="button"
            class="h-20px px-6px rounded-4px border border-solid text-11px cursor-pointer"
            :class="[
              FOCUS_RING,
              !autoCustom && autoPrefs.points === n
                ? 'border-violet bg-violet-soft text-violet-ink'
                : 'border-line bg-surface text-ink-2',
            ]"
            :aria-pressed="!autoCustom && autoPrefs.points === n"
            @click="pickAutoPreset(n)"
          >
            {{ n }}
          </button>
          <button
            type="button"
            class="h-20px px-6px rounded-4px border border-solid text-11px cursor-pointer"
            :class="[FOCUS_RING, autoCustom ? 'border-violet bg-violet-soft text-violet-ink' : 'border-line bg-surface text-ink-2']"
            :aria-pressed="autoCustom"
            @click="pickAutoCustom"
          >
            自定义
          </button>
          <input
            v-if="autoCustom"
            type="text"
            inputmode="numeric"
            maxlength="7"
            class="w-56px h-20px px-4px rounded-4px border border-solid bg-surface text-ink text-11px outline-none"
            :class="autoCustomInvalid ? 'border-danger' : 'border-line focus:border-violet'"
            :value="autoCustomText"
            aria-label="每轮自动执行的点数上限"
            :aria-invalid="autoCustomInvalid"
            @input="onAutoCustomInput"
          />
          <span>点</span>
          <span v-if="autoCustomInvalid" class="text-danger">请填正整数</span>
        </template>
      </div>
      <p class="m-0 mt-4px text-11px text-placeholder">
        {{
          autoPrefs.enabled
            ? `每轮对话按智能体计费；已开启自动执行，每轮上限 ${autoPrefs.points} 点`
            : '每轮对话按智能体计费；触发生成前助手会先告诉你模型与点数'
        }}
      </p>
    </footer>
  </section>
</template>

<style scoped>
.agent-spin :deep(svg) {
  animation: agent-spin 1s linear infinite;
}
@keyframes agent-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .agent-spin :deep(svg) {
    animation: none;
  }
}
</style>
