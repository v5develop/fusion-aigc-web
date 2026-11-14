/**
 * 做同款 · 自动带入品牌档案（做活不做死）：
 * - 入参表单就绪后，用选中的档案预填能映射的位（映射见 brandMapping.ts）；只填「还是空的」位，用户动过的位永不覆盖；
 * - 多个档案默认上次用的（按账号记在 localStorage，前缀登记在 auth-session 的 ACCOUNT_KEYED_PREFIXES），可切换；
 * - 「不用档案」：撤回还没被改过的预填值；
 * - 从「我的模板 / 再来一版」恢复时以恢复的值为准：调用方包 `holdOff(async () => …)`，期间不带入；
 * - 没登录 / 档案取不到：静默不带入，表单照常可用。
 */
import { computed, onScopeDispose, ref, watch } from 'vue'
import { brandPrefillList, brandPrefillView } from '@/api/brand-prefill.ts'
import type { BrandProfileView, LLProfileItem } from '@/api/local-life-full.ts'
import { currentAccountId, onAccountChange } from '@/utils/auth-session.ts'
import { isLoggedIn, loginVersion } from '../industry/useLoginGate.ts'
import { hasBrandSlots, mapProfileToSlots } from './brandMapping.ts'
import { emptyValue } from './slotTypes.ts'
import type { useTemplateSlots } from './useTemplateSlots.ts'

/** 与 auth-session.ts 的 ACCOUNT_KEYED_PREFIXES 里登记的前缀保持一致 */
const KEY_PREFIX = 'xq-brand-prefill:'
const storeKey = () => `${KEY_PREFIX}${currentAccountId() || 'anon'}`
function readLast(): number | null {
  try {
    const n = Number(localStorage.getItem(storeKey()))
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}
function writeLast(id: number) {
  try {
    localStorage.setItem(storeKey(), String(id))
  } catch {
    // 无痕 / 禁用存储：只在本次页面有效
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function useBrandPrefill(tslots: ReturnType<typeof useTemplateSlots>) {
  const profiles = ref<LLProfileItem[]>([])
  const listState = ref<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const profileId = ref<number | null>(null)
  /** 「不用档案」开关：关 = 不带入 */
  const enabled = ref(true)
  /** 当前表单里由档案带入、且没被用户改过的位：key → 带入的值 */
  const filled = ref<Record<string, unknown>>({})
  /** 用户手动改过的位：不再被档案覆盖 */
  const touched = new Set<string>()
  /** 本表单来自「我的模板 / 再来一版」恢复：以恢复的值为准，不带入 */
  const restored = ref(false)
  const views = new Map<number, BrandProfileView>()
  let holding = 0
  let handledItems: unknown = null
  let seq = 0

  const current = computed(() => profiles.value.find((p) => p.id === profileId.value) ?? null)
  const filledCount = computed(() => Object.keys(filled.value).length)
  /** 提示条显不显示：登录、模板有可带入的位 */
  const relevant = computed(() => isLoggedIn() && tslots.status.value === 'ok' && hasBrandSlots(tslots.items.value))
  const state = computed<'hidden' | 'restored' | 'loading' | 'none' | 'ready'>(() => {
    if (!relevant.value || holding) return 'hidden'
    if (restored.value) return 'restored'
    if (listState.value === 'loading' || listState.value === 'idle') return 'loading'
    if (listState.value === 'error' || !profiles.value.length) return 'none'
    return 'ready'
  })

  async function ensureList() {
    if (listState.value === 'ok' || listState.value === 'loading') return
    listState.value = 'loading'
    try {
      profiles.value = await brandPrefillList()
      listState.value = 'ok'
      const last = readLast()
      const pick = profiles.value.find((p) => p.id === last) ?? profiles.value[0]
      profileId.value = pick?.id ?? null
    } catch {
      listState.value = 'error'
    }
  }

  async function viewOf(id: number): Promise<BrandProfileView | null> {
    const hit = views.get(id)
    if (hit) return hit
    try {
      const v = await brandPrefillView(id)
      views.set(id, v)
      return v
    } catch {
      return null
    }
  }

  /** 把档案值填进「还空着」的位（或上一次由档案带入、没被改过的位） */
  async function apply() {
    const s = ++seq
    const items = tslots.items.value
    if (!enabled.value || holding || tslots.status.value !== 'ok' || !isLoggedIn()) return
    await ensureList()
    if (s !== seq || profileId.value == null) return
    const view = await viewOf(profileId.value)
    if (s !== seq || !view || holding || !enabled.value || tslots.items.value !== items) return
    const cur = tslots.values.value
    const mapped = mapProfileToSlots(items, cur, view)
    const next = { ...cur }
    const nextFilled: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(mapped)) {
      if (touched.has(k)) continue
      const slot = items.find((i) => i.key === k)!
      const prev = filled.value[k]
      const isBlank = same(cur[k], emptyValue(slot)) || (prev !== undefined && same(cur[k], prev)) || cur[k] === slot.default
      if (!isBlank) continue
      next[k] = v
      nextFilled[k] = v
    }
    // 上一份档案填过、这份档案没有的位：撤回（没被改过才会还在 filled 里）
    for (const k of Object.keys(filled.value)) {
      if (k in nextFilled || touched.has(k)) continue
      const slot = items.find((i) => i.key === k)
      if (slot && same(cur[k], filled.value[k])) next[k] = slot.default ?? emptyValue(slot)
    }
    filled.value = nextFilled
    tslots.values.value = next
  }

  /** 「不用档案」：撤回没被改过的预填 */
  function clearFilled() {
    ++seq
    const next = { ...tslots.values.value }
    for (const [k, v] of Object.entries(filled.value)) {
      const slot = tslots.items.value.find((i) => i.key === k)
      if (slot && same(next[k], v)) next[k] = slot.default ?? emptyValue(slot)
    }
    filled.value = {}
    tslots.values.value = next
  }

  function setEnabled(on: boolean) {
    enabled.value = on
    if (on) void apply()
    else clearFilled()
  }
  function choose(id: number) {
    if (id === profileId.value) return
    profileId.value = id
    writeLast(id)
    enabled.value = true
    void apply()
  }

  // 新表单（换模板 / 重新取到 slots）：状态归零后带入
  watch(
    () => tslots.values.value,
    () => {
      const items = tslots.items.value
      if (tslots.status.value !== 'ok') {
        if (items !== handledItems) {
          handledItems = items
          filled.value = {}
          touched.clear()
        }
        return
      }
      if (items !== handledItems) {
        handledItems = items
        filled.value = {}
        touched.clear()
        enabled.value = true
        restored.value = false
        void apply()
        return
      }
      // 同一份表单上的改动：与带入值不同 = 用户改过
      const vals = tslots.values.value
      let changed = false
      const left = { ...filled.value }
      for (const [k, v] of Object.entries(left)) {
        if (!same(vals[k], v)) {
          touched.add(k)
          delete left[k]
          changed = true
        }
      }
      if (changed) filled.value = left
    },
    { flush: 'sync' },
  )

  /** 恢复「我的模板 / 再来一版」期间不带入（以恢复的值为准）；恢复完把当前表单整体当作用户的值 */
  async function holdOff<T>(fn: () => Promise<T>): Promise<T> {
    holding++
    try {
      return await fn()
    } finally {
      holding--
      restored.value = true
      filled.value = {}
      for (const k of Object.keys(tslots.values.value)) touched.add(k)
    }
  }

  watch(loginVersion, () => {
    listState.value = 'idle'
    profiles.value = []
    views.clear()
    if (tslots.status.value === 'ok') void apply()
  })
  const offAccount = onAccountChange(() => {
    listState.value = 'idle'
    profiles.value = []
    profileId.value = null
    views.clear()
  })
  onScopeDispose(offAccount)

  return { state, profiles, current, profileId, enabled, filledCount, setEnabled, choose, holdOff, apply }
}
