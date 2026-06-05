import OSS from 'ali-oss'
import { getSts, uploadConfirm } from '@/api/methods.ts'

export async function upload(files: File[], config?: any) {
  const promises = []
  for (const file of files) {
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
