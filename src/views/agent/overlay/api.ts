/**
 * 模板文字叠加接口（Go，/api/v1/plaza/overlays，需登录，CommonResult 信封）。
 * 叠字不收费：这里的调用不走报价 / 扣点；全部用静默请求，失败由调用方就地展示，不弹全局 toast。
 * 叠字失败是 HTTP 200 + status:'failed'（记录已保存，可重试）；网络 / 业务错误照常抛出。
 */
import { getQuiet, postQuiet, putQuiet } from '@/api/index.ts'

export interface IOverlay {
  id: number | string
  templateId: number
  sourceUrl: string
  renderedUrl: string | null
  status: 'ok' | 'failed'
  failReason?: string
  values: Record<string, string>
  updatedAt?: string
}

const BASE = '/api/v1/plaza/overlays'
/** GET 单次最多查多少个 sourceUrl（服务端上限 20） */
export const OVERLAY_QUERY_MAX = 20

export async function overlayCreate(templateId: number, sourceUrl: string, values: Record<string, string>) {
  const res = await postQuiet<IOverlay>(BASE, { templateId, sourceUrl, values })
  return res.data
}

/** 总是从无字原图重渲染；不带 values = 按已存文字重试 */
export async function overlayUpdate(id: IOverlay['id'], values?: Record<string, string>) {
  const res = await putQuiet<IOverlay>(`${BASE}/${encodeURIComponent(String(id))}`, values ? { values } : {})
  return res.data
}

/** 重复参数 sourceUrl=a&sourceUrl=b（axios 默认会序列化成 sourceUrl[]，所以手拼） */
export async function overlayList(sourceUrls: string[]): Promise<IOverlay[]> {
  if (!sourceUrls.length) return []
  const qs = sourceUrls.slice(0, OVERLAY_QUERY_MAX).map((u) => `sourceUrl=${encodeURIComponent(u)}`).join('&')
  const res = await getQuiet<{ items?: IOverlay[] }>(`${BASE}?${qs}`)
  return res.data?.items ?? []
}
