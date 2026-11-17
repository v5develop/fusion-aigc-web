import OSS from 'ali-oss'
import { getSts, uploadConfirm } from '@/api/methods.ts'
import { compressImages } from '@/utils/image-compress.ts'

/**
 * 上传文件到 OSS。图片会先压质量再上传（尺寸不变，详见 utils/imageCompress），
 * 视频与非图片文件原样上传。
 * @param options.compress 传 false 可跳过压缩（不能塞进 config，config 会被透传给 getSts）
 * @param options.onProgress 进度回调（0~1，按单个文件上传量折算；多文件时取各文件平均）。仅 > 10MB 的分片上传有细粒度进度，
 *   小文件 / 退回 put 时只在完成后回报 1
 * @param options.signal 中止信号：中止后抛 AbortError（name === 'AbortError'）
 */
export interface UploadOptions {
  compress?: boolean
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

/** 超过该大小改走分片上传（1MB 分片 / 并发 3），断点存内存，同页面内重试可续传 */
const MULTIPART_THRESHOLD = 10 * 1024 * 1024
/** 同页面内的断点：key = objectKey 无法复用（每次 getSts 新 key），所以按文件指纹存 */
const checkpoints = new Map<string, any>()
const fingerprint = (f: File) => `${f.name}|${f.size}|${f.lastModified}`

function abortError() {
  const e = new Error('上传已取消')
  e.name = 'AbortError'
  return e
}

export async function upload(files: File[], config?: any, options?: UploadOptions) {
  const targets = options?.compress === false ? files : await compressImages(files)

  const { onProgress, signal } = options ?? {}
  if (signal?.aborted) throw abortError()
  const fractions = targets.map(() => 0)
  const report = (i: number, v: number) => {
    fractions[i] = v
    onProgress?.(fractions.reduce((a, b) => a + b, 0) / fractions.length)
  }

  const promises = []
  for (const [idx, file] of targets.entries()) {
    const fn = async () => {
      const { data } = await getSts({
        fileName: file.name,
        contentType: file.type,
        fileSize: file.size,
        ...config,
      })

      const client = new OSS({
        region: data.region,
        accessKeyId: data.accessKeyId,
        accessKeySecret: data.secretAccessKey,
        bucket: data.bucket,
        stsToken: data.sessionToken,
        endpoint: data.endpoint,
        refreshSTSToken: async () => {
          const { data } = await getSts({
            fileName: file.name,
            contentType: file.type,
            fileSize: file.size,
            ...config,
          })
          return {
            accessKeyId: data.accessKeyId,
            accessKeySecret: data.secretAccessKey,
            stsToken: data.sessionToken,
          }
        },
        refreshSTSTokenInterval: 300000,
      })

      if (file.size > MULTIPART_THRESHOLD) {
        const fp = fingerprint(file)
        let cancelled = false
        const onAbort = () => {
          cancelled = true
          // cancel() 会让进行中的分片请求以 cancel 错误结束
          ;(client as any).cancel?.()
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        try {
          await client.multipartUpload(data.objectKey, file, {
            partSize: 1024 * 1024,
            parallel: 3,
            checkpoint: checkpoints.get(fp),
            progress: (p: number, cpt: any) => {
              if (cpt) checkpoints.set(fp, cpt)
              report(idx, p)
            },
          })
          checkpoints.delete(fp)
        } catch (err) {
          if (cancelled || signal?.aborted) throw abortError()
          // 分片接口异常（含桶 CORS 未暴露 ETag）：退回一次普通 put（无进度），不再续用旧断点
          checkpoints.delete(fp)
          console.warn(
            '[oss-upload] 分片上传失败，已退回普通上传（无进度）。如持续出现，请检查 OSS 桶 CORS 是否配置 ExposeHeaders: ETag。',
            err,
          )
          if (signal?.aborted) throw abortError()
          await client.put(data.objectKey, file)
        } finally {
          signal?.removeEventListener('abort', onAbort)
        }
      } else {
        await client.put(data.objectKey, file)
      }
      if (signal?.aborted) throw abortError()
      report(idx, 1)
      await uploadConfirm({ objectKey: data.objectKey })
      return data.url
    }
    promises.push(fn)
  }

  return await Promise.all(promises.map((f) => f()))
}
