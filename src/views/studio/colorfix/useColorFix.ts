/**
 * 服装校色的跨组件状态（原型 composables/useColorFix.ts）：商拍换装 / 姿态复刻两个工作台共用一份（模块级单例）。
 *
 * <ul>
 *   <li>`enabled`：输入区「默认校色」开关，提交时由页面原样带成 `color_fix`（每次提交各自快照）。默认关。</li>
 *   <li>`panelOpen`：结果列里的校色参数台是否打开。</li>
 *   <li>`params`：参数台当前编辑的那组五参数（= 右列正在看的那张结果的参数）。</li>
 * </ul>
 *
 * <p>与原型的差别（刻意不照搬）：原型切换历史记录时会把 `enabled` 改成「这条记录有没有校色」，
 * 等于用户刚打开的提交开关被浏览历史悄悄关掉。这里切记录**不碰** `enabled`：每个批次的结果是否校色
 * 由它自己提交时的 `payload.color_fix` 决定（见 StudioPreviewPanel），参数按任务各自还原。
 *
 * <p>同理，结果区（舞台「校色调整」胶囊、参数台「恢复默认」）只动参数台，**不碰** `enabled`：
 * 看历史结果时调一下参数，不能顺手把下一次提交改成带默认校色。结果区一律用 {@link UseColorFix.openPanelOnly}；
 * 参数台的「恢复默认」由 ColorFixPanel 自己把参数改回默认，持久化走结果区对 `params` 的 watch，不需要再调这里。
 * `openPanel()` / `reset()` 保留给「打开即开启默认校色」的输入区语义（目前没有调用方）。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { COLORFIX_DEFAULT, colorFixEquals, type ColorFixParams } from '@/utils/colorfix.ts'

const enabled = ref(false)
const panelOpen = ref(false)
const params = ref<ColorFixParams>({ ...COLORFIX_DEFAULT })
/** 参数是否离开了默认值（调过） */
const touched = computed(() => !colorFixEquals(params.value, COLORFIX_DEFAULT))

export interface UseColorFix {
  enabled: Ref<boolean>
  panelOpen: Ref<boolean>
  params: Ref<ColorFixParams>
  /** 参数回默认，并打开输入区「默认校色」开关（输入区语义；结果区不要用） */
  reset(): void
  /** 打开输入区「默认校色」开关并展开参数台（输入区语义；结果区不要用） */
  openPanel(): void
  /** 只展开参数台，不改 `enabled`（结果区 / 工具页用） */
  openPanelOnly(): void
  touched: ComputedRef<boolean>
}

export function useColorFix(): UseColorFix {
  function reset() {
    params.value = { ...COLORFIX_DEFAULT }
    enabled.value = true
  }
  function openPanel() {
    enabled.value = true
    panelOpen.value = true
  }
  function openPanelOnly() {
    panelOpen.value = true
  }
  return { enabled, panelOpen, params, reset, openPanel, openPanelOnly, touched }
}
