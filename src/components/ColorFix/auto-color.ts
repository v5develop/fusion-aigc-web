/**
 * 参考图驱动的「自动校色」（2026-11-12，5186 同步决策 1 阶段二）。
 *
 * <p>宿主（如商拍预览面板）给 useResultColorFix 一个 `autoColor`：{@link ColorFixAutoColor.run} 向服务端要每件单品的五个滑杆值。
 * 引擎只做一件事：把这些值当作**每件单品图层的初值**灌进现有分层校色（`cf.applyPieceParams`，一步可撤销），
 * 之后照常手调、保存、精算导出——求解端只解参数，不出图。
 *
 * <p>本文件无 DOM 依赖：{@link useColorFixAutoColor} 是按 cf 共享的状态（参考卡与全屏层用同一份：loading、提示、可用性）。
 * 按钮只在「有带部位的参考图」且「宿主没说不可用」时出现；失败原因由宿主翻成 {@link ColorFixAutoError}（kind 决定提示与是否隐藏）。
 */
import { computed, effectScope, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { ColorFixParams } from '@/utils/colorfix.ts'
import { referenceParts } from './references.ts'
import type { ResultColorFix } from './useResultColorFix.ts'

/** 一件单品的求解结果（params 已是引擎命名 sat / light / bright） */
export interface ColorFixAutoPiece {
  /** 对应参考图的 key */
  key: string
  params: ColorFixParams
  /** 0–100，越高越接近参考色 */
  score: number
}

export interface ColorFixAutoResult {
  pieces: ColorFixAutoPiece[]
  /** 没解的参考图 key（宿主可顺带给原因，只用来提示「某某没能自动校色」） */
  skipped?: string[]
}

/** 分数低于它提示「仅供参考」 */
export const COLORFIX_AUTO_LOW_SCORE = 60
export const COLORFIX_AUTO_LOW_HINT = '自动结果仅供参考，可手动微调'

/**
 * 失败。kind：`disabled` 功能没开（隐藏按钮）/ `retry` 稍后重试（繁忙、超时、太频繁、服务暂不可用）/ `fail` 重试结果一样
 * （解不出、任务未就绪）。message 是给用户的一句话。
 */
export class ColorFixAutoError extends Error {
  readonly kind: 'disabled' | 'retry' | 'fail'
  constructor(message: string, kind: 'disabled' | 'retry' | 'fail') {
    super(message)
    this.name = 'ColorFixAutoError'
    this.kind = kind
  }
}

export interface ColorFixAutoColor {
  /** false = 宿主已知功能没开（隐藏按钮）；缺省 / null / true = 可以点 */
  available?: Ref<boolean | null | undefined>
  /** 向服务端要这些单品（参考图 key）的参数；失败抛 {@link ColorFixAutoError}（别的异常按「稍后重试」处理） */
  run(keys: string[], opts: { signal: AbortSignal }): Promise<ColorFixAutoResult>
}

export interface ColorFixAutoState {
  /** 显示按钮：宿主提供了 autoColor、没被判为不可用、且有带部位的参考图 */
  supported: ComputedRef<boolean>
  busy: Ref<boolean>
  /** 一行提示（成功 / 失败共用）；'' = 没有 */
  hint: Ref<string>
  /** hint 的语气：info 普通 / warn 仅供参考与部分没解 / error 失败 */
  hintKind: Ref<'info' | 'warn' | 'error'>
  /** 对全部带部位的单品自动校色；已在跑时忽略 */
  run: () => Promise<void>
}

const shared = new WeakMap<object, ColorFixAutoState>()

/** 同一份 cf 共用一份自动校色状态（参考卡、全屏层都问它） */
export function useColorFixAutoColor(cf: ResultColorFix): ColorFixAutoState {
  const hit = shared.get(cf)
  if (hit) return hit
  const made = effectScope(true).run(() => build(cf))!
  shared.set(cf, made)
  return made
}

function build(cf: ResultColorFix): ColorFixAutoState {
  const auto = cf.autoColor
  const busy = ref(false)
  const hint = ref('')
  const hintKind = ref<'info' | 'warn' | 'error'>('info')
  /** 本会话里服务端回过「功能没开」：不再显示 */
  const disabled = ref(false)

  const targets = computed(() => cf.references.value.filter((r) => referenceParts(r).length > 0))
  const supported = computed(() => !!auto && auto.available?.value !== false && !disabled.value && targets.value.length > 0)

  function say(text: string, kind: 'info' | 'warn' | 'error') {
    hint.value = text
    hintKind.value = kind
  }

  // 换了图 / 换了任务：等待中的结果作废（run 前后比对 src）
  let ctrl: AbortController | null = null
  let lastSrc = cf.src.value
  watch(
    () => cf.src.value,
    () => {
      ctrl?.abort()
      ctrl = null
      busy.value = false
      say('', 'info')
    },
  )

  async function run() {
    if (!auto || busy.value || !supported.value) return
    const keys = targets.value.map((r) => r.key)
    ctrl?.abort()
    ctrl = new AbortController()
    const my = ctrl
    lastSrc = cf.src.value
    busy.value = true
    say('', 'info')
    try {
      const res = await auto.run(keys, { signal: my.signal })
      if (my.signal.aborted || cf.src.value !== lastSrc) return // 等待期间换了图：结果不属于这张
      const labelOf = (key: string) => cf.references.value.find((r) => r.key === key)?.label ?? key
      const entries = res.pieces.flatMap((p) => {
        const ref = cf.references.value.find((r) => r.key === p.key)
        const parts = ref ? referenceParts(ref) : []
        return parts.length ? [{ key: p.key, parts, params: p.params, score: p.score }] : []
      })
      if (!entries.length) {
        say('没能自动校色，请手动调整', 'error')
        return
      }
      const out = cf.applyPieceParams(entries)
      const notes: string[] = []
      const failed = [...(res.skipped ?? []), ...entries.filter((e) => !out.applied.includes(e.key)).map((e) => e.key)]
      if (failed.length) notes.push(`${[...new Set(failed)].map(labelOf).join('、')}没能自动校色`)
      if (entries.some((e) => e.score < COLORFIX_AUTO_LOW_SCORE)) notes.push(COLORFIX_AUTO_LOW_HINT)
      if (out.baseReset) notes.push('整图校色已归零（自动结果以原图为基准，可撤销）')
      if (notes.length) say(notes.join('；'), 'warn')
      else say('已按参考图校色，可继续微调（可撤销）', 'info')
    } catch (err) {
      if (my.signal.aborted) return
      if (err instanceof ColorFixAutoError) {
        if (err.kind === 'disabled') disabled.value = true
        say(err.message, 'error')
      } else {
        say('自动校色失败，请稍后再试', 'error')
      }
    } finally {
      if (ctrl === my) busy.value = false
    }
  }

  return { supported, busy, hint, hintKind, run }
}
