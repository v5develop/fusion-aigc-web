/**
 * 视频复刻「解析、标注」的页面状态（/tools/ai-video-clone 的主路径）。
 *
 * <p>原片地址一变就重新解析：POST /api/v1/video-clone/analyses（幂等，同一条原片直接复用）→ 每 2.5 秒轮询，
 * 直到 SUCCEEDED / FAILED。换片 / 卸载即作废在途请求（序号守卫，过期响应一律丢弃）并停轮询。
 *
 * <p>解析完成后用户只做标注：片子目的（重排维度、带出文字策略默认值）、十一维各自 保持 / 替换 / 描述、
 * 原片文字、清晰度与音频；出片时 {@link buildPayload} 把标注拼成提交体的 `videoClone`（参考图按提交时 imageUrls 的顺序编号）。
 */
import { computed, onScopeDispose, reactive, ref, watch } from 'vue'
import { toApiError } from '@/api/index.ts'
import {
  getVideoCloneAnalysis,
  startVideoCloneAnalysis,
  type VideoCloneAnalysisView,
  type VideoCloneAnnotations,
  type VideoCloneAudio,
  type VideoCloneDimKey,
  type VideoCloneDimMark,
  type VideoCloneDimMode,
  type VideoCloneResolution,
  type VideoCloneTextStrategy,
} from '@/api/videoClone'
import { VC_DIMS, VC_DIM_CN, VC_STAGE_TEXT, purposeOf, stepOfStage } from './constants'

export interface VcSegEdit {
  refs: string[]
  note: string
}

/** 一个维度的标注（参考图按地址记，提交时再换成序号，删图 / 换顺序不会挂错） */
export interface VcEdit {
  mode: VideoCloneDimMode
  note: string
  refs: string[]
  /** 主体 id；空 = 所有人 */
  subjects: string[]
  perSegment: boolean
  /** 与 dims[key].occurrences 同序 */
  segs: VcSegEdit[]
  withOutfit: boolean
}

export interface VideoCloneOptions {
  /** 当前原片地址；空串 = 没有原片（或不在解析模式） */
  videoUrl: () => string
  /** 当前参考图（顺序即 @1…@n） */
  refs: () => string[]
  /** 当前模型单段时长上限（秒）；模型没建模时 null */
  modelMaxSeconds: () => number | null
  /** 当前模型支持的清晰度（小写，如 720p）；没建模时 null = 都允许 */
  modelResolutions: () => string[] | null
}

const POLL_MS = 2500
/** 连续几次网络失败后暂停轮询，等用户点「继续查询」 */
const MAX_NET_FAILS = 5
const T0_TOLERANCE = 0.05

const emptyEdit = (): VcEdit => ({
  mode: 'keep',
  note: '',
  refs: [],
  subjects: [],
  perSegment: false,
  segs: [],
  withOutfit: false,
})

/** 用户没写补充时 Java 拿摘要当 content（「视频复刻：替换服装」），回填时不当成用户写的 */
const isServerSummary = (s: string) => s.startsWith('视频复刻：')

export function useVideoClone(opts: VideoCloneOptions) {
  const view = ref<VideoCloneAnalysisView | null>(null)
  /** POST 在途（还没拿到解析号） */
  const starting = ref(false)
  /** 请求层失败（限流、无权、断网、解析未开放）：就地显示，可重新解析 */
  const requestError = ref('')
  /** 连续网络失败暂停了轮询 */
  const pollPaused = ref(false)

  const purpose = ref('')
  const textStrategy = ref<VideoCloneTextStrategy>('watermark')
  const textTouched = ref(false)
  const resolution = ref<VideoCloneResolution>('follow')
  const audio = ref<VideoCloneAudio>('keep')
  /** 选填的整体补充说明（提交体 content） */
  const content = ref('')
  const dimOrder = ref<string[]>([])
  const edits = reactive<Record<VideoCloneDimKey, VcEdit>>(
    Object.fromEntries(VC_DIMS.map((k) => [k, emptyEdit()])) as Record<VideoCloneDimKey, VcEdit>,
  )

  let seq = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let netFails = 0
  let currentUrl = ''
  /** 「重新编辑」带回来的标注：同一个解析号完成后套上 */
  let pending: { annotation: VideoCloneAnnotations; refs: string[]; content: string } | null = null

  const result = computed(() => (view.value?.status === 'SUCCEEDED' ? (view.value.result ?? null) : null))
  const meta = computed(() => result.value?.meta ?? null)
  const dims = computed(() => result.value?.dims ?? {})
  const subjects = computed(() => result.value?.subjects ?? [])
  const ready = computed(() => !!result.value)
  /** 解析在跑（请求层失败后不再算在跑：轮询已停，交给失败态） */
  const running = computed(
    () =>
      starting.value ||
      (!requestError.value && !!view.value && (view.value.status === 'PENDING' || view.value.status === 'RUNNING')),
  )
  const failed = computed(() => !running.value && (!!requestError.value || view.value?.status === 'FAILED'))
  /** 可以重新解析：请求层失败一律可以；解析失败看 retryable */
  const canRetry = computed(
    () => !!requestError.value || (view.value?.status === 'FAILED' && view.value.retryable === true),
  )
  const errorText = computed(() => {
    if (requestError.value) return requestError.value
    if (view.value?.status === 'FAILED') return view.value.errorMessage || '解析没有完成'
    return ''
  })

  /** 四步进度：0 上传 / 1 抽帧 + 音轨 / 2 看画面 / 3 标维度 */
  const step = computed(() => {
    if (ready.value) return 3
    if (starting.value || !view.value) return 0
    return stepOfStage(view.value.stage)
  })
  const progress = computed(() => {
    const p = view.value?.progress
    return typeof p === 'number' && Number.isFinite(p) ? Math.max(0, Math.min(100, Math.round(p))) : null
  })
  const stageText = computed(() => {
    if (starting.value) return '正在提交原片…'
    const s = view.value?.stage
    return (s && VC_STAGE_TEXT[s]) || '正在排队解析…'
  })

  /* ------------------------------------------------------------ 请求与轮询 */

  function clearTimer() {
    if (timer) clearTimeout(timer)
    timer = undefined
  }

  function resetAnnotations() {
    purpose.value = ''
    textStrategy.value = 'watermark'
    textTouched.value = false
    resolution.value = 'follow'
    audio.value = 'keep'
    content.value = ''
    dimOrder.value = []
    for (const k of VC_DIMS) edits[k] = emptyEdit()
  }

  function reset() {
    seq += 1
    clearTimer()
    netFails = 0
    view.value = null
    starting.value = false
    requestError.value = ''
    pollPaused.value = false
    resetAnnotations()
  }

  function errorMessageOf(err: unknown, fallback: string) {
    const e = toApiError(err)
    if (e?.isNetwork) return '网络不稳，没能连上解析服务'
    return e?.message || (err instanceof Error && err.message) || fallback
  }

  async function start(url: string) {
    const my = ++seq
    clearTimer()
    netFails = 0
    starting.value = true
    requestError.value = ''
    pollPaused.value = false
    try {
      const res = await startVideoCloneAnalysis(url)
      if (my !== seq) return
      accept(res.data, my)
    } catch (err) {
      if (my !== seq) return
      requestError.value = errorMessageOf(err, '解析没能开始，请稍后重试')
    } finally {
      if (my === seq) starting.value = false
    }
  }

  function accept(next: VideoCloneAnalysisView | null | undefined, my: number) {
    if (!next || !next.analysisId) {
      requestError.value = '解析服务没有返回结果，请重新解析'
      return
    }
    const wasReady = view.value?.status === 'SUCCEEDED' && view.value.analysisId === next.analysisId
    view.value = next
    if (next.status === 'SUCCEEDED' && !next.result) {
      requestError.value = '解析结果缺失，请重新解析'
      return
    }
    if (next.status === 'PENDING' || next.status === 'RUNNING') {
      schedule(next.analysisId, my)
    } else if (next.status === 'SUCCEEDED' && !wasReady) {
      enterReady()
    }
  }

  function schedule(id: string, my: number) {
    clearTimer()
    timer = setTimeout(() => void poll(id, my), POLL_MS)
  }

  async function poll(id: string, my: number) {
    if (my !== seq) return
    try {
      const res = await getVideoCloneAnalysis(id)
      if (my !== seq) return
      netFails = 0
      accept(res.data, my)
    } catch (err) {
      if (my !== seq) return
      const e = toApiError(err)
      if (e?.isNetwork || e?.code === -1) {
        netFails += 1
        if (netFails >= MAX_NET_FAILS) pollPaused.value = true
        else schedule(id, my)
        return
      }
      // 业务失败（4001 不属于本人等）：停轮询，就地显示，允许用同一原片重新解析
      requestError.value = errorMessageOf(err, '解析进度查询失败')
    }
  }

  /** 暂停后继续查询（网络恢复） */
  function resumePolling() {
    const id = view.value?.analysisId
    if (!id) return
    pollPaused.value = false
    netFails = 0
    void poll(id, seq)
  }

  /** 重新解析：同一原片地址再 POST 一次（失败 / 可重试的会原地重启） */
  function retry() {
    if (!currentUrl || running.value) return
    void start(currentUrl)
  }

  watch(
    opts.videoUrl,
    (url) => {
      if (url === currentUrl) return
      currentUrl = url
      reset()
      if (url) void start(url)
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    seq += 1
    clearTimer()
  })

  /* ------------------------------------------------------------ 进入标注 */

  function enterReady() {
    const r = result.value
    if (!r) return
    resetAnnotations()
    const p = purposeOf(r.meta.purpose) ?? purposeOf('mixed')!
    purpose.value = p.key
    dimOrder.value = r.dimOrder?.length ? [...r.dimOrder] : [...p.order]
    const t = r.defaults?.textStrategy
    textStrategy.value = t === 'all' || t === 'watermark' || t === 'off' ? t : p.text
    audio.value = r.defaults?.audio === 'regenerate' || !r.meta.hasAudio ? 'regenerate' : 'keep'
    resolution.value = 'follow'
    applyPending()
  }

  function setPurpose(next: string) {
    const p = purposeOf(next)
    if (!p || next === purpose.value) return
    purpose.value = next
    // 回到解析判断的目的时用解析给的顺序，否则按目的预设重排
    const r = result.value
    dimOrder.value = r && next === r.meta.purpose && r.dimOrder?.length ? [...r.dimOrder] : [...p.order]
    if (!textTouched.value) textStrategy.value = p.text
  }

  const purposeWhy = computed(() => {
    const r = result.value
    if (r && purpose.value === r.meta.purpose && r.meta.purposeReason) return r.meta.purposeReason
    return purposeOf(purpose.value)?.why ?? ''
  })

  function setTextStrategy(v: VideoCloneTextStrategy) {
    textTouched.value = true
    textStrategy.value = v
  }

  function setResolution(v: VideoCloneResolution) {
    resolution.value = v
  }
  function setAudio(v: VideoCloneAudio) {
    audio.value = v
  }
  function setContent(v: string) {
    content.value = v
  }

  /** 维度排序：画面里有的在前，同组按 dimOrder */
  const orderedDims = computed<VideoCloneDimKey[]>(() => {
    const index = new Map(dimOrder.value.map((k, i) => [k, i]))
    const absent = (k: VideoCloneDimKey) => (dims.value[k]?.present ? 0 : 1)
    return [...VC_DIMS].sort((a, b) => absent(a) - absent(b) || (index.get(a) ?? 99) - (index.get(b) ?? 99))
  })

  /* ------------------------------------------------------------ 维度标注 */

  function occurrencesOf(key: VideoCloneDimKey) {
    return dims.value[key]?.occurrences ?? []
  }

  /** 逐段替换：该维度在画面里出现多段、且选了替换 */
  function perSegmentActive(key: VideoCloneDimKey) {
    const e = edits[key]
    return e.mode === 'replace' && e.perSegment && occurrencesOf(key).length > 1
  }

  function segOf(key: VideoCloneDimKey, i: number): VcSegEdit {
    const e = edits[key]
    while (e.segs.length <= i) e.segs.push({ refs: [], note: '' })
    return e.segs[i]!
  }

  function setMode(key: VideoCloneDimKey, mode: VideoCloneDimMode) {
    if (!dims.value[key]?.present) return
    const e = edits[key]
    if (e.mode === mode) return
    e.mode = mode
    if (mode === 'keep') edits[key] = emptyEdit()
  }

  function setPerSegment(key: VideoCloneDimKey, on: boolean) {
    const e = edits[key]
    e.perSegment = on
    if (on) while (e.segs.length < occurrencesOf(key).length) e.segs.push({ refs: [], note: '' })
    // 切回「全部换同一套」且整体没挂图：把第一段挂的图带过来，免得白挑
    if (!on && !e.refs.length) {
      const first = e.segs.find((s) => s.refs.length)
      if (first) e.refs = [...first.refs]
    }
  }

  function toggleRef(list: string[], url: string) {
    const at = list.indexOf(url)
    if (at >= 0) list.splice(at, 1)
    else list.push(url)
  }

  function toggleSubject(key: VideoCloneDimKey, id: string | null) {
    const e = edits[key]
    if (id === null) {
      e.subjects = []
      return
    }
    toggleRef(e.subjects, id)
    // 选全了等于所有人
    if (e.subjects.length >= subjects.value.length) e.subjects = []
  }

  /** 参考图被删：把挂在各维度 / 各段上的同一地址一并摘掉 */
  watch(
    () => opts.refs().join('\n'),
    () => {
      const live = new Set(opts.refs())
      for (const k of VC_DIMS) {
        const e = edits[k]
        if (e.refs.some((u) => !live.has(u))) e.refs = e.refs.filter((u) => live.has(u))
        for (const s of e.segs) if (s.refs.some((u) => !live.has(u))) s.refs = s.refs.filter((u) => live.has(u))
      }
    },
  )

  /** 换模型后不支持的清晰度退回跟随原片 */
  watch(
    () => opts.modelResolutions(),
    (list) => {
      if (list && resolution.value !== 'follow' && !list.includes(resolution.value)) resolution.value = 'follow'
    },
  )

  const changedKeys = computed(() => VC_DIMS.filter((k) => edits[k].mode !== 'keep' && dims.value[k]?.present))

  /** 生成按钮不可点的原因（空串 = 可以提交）；与 Java 受理面的规则一一对应 */
  const blockReason = computed(() => {
    if (!opts.videoUrl()) return ''
    if (running.value) return '原片还在解析，解析完成后再生成'
    if (!ready.value) return '解析没有完成：可以重新解析，或改用「直接出片」'
    for (const k of changedKeys.value) {
      const e = edits[k]
      const name = VC_DIM_CN[k]
      if (e.mode === 'describe' && !e.note.trim()) return `「${name}」选了描述，请写清改成什么样`
      if (e.mode === 'replace') {
        if (perSegmentActive(k)) {
          const any = e.note.trim() || e.segs.some((s) => s.refs.length || s.note.trim())
          if (!any) return `「${name}」逐段替换至少给一段挂参考图或写说明`
        } else if (!e.refs.length && !e.note.trim()) {
          return `「${name}」选了替换，请挂一张参考图或写一句说明`
        }
      }
    }
    if (!changedKeys.value.length && !content.value.trim()) {
      return '先标一个维度（比如「服装 → 替换」），或写一句改成什么样'
    }
    const max = opts.modelMaxSeconds()
    const d = meta.value?.duration
    if (max && d && d > max + 0.5) {
      return `原片 ${d.toFixed(1)} 秒，超过当前模型单段上限 ${max} 秒，请换模型或先裁剪原片`
    }
    return ''
  })

  /** 出片请求体里的视频复刻部分；sentRefs = 本次实际提交的 imageUrls（@n = 下标 + 1） */
  function buildPayload(sentRefs: string[]): { videoClone: VideoCloneAnnotations; content?: string } {
    const v = view.value
    if (!v || !ready.value) throw new Error('解析还没完成')
    const no = (urls: string[]) => {
      const out = urls.map((u) => sentRefs.indexOf(u) + 1).filter((n) => n > 0)
      return [...new Set(out)]
    }
    const marks: Partial<Record<VideoCloneDimKey, VideoCloneDimMark>> = {}
    for (const k of changedKeys.value) {
      const e = edits[k]
      const mark: VideoCloneDimMark = { mode: e.mode }
      const note = e.note.trim()
      if (note) mark.note = note
      if (e.subjects.length && subjects.value.length > 1) mark.subjects = [...e.subjects]
      if (e.mode === 'replace') {
        if (perSegmentActive(k)) {
          mark.perSegment = true
          mark.segments = occurrencesOf(k)
            .map((o, i) => {
              const s = e.segs[i]
              if (!s) return null
              const refs = no(s.refs)
              const segNote = s.note.trim()
              if (!refs.length && !segNote) return null
              return { t0: o.t0, ...(refs.length ? { refs } : {}), ...(segNote ? { note: segNote } : {}) }
            })
            .filter((s): s is NonNullable<typeof s> => !!s)
        } else {
          const refs = no(e.refs)
          if (refs.length) mark.refs = refs
        }
        if (k === 'model') mark.withOutfit = e.withOutfit
      }
      marks[k] = mark
    }
    const videoClone: VideoCloneAnnotations = {
      analysisId: v.analysisId,
      purpose: purpose.value || undefined,
      textStrategy: textStrategy.value,
      resolution: resolution.value,
      audio: audio.value,
      dims: marks,
    }
    const text = content.value.trim()
    return text ? { videoClone, content: text } : { videoClone }
  }

  /* ------------------------------------------------------------ 重新编辑 */

  /**
   * 「重新编辑」：记下当时的标注，等同一个解析号完成后套上（同一原片 POST 会复用原解析，号不变）；
   * 原片已经解析好且号对得上时立刻套上。refs = 回填后的参考图（顺序即当时的 @n）。
   */
  function queueRestore(annotation: VideoCloneAnnotations, refs: string[], contentText: string) {
    pending = { annotation, refs: [...refs], content: isServerSummary(contentText) ? '' : contentText }
    if (ready.value) applyPending()
  }

  function clearRestore() {
    pending = null
  }

  function applyPending() {
    const p = pending
    const v = view.value
    if (!p || !v || !result.value) return
    // 号对不上（回填的是另一条原片、换片还没生效）：留着等那条原片解析完成再套
    if (p.annotation.analysisId !== v.analysisId) return
    pending = null
    const a = p.annotation
    if (a.purpose && purposeOf(a.purpose)) setPurpose(a.purpose)
    if (a.textStrategy === 'all' || a.textStrategy === 'watermark' || a.textStrategy === 'off') {
      textStrategy.value = a.textStrategy
      textTouched.value = true
    }
    const supported = opts.modelResolutions()
    if (
      a.resolution === 'follow' ||
      ((a.resolution === '720p' || a.resolution === '1080p') && (!supported || supported.includes(a.resolution)))
    )
      resolution.value = a.resolution
    if (a.audio === 'keep' || a.audio === 'regenerate') audio.value = meta.value?.hasAudio ? a.audio : 'regenerate'
    content.value = p.content
    const urlOf = (nums: unknown) =>
      Array.isArray(nums)
        ? nums.map((n) => (typeof n === 'number' ? p.refs[n - 1] : undefined)).filter((u): u is string => !!u)
        : []
    for (const k of VC_DIMS) {
      const m = a.dims?.[k]
      if (!m || !dims.value[k]?.present || (m.mode !== 'replace' && m.mode !== 'describe')) continue
      const e = emptyEdit()
      e.mode = m.mode
      e.note = typeof m.note === 'string' ? m.note : ''
      e.refs = urlOf(m.refs)
      const known = new Set(subjects.value.map((s) => s.id))
      e.subjects = Array.isArray(m.subjects) ? m.subjects.filter((id) => known.has(id)) : []
      e.withOutfit = k === 'model' && m.withOutfit === true
      const occ = occurrencesOf(k)
      if (m.perSegment && occ.length > 1) {
        e.perSegment = true
        e.segs = occ.map(() => ({ refs: [], note: '' }))
        for (const s of m.segments ?? []) {
          const at = occ.findIndex((o) => typeof s.t0 === 'number' && Math.abs(o.t0 - s.t0) <= T0_TOLERANCE)
          if (at >= 0) e.segs[at] = { refs: urlOf(s.refs), note: typeof s.note === 'string' ? s.note : '' }
        }
      }
      edits[k] = e
    }
  }

  return {
    view,
    starting,
    requestError,
    pollPaused,
    result,
    meta,
    dims,
    subjects,
    ready,
    running,
    failed,
    canRetry,
    errorText,
    step,
    progress,
    stageText,
    purpose,
    purposeWhy,
    textStrategy,
    resolution,
    audio,
    content,
    edits,
    orderedDims,
    changedKeys,
    blockReason,
    occurrencesOf,
    perSegmentActive,
    segOf,
    setPurpose,
    setTextStrategy,
    setResolution,
    setAudio,
    setContent,
    setMode,
    setPerSegment,
    toggleRef,
    toggleSubject,
    retry,
    resumePolling,
    buildPayload,
    queueRestore,
    clearRestore,
  }
}

/** 包成 reactive：模板与子组件里不用写 .value（refs / computed 自动解包） */
export function useVideoCloneState(opts: VideoCloneOptions) {
  return reactive(useVideoClone(opts))
}

export type VideoCloneState = ReturnType<typeof useVideoCloneState>
