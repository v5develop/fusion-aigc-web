import { nextTick } from 'vue'
import {
  entryCodeVal2Label,
  modelVal2Label,
  ratioVal2Label,
  durationVal2Label,
  ratioOps,
  durationOps,
  modelOps,
  config,
} from './constants.ts'
import { ensureModelCatalog, videoModelOpsFor } from '@/utils/model-catalog'
import { originalImagesOf, promptOf } from '@/utils/same-style'
import type { ISameStyleRecipe } from '@/api/types'

/**
 * 素材尺寸是否不一致：同一任务多产出的 (resolution,ratio) 有多种取值时为 true。
 * 用于角标去重——同尺寸由顶部元信息行统一展示、不再逐张打角标；仅尺寸不一致时才逐张标注。
 */
export const isMixedSize = (contents: any[] = []): boolean => {
  const withSize = (contents ?? []).filter((c) => c && (c.resolution || c.ratio))
  if (withSize.length <= 1) return false
  const key = (c: any) => `${c.resolution ?? ''}|${c.ratio ?? ''}`
  const first = key(withSize[0])
  return withSize.some((c) => key(c) !== first)
}

/**
 * 归一化历史记录的 inputParams 为视频 submit 入参，供「再次生成」复用。
 * 历史 inputParams 存在两种结构：
 *  1) 本站 submit 结构：{ type, entryCode, modelCode, params:{prompt,resolution,aspectRatio,duration}, images, video }
 *  2) 端上/agent 来源(source=aigc_chat)：{ scene, prompt, imageUrls, videoUrls, modelCode, params:{} }（无 entryCode）
 * 若不归一化，直接回传结构 2 会被后端拒绝：「创作场景(entryCode)不能为空」。
 */
export const buildResubmitParams = (item: any) => {
  const src = item?.inputParams ?? {}
  const p = src.params ?? {}
  const images: string[] = src.images ?? src.imageUrls ?? []
  const video: string = src.video ?? (src.videoUrls ?? [])[0] ?? ''
  const first = (item?.contents ?? [])[0] ?? {}
  // 结构 2 无 entryCode：按有无输入图兜底推断（多数记录已带 entryCode，走原值）
  const entryCode = src.entryCode ?? (images.length ? 'imageToVideo' : 'textToVideo')
  const isActionTransfer = entryCode === 'actionTransfer'
  return {
    type: 'VIDEO',
    entryCode,
    modelCode: src.modelCode ?? 'xiaoqi-video-1.0-lite',
    params: {
      prompt: p.prompt ?? src.prompt ?? '',
      // size 由请求入口按 aspectRatio 统一推导；动作迁移无画幅、入口不注入（与首次生成一致）
      // 动作迁移由参考视频决定画幅/时长，不传比例/分辨率/时长
      ...(isActionTransfer
        ? {}
        : {
            resolution: p.resolution,
            aspectRatio: p.aspectRatio ?? p.ratio ?? first.ratio,
            duration: p.duration,
          }),
    },
    images,
    // 动作迁移才带输入视频
    video: isActionTransfer ? video : '',
  }
}

/**
 * 视频任务元信息：能力 | 模型 | 画幅 | 分辨率 | 时长。入参为整条历史 item（含 inputParams + contents）。
 * 画幅/分辨率权威来源是实际生成的素材(content.ratio/resolution，后端已返回)，缺失才回退请求入参；
 * 能力/模型/时长为请求侧属性，取自 inputParams。防御式取值：缺字段/未知映射的段留空，仅拼接非空段，
 * 避免渲染出 "undefined | undefined" 或多余分隔符。
 */
export const getMetaData = (item: any) => {
  const params = item?.inputParams ?? {}
  const p = params.params ?? {}
  const content = (item?.contents ?? [])[0] ?? {}
  const segs = [
    entryCodeVal2Label[params.entryCode],
    modelVal2Label[params.modelCode],
    // 画幅/分辨率优先取实际素材(content)，缺失回退请求入参
    content.ratio ?? ratioVal2Label[p.aspectRatio] ?? p.aspectRatio,
    content.resolution ?? p.resolution,
    durationVal2Label[p.duration] ?? (p.duration != null ? `${p.duration}s` : undefined),
  ]
  return segs.filter((s) => s != null && s !== '').join(' | ')
}

const inOps = (list: { value: any }[] | undefined, v: any) => !!list?.some((o) => o.value === v)

/**
 * 把做同款配方回填进视频页表单。
 *
 * <p>顺序是有讲究的：页面上挂着两条会反向改写表单的 watch——「场景 → 模型」「模型 → 档位」，
 * 另有一条切场景时清空/截断 images 的。配方是异步到的，那会儿它们早跑过一轮，
 * 一次性平铺赋值会被它们按旧模型的可选集覆盖掉，所以中间必须让出一个 tick。
 *
 * @param formData  页面表单（就地改）
 * @param recipe    /asset/public/same-style 返回的三段配方
 * @param entryCode 已过白名单校验的创作场景
 */
export const applySameStyleRecipe = async (
  formData: any,
  recipe: ISameStyleRecipe,
  entryCode: string,
  isCurrent: () => boolean = () => true,
) => {
  const req = recipe.submit?.request ?? {}
  const p = req.params ?? {}

  formData.entryCode = entryCode
  formData.prompt = promptOf(req)

  // 模型表是异步的，首屏是空数组；在空表上判「不合法」会把合法模型也误伤
  await ensureModelCatalog().catch(() => {})
  // 让出过控制权，期间可能已经切到另一条配方
  if (!isCurrent()) return
  const ops = videoModelOpsFor(entryCode)
  // 不合法就别写，留给页面那条对齐 watch 回退到该场景的首个模型
  if (typeof req.modelCode === 'string' && ops.some((m) => m.value === req.modelCode)) {
    formData.modelCode = req.modelCode
  }

  // 等上述 watch 各跑一轮（模型对齐、档位纠正、切场景清图）再写档位与素材
  await nextTick()
  if (!isCurrent()) return

  const model = modelOps.find((m) => m.value === formData.modelCode)
  const ratio = String(p.aspectRatio ?? p.ratio ?? '')
  if (inOps(model?.ratioOps?.length ? model.ratioOps : ratioOps, ratio)) formData.ratio = ratio
  const resolution = String(p.resolution ?? '')
  if (inOps(model?.resolutionOps, resolution)) formData.resolution = resolution
  const duration = Number(p.duration)
  if (inOps(model?.durationOps?.length ? model.durationOps : durationOps, duration)) formData.duration = duration

  // submit.request 里的用户素材已被后端清空（隐私红线），原作输入图只在 original.request 里。
  // 产品口径是直接回填原作图、允许用户删改或原样提交，与 App 端一致。
  // 只有收图的场景才回填：文生视频的上传区是隐藏的（页面也会在切场景时清空 images），
  // 这里再塞回去，用户看不见也删不掉，却会一路带进询价与提交。
  // 注意不能拿 config.imageLimit 当判据——textToVideo 身上还留着一个没用的 imageLimit: 5。
  const limit = entryCode === 'textToVideo' ? 0 : (config[entryCode]?.imageLimit ?? 0)
  formData.images = limit ? originalImagesOf(recipe.original?.request).slice(0, limit) : []
}
