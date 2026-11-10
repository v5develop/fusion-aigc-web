/**
 * 自动识别选区：POST /api/v1/studio/masks { image_url, target, parts? } → { mask_url, target, cached, parts?, available_parts? }。
 *
 * <p>优先用 api/studio.ts 的 `studioSegmentMask`（另一条线在补）；还没有这个导出时按同一契约直接 POST。
 * 接口探到 404（老网关没有）后本会话 {@link colorFixSegmentSupported} = false，面板隐藏「自动识别」。
 * 结果按 图 + 目标 + 部位 缓存在内存（同一张图来回切目标 / 部位不重复请求；服务端自己也有缓存）。
 *
 * <p>服装细分部位（上衣 / 外套 / 下装 / 裙装 / 鞋 / 包 / 帽）是后加的能力，要先探到服务端支持才显示：
 * 任一次服装识别的响应带 `available_parts`、或商拍任务带 `mask_parts` 字段（新网关总下发）即 {@link colorFixGarmentParts}
 * 有值；服装识别的响应没有 `available_parts` = 老服务端，清空（面板隐藏部位选择，parts 一律不发）。
 */
import { ref } from 'vue'
import * as studioApi from '@/api/studio.ts'
import { post, toApiError } from '@/api/index.ts'
import { colorFixPartsSanitize, type ColorFixAutoTarget, type ColorFixGarmentPart } from './types.ts'

/** 识别函数：返回蒙版地址（白 / 不透明 = 要调整），失败抛错；parts 只对 garment 有效，空 = 全部服装 */
export type ColorFixSegmenter = (
  imageUrl: string,
  target: ColorFixAutoTarget,
  parts?: readonly ColorFixGarmentPart[],
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

type SegmentFn = (imageUrl: string, target: ColorFixAutoTarget, parts?: ColorFixGarmentPart[]) => Promise<unknown>

const NATIVE_NAME: string = 'studioSegmentMask'
const cache = new Map<string, Promise<string>>()
const CACHE_MAX = 32

function pickBody(resp: unknown): SegmentResp {
  const body = resp as { data?: SegmentResp } & SegmentResp
  return (body?.data && typeof body.data === 'object' ? body.data : body) ?? {}
}

/** 默认识别函数（走网关 /api/v1/studio/masks） */
export const defaultColorFixSegmenter: ColorFixSegmenter = (imageUrl, target, parts) => {
  const sendParts = colorFixRequestParts(target, parts)
  const key = `${target}|${sendParts.join(',')}|${imageUrl}`
  const hit = cache.get(key)
  if (hit) return hit
  // 动态键取：导出还没合入时打包器不报「导入恒为 undefined」，合入后自动改走它
  const native = (studioApi as unknown as Record<string, unknown>)[NATIVE_NAME] as SegmentFn | undefined
  const reqBody: Record<string, unknown> = { imageUrl: imageUrl, target }
  if (sendParts.length) reqBody.parts = sendParts
  const call = native
    ? native(imageUrl, target, sendParts.length ? sendParts : undefined)
    : post<SegmentResp>('/api/v1/studio/masks', reqBody, undefined, 60000)
  const task = Promise.resolve(call)
    .then((resp) => {
      const body = pickBody(resp)
      if (target === 'garment') noteColorFixGarmentParts(body.availableParts)
      if (!body.maskUrl) throw new Error('识别结果缺少蒙版地址')
      // 逐件蒙版顺手进缓存：之后单选其中一件不再请求
      for (const p of body.parts ?? []) {
        if (p?.maskUrl && sendParts.length > 1 && colorFixPartsSanitize([p.part]).length) {
          const k = `${target}|${p.part}|${imageUrl}`
          if (!cache.has(k)) cache.set(k, Promise.resolve(p.maskUrl))
        }
      }
      return body.maskUrl
    })
    .catch((err: unknown) => {
      cache.delete(key)
      const e = toApiError(err)
      if (e?.httpStatus === 404 && e.code === -1) colorFixSegmentSupported.value = false
      throw err
    })
  cache.set(key, task)
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
  return task
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
