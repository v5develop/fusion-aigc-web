/**
 * 批量应用校色（2026-11-11，资产库多选「应用校色」）：把一份校色预设（preset.ts，只取能带走的层）套到 N 张图上，
 * 每张存成资产的新版本——与资产详情「保存为新版本」同一条路（asset-version.ts saveColorFixLayersVersion）。
 *
 * <p>每张图：
 * <ol>
 *   <li>拉资产详情（版本前 50 个）→ 校色底图（colorFixBaseOf：当前是校色版本就用它的原图，不叠两遍）；</li>
 *   <li>按签名判重：这张资产已有同参数的校色版本 / 本会话已经存过 → 「已有相同版本」，不再存（重试也不会重复存）；</li>
 *   <li>自动识别层按同一目标 / 部位在这张图上重新识别（segment.ts：网关超时当「还在算」退避重发，业务错误直接失败）；</li>
 *   <li>烘图（导出尺寸，Worker 里算）→ 上传 → 追加版本。</li>
 * </ol>
 * 并发 2；取消 = 不再开始新的、在途的识别立即放弃、已上传还没追加版本的不追加（不会多出版本）。
 * 失败 / 取消的条目可以「重试」（状态改回 queued 再跑一次）；已存好的永远不会再存。
 */
import { assetLibDetail } from '@/api/asset-library.ts'
import { ColorFixMaskLoadError, colorFixDataUrlToFile, colorFixRenderLayers, type ColorFixRenderLayer } from '@/utils/colorfix.ts'
import {
  colorFixBaseOf,
  colorFixLayersSignature,
  colorFixSignatureOfVersion,
  colorFixVersionSavedInSession,
  saveColorFixLayersVersion,
} from './asset-version.ts'
import { adjustActive, cloneAdjust, isBaseLayer, layerEffective, recolorActive, type ColorFixLayer } from './layers.ts'
import {
  colorFixRequestParts,
  colorFixSegmentFailure,
  colorFixSegmentSupported,
  defaultColorFixSegmenter,
  type ColorFixSegmenter,
} from './segment.ts'

export type ColorFixBatchStatus =
  | 'queued'
  | 'loading'
  | 'detecting'
  | 'rendering'
  | 'uploading'
  | 'saved'
  | 'duplicate'
  | 'failed'
  | 'cancelled'
  | 'skipped'

export interface ColorFixBatchAsset {
  id: number
  title: string
  image: string
  media: string
}

export interface ColorFixBatchItem {
  asset: ColorFixBatchAsset
  status: ColorFixBatchStatus
  /** 失败原因 / 跳过原因 / 进度说明 */
  message: string
}

/** 终态（不会再跑）：已存 / 已有相同版本 / 跳过 */
export const BATCH_DONE: readonly ColorFixBatchStatus[] = ['saved', 'duplicate', 'skipped']
/** 可重试 */
export const BATCH_RETRYABLE: readonly ColorFixBatchStatus[] = ['failed', 'cancelled']
/** 在跑 */
export const BATCH_RUNNING: readonly ColorFixBatchStatus[] = ['loading', 'detecting', 'rendering', 'uploading']

class BatchDuplicate extends Error {}

class BatchCancelled extends Error {
  constructor() {
    super('已取消')
    this.name = 'BatchCancelled'
  }
}

export interface RunColorFixBatchOptions {
  /** 同时处理几张，默认 2 */
  concurrency?: number
  signal: AbortSignal
  /** 自动识别函数，默认 defaultColorFixSegmenter */
  segmenter?: ColorFixSegmenter | null
  /** 每张存好（saved）后回调（调用方据此刷新列表） */
  onSaved?: (assetId: number) => void
}

/**
 * 跑一批：只处理 status = queued 的条目（就地改 items 里的 status / message，items 传响应式数组即可驱动界面）。
 * layers = 预设里要应用的图层（preset.ts presetLayersForApply：底层 + 生效的自动识别层，不含涂抹 / 点选层）。
 */
export async function runColorFixBatch(
  items: ColorFixBatchItem[],
  layers: readonly ColorFixLayer[],
  opts: RunColorFixBatchOptions,
): Promise<void> {
  const queue = items.filter((it) => it.status === 'queued')
  const limit = Math.max(1, opts.concurrency ?? 2)
  const seg = opts.segmenter === undefined ? defaultColorFixSegmenter : opts.segmenter
  let next = 0
  const worker = async () => {
    while (next < queue.length) {
      const item = queue[next++]!
      if (opts.signal.aborted) {
        item.status = 'cancelled'
        item.message = '已取消'
        continue
      }
      await runOne(item, layers, seg, opts)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker))
}

async function runOne(
  item: ColorFixBatchItem,
  layers: readonly ColorFixLayer[],
  seg: ColorFixSegmenter | null,
  opts: RunColorFixBatchOptions,
) {
  const { signal } = opts
  const check = () => {
    if (signal.aborted) throw new BatchCancelled()
  }
  const id = item.asset.id
  try {
    if (item.asset.media && item.asset.media !== 'image') {
      item.status = 'skipped'
      item.message = '视频不能校色，已跳过'
      return
    }
    item.status = 'loading'
    item.message = '读取资产…'
    const res = await assetLibDetail(id, { pageSize: 50 })
    check()
    const asset = res.data?.asset
    const versions = res.data?.versions?.items ?? []
    if (!asset) throw new Error('资产不存在或已删除')
    const base = colorFixBaseOf(asset, versions)
    if (!base) {
      item.status = 'skipped'
      item.message = '不是图片或没有可用的图，已跳过'
      return
    }
    // 先判重（省一次识别 + 烘图）：已有同参数的校色版本 / 本会话存过
    const sig = colorFixLayersSignature(layers, base)
    if (sig && (versions.some((v) => colorFixSignatureOfVersion(v.params) === sig) || colorFixVersionSavedInSession(id, layers, base))) {
      item.status = 'duplicate'
      item.message = '已有相同参数的校色版本，未重复保存'
      return
    }

    // 自动识别层：在这张图上重新识别
    const render: ColorFixRenderLayer[] = []
    const autoCount = layers.filter((l) => !isBaseLayer(l) && layerEffective(l)).length
    let done = 0
    for (const l of layers) {
      if (!layerEffective(l)) continue
      let mask: string | null = null
      if (!isBaseLayer(l)) {
        if (l.region.mode !== 'auto') continue
        if (!seg || !colorFixSegmentSupported.value) throw new Error('当前环境不支持自动识别，无法应用选区图层')
        item.status = 'detecting'
        item.message = autoCount > 1 ? `识别选区 ${done + 1}/${autoCount}…` : '识别选区…'
        const target = l.region.target
        try {
          mask = await seg(base, target, colorFixRequestParts(target, l.region.parts), { signal })
        } catch (err) {
          check()
          const f = colorFixSegmentFailure(err, target)
          throw new Error(`「${l.name}」${f?.message ?? '识别失败'}`)
        }
        check()
        done++
      }
      render.push({
        params: { ...l.params },
        mask,
        invert: !!mask && l.region.invert,
        feather: mask ? l.region.feather : 0,
        recolor: recolorActive(l.recolor) ? { ...l.recolor } : null,
        adjust: adjustActive(l.adjust) ? cloneAdjust(l.adjust) : null,
      })
    }

    item.status = 'rendering'
    item.message = '生成校色图…'
    let commits = 0
    const r = await saveColorFixLayersVersion(
      id,
      layers,
      async (name, side) => colorFixDataUrlToFile(await colorFixRenderLayers(base, render, side), name),
      {
        sourceImage: base,
        fileName: `colorfix-asset-${id}.png`,
        existingVersions: versions,
        beforeCommit: async () => {
          check()
          item.status = 'uploading'
          item.message = '上传并保存版本…'
          if (++commits < 2 || !sig) return
          // 上传完、追加版本前再对一次最新版本：另一个标签页 / 另一次批量刚存过同参数版本时不再重复存
          try {
            const latest = await assetLibDetail(id, { pageSize: 50 })
            check()
            if (latest.data?.versions?.items?.some((v) => colorFixSignatureOfVersion(v.params) === sig)) throw new BatchDuplicate()
          } catch (err) {
            if (err instanceof BatchDuplicate || err instanceof BatchCancelled) throw err
            /* 复查读不到就按原判断继续 */
          }
        },
      },
    )
    if (r.status === 'saved') {
      item.status = 'saved'
      item.message = '已存为新版本'
      opts.onSaved?.(id)
    } else if (r.status === 'duplicate') {
      item.status = 'duplicate'
      item.message = '已有相同参数的校色版本，未重复保存'
    } else {
      item.status = 'failed'
      item.message = '没有可应用的调整'
    }
  } catch (err) {
    if (err instanceof BatchDuplicate) {
      item.status = 'duplicate'
      item.message = '已有相同参数的校色版本，未重复保存'
      return
    }
    if (err instanceof BatchCancelled || signal.aborted) {
      item.status = 'cancelled'
      item.message = '已取消'
      return
    }
    item.status = 'failed'
    item.message = failureText(err)
  }
}

function failureText(err: unknown): string {
  if (err instanceof ColorFixMaskLoadError) return err.message
  const msg = err instanceof Error ? err.message : ''
  if (msg === '图片加载失败') return '图片读取失败（可能是存储没有开跨域），未能校色'
  if (msg && /[一-龥]/.test(msg)) return msg
  return '保存失败，可稍后重试'
}
