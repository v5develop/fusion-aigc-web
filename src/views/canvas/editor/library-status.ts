/**
 * 画布产物「先交付、后进素材库」（契约 3.3，2026-11-11）的前端口径。
 *
 * <p>run 成功后服务端立即交付，产物地址先是 10 分钟现签地址（`library_status=pending`），后台转存素材库完成后
 * 同一个 run 换成长期地址、状态变空；转存永久失败为 `failed`（仍可看可下载，地址仍是现签）。
 * pending / failed 时**不能把候选 / 视频地址写进节点内容**：引用走连线 + candidate_index（服务端按 run 现取），
 * 只能靠地址工作的入口在 pending 时禁用并提示 {@link LIBRARY_PENDING_TIP}。
 */
import type { CanvasEditorNodeData } from './types.ts'

export type CanvasLibraryStatus = 'pending' | 'failed'

/** 只读键：GET /canvases/{id} 回填、轮询写回，保存前剥掉（服务端也会剥） */
export const LIBRARY_STATUS_KEYS = ['libraryStatus', 'library_status'] as const

export const LIBRARY_PENDING_TIP = '正在保存到素材库，稍候即可使用'
export const LIBRARY_PENDING_HINT = '保存到素材库中…'
export const LIBRARY_FAILED_HINT = '未能保存到素材库'

/** 接口原样值 → 只认 pending / failed，其余（空 / 不认识）按「已在素材库」处理 */
export function normalizeLibraryStatus(raw: unknown): CanvasLibraryStatus | undefined {
  return raw === 'pending' || raw === 'failed' ? raw : undefined
}

/** 产物地址是现签临时地址（pending / failed）：不能存进节点内容 */
export function hasTransientMedia(data: Pick<CanvasEditorNodeData, 'libraryStatus'> | undefined): boolean {
  return Boolean(data && normalizeLibraryStatus(data.libraryStatus))
}

export function isLibraryPending(data: Pick<CanvasEditorNodeData, 'libraryStatus'> | undefined): boolean {
  return data?.libraryStatus === 'pending'
}

/** 从一个对象上删掉 libraryStatus 只读键（保存 / 导出 / 剪贴板前防御性剥离） */
export function stripLibraryStatus(data: Record<string, unknown>): void {
  for (const key of LIBRARY_STATUS_KEYS) delete data[key]
}
