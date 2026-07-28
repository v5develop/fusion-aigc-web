import OSS from 'ali-oss'
import { getSts, uploadConfirm } from '@/api/methods.ts'
import { compressImages } from '@/utils/imageCompress.ts'

/**
 * 上传文件到 OSS。图片会先压质量再上传（尺寸不变，详见 utils/imageCompress），
 * 视频与非图片文件原样上传。
 * @param options.compress 传 false 可跳过压缩（不能塞进 config，config 会被透传给 getSts）
 */
export async function upload(files: File[], config?: any, options?: { compress?: boolean }) {
  const targets = options?.compress === false ? files : await compressImages(files)

  const promises = []
  for (const file of targets) {
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

      await client.put(data.objectKey, file)
      await uploadConfirm({ objectKey: data.objectKey })
      return data.url;
    }
    promises.push(fn)
  }

  return await Promise.all(promises.map((f) => f()))
}
