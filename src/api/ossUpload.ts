import OSS from 'ali-oss'
import { getSts, uploadConfirm } from '@/api/methods.ts'

export async function upload(files: File[], config?: any) {
  const urls = []
  const promises = []
  for (const file of files) {
    const promise = new Promise(async (resolve, reject) => {
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
      // urls.push(data.url)
      resolve(data.url)
    })
    promises.push(promise)
  }

  return await Promise.all(promises)

  // return urls
}
