/**
 * 自动识别选区：POST /api/v1/studio/masks { image_url, target, parts? } → { mask_url, target, cached, parts?, available_parts? }。
 *
 * <p>接口探到 404（老网关没有）后本会话 {@link colorFixSegmentSupported} = false，面板隐藏「自动识别」。
 * 结果按 图 + 目标 + 部位 缓存在内存（同一张图来回切目标 / 部位不重复请求；服务端自己也有缓存）。
 *
 * <p>首次识别慢（服务端未命中缓存时 > 60s），而网关 nginx 60s 就回 504——服务端其实还在算、算完会缓存。
 * 所以网关超时类失败（HTTP 502 / 503 / 504、请求超时、断网）一律当作「还在算」：保持识别中，按 3s、5s、8s… 退避重发，
 * 总时长约 {@link SEGMENT_TOTAL_MS}；业务错误（4001 没识别到、6001 服务不可用、4002 太频繁等）不重试，原样交给调用方
 * （{@link colorFixSegmentFailure} 翻成提示）。调用方传 `signal` 可中途放弃：同一份识别被多处共用时，所有调用方都放弃了
 * 才真正停掉重试与在途请求。
 *
 * <p>服装细分部位（上衣 / 外套 / 下装 / 裙装 / 鞋 / 包 / 帽）是后加的能力，要先探到服务端支持才显示：
 * 任一次服装识别的响应带 `available_parts`、或商拍任务带 `mask_parts` 字段（新网关总下发）即 {@link colorFixGarmentParts}
 * 有值；服装识别的响应没有 `available_parts` = 老服务端，清空（面板隐藏部位选择，parts 一律不发）。
 */
import { ref } from 'vue'
import { SEGMENT_MASK_TIMEOUT, studioSegmentMask } from '@/api/studio.ts'
import { toApiError } from '@/api/index.ts'
import { colorFixPartsSanitize, type ColorFixAutoTarget, type ColorFixGarmentPart } from './types.ts'

/** 识别函数：返回蒙版地址（白 / 不透明 = 要调整），失败抛错；parts 只对 garment 有效，空 = 全部服装 */
export type ColorFixSegmenter = (
  imageUrl: string,
  target: ColorFixAutoTarget,
  parts?: readonly ColorFixGarmentPart[],
  opts?: { signal?: AbortSignal },
) => Promise<string>

/** 自动识别接口是否可用；探到 404 后本会话为 false */
export const colorFixSegmentSupported = ref(true)

/** 服务端支持的服装细分部位；空 = 还没探到 / 不支持（面板不显示部位选择） */
export const colorFixGarmentParts = ref<ColorFixGarmentPart[]>([])

/** 记下服务端是否支持服装细分部位：list 为 undefined = 响应里没有这个字段（老服务端） */
export function noteColorFixGarmentParts(list: unknown) {
  const parts = list === undefined ? [] : colorFixPartsSanitize(list)
  if (parts.join() !== colorFixGarmentParts.value.join()) colorFixGarmentParts.value = parts
}

/** 当前请求实际要发的部位：服务端不支持 / 非服装 → 空（全部服装） */
export function colorFixRequestParts(
  target: ColorFixAutoTarget,
  parts: readonly ColorFixGarmentPart[] | undefined,
): ColorFixGarmentPart[] {
  if (target !== 'garment' || !parts?.length || !colorFixGarmentParts.value.length) return []
  const allowed = new Set(colorFixGarmentParts.value)
  return colorFixPartsSanitize(parts).filter((p) => allowed.has(p))
}

interface SegmentResp {
  maskUrl?: string
  target?: string
  cached?: boolean
  parts?: { part: string; maskUrl: string }[]
  availableParts?: string[]
}

// ---------------- 网关超时 = 还在算：退避重发 ----------------

/** 「还在算」时的重发间隔（最后一档循环用） */
export const SEGMENT_RETRY_DELAYS_MS = [3000, 5000, 8000, 13000, 20000] as const
/** 从第一次请求起的总时长上限：超过就不再发新请求，报「识别超时」 */
export const SEGMENT_TOTAL_MS = 150_000
/** 单次请求的最短超时（剩余时长太短时也给够一次服务端缓存命中的往返） */
const SEGMENT_MIN_ATTEMPT_MS = 20_000

/** 识别失败的归类（{@link colorFixSegmentFailure} 用） */
export class ColorFixSegmentError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'aborted',
  ) {
    super(message)
    this.name = 'ColorFixSegmentError'
  }
}

/** 网关超时 / 断网 / 请求超时：服务端多半还在算（算完会缓存），值得再问一次 */
export function isSegmentStillComputing(err: unknown): boolean {
  const e = toApiError(err)
  if (!e) return false
  if (e.isNetwork) return true
  return e.code === -1 && (e.httpStatus === 502 || e.httpStatus === 503 || e.httpStatus === 504)
}

function abortError() {
  return new ColorFixSegmentError('已取消', 'aborted')
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError())
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function requestWithRetry(
  imageUrl: string,
  target: ColorFixAutoTarget,
  parts: ColorFixGarmentPart[],
  signal: AbortSignal,
): Promise<SegmentResp> {
  const startedAt = Date.now()
  for (let attempt = 0; ; attempt++) {
    const remaining = SEGMENT_TOTAL_MS - (Date.now() - startedAt)
    const timeout = Math.min(SEGMENT_MASK_TIMEOUT, Math.max(SEGMENT_MIN_ATTEMPT_MS, remaining))
    try {
      const resp = await studioSegmentMask(imageUrl, target, parts.length ? parts : undefined, { signal, timeout })
      return pickBody(resp)
    } catch (err) {
      if (signal.aborted) throw abortError()
      if (!isSegmentStillComputing(err)) throw err
      const wait = SEGMENT_RETRY_DELAYS_MS[Math.min(attempt, SEGMENT_RETRY_DELAYS_MS.length - 1)]!
      if (Date.now() - startedAt + wait >= SEGMENT_TOTAL_MS)
        throw new ColorFixSegmentError('识别超时', 'timeout')
      await sleep(wait, signal)
    }
  }
}

/** 识别失败后可以一键改走的路：换「人物」目标 / 点选 / 手动涂抹 */
export type ColorFixSegmentSuggestion = 'person' | 'point' | 'paint'

/**
 * 4001「没识别到对应区域」（如服装走阿里云 SegmentCloth，风格化 / AI 画风图、飘逸半透明汉服、特写人像常报 noClothError——
 * 供应商模型的局限，不是故障）：不给死路提示，改成可操作的一句话 + 建议的替代方式（面板渲染成按钮）。
 */
const NO_REGION: Record<ColorFixAutoTarget, { message: string; suggest: ColorFixSegmentSuggestion[] }> = {
  garment: {
    message: '没识别到服装（识别更适合商品图 / 模特正装照）。可改用「人物」或「点选」框出衣服',
    suggest: ['person', 'point'],
  },
  product: { message: '没识别到商品。可改用「点选」或「手动涂抹」框出商品', suggest: ['point', 'paint'] },
  person: { message: '没识别到人物。可改用「点选」或「手动涂抹」框出人物', suggest: ['point', 'paint'] },
  background: {
    message: '没识别到背景。可改用「点选」选中主体后打开「反选」，或「手动涂抹」',
    suggest: ['point', 'paint'],
  },
}

export interface ColorFixSegmentFailure {
  message: string
  retryable: boolean
  /** 建议的替代方式（按钮）；空 = 不给 */
  suggest?: ColorFixSegmentSuggestion[]
}

/** 识别失败 → 给用户的一句话 + 是否给「重试」+ 替代方式；取消返回 null（不提示） */
export function colorFixSegmentFailure(err: unknown, target?: ColorFixAutoTarget): ColorFixSegmentFailure | null {
  if (err instanceof ColorFixSegmentError) {
    if (err.kind === 'aborted') return null
    return { message: '识别超时，可重试或改用手动涂抹', retryable: true }
  }
  if (!colorFixSegmentSupported.value) return { message: '当前环境不支持自动识别，请改用手动涂抹', retryable: false }
  const e = toApiError(err)
  if (e && e.code !== -1) {
    if (e.code === 4001) {
      if (target) return { ...NO_REGION[target], retryable: false }
      return { message: '没有识别到对应区域，可换个目标或改用手动涂抹 / 点选', retryable: false, suggest: ['point', 'paint'] }
    }
    if (e.code === 6001) return { message: '识别服务暂不可用，可稍后重试或改用手动涂抹', retryable: true }
    if (e.code === 4002) return { message: '识别太频繁，请稍后重试', retryable: true }
    return { message: e.message || '识别失败，可重试或改用手动涂抹', retryable: true }
  }
  return { message: '识别失败，可重试或改用手动涂抹', retryable: true }
}

// ---------------- 共享任务 + 缓存 ----------------

interface SharedTask {
  promise: Promise<string>
  ctrl: AbortController | null
  /** 还在等它的调用方（带 signal 的放弃时减一，减到 0 且没结束就停掉） */
  waiters: number
  /** 有不带 signal 的调用方在等（放弃不了）：带 signal 的都放弃了也不停 */
  pinned: boolean
  settled: boolean
}

const cache = new Map<string, SharedTask>()
const CACHE_MAX = 32

function settledTask(url: string): SharedTask {
  return { promise: Promise.resolve(url), ctrl: null, waiters: 0, pinned: false, settled: true }
}

function pickBody(resp: unknown): SegmentResp {
  const body = resp as { data?: SegmentResp } & SegmentResp
  return (body?.data && typeof body.data === 'object' ? body.data : body) ?? {}
}

function startTask(key: string, imageUrl: string, target: ColorFixAutoTarget, sendParts: ColorFixGarmentPart[]) {
  const ctrl = new AbortController()
  const task: SharedTask = { promise: Promise.resolve(''), ctrl, waiters: 0, pinned: false, settled: false }
  task.promise = requestWithRetry(imageUrl, target, sendParts, ctrl.signal)
    .then((body) => {
      if (target === 'garment') noteColorFixGarmentParts(body.availableParts)
      if (!body.maskUrl) throw new Error('识别结果缺少蒙版地址')
      // 逐件蒙版顺手进缓存：之后单选其中一件不再请求
      for (const p of body.parts ?? []) {
        if (p?.maskUrl && sendParts.length > 1 && colorFixPartsSanitize([p.part]).length) {
          const k = `${target}|${p.part}|${imageUrl}`
          if (!cache.has(k)) cache.set(k, settledTask(p.maskUrl))
        }
      }
      return body.maskUrl
    })
    .catch((err: unknown) => {
      if (cache.get(key) === task) cache.delete(key)
      const e = toApiError(err)
      if (!ctrl.signal.aborted && e?.httpStatus === 404 && e.code === -1) colorFixSegmentSupported.value = false
      throw err
    })
    .finally(() => {
      task.settled = true
      task.ctrl = null
    })
  task.promise.catch(() => {}) // 由各调用方处理
  cache.set(key, task)
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
  return task
}

/** 默认识别函数（走网关 /api/v1/studio/masks；网关超时自动重发，见文件头） */
export const defaultColorFixSegmenter: ColorFixSegmenter = (imageUrl, target, parts, opts) => {
  const sendParts = colorFixRequestParts(target, parts)
  const key = `${target}|${sendParts.join(',')}|${imageUrl}`
  const task = cache.get(key) ?? startTask(key, imageUrl, target, sendParts)
  const signal = opts?.signal
  if (task.settled) return task.promise
  if (!signal) {
    task.pinned = true
    return task.promise
  }
  if (signal.aborted) return Promise.reject(abortError())
  task.waiters += 1
  return new Promise<string>((resolve, reject) => {
    let done = false
    const leave = () => {
      if (done) return false
      done = true
      task.waiters -= 1
      return true
    }
    const onAbort = () => {
      if (!leave()) return
      // 没人等了：停掉重发与在途请求，下次重新开始
      if (task.waiters <= 0 && !task.pinned && !task.settled) {
        task.ctrl?.abort()
        if (cache.get(key) === task) cache.delete(key)
      }
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    task.promise.then(
      (url) => {
        signal.removeEventListener('abort', onAbort)
        if (leave()) resolve(url)
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort)
        if (leave()) reject(err)
      },
    )
  })
}

/** 现成的逐件蒙版（如商拍任务的 mask_parts） */
export interface ColorFixPresetPart {
  part: string
  maskUrl: string
}

/**
 * 现成蒙版能不能当作「服装 · parts」的识别结果：presetUrl 代表的部位 = presetParts 的部位集合（空 = 全部服装）；
 * 部位相同用 presetUrl，单选其中一件用那一件的蒙版，否则 ''（要请求）。
 */
export function colorFixPresetFor(
  parts: readonly ColorFixGarmentPart[],
  presetUrl: string,
  presetParts: readonly ColorFixPresetPart[] | null | undefined,
): string {
  if (!presetUrl) return ''
  const list = presetParts ?? []
  const labels = colorFixPartsSanitize(list.map((p) => p.part))
  if (labels.length === parts.length && labels.every((p, i) => p === parts[i])) return presetUrl
  if (parts.length === 1) return list.find((p) => p.part === parts[0] && p.maskUrl)?.maskUrl ?? ''
  return ''
}
