/**
 * 结果对照（MediaLightbox）与单张重试的判定，从批次快照 batch.payload 推出每张成品对应的输入图。
 *
 * <ul>
 *   <li>商拍换装：该任务的模特图（model_index）+ 全部服装图（role 作名）→ 成品；</li>
 *   <li>姿态复刻：人物图 + 该任务的姿势图（pose_index）→ 成品；</li>
 *   <li>图片生成：参考图（没有就只有成品）→ 成品。</li>
 * </ul>
 * 快照缺字段 / 解析失败时只放成品。
 */
import { ref } from 'vue'
import type { LightboxItem } from '@/components/MediaLightbox/index.vue'
import type {
  StudioBatch,
  StudioBatchDetail,
  StudioImageGenPayload,
  StudioPosePayload,
  StudioTask,
  StudioTryonPayload,
} from '@/api/studio-types.ts'
import { taskCaption } from '../../constants.ts'

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : '')

/** 成品前面的输入图（不含成品） */
export function sourceItems(d: StudioBatchDetail, task: StudioTask): LightboxItem[] {
  const p = parsePayload(d.batch.payload)
  const out: LightboxItem[] = []
  if (d.batch.kind === 'tryon') {
    const t = p as StudioTryonPayload
    const model = str(t.modelImageUrls?.[task.modelIndex])
    if (model) out.push({ url: model, name: `模特图 ${task.modelIndex + 1}` })
    for (const g of Array.isArray(t.garmentImages) ? t.garmentImages : []) {
      const url = str(g?.url)
      if (url) out.push({ url, name: `服装图 · ${g.role || '单品'}` })
    }
  } else if (d.batch.kind === 'pose') {
    const t = p as StudioPosePayload
    const source = str(t.sourceImageUrl)
    if (source) out.push({ url: source, name: '人物图' })
    const pose = str(t.poseImageUrls?.[task.poseIndex])
    if (pose) out.push({ url: pose, name: `姿势图 ${task.poseIndex + 1}` })
  } else {
    const t = p as StudioImageGenPayload
    ;(Array.isArray(t.imageUrls) ? t.imageUrls : []).forEach((u, i) => {
      const url = str(u)
      if (url) out.push({ url, name: `参考图 ${i + 1}` })
    })
  }
  return out
}

/**
 * 「前后对比」的前图（原型 ToolPreviewPanel COMPARE_BEFORE_INDEX）：
 * 商拍换装 = 该任务的模特图（model_image_urls[model_index]）「模特图」；
 * 姿态复刻 = 该任务的姿势图（pose_image_urls[pose_index]）「参考姿势图」；图片生成不做前后对比。
 */
export function compareBefore(d: StudioBatchDetail, task: StudioTask): { url: string; label: string } | null {
  const p = parsePayload(d.batch.payload)
  if (d.batch.kind === 'tryon') {
    const url = str((p as StudioTryonPayload).modelImageUrls?.[task.modelIndex])
    return url ? { url, label: '模特图' } : null
  }
  if (d.batch.kind === 'pose') {
    const url = str((p as StudioPosePayload).poseImageUrls?.[task.poseIndex])
    return url ? { url, label: '参考姿势图' } : null
  }
  return null
}

/** 提交时是否开了「默认校色」（payload.colorFix）；老批次没有这个字段按没开 */
export function batchColorFix(d: StudioBatchDetail): boolean {
  return parsePayload(d.batch.payload).colorFix === true
}

/** 对照组：输入图 → 成品；index 指向成品 */
export function compareItems(d: StudioBatchDetail, task: StudioTask): { items: LightboxItem[]; index: number } {
  const items = [...sourceItems(d, task), { url: task.resultUrl, name: `结果 · ${taskCaption(task, d.batch)}` }]
  return { items, index: items.length - 1 }
}

/**
 * 能否「重试这张」（与 Go RetryTask 前置条件一致的前端快速判断，最终以服务端为准）：
 * 任务失败（已取消的不给），批次已结束且是 全部失败 / 部分成功。
 */
export function canRetryTask(batch: StudioBatch, task: StudioTask) {
  return task.status === 3 && (batch.status === 5 || batch.status === 6)
}

/** 每张点数（预估冻结额 / 张数），拿不到为 0 */
export function unitPoints(batch: StudioBatch) {
  return batch.taskTotal > 0 ? Math.round(batch.estimatedPoints / batch.taskTotal) : 0
}

/**
 * 重试接口在不在：网关还没上 POST /tasks/{task_id}/retry 时返回 HTTP 404（无业务码），记下来后不再显示「重试这张」。
 * 模块级：同一会话里三个工作台共用一个结论，刷新页面重新探测。
 */
export const retrySupported = ref(true)
