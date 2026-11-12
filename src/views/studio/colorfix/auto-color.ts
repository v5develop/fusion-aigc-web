/**
 * 商拍成品的「参考图自动校色」宿主适配（对接 components/ColorFix/auto-color.ts 的 ColorFixAutoColor）。
 *
 * <p>只传子任务号给 POST /studio/colorfix/auto（参考图 / 蒙版 / 成品全由服务端按归属解析，不传任何图片地址）；
 * 回来的五参数线上键名是 saturation / value / brightness，引擎里叫 sat / light / bright，这里转换并夹到合法范围。
 * 可用性：GET /studio/models 的 colorfixAuto === false（求解服务没配置）→ 不出按钮；老网关没有这个字段 = 未知，
 * 点击后遇到 COLORFIX_AUTO_DISABLED / 404 再隐藏。失败原因按信封 reason 翻成给用户的话（不按 msg）。
 */
import { ref, type Ref } from 'vue'
import { studioAutoColorFix, studioModels } from '@/api/studio.ts'
import type { StudioAutoColorFixPiece } from '@/api/studio-types.ts'
import { toApiError } from '@/api/index.ts'
import { ColorFixAutoError, type ColorFixAutoColor, type ColorFixAutoPiece } from '@/components/ColorFix/auto-color.ts'
import { colorFixSanitize, type ColorFixParams } from '@/utils/colorfix.ts'

/** 服务端是否开了自动校色：null = 未知（老网关 / 还没问到）；false = 没开（隐藏按钮） */
const availability = ref<boolean | null>(null)
let probed = false

function probe() {
  if (probed) return
  probed = true
  studioModels({ kind: 'tryon' })
    .then((res) => {
      if (typeof res.data?.colorfixAuto === 'boolean') availability.value = res.data.colorfixAuto
    })
    .catch(() => {
      // 接口失败：保持未知，按钮照常出，点了再看服务端怎么说
    })
}

/** 线上五参数 → 引擎五参数（sat / light / bright），夹到合法范围；不合法返回 null */
export function autoPieceToEngine(p: StudioAutoColorFixPiece): ColorFixAutoPiece | null {
  const w = p.params
  if (!w) return null
  const params: ColorFixParams | null = colorFixSanitize({
    hue: w.hue,
    sat: w.saturation,
    light: w.value,
    bright: w.brightness,
    contrast: w.contrast,
  })
  if (!params || typeof p.key !== 'string' || !p.key) return null
  return { key: p.key, params, score: typeof p.score === 'number' && Number.isFinite(p.score) ? p.score : 0 }
}

/** 接口错误 → 给用户的一句话与处理方式（reason 优先；老网关 404 = 功能没开） */
export function autoColorError(err: unknown): ColorFixAutoError {
  const e = toApiError(err)
  if (!e) return new ColorFixAutoError('自动校色失败，请稍后再试', 'retry')
  switch (e.reason) {
    case 'COLORFIX_AUTO_DISABLED':
      return new ColorFixAutoError('自动校色暂未开放', 'disabled')
    case 'COLORFIX_AUTO_BUSY':
      return new ColorFixAutoError('自动校色服务繁忙，请稍后再试', 'retry')
    case 'COLORFIX_AUTO_TIMEOUT':
      return new ColorFixAutoError('自动校色超时，请稍后再试', 'retry')
    case 'COLORFIX_AUTO_UNAVAILABLE':
      return new ColorFixAutoError('自动校色暂不可用，请稍后再试', 'retry')
    case 'COLORFIX_AUTO_TOO_FREQUENT':
      return new ColorFixAutoError('操作太频繁，请稍后再试', 'retry')
    case 'COLORFIX_AUTO_TASK_NOT_READY':
      return new ColorFixAutoError('这张图还没处理完，稍后再试', 'retry')
    case 'COLORFIX_AUTO_NO_PIECE':
      return new ColorFixAutoError('没能识别出可自动校色的服装区域，请手动校色', 'fail')
    case 'COLORFIX_AUTO_NO_REFERENCE':
      return new ColorFixAutoError('这张图没有可用的参考图，请手动校色', 'fail')
  }
  if (e.code === 7003 || (e.code === -1 && e.httpStatus === 404)) return new ColorFixAutoError('自动校色暂未开放', 'disabled')
  if (e.isNetwork || (e.code === -1 && (e.httpStatus === 502 || e.httpStatus === 503 || e.httpStatus === 504)))
    return new ColorFixAutoError('网络不稳或服务超时，请稍后再试', 'retry')
  return new ColorFixAutoError('自动校色失败，请稍后再试', 'retry')
}

/**
 * 商拍预览面板用：taskId = 当前成功任务的子任务号（空 = 没有可校色的图）。
 * 参考图 key 就是单品码（见 ./references.ts），直接作为 pieces 传给服务端。
 */
export function studioAutoColor(taskId: Ref<string | undefined | null>): ColorFixAutoColor {
  probe()
  return {
    available: availability,
    async run(keys, { signal }) {
      const id = taskId.value
      if (!id) throw new ColorFixAutoError('这张图暂时不能自动校色', 'fail')
      try {
        const res = await studioAutoColorFix(id, keys, { signal })
        const data = res.data
        const pieces = (data?.pieces ?? []).flatMap((p) => {
          const v = autoPieceToEngine(p)
          return v ? [v] : []
        })
        return { pieces, skipped: (data?.skipped ?? []).map((s) => s.key) }
      } catch (err) {
        if (signal.aborted) throw err
        const mapped = autoColorError(err)
        if (mapped.kind === 'disabled') availability.value = false
        throw mapped
      }
    },
  }
}
