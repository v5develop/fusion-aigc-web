import { defineConfig, presetUno, transformerVariantGroup } from 'unocss'

/**
 * UnoCSS 配置 —— 本地生活（local-life）新功能模块起启用。
 *
 * <p>色板与 shortcuts 对齐小岐AI 官方「新锤子风 · 藤紫」设计系统
 * （小岐AI-5181-s1.1 交付包 foundation/sx-scoped.css v0.1.8）：
 * 藤紫 #875f9a 主色 + 灰白中性 + 低饱和语义色；轻拟物材质（细描边 + 短投影 + 内凹按压）。
 *
 * <p>老页面保持独立 less 不动；新代码优先用这里的原子类与 shortcuts，
 * 复杂选择器（滚动条 mixin、深度选择器）仍落 <style scoped lang="less">。
 */
export default defineConfig({
  presets: [presetUno()],
  // 支持 hover:(a b) 这类变体分组写法（否则分组内的类不会生成 CSS）
  transformers: [transformerVariantGroup()],
  // 基础边框（与 Tailwind preflight 一致）：默认宽度 0、样式实线、颜色同 palette 的 line 色。浏览器原生按钮/输入框的默认边框由此清除，只有显式写了 border 类的元素才显示边框
  preflights: [
    {
      getCSS: () => '*, ::before, ::after { border-width: 0; border-style: solid; border-color: #e5e7eb; }',
    },
  ],
  // 老代码大量使用 .container 作为布局类名（layout / 电商 Container / Row），
  // 与 presetUno 内置的 container utility（响应式 max-width）撞名会把它们全部压窄，屏蔽之
  blocklist: ['container'],
  theme: {
    colors: {
      // ---- 藤紫（fujimurasaki）主色系 ----
      violet: {
        DEFAULT: '#875f9a',
        top: '#8a639f',
        bottom: '#7a548c',
        deep: '#6b487c',
        press: '#5f3f6f',
        border: '#6a487b',
        soft: '#f3edf8',
        'soft-2': '#ede3f2',
        line: '#d9c7e3',
        ink: '#6b487c',
      },
      // ---- 灰白中性 ----
      page: '#f5f6f7',
      surface2: '#f7f8f9',
      surface3: '#f3f4f5',
      sunken: '#eff1f3',
      line: '#e5e7eb',
      'line-soft': '#eff1f3',
      'line-strong': '#d9dde2',
      ink: '#1f2329',
      'ink-2': '#4b5563',
      muted: '#5f6673',
      placeholder: '#6e7681',
      // ---- 语义（低饱和）----
      danger: '#b4433e',
      'danger-soft': '#fdf1f0',
      'danger-line': '#ecc9c6',
      success: '#34795a',
      'success-soft': '#f0f8f4',
      'success-line': '#c7e3d5',
      warning: '#94651f',
      'warning-soft': '#fbf4e8',
      'warning-line': '#ead8b9',
      'info-soft': '#f5eff8',
    },
  },
  shortcuts: {
    // ---- 胶囊切换项：白底细描边轻拟物，选中 = 柔紫底内凹 ----
    'll-pill':
      'inline-flex items-center px-14px py-6px rounded-4px text-12px leading-none cursor-pointer select-none ' +
      'text-ink-2 bg-gradient-to-b from-white to-#fbfcfc border border-#d9dde2 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] ' +
      'transition-colors hover:(border-#aeb6bf text-ink) active:(bg-surface3 shadow-[inset_0_1px_2px_rgba(31,35,41,0.12)])',
    'll-pill-active':
      'bg-violet-soft !border-violet-line !text-violet-ink shadow-[inset_0_1px_2px_rgba(80,55,95,0.10)]',
    // 小号胶囊（音色分类等）
    'll-tag':
      'inline-flex items-center px-10px py-4px rounded-4px text-11px leading-none cursor-pointer select-none ' +
      'text-ink-2 bg-surface2 border border-transparent transition-colors hover:(bg-surface3 text-ink)',
    'll-tag-active': 'bg-violet-soft !text-violet-ink !border-violet-line',
    // ---- 表单字段标签行 / 链接 ----
    'll-label': 'text-13px text-ink-2 mb-6px flex items-center justify-between',
    'll-link': 'text-violet-ink text-12px cursor-pointer hover:text-violet-press',
    // 模块小标题（左栏分组）
    'll-section-title': 'text-14px font-600 text-ink mb-10px',
    // ---- 状态徽标：语义 soft 底 + 深字（官方低饱和口径）----
    'll-chip': 'inline-block flex-shrink-0 text-11px px-8px py-2px rounded-4px leading-none',
    'll-chip-running': 'text-violet-ink bg-info-soft border border-violet-line',
    'll-chip-success': 'text-success bg-success-soft border border-success-line',
    'll-chip-error': 'text-danger bg-danger-soft border border-danger-line',
    'll-chip-warning': 'text-warning bg-warning-soft border border-warning-line',
    // ---- 白底记录卡：细描边 + 面板短投影 ----
    'll-card':
      'bg-white rounded-10px border border-line shadow-[0_2px_4px_-1px_rgba(31,35,41,0.08),0_10px_18px_-10px_rgba(31,35,41,0.22)]',
    // ---- 主按钮（生成 CTA）：藤紫渐变 + 深描边 + 短投影，按下内凹 ----
    'll-btn-primary':
      'inline-flex items-center justify-center gap-8px rounded-999px text-white text-14px font-600 cursor-pointer select-none ' +
      'bg-gradient-to-b from-violet-top to-violet-bottom border border-violet-border ' +
      'shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_1px_rgba(90,60,110,0.18),0_2px_4px_rgba(90,60,110,0.18)] ' +
      'transition-all hover:(from-#9a6fae to-#875c9a border-violet-press) ' +
      'active:(bg-violet-press from-violet-press to-violet-press shadow-[inset_0_1px_3px_rgba(40,24,48,0.35)]) ' +
      'disabled:(bg-#cbb9d5 from-#cbb9d5 to-#cbb9d5 !border-violet-line cursor-not-allowed)',
    // ---- 危险文字操作 ----
    'll-danger-link': 'text-danger cursor-pointer hover:text-#c1524c',
    // 输入/卡片空态文字
    'll-empty': 'text-center text-muted text-13px',
  },
})
