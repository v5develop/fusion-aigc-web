export interface ApiResponse<T = any> {
  code: number
  msg: string
  data: T
}

export interface IGetSts {
  // 子目录路径（可选值：uploads=通用上传(默认), images=图片, videos=视频, audios=音频）
  subDir?: 'uploads' | 'images' | 'videos' | 'audios'
  fileName: string // 文件名称
  contentType: string // 文件MIME
  fileSize: number // 文件大小
  visibility?: 'public' | 'visible' // 可见性（可选值：public=公开桶（默认） private=私有桶）
}

export interface IAssetAll {
  type: string // customizedmodel:本地local上传, realpersonmodel:豆包验证库
}

export interface IFaceRecognition {
  modelCode: string
  imageUrls: string[]
}

export interface IPublicTemplate {
  bizType?: 'ecommerce' // 业务域
  moduleCode: string // 跟生成接口的type传一样的值
  // 页面区块，model：默特库， tryOnTemplate：试衣模板库， background：背景库， shoeTemplate：鞋库， gestures：手持姿势库
  slotCode?: 'model' | 'tryOnTemplate' | 'background' | 'shoeTemplate' | 'gestures'
  type?: 'image' | 'video' // 素材类型：image/video
  filters?: any // 下拉项code
  page?: number
  pageSize?: number // 每页数量，上限 100
}

export interface ICreationSubmit {
  type: 'IMAGE' // IMAGE：图片  VIDEO：视频
  entryCode: 'imageToImage' | 'textToImage'
  modelCode: string
  params: {
    prompt?: string
    width: number
    height: number
    num?: number
  }
  images?: string[]
}
