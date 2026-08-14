import { reactive } from 'vue'
import { aigcModelOptions } from '@/api/methods'
import type { IAigcModelOption, IAigcOptionChoice } from '@/api/types'

/**
 * 可用模型目录：模型列表<b>由服务端下发</b>，不在前端写死。
 *
 * <p>写死的问题不是「加模型要改两处」，而是<b>后台停用的模型前端照样能选</b>：
 * 用户选中一个已停用/未开放的模型，提交才被拒，看起来像功能坏了。故列表只认服务端
 * （{@code GET /api/v1/aigc/model-options}）——后台停用即不下发，前端自然不显示、也选不到。
 *
 * <p>展示名直接用服务端 name：模型显示名的单一真相在后台模型管理，要改档位叫法在那里改，
 * 不在前端另建一份 code → 文案的映射（那就又回到两份真相了）。
 *
 * <p>用 reactive 数组而非 ref：各页面已有 `import { modelOps }` + `:options="modelOps"` /
 * `modelOps.find(...)` 的用法，就地改写数组内容能让这些调用点完全不动。
 */

export interface SelectOption {
  label: string
  value: string
  /**
   * 该模型真正配了计费档位的创作场景（服务端 entry_codes）。
   * 同一 media_type 下模型不是处处可用——如 xiaoqi-video-1.0-mini 的上游契约里没有参考素材字段，
   * 只能做文生视频。按本表过滤各场景的下拉，避免「能选、提交才报无法匹配计费档位」。
   */
  entryCodes?: string[]
}

/** 时长选项：value 是秒数（数字），与既有 durationOps 一致 */
export interface DurationOption {
  label: string
  value: number
}

export interface VideoModelOption extends SelectOption {
  /** 该模型可选分辨率（视频专有；上游契约无分辨率的模型为空数组） */
  resolutionOps: SelectOption[]
  /** 该模型可选画面比例 */
  ratioOps: SelectOption[]
  /**
   * 该模型可选时长（秒）。
   * <p>必须按模型给，不能用一张全局表：xiaoqi-video-1.0-mini（task_type 51）只支持 5 秒，
   * 而全局表列的是 4~15 秒——用户选 10 秒会在<b>扣费之后</b>于生成阶段失败，还得走退款。
   */
  durationOps: DurationOption[]
}

/** 生图可选模型。首次加载完成前为空数组 —— 页面渲染出空下拉，好过渲染一个选了会失败的模型。 */
export const imageModelOps = reactive<SelectOption[]>([])

/** 生视频可选模型（含各自的分辨率档）。 */
export const videoModelOps = reactive<VideoModelOption[]>([])

/** code → 展示名，供历史记录等只有 code 的地方回显。 */
export const modelCodeToLabel = reactive<Record<string, string>>({})

function choiceOps(choices?: IAigcOptionChoice[]): SelectOption[] {
  return (choices ?? []).map((c) => ({ label: String(c.value), value: String(c.value) }))
}

function toImageOption(m: IAigcModelOption): SelectOption {
  return { label: m.name || m.code, value: m.code, entryCodes: m.entry_codes }
}

function durationOpsOf(choices?: IAigcOptionChoice[]): DurationOption[] {
  return (choices ?? [])
    .map((c) => Number(c.value))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => ({ label: `${n}s`, value: n }))
}

function toVideoOption(m: IAigcModelOption): VideoModelOption {
  return {
    label: m.name || m.code,
    value: m.code,
    entryCodes: m.entry_codes,
    resolutionOps: choiceOps(m.resolutions),
    ratioOps: choiceOps(m.aspect_ratios),
    durationOps: durationOpsOf(m.durations),
  }
}

/**
 * 某创作场景可选的视频模型。
 * <p>entry_codes 缺失（旧后端）时不过滤 —— 宁可多显示一个，也不要因为字段没下发就把下拉清空。
 */
export function videoModelOpsFor(entryCode: string): VideoModelOption[] {
  return videoModelOps.filter((m) => !m.entryCodes?.length || m.entryCodes.includes(entryCode))
}

/** 就地替换数组内容（不是重新赋值）：各页面持有的是同一个引用，重新赋值它们看不到。 */
function replaceAll<T>(target: T[], next: T[]) {
  target.splice(0, target.length, ...next)
}

let loading: Promise<void> | null = null

/**
 * 加载模型目录，同一次会话只发一轮请求。
 *
 * <p>失败不缓存：登录态未就绪、网络抖动都会让首次加载失败，缓存住失败结果等于这次会话
 * 再也拿不到模型列表、所有生成页永久空下拉。故失败后清掉句柄，下次调用重新拉。
 */
export function ensureModelCatalog(): Promise<void> {
  if (loading) return loading
  loading = Promise.all([aigcModelOptions('image'), aigcModelOptions('video')])
    .then(([image, video]) => {
      const imageModels = image?.data?.models ?? []
      const videoModels = video?.data?.models ?? []
      replaceAll(imageModelOps, imageModels.map(toImageOption))
      replaceAll(videoModelOps, videoModels.map(toVideoOption))
      for (const m of [...imageModels, ...videoModels]) {
        modelCodeToLabel[m.code] = m.name || m.code
      }
    })
    .catch((e) => {
      loading = null
      throw e
    })
  return loading
}
