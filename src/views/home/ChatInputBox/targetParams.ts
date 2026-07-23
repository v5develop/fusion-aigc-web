import type { PromptSlot, FileItem } from './types'

// ====== 各目标页面的首页参数模型 ======

export interface ClothingTryParams {
  imageUrls: string[]
  personUrl: string
  uploadPersonUrl: string[]
  poseUrl: string
  bgImageUrl: string
}

export interface ChangeBackgroundParams {
  imageUrls: string[]
  bgImageUrl: string
  refImageUrl: string[]
  description: string
}

export interface ClothingKitParams {
  imageUrls: string[]
  personUrl: string
  uploadPersonUrl: string[]
  aspectRatio: string
  scenePhoto: string[]
  prompt: string
}

export interface ProductKitParams {
  imageUrls: string[]
  platform: string
  region: string
  language: string
  aspectRatio: string
  buyPoint: string
}

// ====== builder ======

export function buildTargetParams(templateCode: string, slots: PromptSlot[], images: FileItem[]): Record<string, any> {
  const imageUrls = images.map((f) => f.url)

  const getUploadUrl = (key: string) => {
    const s = slots.find((s) => s.type === 'upload' && s.key === key)
    if (s?.type === 'upload') return s.value[0]?.url || ''
    return ''
  }
  /** 获取指定上传插槽是否来自模特库/模板库 */
  const getUploadFromLibrary = (key: string): boolean => {
    const s = slots.find((s) => s.type === 'upload' && s.key === key)
    if (s?.type === 'upload') return s.fromLibrary ?? true
    return true
  }
  const getUploadUrls = (key: string) => {
    const s = slots.find((s) => s.type === 'upload' && s.key === key)
    if (s?.type === 'upload') return s.value.map((f) => f.url)
    return []
  }
  const getSelectVal = (key: string) => {
    const s = slots.find((s) => s.type === 'select' && (s.key === key || s.label?.includes(key)))
    if (s?.type === 'select') return s.value
    return ''
  }
  /** 携带到目标页的提示词/描述：最后一个插槽（chip）之后、第一个逗号之后的所有内容 */
  const getPromptTail = () => {
    let lastSlotIdx = -1
    slots.forEach((s, i) => {
      if (s.type !== 'text') lastSlotIdx = i
    })
    const tail = slots
      .slice(lastSlotIdx + 1)
      .map((s) => (s.type === 'text' ? s.value : ''))
      .join('')
    // 无 chip（纯手输文本）时不做逗号截断，整段带走；尾巴无逗号时同样整段兜底
    if (lastSlotIdx < 0) return tail.trim()
    const m = /[，,]/.exec(tail)
    return (m ? tail.slice(m.index + 1) : tail).trim()
  }

  let result: Record<string, any> = {}

  switch (templateCode) {
    case '/e-commerce/clothing-try': {
      const modelUrl = getUploadUrl('modelImage')
      const isLibModel = getUploadFromLibrary('modelImage')
      result = {
        imageUrls: getUploadUrls('apparelImage').length > 0 ? getUploadUrls('apparelImage') : imageUrls,
        personUrl: isLibModel ? modelUrl : '',
        uploadPersonUrl: isLibModel ? [] : (modelUrl ? [modelUrl] : []),
        poseUrl: getUploadUrl('poseImage') || getSelectVal('poseSelect'),
        bgImageUrl: getUploadUrl('bgImage') || getSelectVal('bgSelect'),
      }
      break
    }

    case '/e-commerce/change-background': {
      // 「选择背景图」插槽只有本地上传一条路径（已直传 OSS，不能再靠 data: 前缀区分本地/素材库），
      // 统一作为参考图携带：目标页据 refImageUrl 自动切「自定义」并填入背景风格参考
      const bgUrl = getUploadUrl('background')
      result = {
        imageUrls: getUploadUrls('personImage').length > 0 ? getUploadUrls('personImage') : imageUrls,
        bgImageUrl: '',
        refImageUrl: bgUrl ? [bgUrl] : [],
        description: getPromptTail(),
      }
      break
    }

    case '/e-commerce/clothing-kit': {
      const modelUrl = getUploadUrl('modelImage')
      const isLibModel = getUploadFromLibrary('modelImage')
      result = {
        imageUrls: getUploadUrls('goodsImage').length > 0 ? getUploadUrls('goodsImage') : imageUrls,
        personUrl: isLibModel ? modelUrl : '',
        uploadPersonUrl: isLibModel ? [] : (modelUrl ? [modelUrl] : []),
        aspectRatio: getSelectVal('aspectRatio'),
        scenePhoto: slots
          .filter((s) => s.type === 'select' && s.key !== 'aspectRatio' && !!s.value)
          .map((s) => s.value) as string[],
        // 穿戴套图无「自定义描述」输入框，首页不携带 prompt；
        // 否则模板固定文案会被当作场景混入 scenePhoto
        prompt: '',
      }
      break
    }

    case '/e-commerce/product-kit':
      result = {
        imageUrls: getUploadUrls('productImage').length > 0 ? getUploadUrls('productImage') : imageUrls,
        platform: getSelectVal('platform'),
        region: getSelectVal('region'),
        language: getSelectVal('language'),
        aspectRatio: getSelectVal('aspectRatio'),
        buyPoint: getPromptTail(),
      }
      break
  }
  return result
}
