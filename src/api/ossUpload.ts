import OSS from 'ali-oss'

export function upload(files: File[], config: any) {
  const client = new OSS({
    region: 'oss-cn-hangzhou', // 你的 bucket 地域
    accessKeyId: '临时AK或STS AK',
    accessKeySecret: '临时SK或STS SK',
    bucket: '你的bucket名',
    // stsToken: 'STS临时token' // 用STS时加上
  })

  files.forEach(file => {
    client.put(config.fileName ?? file.name, file)
  })
}
