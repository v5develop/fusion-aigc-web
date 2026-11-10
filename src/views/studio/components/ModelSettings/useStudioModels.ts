/**
 * 商拍工作室模型档能力（GET /api/v1/studio/models）：每个模型档实际支持的分辨率 / 比例。
 *
 * <p>按 kind 缓存在模块里（三页共用、整页生命周期只拉一次）；接口不存在或失败时返回 null，
 * 调用方回退到 constants.ts 的写死选项（MODEL_OPTIONS / RESOLUTION_OPTIONS / ASPECT_RATIO_OPTIONS）。
 */
import { shallowRef, type ShallowRef } from 'vue'
import { studioModels } from '@/api/studio.ts'
import type { StudioKind, StudioModelCapability } from '@/api/studioTypes.ts'
import { normalizeModelTier } from '@/utils/modelLabel'

const cache = new Map<StudioKind, ShallowRef<StudioModelCapability[] | null>>()
const inflight = new Map<StudioKind, Promise<void>>()

export function useStudioModels(kind: StudioKind): ShallowRef<StudioModelCapability[] | null> {
  let state = cache.get(kind)
  if (!state) {
    state = shallowRef<StudioModelCapability[] | null>(null)
    cache.set(kind, state)
  }
  const target = state
  if (!target.value && !inflight.has(kind)) {
    const p = studioModels({ kind })
      .then((res) => {
        // 后端过渡期仍可能下发旧档位码：归一后再参与比较与传值
        const items = (res.data?.items ?? []).map((c) => ({ ...c, code: normalizeModelTier(c.code) }))
        target.value = items.length ? items : null
      })
      .catch(() => {
        // 接口未上线 / 失败：保持 null，用前端兜底选项
      })
      .finally(() => inflight.delete(kind))
    inflight.set(kind, p)
  }
  return target
}
