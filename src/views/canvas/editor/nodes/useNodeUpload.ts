/**
 * 图片 / 视频节点共用的上传状态：上传中 / 取消（AbortController 中止直传 PUT）/ 响应 store 的「更换」请求。
 * 上传助手不回报进度，所以只显示「上传中…」，不显示百分比。
 */
import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { canvasUploadMedia } from '@/api/canvasHome.ts'
import { editorMessage, useCanvasEditor } from '../useCanvasEditor.ts'

/** 画布图片上传的大小上限（节点上传 / 拖入节点 / 菜单「替换图片」/ 拖到空白画布同一口径） */
export const MAX_IMAGE_UPLOAD_BYTES = 30 * 1024 * 1024
export const MAX_IMAGE_UPLOAD_MB = 30

/** 超限返回给用户看的原因；没超返回空串。视频暂无前端上限（以服务端为准） */
export function uploadSizeError(file: File): string {
  if (file.type.startsWith('image/') && file.size > MAX_IMAGE_UPLOAD_BYTES) {
    return `图片超过 ${MAX_IMAGE_UPLOAD_MB}MB，请压缩后再上传`
  }
  return ''
}

export function useNodeUpload(options: {
  nodeId: () => string
  fileRef: Ref<HTMLInputElement | null>
  failText: string
  onUploaded: (url: string) => void
}) {
  const store = useCanvasEditor()
  const uploading = ref(false)
  let controller: AbortController | null = null

  function pick() {
    if (uploading.value) return
    options.fileRef.value?.click()
  }

  async function uploadFile(file: File) {
    if (uploading.value) return
    const tooBig = uploadSizeError(file)
    if (tooBig) {
      editorMessage.warning(tooBig)
      return
    }
    const current = new AbortController()
    controller = current
    uploading.value = true
    try {
      const url = await canvasUploadMedia(file, { signal: current.signal })
      // 取消后才回来的结果不落节点
      if (!current.signal.aborted) options.onUploaded(url)
    } catch (error) {
      const aborted = current.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')
      if (!aborted) editorMessage.error(error instanceof Error ? error.message : options.failText)
    } finally {
      if (controller === current) {
        controller = null
        uploading.value = false
      }
    }
  }

  function cancelUpload() {
    controller?.abort()
    controller = null
    uploading.value = false
  }

  async function onFile(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (file) await uploadFile(file)
  }

  // 右键菜单等外部入口的「更换」：store.replaceNodeImage(nodeId) 发信号，这里打开文件框
  watch(
    () => store.replaceMediaRequest.value,
    (request) => {
      if (request && request.nodeId === options.nodeId()) pick()
    },
    // 同步触发：文件框 click() 要落在菜单点击的那次用户手势里（Safari 对异步打开的文件框会直接忽略）
    { flush: 'sync' },
  )

  onBeforeUnmount(() => controller?.abort())

  return { uploading, pick, uploadFile, cancelUpload, onFile }
}
