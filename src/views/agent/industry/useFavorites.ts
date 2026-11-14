/**
 * 收藏状态（模块级单例，卡片 / 预览 / 「我的」抽屉共用）：当前行业里已收藏的模板 id。
 *
 * - 严格按行业：`load(industry)` 只取该行业的收藏；换行业整体替换，不混放；
 * - 乐观更新：点 ♡ 立刻翻转，失败回滚并提示；同一模板有请求在途时忽略再点（不会乱序）；
 * - 未登录：弹登录半屏（F-05，不跳页），不翻转、不发请求；
 * - `version` 每次本地收藏有变化 +1，「我的」抽屉据此重取列表。
 */
import { ref } from 'vue'
import {
  plazaAddFavorite,
  plazaErrorText,
  plazaFavorites,
  plazaRemoveFavorite,
  type IPlazaTemplate,
} from '@/api/plaza.ts'
import { isLoggedIn, requireLogin } from './useLoginGate.ts'

const ids = ref<Set<number>>(new Set())
const version = ref(0)
let loadedIndustry = ''
let seq = 0
const busy = new Set<number>()

export function isFavorite(id: number): boolean {
  return ids.value.has(id)
}

/** 取当前行业的收藏 id 集合；未登录清空。失败沿用旧值（不打扰） */
export async function loadFavorites(industry: string, force = false) {
  if (!industry || !isLoggedIn()) {
    ids.value = new Set()
    loadedIndustry = ''
    return
  }
  if (!force && loadedIndustry === industry) return
  const s = ++seq
  try {
    const res = await plazaFavorites({ industry })
    if (s !== seq) return
    ids.value = new Set((res.data?.items ?? []).map((x) => x.plazaTemplateId))
    loadedIndustry = industry
  } catch {
    // 取不到就当没有收藏状态：卡片上显示空心，点一下仍可收藏
  }
}

/**
 * 点 ♡：收藏 / 取消。返回最终是否已收藏；`notify` 用来出提示（失败 / 满了）。
 * 未登录弹登录半屏并返回当前状态（不变）。
 */
export async function toggleFavorite(
  item: Pick<IPlazaTemplate, 'plazaTemplateId'>,
  notify: (text: string) => void,
): Promise<boolean> {
  const id = item.plazaTemplateId
  const was = ids.value.has(id)
  if (!requireLogin('favorite')) return was
  if (busy.has(id)) return was
  busy.add(id)
  const next = new Set(ids.value)
  if (was) next.delete(id)
  else next.add(id)
  ids.value = next
  try {
    if (was) await plazaRemoveFavorite(id)
    else await plazaAddFavorite(id)
    version.value++
    return !was
  } catch (err) {
    const back = new Set(ids.value)
    if (was) back.add(id)
    else back.delete(id)
    ids.value = back
    notify(plazaErrorText(err, was ? '没能取消收藏，再试一次' : '没能收藏，再试一次'))
    return was
  } finally {
    busy.delete(id)
  }
}

export function useFavoritesVersion() {
  return version
}

/** 抽屉里取消收藏后同步卡片上的状态（列表已经自己更新，不再发请求） */
export function markFavorite(id: number, on: boolean) {
  const next = new Set(ids.value)
  if (on) next.add(id)
  else next.delete(id)
  ids.value = next
}

/** 单测 / 换号用：清空本地状态 */
export function resetFavorites() {
  ids.value = new Set()
  loadedIndustry = ''
  seq++
}
