/**
 * 广场 / 落地页「做同款」统一出口：
 * - 视频模板：智能体对话不出视频，按 videoHandoff 规则预填并去「生成视频」页；
 * - 图片模板：暂存整条模板，跳 /agent?plazaTemplateId=<id>（智能体页走同一条 pickTemplate 路径，匿名也能进，发送时才要登录）。
 * 只读复用 views/agent 里导出的函数，不改那边的文件。
 */
import type { Router } from 'vue-router'
import { stashPlazaTemplate, type IPlazaTemplate } from '@/api/plaza.ts'
import { isVideoTemplate } from '@/views/agent/templateMedia.ts'
import { stashVideoPrefill, videoPrefillOf } from '@/views/agent/industry/videoHandoff.ts'

export function replicateTemplate(router: Router, t: IPlazaTemplate) {
  if (isVideoTemplate(t)) {
    stashVideoPrefill(videoPrefillOf(t))
    void router.push({ name: 'video-generate' })
    return
  }
  stashPlazaTemplate(t)
  void router.push({ name: 'agent', query: { plazaTemplateId: String(t.plazaTemplateId) } })
}
