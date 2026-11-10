import { entryCodeVal2Label, modelVal2Label, numOps } from './constants.ts'
import { imageRatioOps, ratioLabel } from '@/utils/ratio'
import { ensureModelCatalog, imageModelOps } from '@/utils/model-catalog'
import { originalImagesOf, promptOf } from '@/utils/same-style'
import type { ISameStyleRecipe } from '@/api/types'

/** 图片页输入图上限，与模板里 ChatInputBox 的 :imageLimit 保持一致 */
const IMAGE_LIMIT = 3

/**
 * 归一化历史记录的 inputParams 为图片 submit 入参，供「再次生成」复用。
 * 历史 inputParams 存在两种结构：
 *  1) 本站 submit 结构：{ type, entryCode, modelCode, params:{prompt,width,height,num}, images }
 *  2) 端上/agent 来源(source=aigc_chat)：{ scene, prompt, imageUrls, modelCode, params:{} }（无 entryCode）
 * 若不归一化，直接回传结构 2 会被后端拒绝：「创作场景(entryCode)不能为空」。
 * 尺寸缺失时回退到已生成素材 contents[0] 的宽高，尽量还原原始画幅。
 * @param single 单张再次生成时强制只出 1 张；否则沿用原任务数量
 */
export const buildResubmitParams = (item: any, single = false) => {
  const src = item?.inputParams ?? {}
  const p = src.params ?? {}
  const images: string[] = src.images ?? src.imageUrls ?? []
  const first = (item?.contents ?? [])[0] ?? {}
  // 结构 2 无 entryCode：图片仅两种能力，按有无输入图推断
  const entryCode = src.entryCode ?? (images.length ? 'imageToImage' : 'textToImage')
  return {
    type: 'IMAGE',
    entryCode,
    modelCode: src.modelCode ?? 'xiaoqi-image-1.0-flash',
    params: {
      prompt: p.prompt ?? src.prompt ?? '',
      width: p.width ?? first.width ?? 1024,
      height: p.height ?? first.height ?? 1024,
      // size 由请求入口按 width/height 统一推导，页面/工具层不再手动传
      // 单张固定 1 张；整批沿用原数量，缺失则按已生成素材数兜底
      num: single ? 1 : (p.num ?? (item?.contents?.length || 1)),
    },
    images,
  }
}

/** 记录是否来自 aigc_chat（端上/agent 来源）：这类素材隐藏「重新生成/再次生成」入口 */
export const isFromAigcChat = (item: any): boolean => item?.inputParams?.source === 'aigc_chat'

export const showDownloadBtn = (item: any) => {
  // 仅当存在生成成功(status===2)的素材时才显示「全部下载」
  const urls = item.contents.filter((c: any) => c.resultUrl && c.status === 2)

  return urls.length
}

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
 * 任务元信息展示：能力名 | 模型 | 画幅比例。入参为整条历史 item（含 inputParams + contents）。
 * 画幅比例权威来源是实际生成的素材(content.ratio，后端已返回)，缺失才回退请求入参尺寸映射/约分。
 * 防御式取值：缺字段/未知映射不再渲染 "undefined | undefined"，仅拼接非空段。
 */
export const getMetaData = (item: any) => {
  const params = item?.inputParams ?? {}
  const content = (item?.contents ?? [])[0] ?? {}
  const entryLabel = entryCodeVal2Label[params.entryCode] ?? ''
  // 未知 modelCode（如端上来源）不展示，避免渲染出原始码值
  const modelLabel = modelVal2Label[params.modelCode] ?? ''
  // 画幅优先取素材 content.ratio；无则按请求尺寸精确映射(ratioOps)或 gcd 约分兜底
  const rLabel = content.ratio ?? ratioLabel(params.params?.width, params.params?.height)
  return [entryLabel, modelLabel, rLabel].filter(Boolean).join(' | ')
}

/**
 * 后端配方的画幅 → 页面 ratio（"宽,高" 像素串）。
 * 图片页存的是像素串而不是比例串，所以要反查 imageRatioOps；查不到就不回填、
 * 让页面停在自己的默认值，别把非标准尺寸写进下拉。
 */
const pickImageRatio = (p: any): string => {
  const w = Number(p?.width)
  const h = Number(p?.height)
  if (w > 0 && h > 0) {
    const exact = imageRatioOps.find((o) => o.value === `${w},${h}`)
    if (exact) return exact.value
    const byLabel = imageRatioOps.find((o) => o.label === ratioLabel(w, h))
    if (byLabel) return byLabel.value
  }
  const bySize = imageRatioOps.find((o) => o.label === String(p?.size ?? p?.ratio ?? ''))
  return bySize?.value ?? ''
}

/**
 * 把做同款配方回填进图片页表单。
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
  // 图片模型下拉没有按场景过滤，且 ChatInputSelect 的自纠 watch 对 imageModelOps
  // （就地 splice 的同一个 reactive 引用，getter 恒等）不触发。后台已停用的模型回显进来，
  // UI 会显示「请选择」、询价与提交则报「无法匹配计费档位」，只能自己校验一次。
  if (typeof req.modelCode === 'string' && imageModelOps.some((m) => m.value === req.modelCode)) {
    formData.modelCode = req.modelCode
  }

  const ratio = pickImageRatio(p)
  if (ratio) formData.ratio = ratio

  const num = Number(p.num)
  if (numOps.some((o) => o.value === num)) formData.num = num

  // submit.request 里的用户素材已被后端清空（隐私红线），原作输入图只在 original.request 里。
  // 产品口径是直接回填原作图、允许用户删改或原样提交，与 App 端一致。
  // 只有收图的场景才回填：文生图的上传区是隐藏的，塞了图用户看不见也删不掉，却会一路带进询价与提交。
  formData.images = entryCode === 'imageToImage' ? originalImagesOf(recipe.original?.request).slice(0, IMAGE_LIMIT) : []
}
