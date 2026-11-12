/**
 * 节点菜单「存为资产」：把用户自己的图片节点（上传的输入图）存进资产库。
 *
 * <p>只对用户内容开放：生成结果（kind=result / 模型·工具节点的候选）本来就由服务端自动入素材库，
 * 从素材库挑进来的图（带 assetId）本来就在资产库里，这些都不显示入口。归属 / 去重 / 校验全在服务端
 * （POST /api/v1/asset-library/assets/from-url）：只认本人上传的图，按内容幂等，重复点击返回已有资产。
 */
import { assetLibCreateFromUrl } from '@/api/asset-library.ts'
import { toApiError } from '@/api/index.ts'
import { editorMessage } from './useCanvasEditor.ts'
import { hasTransientMedia } from './library-status.ts'
import type { CanvasEditorNode } from './types.ts'

/** 只有 http(s) 地址能让服务端取图；dataURL / blob 要先上传换地址 */
function isRemoteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/** 该节点是否提供「存为资产」：用户上传的输入图，且不是已在资产库里的图 */
export function canSaveNodeAsAsset(node: CanvasEditorNode): boolean {
  const d = node.data
  if (node.type !== 'image' || d.kind !== 'input') return false
  if (!d.image || !isRemoteUrl(d.image)) return false
  // 从素材库选进来的图（assetId）本来就在资产库；产物转存中 / 失败的是现签地址
  if (d.assetId || hasTransientMedia(d)) return false
  return true
}

/** 资产标题：节点标题（空则交给服务端默认），超长截断到 100 字 */
function titleOf(node: CanvasEditorNode): string | undefined {
  const t = (node.data.title || '').trim()
  return t ? Array.from(t).slice(0, 100).join('') : undefined
}

/**
 * 存为资产并提示。返回是否成功（已存在也算成功）。
 * 业务失败的提示由全局拦截器弹后端原话（已是面向用户的中文），这里只补网络失败。
 */
export async function saveNodeAsAsset(node: CanvasEditorNode, canvasId: string): Promise<boolean> {
  const url = node.data.image
  if (!url || !canSaveNodeAsAsset(node)) {
    editorMessage.warning('这个节点的图片暂时不能存为资产')
    return false
  }
  try {
    const res = await assetLibCreateFromUrl({
      url,
      title: titleOf(node),
      source: 'canvas',
      canvasId: canvasId || undefined,
      nodeId: node.id,
    })
    if (res.data.existing) editorMessage.info('已在资产库中')
    else editorMessage.success('已存入资产库')
    return true
  } catch (err) {
    const apiErr = toApiError(err)
    if (!apiErr || apiErr.isNetwork || apiErr.code === -1) editorMessage.error('保存失败，请检查网络后重试')
    return false
  }
}
