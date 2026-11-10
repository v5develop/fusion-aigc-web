/**
 * 资产页的「删除素材」与「未分类」筛选（对齐原型 5185 AssetsView：deleteSelected / deleteCurrent / __uncat__）。
 *
 * <p>单独成文件，只在 index.vue 里挂几处接线，避免和页面布局改动互相覆盖。
 * 后端：Go 资产库 DELETE /assets/:id、POST /assets/batch-delete（逻辑删除 + 解除标签，不删存储、不影响任务结果）；
 * 官方素材后端也会拒删（单删 2005 / 批量静默跳过），这里先在前端把它们排除并在确认语里说明。
 */
import { ref } from 'vue'
import { useDialog, useMessage } from 'naive-ui'
import { assetLibBatchDelete, assetLibDelete } from '@/api/asset-library.ts'
import { toApiError } from '@/api/index.ts'
import type { IAssetLibAsset } from '@/api/asset-library.ts'
import { removeRecentAssets } from '@/utils/asset-recent.ts'

/** 标签筛选里「未分类」的哨兵值（filters.tag 取它时列表改发 untagged=true） */
export const UNTAGGED_TAG = '__uncat__'

/** 标签筛选值 → 列表参数（tag 与 untagged 互斥） */
export function tagListParams(tag: string): { tag?: string; untagged?: boolean } {
  if (!tag) return {}
  return tag === UNTAGGED_TAG ? { untagged: true } : { tag }
}

/** 标签筛选值的展示名 */
export function tagFilterLabel(tag: string) {
  return tag === UNTAGGED_TAG ? '未分类' : tag
}

/** 官方素材只能打标签，不能删 */
export const canDeleteAsset = (asset: IAssetLibAsset | undefined | null) => !!asset && asset.source !== 'official'

/** 后端一次最多 100 个 */
const BATCH_MAX = 100

export function useAssetDelete(opts: {
  /** id → 资产快照（已选跨页保留时从快照里取） */
  resolve: (id: number) => IAssetLibAsset | undefined
  /** 删除成功后（ids = 实际删掉的） */
  onDeleted: (ids: number[]) => void
}) {
  const dialog = useDialog()
  const message = useMessage()
  const deleting = ref(false)

  /** 选中里要发给后端的 id：只排除已确认是官方素材的；没有快照的（跨页已选等）交给后端裁决 */
  function deletableOf(ids: number[]) {
    return ids.filter((id) => {
      const a = opts.resolve(id)
      return !a || canDeleteAsset(a)
    })
  }
  /** 已确认是官方素材的 id 数 / 没有快照、无法确认身份的 id 数 */
  function countOf(ids: number[]) {
    let official = 0
    let unknown = 0
    for (const id of ids) {
      const a = opts.resolve(id)
      if (!a) unknown++
      else if (!canDeleteAsset(a)) official++
    }
    return { official, unknown }
  }

  /** 删除成功后统一收口：先把「最近」里的已删素材剔掉，再通知页面 */
  function notifyDeleted(ids: number[]) {
    if (!ids.length) return
    const urls = ids.flatMap((id) => {
      const a = opts.resolve(id)
      return a ? [a.image, a.videoUrl] : []
    })
    removeRecentAssets(ids, urls)
    opts.onDeleted(ids)
  }

  /** 分块删除；某块失败时把已删掉的 id 挂在 error 上，调用方仍要同步它们 */
  async function runBatch(ids: number[], deleted: number[], skip: { official: number; missing: number }) {
    for (let i = 0; i < ids.length; i += BATCH_MAX) {
      const res = await assetLibBatchDelete(ids.slice(i, i + BATCH_MAX))
      deleted.push(...(res.data?.deletedIds ?? []))
      skip.official += res.data?.officialSkipped ?? 0
      skip.missing += res.data?.missing ?? 0
    }
  }

  /** 选择条「删除」：官方素材不删，确认语里说明跳过几个 */
  function confirmDeleteSelected(ids: number[]) {
    if (!ids.length || deleting.value) return
    const deletable = deletableOf(ids)
    const { official: officialKnown, unknown } = countOf(ids)
    if (!deletable.length) {
      message.info('选中的都是官方素材，不可删除，可以只用它们打标签')
      return
    }
    dialog.warning({
      title: '删除素材',
      content: `删除选中的 ${deletable.length} 个素材？${officialKnown ? `另有 ${officialKnown} 个官方素材不会删除。` : ''}${unknown ? `其中 ${unknown} 个不在当前列表里，将由服务器核对后再删。` : ''}此操作不可撤销。`,
      positiveText: '删除',
      negativeText: '取消',
      onPositiveClick: async () => {
        deleting.value = true
        const deleted: number[] = []
        const skip = { official: officialKnown, missing: 0 }
        let failed: string | null = null
        try {
          await runBatch(deletable, deleted, skip)
          const notes = [
            skip.official ? `跳过 ${skip.official} 个官方素材` : '',
            skip.missing ? `${skip.missing} 个已不存在或不属于你` : '',
          ].filter(Boolean)
          message.success(`已删除 ${deleted.length} 个素材${notes.length ? `，${notes.join('，')}` : ''}`)
        } catch (e) {
          // 批量删除是静默接口（请求层不弹），这里合并成一条：失败原因 + 已删几个；已删掉的块仍要同步到页面
          const err = toApiError(e)
          failed = (err && !err.isNetwork && err.message) || '网络异常，请稍后重试'
        } finally {
          notifyDeleted(deleted)
          if (failed) {
            if (deleted.length) message.warning(`部分删除失败：已删除 ${deleted.length} 个，其余未删除（${failed}）`)
            else message.error(`删除失败：${failed}`)
          }
          deleting.value = false
        }
      },
    })
  }

  /**
   * 单个删除（详情底部「删除」用的钩子：DetailModal 可直接调它，成功后自行关闭详情）。
   * 返回 Promise<boolean>：true = 已删除。
   */
  function confirmDeleteOne(asset: IAssetLibAsset): Promise<boolean> {
    if (!canDeleteAsset(asset)) {
      message.info('官方素材不可删除')
      return Promise.resolve(false)
    }
    return new Promise((resolve) => {
      dialog.warning({
        title: '删除素材',
        content: `删除「${asset.title || '未命名素材'}」？此操作不可撤销。`,
        positiveText: '删除',
        negativeText: '取消',
        onPositiveClick: async () => {
          deleting.value = true
          try {
            await assetLibDelete(asset.id)
            message.success('已删除素材')
            notifyDeleted([asset.id])
            resolve(true)
          } catch {
            resolve(false)
          } finally {
            deleting.value = false
          }
        },
        onNegativeClick: () => resolve(false),
        // Esc / 遮罩 / 右上角关闭都会走到离场；resolve 幂等，确认成功时已先 resolve(true)
        onAfterLeave: () => resolve(false),
      })
    })
  }

  return { deleting, deletableOf, confirmDeleteSelected, confirmDeleteOne }
}
