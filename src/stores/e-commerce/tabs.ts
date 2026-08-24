import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

export interface EcTab {
  /** 路由 name。同时也是组件 name（keep-alive include 项）和任务 type，三者刻意保持同名，省掉映射层 */
  name: string
  title: string
  path: string
}

export const useEcTabsStore = defineStore('ecTabs', () => {
  // 不含「电商首页」：首页在标签条里是固定首项，不可关闭，也不需要进缓存
  const tabs = ref<EcTab[]>([])
  // 各功能是否有任务在跑，键与 tab.name 一致。给标签条上的「进行中」小圆点用
  const runningMap = ref<Record<string, boolean>>({})

  // 喂给 keep-alive :include。只列已打开的电商功能页，其它模块页面不进缓存、行为不变
  const cachedNames = computed(() => tabs.value.map((t) => t.name))

  function openTab(tab: EcTab) {
    if (tabs.value.some((t) => t.name === tab.name)) return
    tabs.value.push(tab)
  }

  /**
   * 关闭标签，返回关闭后应该落到哪个标签；null 表示没有别的标签了，调用方回电商首页。
   * 导航由调用方做，store 不碰 router。
   * 从 tabs 移除即从 cachedNames 移除 → keep-alive 销毁该组件，表单状态随之释放。
   */
  function closeTab(name: string): EcTab | null {
    const index = tabs.value.findIndex((t) => t.name === name)
    if (index === -1) return null

    tabs.value.splice(index, 1)
    delete runningMap.value[name]

    // 优先落到右邻，没有右邻则取左邻
    return tabs.value[index] ?? tabs.value[index - 1] ?? null
  }

  function setRunning(name: string, running: boolean) {
    runningMap.value[name] = running
  }

  return { tabs, runningMap, cachedNames, openTab, closeTab, setRunning }
})
