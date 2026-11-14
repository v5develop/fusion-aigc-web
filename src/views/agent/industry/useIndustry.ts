/**
 * 行业状态（agent-template-industry DESIGN §3 / §7.2）：行业树、当前行业 / 二级、偏好读写、本地缓存、stale 处理。
 *
 * - 进页只请求「行业目录」（已登录再加「偏好」），门通过前不发头条 / 列表请求（由调用方看 `current` 决定）；
 * - 本地缓存 `fusion_agent_industry:<accountId|anon>` 让回访用户立刻进入行业，偏好返回后以服务端为准；
 * - 选行业乐观进入，PUT 失败不回滚界面：toast「没能记住你的选择…」并后台重试一次；未登录只写本地；
 * - 偏好 stale / 接口回 INDUSTRY_NOT_FOUND：清缓存回行业门（不可关闭），toast「「X」已调整，请重新选择」；
 * - 登录后若本地只有 anon 偏好而服务端没有 → 自动迁移 PUT；服务端已有 → 以服务端为准。
 */
import { computed, ref } from 'vue'
import { useMessage } from 'naive-ui'
import {
  plazaIndustries,
  plazaIndustryPreference,
  putPlazaIndustryPreference,
  type IIndustry,
  type IIndustryCatalog,
} from '@/api/plaza.ts'
import { currentAccountId } from '@/utils/auth-session.ts'

const CACHE_PREFIX = 'fusion_agent_industry:'

interface Cached {
  industry: string
  sub?: string
}

function loggedIn(): boolean {
  try {
    return !!localStorage.getItem('fusion_accessToken')
  } catch {
    return false
  }
}

function cacheKey(anon = false): string {
  return CACHE_PREFIX + (anon ? 'anon' : currentAccountId() || 'anon')
}

function readCache(key: string): Cached | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const v = JSON.parse(raw) as Cached
    return v?.industry ? v : null
  } catch {
    return null
  }
}

function writeCache(key: string, v: Cached | null) {
  try {
    if (v) localStorage.setItem(key, JSON.stringify(v))
    else localStorage.removeItem(key)
  } catch {
    // 无痕 / 禁用存储：本次会话内存里有效即可
  }
}

export function useIndustry() {
  const message = useMessage()

  const catalog = ref<IIndustryCatalog | null>(null)
  const loading = ref(true)
  const failed = ref(false)
  const currentCode = ref('')
  const sub = ref('')
  /** 重开门（对话框）是否打开 */
  const gateOpen = ref(false)

  const industries = computed(() => catalog.value?.industries ?? [])
  const current = computed<IIndustry | null>(() => industries.value.find((x) => x.code === currentCode.value) ?? null)
  const children = computed(() => current.value?.children ?? [])
  /** 目录已回来、有行业、还没选 → 首次门 */
  const needGate = computed(() => !loading.value && !failed.value && industries.value.length > 0 && !current.value)
  /** gateEnabled=false 或 0 个行业：显示「行业模板整理中」，不降级成全量 */
  const gateOff = computed(
    () => !loading.value && !failed.value && (!catalog.value?.gateEnabled || industries.value.length === 0),
  )

  /** 偏好 PUT 用的 id：选了二级就传二级 id，否则一级 */
  function prefId(): number | null {
    const ind = current.value
    if (!ind) return null
    return children.value.find((c) => c.code === sub.value)?.id ?? ind.id
  }

  async function savePref(id: number, retry = true) {
    if (!loggedIn()) return
    try {
      await putPlazaIndustryPreference(id)
    } catch {
      if (retry) {
        setTimeout(() => void savePref(id, false), 1500)
      } else {
        message.warning('没能记住你的选择，下次进来可能要重选一次')
      }
    }
  }

  function apply(code: string, subCode = '') {
    currentCode.value = code
    sub.value = subCode
  }

  /** 用户选行业（乐观进入）；换行业清二级，搜索词由调用方重置 */
  function select(code: string) {
    const ind = industries.value.find((x) => x.code === code)
    if (!ind) return
    apply(code, '')
    gateOpen.value = false
    writeCache(cacheKey(), { industry: code })
    void savePref(ind.id)
  }

  function selectSub(code: string) {
    sub.value = code
  }

  /** 行业已停用 / 删除 / 二级不属于它：清缓存回首次门 */
  function handleGone() {
    const name = current.value?.name
    writeCache(cacheKey(), null)
    apply('')
    gateOpen.value = false
    if (name) message.warning(`「${name}」已调整，请重新选择`)
    void load(false)
  }

  /** 把「code 或 id」解析成 { industry, sub } */
  function resolveById(id: number): Cached | null {
    for (const i of industries.value) {
      if (i.id === id) return { industry: i.code }
      const c = i.children?.find((x) => x.id === id)
      if (c) return { industry: i.code, sub: c.code }
    }
    return null
  }

  async function reconcilePreference() {
    if (!loggedIn()) return
    try {
      const res = await plazaIndustryPreference()
      const pref = res.data
      if (!pref) return
      if (pref.stale) {
        const name = current.value?.name ?? pref.primary?.name
        writeCache(cacheKey(), null)
        apply('')
        message.warning(name ? `「${name}」已调整，请重新选择` : '你选的行业已调整，请重新选择')
        return
      }
      const hit = pref.primaryIndustryId != null ? resolveById(pref.primaryIndustryId) : null
      if (hit) {
        // 服务端为准：与当前不同才换（换了就重拉由调用方的 watch 完成）
        if (hit.industry !== currentCode.value || (hit.sub ?? '') !== sub.value) apply(hit.industry, hit.sub ?? '')
        writeCache(cacheKey(), hit)
        return
      }
      // 服务端没有偏好：本地有 anon 选择则迁移上去
      const anon = readCache(cacheKey(true))
      if (anon && !currentCode.value) {
        const ind = industries.value.find((x) => x.code === anon.industry)
        if (ind) {
          apply(ind.code, anon.sub ?? '')
          writeCache(cacheKey(), anon)
          void savePref(ind.id)
        }
      } else if (currentCode.value) {
        const id = prefId()
        if (id != null) void savePref(id)
      }
    } catch {
      // 偏好接口失败不挡浏览：沿用本地缓存
    }
  }

  async function load(restore = true) {
    loading.value = true
    failed.value = false
    try {
      const res = await plazaIndustries()
      catalog.value = res.data ?? { gateEnabled: false, industries: [] }
      loading.value = false
      if (restore && !currentCode.value) {
        const cached = readCache(cacheKey()) ?? (loggedIn() ? null : readCache(cacheKey(true)))
        const ind = cached && industries.value.find((x) => x.code === cached.industry)
        if (cached && ind) apply(ind.code, ind.children?.some((c) => c.code === cached.sub) ? (cached.sub ?? '') : '')
      }
      if (restore) await reconcilePreference()
    } catch {
      failed.value = true
      loading.value = false
    }
  }

  return {
    industries,
    loading,
    failed,
    current,
    children,
    sub,
    gateOpen,
    needGate,
    gateOff,
    load,
    select,
    selectSub,
    handleGone,
  }
}
