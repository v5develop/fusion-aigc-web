export interface ApiResponse<T = any> {
  code: number
  msg: string
  data: T
}

export interface IGetSts {
  subDir?: 'uploads' | 'images' | 'videos' | 'audios' // 子目录路径（可选值：uploads=通用上传(默认), images=图片, videos=视频, audios=音频）
  fileName: string // 文件名称
  contentType: string // 文件MIME
  fileSize: number // 文件大小
  visibility?: 'public' | 'visible' // 可见性（可选值：public=公开桶（默认） private=私有桶）
}
