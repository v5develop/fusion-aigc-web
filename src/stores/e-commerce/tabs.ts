import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

const STORAGE_KEY = 'ecTabs'
const STORAGE_VERSION = 1

export interface EcTab {
  /** 实例 id，进 URL 的 ?tab=。同类目可以多开，靠它区分 */
  id: string
  /** 路由 name。同时也是组件 name（keep-alive include 项）和任务 type，三者刻意保持同名，省掉映射层 */
  name: string
  /** 类目名，取自 route.meta.title */
  title: string
  /** 同类目内序号，1 不显示后缀 */
  ordinal: number
}

/** 标签展示名：第一个不带序号，之后带 */
export const tabLabel = (tab: EcTab) => (tab.ordinal === 1 ? tab.title : `${tab.title} ${tab.ordinal}`)

/**
 * 会话分片键的唯一实现。标签条的清理和 useInitCheckTaskStatus 建会话都必须走这里 ——
 * 两边各写一份的话，一旦算法分叉，清理就会把还活着的标签会话删掉，而且是静默丢数据
 */
export const ecSessionKey = (name: string, tabId: string) => `${name}#${tabId}`

export const sessionKeyOf = (tab: EcTab) => ecSessionKey(tab.name, tab.id)

interface PersistedState {
  v: number
  nextId: number
  tabs: EcTab[]
}

function loadPersisted(): PersistedState {
  const empty = { v: STORAGE_VERSION, nextId: 1, tabs: [] }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return empty
    const parsed = JSON.parse(raw)
    // 版本不符直接丢弃：标签列表是纯缓存，重建的代价远小于兼容旧结构
    if (parsed?.v !== STORAGE_VERSION || !Array.isArray(parsed.tabs)) return empty
    return { v: STORAGE_VERSION, nextId: Number(parsed.nextId) || 1, tabs: parsed.tabs }
  } catch {
    return empty
  }
}

export const useEcTabsStore = defineStore('ecTabs', () => {
  const persisted = loadPersisted()

  // 不含「电商首页」：首页在标签条里是固定首项，不可关闭，也不需要进缓存
  const tabs = ref<EcTab[]>(persisted.tabs)
  // 发号器。自增整数比 uuid 在 URL 里干净，且不可能碰撞；随标签列表一起持久化
  const nextId = ref(persisted.nextId)
  // 各标签是否有任务在跑，键是 tab.id。给标签条上的「进行中」小圆点用
  const runningMap = ref<Record<string, boolean>>({})

  // 喂给 keep-alive :include。include 按组件 name 匹配，同类目多个实例共用一个 name，
  // 所以这里去重；实例之间靠 <component> 上的 :key 分开缓存
  const cachedNames = computed(() => [...new Set(tabs.value.map((t) => t.name))])

  // 只存标签列表和发号器，不存表单。刷新后标签条恢复、各自会话跟着恢复，表单仍是空的
  watch(
    [tabs, nextId],
    () => {
      try {
        const state: PersistedState = { v: STORAGE_VERSION, nextId: nextId.value, tabs: tabs.value }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      } catch {}
    },
    { deep: true },
  )

  /** 发一个新实例 id。入口点卡片时调用，拿到号再带进 URL */
  function nextTabId() {
    return String(nextId.value++)
  }

  /**
   * 同类目内的最小未占用序号。
   * 刻意不用「数量 + 1」：关掉 1 号后 2 号不重排、仍叫「爆款视频 2」，
   * 否则用户眼皮底下标签名会跳变
   */
  function nextOrdinal(name: string) {
    const used = new Set(tabs.value.filter((t) => t.name === name).map((t) => t.ordinal))
    let ordinal = 1
    while (used.has(ordinal)) ordinal++
    return ordinal
  }

  function openTab(tab: Omit<EcTab, 'ordinal'>) {
    if (tabs.value.some((t) => t.id === tab.id)) return
    tabs.value.push({ ...tab, ordinal: nextOrdinal(tab.name) })
  }

  /**
   * 关闭标签，返回关闭后应该落到哪个标签；null 表示没有别的标签了，调用方回电商首页。
   * 导航和会话清理都由调用方做，store 不碰 router、也不跨 store。
   * 从 tabs 移除即从 cachedNames 移除 → keep-alive 销毁该组件，表单状态随之释放。
   */
  function closeTab(id: string): EcTab | null {
    const index = tabs.value.findIndex((t) => t.id === id)
    if (index === -1) return null

    tabs.value.splice(index, 1)
    delete runningMap.value[id]

    // 优先落到右邻，没有右邻则取左邻
    return tabs.value[index] ?? tabs.value[index - 1] ?? null
  }

  function setRunning(id: string, running: boolean) {
    runningMap.value[id] = running
  }

  return { tabs, runningMap, cachedNames, nextTabId, openTab, closeTab, setRunning }
})
