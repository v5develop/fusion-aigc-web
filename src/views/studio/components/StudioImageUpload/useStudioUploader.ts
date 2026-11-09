import { getCurrentScope, onScopeDispose, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { goUploadImage } from '@/api/goUpload.ts'
import { checkMinShortSide } from '../../imageSize.ts'

/**
 * 商拍工作室的图片直传（叠片入口与服装图弹窗共用）。
 *
 * <p>仍走 goUploadImage 直传（Go presign；studio 拒收 Java STS 地址，≤10M 在内部拦截）。
 * 余量 / 非图片 / 超额的提示与逐张串行上传的口径与原 StudioImageUpload 一致。
 *
 * <p>代号：清空 / 整组换掉 / 组件卸载时 invalidate()（代号 +1），逐张串行上传中途发现代号变了就停，
 * 已传回来的也不再回调，避免把旧批次追加进清空或换过的格子里。
 *
 * @param options.minShortSide 给了就在上传前读尺寸，短边不够的跳过并提示（见 imageSize.ts）；不给不检查
 * @param options.onOverflow 多选超出余量时的提示；不给沿用默认 warning 文案（只有姿态页自定义）
 */
export function useStudioUploader(options: { minShortSide?: number; onOverflow?: (info: { room: number; max: number; extra: number }) => void } = {}) {
  const message = useMessage()
  const uploading = ref(false)
  let generation = 0

  /** 作废还在路上的上传（清空 / 替换 / 卸载） */
  function invalidate() {
    generation += 1
    uploading.value = false
  }
  if (getCurrentScope()) onScopeDispose(invalidate)

  /**
   * 槽位被整组换掉时自动作废：新列表为空，或与旧列表没有一张相同（清空 / 回填 / 重置）；
   * 原地 push / splice 不换引用，不会触发
   */
  function invalidateOnReplace(source: () => readonly string[]) {
    watch(source, (next, prev) => {
      if (!next.length || !prev?.some((u) => next.includes(u))) invalidate()
    })
  }

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
      const extra = picked.length - room
      picked = picked.slice(0, room)
      if (options.onOverflow) options.onOverflow({ room, max, extra })
      else message.warning(`最多还能添加 ${room} 张（上限 ${max} 张），多选的其余 ${extra} 张未添加`)
    }
    if (!picked.length) return

    const mine = ++generation
    uploading.value = true
    try {
      // 逐张串行传：goUploadImage 内部有 10M 校验（抛中文 Error），失败的跳过并提示
      let done = 0
      for (const file of picked) {
        if (mine !== generation) return
        if (options.minShortSide) {
          const small = await checkMinShortSide(file, options.minShortSide)
          if (mine !== generation) return
          if (small) {
            message.error(small)
            continue
          }
        }
        try {
          const url = await goUploadImage(file)
          if (mine !== generation) return
          onUploaded(url, done)
          done += 1
        } catch (err) {
          if (mine !== generation) return
          message.error(err instanceof Error ? err.message : '图片上传失败')
        }
      }
    } finally {
      if (mine === generation) uploading.value = false
    }
  }

  return { uploading, uploadFiles, invalidate, invalidateOnReplace }
}
