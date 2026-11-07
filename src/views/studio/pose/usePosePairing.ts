/**
 * 姿态复刻 · 多人配对状态（付费前确认）。
 *
 * <p>状态绑定到「人物图 + 姿势图序列」的签名：图一变（换图 / 删图 / 调序）签名就变，旧结果立即视为失效，
 * 不会把过期配对提交出去。原图单人 / 没跑预览时不产生任何 mappings，提交体与此前完全一致。
 */
import { computed, onBeforeUnmount, ref, type Ref } from 'vue'
import { studioPosePreview } from '@/api/studio.ts'
import { toApiError } from '@/api/index.ts'
import type { StudioPosePayload, StudioPosePeople, StudioPosePerson, StudioPoseMapping } from '@/api/studioTypes.ts'

export interface PairPose {
  poseIndex: number
  /** 读图失败 / 未读到时为 0 */
  poseCount: number
  /** 回填来的配对没有人物明细 */
  people: StudioPosePerson[]
  truncated: boolean
  error: string
  defaultMapping: number[]
  mapping: number[]
}

export interface PairState {
  sig: string
  sourceCount: number
  sourcePeople: StudioPosePerson[]
  sourceTruncated: boolean
  group: string
  interaction: string
  poses: PairPose[]
  /** true = 从历史批次回填，没有识别明细 */
  restored: boolean
  /**
   * 服务端是否开放配对（原图 ≥2 人）。false 时 poses 只用来展示每张姿势图的人数，提交不带 mappings：
   * 原图单人 → 每张姿势图只取 1 位；原图多人但没开放 → 服务端按默认左→左、右→右配对
   */
  mappingEnabled: boolean
}

const TIMEOUT_TEXT = '识别超时或网络中断，可稍后重试；也可直接提交，按默认配对生成'
/** 取消识别后 / 撞上「上一次还在进行」（4002）时，重新识别要等的秒数：服务端那次读图仍在跑，立刻再点只会 4002 */
export const RERUN_COOLDOWN = 10
const NO_PERSON = /(没有|未)(识别|检测)到人物|没有人物|无人物/

/** 服务端 422「原图中没有识别到人物」/「姿势参考图中没有识别到人物」→ 带下一步的说法；其它原样 */
export function friendlyPreviewError(msg: string, what: 'source' | 'pose' = 'source') {
  if (!NO_PERSON.test(msg)) return msg
  return what === 'pose' || /姿势/.test(msg) ? '姿势参考图中没有识别到人物，请换一张' : '原图中没有识别到人物，请换一张'
}

/** 网络中断 / 网关超时（502/503/504）/ 报错文本含 timeout、deadline */
function isTimeoutLike(e: { isNetwork?: boolean; httpStatus?: number; message?: string } | null, raw: unknown) {
  if (e?.isNetwork) return true
  if (e?.httpStatus === 502 || e?.httpStatus === 503 || e?.httpStatus === 504) return true
  const status = (raw as { response?: { status?: number } } | null)?.response?.status
  if (status === 502 || status === 503 || status === 504) return true
  return /timeout|timed out|deadline/i.test(`${e?.message ?? ''} ${(raw as Error | null)?.message ?? ''}`)
}

export const PEOPLE_LETTERS = ['A', 'B', 'C', 'D']

export function pairSig(source: string[], poses: string[]) {
  return `${source[0] ?? ''}\n${poses.join('\n')}`
}

/** 与服务端同规则的配对校验；通过返回空串 */
export function validateMapping(mapping: number[], sourceCount: number, poseCount: number): string {
  if (mapping.length !== sourceCount) return `配对人数应为 ${sourceCount} 位`
  const used = new Set<number>()
  for (const v of mapping) {
    if (!Number.isInteger(v) || v < -1 || v > poseCount - 1) return '配对取值超出姿势图人数范围'
    if (v >= 0) {
      if (used.has(v)) return '同一位参考人物不能被多位人物重复使用'
      used.add(v)
    }
  }
  if (!used.size) return '至少要有一位人物取参考图的姿势'
  return ''
}

/** 一位参考人物的可读名：「图2画面左侧」；没有明细时「图2第1位」 */
export function poseWho(pose: PairPose, k: number) {
  const p = pose.people[k]
  return `图${pose.poseIndex + 1}${p?.position || `第${k + 1}位`}`
}

export function usePosePairing(source: Ref<string[]>, poses: Ref<string[]>) {
  const state = ref<PairState | null>(null)
  const running = ref(false)
  const elapsed = ref(0)
  const errorText = ref('')
  /** 重新识别冷却剩余秒数；>0 时不能发起识别 */
  const cooldown = ref(0)
  let seq = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let coolTimer: ReturnType<typeof setInterval> | undefined
  /** 本轮已因 4002 自动重试过一次（只退避一次，再撞就交给用户） */
  let autoRetried = false

  const sig = computed(() => pairSig(source.value, poses.value))
  /** 仅当签名吻合才算有效 */
  const current = computed(() => (state.value && state.value.sig === sig.value ? state.value : null))
  const stale = computed(() => !!state.value && state.value.sig !== sig.value)
  const canRun = computed(() => !!source.value[0] && poses.value.length > 0 && cooldown.value <= 0)

  function stopTimer() {
    if (timer) clearInterval(timer)
    timer = undefined
  }

  function stopCooldown() {
    if (coolTimer) clearInterval(coolTimer)
    coolTimer = undefined
    cooldown.value = 0
  }

  /** 冷却 seconds 秒，结束时回调 then */
  function startCooldown(seconds: number, then?: () => void) {
    stopCooldown()
    cooldown.value = seconds
    coolTimer = setInterval(() => {
      cooldown.value -= 1
      if (cooldown.value > 0) return
      stopCooldown()
      then?.()
    }, 1000)
  }

  /** 放弃进行中的识别（只丢结果，服务端那次仍会跑完）；提交 / 回填 / 卸载时调用，不进冷却 */
  function cancel() {
    seq++
    running.value = false
    stopTimer()
    stopCooldown()
  }

  /** 用户点「取消识别」：服务端那次还在读图，冷却 RERUN_COOLDOWN 秒再允许重新识别，免得立刻撞 4002 */
  function abort() {
    const wasRunning = running.value
    cancel()
    if (wasRunning) startCooldown(RERUN_COOLDOWN)
  }

  function toPairPose(
    idx: number,
    item: { pose: StudioPosePeople | null; default_mapping: number[]; error: string },
  ): PairPose {
    return {
      poseIndex: idx,
      poseCount: item.pose?.person_count ?? 0,
      people: item.pose?.people ?? [],
      truncated: !!item.pose?.people_truncated,
      error: item.error ? friendlyPreviewError(item.error, 'pose') : item.pose ? '' : '没有读到这张姿势图的人物',
      defaultMapping: [...(item.default_mapping ?? [])],
      mapping: [...(item.default_mapping ?? [])],
    }
  }

  async function run(isAutoRetry = false) {
    if (running.value || !canRun.value) return
    if (!isAutoRetry) autoRetried = false
    const my = ++seq
    const mySig = sig.value
    running.value = true
    elapsed.value = 0
    errorText.value = ''
    stopTimer()
    timer = setInterval(() => (elapsed.value += 1), 1000)
    try {
      const res = await studioPosePreview({ source_image_url: source.value[0]!, pose_image_urls: [...poses.value] })
      if (my !== seq) return
      const d = res.data
      if (!d?.source) throw new Error('empty')
      const mappingEnabled = !!d.mapping_enabled && d.source.person_count >= 2
      state.value = {
        sig: mySig,
        sourceCount: d.source.person_count,
        sourcePeople: d.source.people ?? [],
        sourceTruncated: !!d.source.people_truncated,
        group: d.source.group ?? '',
        interaction: d.source.interaction ?? '',
        // 开放配对：每张姿势图都要有一项（缺的按读图失败）；没开放：服务端给了几张的人数就展示几张（旧版服务端为 []）
        poses: mappingEnabled
          ? poses.value.map((_, i) => {
              const it = d.poses?.find((x) => x.pose_index === i)
              return toPairPose(i, it ?? { pose: null, default_mapping: [], error: '没有读到这张姿势图的人物' })
            })
          : (d.poses ?? [])
              .filter((x) => x.pose_index >= 0 && x.pose_index < poses.value.length)
              .sort((a, b) => a.pose_index - b.pose_index)
              .map((x) => toPairPose(x.pose_index, x)),
        restored: false,
        mappingEnabled,
      }
    } catch (err) {
      if (my !== seq) return
      const e = toApiError(err)
      if (e?.code === 4002) {
        // 服务端同一用户只跑一个预览：自动退避一次，到点签名没变就再发；再撞就只提示
        if (!autoRetried) {
          autoRetried = true
          errorText.value = `上一次识别还在进行，${RERUN_COOLDOWN} 秒后自动重试`
          startCooldown(RERUN_COOLDOWN, () => {
            if (seq !== my || sig.value !== mySig) return
            errorText.value = ''
            void run(true)
          })
        } else {
          errorText.value = '上一次识别还在进行，请稍候再点「识别人物与配对」'
          startCooldown(RERUN_COOLDOWN)
        }
      } else if (isTimeoutLike(e, err)) errorText.value = TIMEOUT_TEXT
      else errorText.value = friendlyPreviewError(e?.message || '识别失败，请稍后重试')
    } finally {
      if (my === seq) {
        running.value = false
        stopTimer()
      }
    }
  }

  /** 反转 / 重置 / 改选 */
  function setMapping(poseIndex: number, mapping: number[]) {
    const p = state.value?.poses.find((x) => x.poseIndex === poseIndex)
    if (p) p.mapping = mapping
  }
  function reverse(poseIndex: number) {
    const p = state.value?.poses.find((x) => x.poseIndex === poseIndex)
    if (p) p.mapping = [...p.mapping].reverse()
  }
  function reset(poseIndex: number) {
    const p = state.value?.poses.find((x) => x.poseIndex === poseIndex)
    if (p) p.mapping = [...p.defaultMapping]
  }

  /** 提交体里的配对；没有有效多人预览返回 null（提交体完全不带这两个字段）。校验失败返回 error */
  function buildPayload(): { sourcePersonCount: number; mappings: StudioPoseMapping[] } | { error: string } | null {
    const s = current.value
    if (!s || s.sourceCount < 2 || !s.mappingEnabled) return null
    const list: StudioPoseMapping[] = []
    for (const p of s.poses) {
      if (p.error || p.poseCount < 1) continue
      const msg = validateMapping(p.mapping, s.sourceCount, p.poseCount)
      if (msg) return { error: `姿势图${p.poseIndex + 1}的人物配对有误：${msg}` }
      list.push({ pose_index: p.poseIndex, mapping: [...p.mapping], pose_person_count: p.poseCount })
    }
    if (!list.length) return null
    return { sourcePersonCount: s.sourceCount, mappings: list }
  }

  /** 重新编辑回填：payload 带了配对就带回（没有识别明细，只有下标） */
  function restore(payload: StudioPosePayload, sourceUrls: string[], poseUrls: string[]) {
    cancel()
    errorText.value = ''
    state.value = null
    const n = payload.source_person_count
    const ms = Array.isArray(payload.mappings) ? payload.mappings : []
    if (!n || n < 2 || !ms.length) return
    const poseList: PairPose[] = []
    for (const m of ms) {
      if (!m || !Array.isArray(m.mapping) || m.pose_index < 0 || m.pose_index >= poseUrls.length) continue
      const mapping = m.mapping.map(Number)
      poseList.push({
        poseIndex: m.pose_index,
        poseCount: m.pose_person_count,
        people: [],
        truncated: false,
        error: '',
        defaultMapping: [...mapping],
        mapping,
      })
    }
    if (!poseList.length) return
    poseList.sort((a, b) => a.poseIndex - b.poseIndex)
    state.value = {
      sig: pairSig(sourceUrls, poseUrls),
      sourceCount: n,
      sourcePeople: [],
      sourceTruncated: false,
      group: '',
      interaction: '',
      poses: poseList,
      restored: true,
      mappingEnabled: true,
    }
  }

  onBeforeUnmount(cancel)

  return {
    state,
    current,
    stale,
    running,
    elapsed,
    errorText,
    cooldown,
    canRun,
    run,
    cancel,
    abort,
    setMapping,
    reverse,
    reset,
    buildPayload,
    restore,
  }
}
