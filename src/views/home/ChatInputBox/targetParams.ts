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
  const getTextVal = () => {
    const s = slots.find((s) => s.type === 'text' && !!s.value)
    return (s as any)?.value || ''
  }
  /** 取最后一个 text 插槽的值，用于"选择场景图"之后的文案 */
  const getLastTextVal = () => {
    const texts = slots.filter((s) => s.type === 'text' && !!s.value)
    const last = texts[texts.length - 1]
    if (!last) return ''
    return (last as any).value?.replace(/^[，, ]+/, '') || ''
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
      const bgUrl = getUploadUrl('background')
      const isLibBg = getUploadFromLibrary('background')
      result = {
        imageUrls: getUploadUrls('personImage').length > 0 ? getUploadUrls('personImage') : imageUrls,
        bgImageUrl: isLibBg ? bgUrl : (getSelectVal('background')),
        refImageUrl: isLibBg ? [] : (bgUrl ? [bgUrl] : []),
        description: getLastTextVal(),
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
        prompt: getTextVal(),
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
        buyPoint: getTextVal(),
      }
      break
  }
  return result
}
