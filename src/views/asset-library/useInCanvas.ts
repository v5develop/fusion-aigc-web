/**
 * 资产「用于画布」（对齐原型 5185 资产详情的「用于画布」）：新建一张画布，把图片 / 视频地址一次性交给编辑器，
 * 编辑器首次加载完逐个建图片节点 / 视频素材节点并自动保存（见 utils/canvasImportHandoff.ts）。
 * 新建画布接口只收 title、带不了初始快照，所以和智能体「在画布中打开」走同一条交接。
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { toApiError } from '@/api'
import { canvasCreate } from '@/api/canvas-home.ts'
import { stashCanvasImport } from '@/utils/canvas-import-handoff.ts'

export interface ICanvasAssetRef {
  media: string
  image?: string | null
  video_url?: string | null
  title?: string | null
}

/** 一次最多带进画布的素材数：节点横排铺开，太多一屏看不过来，也拖慢首次自动保存 */
export const CANVAS_IMPORT_LIMIT = 20

function isHttp(u: string | null | undefined): u is string {
  return typeof u === 'string' && /^https?:\/\//i.test(u)
}

export function useAssetsInCanvas() {
  const router = useRouter()
  const message = useMessage()
  const opening = ref(false)

  async function openAssetsInCanvas(assets: ICanvasAssetRef[]) {
    if (opening.value) return
    const picked = assets.slice(0, CANVAS_IMPORT_LIMIT)
    const urls = picked
      .filter((a) => a.media !== 'video')
      .map((a) => a.image)
      .filter(isHttp)
    const videos = picked
      .filter((a) => a.media === 'video')
      .map((a) => a.video_url)
      .filter(isHttp)
    if (!urls.length && !videos.length) {
      message.warning('这些素材没有可用的文件地址，无法用于画布')
      return
    }
    if (assets.length > CANVAS_IMPORT_LIMIT)
      message.info(`一次最多带 ${CANVAS_IMPORT_LIMIT} 个素材进画布，已取前 ${CANVAS_IMPORT_LIMIT} 个`)
    opening.value = true
    let navigated = false
    try {
      const title = picked.length === 1 ? picked[0]!.title?.trim() : ''
      const res = await canvasCreate(title ? { title } : {})
      const id = res.data?.id
      if (!id) throw new Error('创建画布失败，请稍后重试')
      stashCanvasImport({ canvasId: id, urls, videos })
      // 等跳转完成再放开 opening：跳转期间连点不会再建第二张画布
      // push 被拦下 / 取消时返回 NavigationFailure 而不抛：这时放开按钮
      const failure = await router.push({ name: 'canvas-editor', params: { id } })
      navigated = !failure
    } catch (err) {
      // 业务失败（code≠0）请求层已 toast，这里只补传输层失败与无 id 的情况
      const apiErr = toApiError(err)
      if (apiErr && apiErr.code !== -1 && !apiErr.httpStatus) return
      // 传输层失败的原始文案多是英文（Network Error / timeout…），只在是中文时展示
      const msg = apiErr?.message
      message.error(msg && /[\u4e00-\u9fa5]/.test(msg) ? msg : '创建画布失败，请稍后重试')
    } finally {
      // 跳转成功后本页即将卸载，保持 opening=true 防止卸载前的再次点击
      if (!navigated) opening.value = false
    }
  }

  return { opening, openAssetsInCanvas }
}
