import type { InjectionKey } from 'vue'

/**
 * Workbench 三栏模式向子树提供的控制口。
 * <1440 时历史与预览是右栏里的两段分段切换：在历史里选中一条后调 revealPreview() 切回「生成结果」。
 * ≥1440 两段同时可见，调用无副作用。不在 Workbench 里（inject 拿到 undefined）时调用方应安全跳过。
 */
export interface LLWorkbenchContext {
  revealPreview: () => void
}

export const LL_WORKBENCH_KEY: InjectionKey<LLWorkbenchContext> = Symbol('llWorkbench')
