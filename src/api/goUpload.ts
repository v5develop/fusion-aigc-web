/**
 * 直传到对象存储（预签名 PUT），返回可直接传给业务接口的公有地址。
 *
 * <p>studio（/api/v1/studio）与资产库（/api/v1/asset-library）只接受「本服务签发的地址」，
 * 这些地址的白名单由运维配置在 STUDIO_INPUT_URL_PREFIXES（两边共用）。
 * 上传走 Java 客户端直传接口：presign → PUT → confirm，取 visibility=public 的地址。
 */
import { post } from './index.ts'

/** Java 直传 presign 的返回（DirectUploadPresignRespVO） */
interface IDirectPresign {
  uploadUrl: string
  method: string
  headers?: Record<string, string>
  objectKey: string
  url?: string
  expiresAt?: number
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/** 上传一张图片（≤10M），返回可直接传给业务接口的公有地址 */
export async function goUploadImage(file: File): Promise<string> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error('图片不能超过 10M')
  }
  const contentType = file.type || 'image/jpeg'
  const pre = await post<IDirectPresign>('/api/v1/storage/direct/presign', {
    subDir: 'images',
    fileName: file.name,
    contentType,
    fileSize: file.size,
    visibility: 'public',
  })
  const presign = pre.data
  if (!presign?.uploadUrl || !presign.objectKey) {
    throw new Error('获取上传凭证失败')
  }
  // 按返回的 headers 原样携带（含 Content-Type），与签名时保持一致
  const headers = presign.headers ?? { 'Content-Type': contentType }
  const put = await fetch(presign.uploadUrl, { method: 'PUT', body: file, headers })
  if (!put.ok) {
    throw new Error('图片上传失败')
  }
  const confirmed = await post<{ url: string }>('/api/v1/storage/direct/confirm', {
    objectKey: presign.objectKey,
  })
  const url = confirmed.data?.url
  if (!url) {
    throw new Error('上传确认失败')
  }
  return url
}
