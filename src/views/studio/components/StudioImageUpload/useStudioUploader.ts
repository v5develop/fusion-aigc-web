import { ref } from 'vue'
import { useMessage } from 'naive-ui'
import { goUploadImage } from '@/api/goUpload.ts'

/**
 * 商拍工作室的图片直传（叠片入口与服装图弹窗共用）。
 *
 * <p>仍走 goUploadImage 直传（Go presign；studio 拒收 Java STS 地址，≤10M 在内部拦截）。
 * 余量 / 非图片 / 超额的提示与逐张串行上传的口径与原 StudioImageUpload 一致。
 */
export function useStudioUploader() {
  const message = useMessage()
  const uploading = ref(false)

  /**
   * @param files 选中的文件
   * @param room 还能放几张
   * @param max 上限（只用于提示文案）
   * @param onUploaded 每传成功一张回调一次（i 为本次第几张成功，从 0 起）
   */
  async function uploadFiles(files: File[], room: number, max: number, onUploaded: (url: string, i: number) => void) {
    if (!files.length) return
    if (room <= 0) {
      message.warning(`最多上传 ${max} 张`)
      return
    }
    let picked = files.filter((f) => f.type.startsWith('image/'))
    if (picked.length < files.length) message.warning('已跳过非图片文件')
    if (picked.length > room) {
      picked = picked.slice(0, room)
      message.warning(`最多还能添加 ${room} 张（上限 ${max} 张），多选的其余 ${files.length - room} 张未添加`)
    }
    if (!picked.length) return

    uploading.value = true
    try {
      // 逐张串行传：goUploadImage 内部有 10M 校验（抛中文 Error），失败的跳过并提示
      let done = 0
      for (const file of picked) {
        try {
          const url = await goUploadImage(file)
          onUploaded(url, done)
          done += 1
        } catch (err) {
          message.error(err instanceof Error ? err.message : '图片上传失败')
        }
      }
    } finally {
      uploading.value = false
    }
  }

  return { uploading, uploadFiles }
}
