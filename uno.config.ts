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
    // 断点：用户 theme 的 breakpoints 会整表替换预设，所以把 presetUno 默认档位全部列出，再插入原型的 1440
    // （原型外壳：≥1440 目录在布局内，<1440 目录改为浮层；工具页三栏 ↔ 单列也以此为界）
    breakpoints: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      wide: '1440px',
      '2xl': '1536px',
    },
    // 字族（原型 v3-theme.css:27-29 / sx-scoped.css:65-66）
    fontFamily: {
      sans: "'Smartisan Compact','Noto Sans SC','Noto Sans CJK SC','PingFang SC','Microsoft YaHei',sans-serif",
      mono: "'SFMono-Regular','Cascadia Code',Consolas,'Liberation Mono',monospace",
    },
    // 语义圆角（sx-scoped.css:78-84）：xs 3 Tag/Checkbox · sm 4 按钮/输入 · md 6 导航项/目录项 ·
    // lg 8 卡片/弹层(Naive) · xl 10 .sx-card/提交按钮/浮层 · dialog 12 · plate 5 叠片
    borderRadius: {
      xs: '3px',
      sm: '4px',
      md: '6px',
      lg: '8px',
      xl: '10px',
      dialog: '12px',
      plate: '5px',
      pill: '999px',
    },
    // 阴影 token（sx-scoped.css:87-100、v3.ts、v3-theme.css）
    boxShadow: {
      card: 'inset 0 1px 0 #fff, inset 0 -1px 0 #eff1f3, 0 10px 16px rgba(0,0,0,0.04)',
      'card-v3': '0 1px 2px rgba(31,35,41,0.04), 0 8px 18px rgba(31,35,41,0.05)',
      panel: '0 2px 4px -1px rgba(31,35,41,0.08), 0 10px 18px -10px rgba(31,35,41,0.22)',
      pop: '0 12px 24px rgba(31,35,41,0.14), 0 2px 6px rgba(31,35,41,0.06)',
      raised: '0 1px 2px rgba(16,24,40,0.06), 0 4px 12px rgba(16,24,40,0.06)',
      'raised-hover': '0 1px 2px rgba(16,24,40,0.06), 0 4px 12px rgba(16,24,40,0.06), 0 6px 16px rgba(16,24,40,0.09)',
      btn: 'inset 0 1px 0 rgba(255,255,255,0.18), 0 1px 1px rgba(90,60,110,0.18), 0 2px 4px rgba(90,60,110,0.18)',
      'cast-r': '10px 0 16px -12px rgba(31,35,41,0.22)',
      plate: 'inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 0 rgba(31,35,41,0.04)',
      press: 'inset 0 1px 2px rgba(31,35,41,0.12), inset 0 0 0 1px rgba(31,35,41,0.03)',
      'inset-input': 'inset 0 1px 2px rgba(31,35,41,0.055), inset 0 0 0 1px rgba(255,255,255,0.7)',
      // 导航行 / 列表行选中的内凹（NextSidebar.vue:413-417）
      sunk: 'inset 0 1px 3px rgba(31,35,41,0.10), inset 0 -1px 0 #fff',
      well: 'inset 0 0 16px rgba(31,35,41,0.12), inset 0 1px 0 rgba(31,35,41,0.05)',
      // 输入焦点环：3px、藤紫 .14（v3.ts:44，sx-scoped.css:657）
      focus: '0 0 0 3px rgba(135,95,154,0.14)',
      'focus-danger': '0 0 0 3px rgba(180,67,62,0.10)',
      toast: '0 4px 10px rgba(31,35,41,0.10)',
      preview: '0 12px 28px rgba(31,35,41,0.16), 0 2px 6px rgba(31,35,41,0.06)',
      node: '0 2px 4px rgba(16,24,40,0.06), 0 16px 36px rgba(16,24,40,0.13)',
      // 白瓷材质（智能体页，原型 AgentView.vue:2079 --soft-shadow）：短外影 + 顶高光 + 底部内凹
      soft: '0 6px 16px rgba(31,35,41,0.08), inset 0 1px 0 #fff, inset 0 -3px 6px rgba(31,35,41,0.04)',
      'soft-hover': '0 2px 6px rgba(31,35,41,0.08), inset 0 1px 0 #fff',
      // 白瓷输入聚焦：往里凹一层，不加外环（原型 AgentView.vue:2038-2042）
      'soft-focus': 'inset 0 2px 6px rgba(31,35,41,0.13), inset 0 1px 2px rgba(31,35,41,0.08), 0 6px 16px rgba(31,35,41,0.08)',
    },
    // 动效（sx-scoped.css:103-105、480）
    duration: {
      fast: '110ms',
      mid: '180ms',
      slow: '240ms',
      seg: '300ms',
    },
    easing: {
      sx: 'cubic-bezier(.2,.7,.2,1)',
      std: 'cubic-bezier(.4,0,.2,1)',
    },
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
        // 选中渐变终点（#fff → #f8f3fc），分段选中 / 色调按钮 / 历史卡选中
        tint: '#f8f3fc',
        'tint-hover': '#f1e8f9',
        // 主按钮 hover 渐变、禁用底
        'hover-top': '#9a6fae',
        'hover-bottom': '#875c9a',
        disabled: '#cbb9d5',
      },
      // ---- 控件描边（sx-scoped.css:37-38,149）----
      control: { DEFAULT: '#c9cfd6', hover: '#aeb6bf', press: '#b9c0c8' },
      // ---- 浮起卡描边（sx-scoped.css:40-41）----
      raised: { line: '#cecece', hover: '#bdbdbd' },
      // 外壳分隔线（原型 App.vue:441,476）与目录分组刻线
      'shell-line': '#e2e2e2',
      engrave: '#efefef',
      'ghost-press': '#e9ecef',
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
      'danger-top': '#c1524c',
      'danger-soft': '#fdf1f0',
      'danger-line': '#ecc9c6',
      success: '#34795a',
      'success-soft': '#f0f8f4',
      'success-line': '#c7e3d5',
      warning: '#94651f',
      'warning-soft': '#fbf4e8',
      'warning-line': '#ead8b9',
      'info-soft': '#f5eff8',
      // 提示条文字（sx-scoped.css:1170-1172）
      alert: { info: '#654876', danger: '#8f4b47', warning: '#7d5a20' },
      // 白瓷描边（智能体页材质，原型 AgentView.vue:2079 --soft-line）
      'soft-line': '#c9cdd0',
      // 画布端口色（sx-scoped.css:1217-1228）
      port: { image: '#3f7f96', video: '#b45650', prompt: '#3e8e6a', audio: '#875f9a' },
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
    // ---- 白底记录卡：细描边 + 面板短投影（材质对齐轮：面板/卡片档位 r18）----
    'll-card':
      'sx-squircle bg-white rounded-18px border border-line shadow-[0_2px_4px_-1px_rgba(31,35,41,0.08),0_10px_18px_-10px_rgba(31,35,41,0.22)]',
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

    // ======== sx-*：原型 v3 规范（docs/design/ui-design-spec.md §8.2），新代码优先用这一组 ========
    // ---- 曲率（材质对齐 2026-11-06）：只挂有圆角档位的组件；圆钮 50% / 胶囊 999 不挂，避免变超椭圆 ----
    'sx-squircle': '[corner-shape:squircle]',
    // ---- 渐变（§1.2）----
    'sx-grad-primary': 'bg-gradient-to-b from-violet-top to-violet-bottom',
    'sx-grad-plate': 'bg-gradient-to-b from-white to-#fbfcfc',
    'sx-grad-tint': 'bg-gradient-to-b from-white to-violet-tint',
    'sx-grad-sunk': 'bg-[linear-gradient(#f3f4f5,#fafbfc)]',
    'sx-grad-icon': 'bg-[linear-gradient(135deg,#f6effa,#efe6f5)]',
    'sx-grad-upload': 'bg-gradient-to-b from-white to-#f9fafb',
    'sx-grad-progress': 'bg-gradient-to-r from-violet-top to-violet-bottom',
    // ---- 焦点 ----
    'sx-focus': 'focus-visible:(outline outline-2 outline-solid outline-violet outline-offset-2)',
    // ---- 拖入高亮（§5.9 上传槽「拖入时描边 violet、底 violet-soft」，useFileDropPaste 的 dragging）----
    // sx-drop：本身有 1px 描边的上传槽，描边改藤紫实线、底换柔紫（盖掉渐变）。
    // 原型 C-07 / 组件地图 §5.9：拖入 = 实线紫 + 淡紫底（不是虚线；虚线是「空槽」的样子，拖入要和空态区分开）
    'sx-drop': '!border-solid !border-violet !bg-none !bg-violet-soft',
    // sx-drop-ring：没有描边的区域，用不占位的 1px 藤紫实线外框（同 sx-drop：拖入 = 实线），避免布局跳动
    'sx-drop-ring': '!outline-1 !outline-solid !outline-violet !-outline-offset-1 !bg-none !bg-violet-soft',
    // ---- 按钮（§4.1 + 材质对齐：按钮档位 r14；圆钮/胶囊不在此列，保持原形）----
    'sx-btn':
      'sx-squircle inline-flex items-center justify-center gap-6px h-32px px-12px rounded-14px text-13px font-500 leading-none cursor-pointer select-none ' +
      'text-ink-2 sx-grad-plate border border-solid border-control shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(31,35,41,0.04),0_1px_2px_rgba(31,35,41,0.05)] ' +
      'hover:(border-control-hover text-ink to-surface2) active:(border-control-press shadow-press from-surface3 to-surface2) ' +
      'disabled:(border-line bg-surface3 bg-none shadow-none text-placeholder cursor-not-allowed) sx-focus',
    'sx-btn-primary':
      'sx-squircle inline-flex items-center justify-center gap-6px h-32px px-12px rounded-14px text-13px font-600 leading-none cursor-pointer select-none ' +
      'text-white sx-grad-primary border border-solid border-violet-border shadow-btn ' +
      'hover:(from-violet-hover-top to-violet-hover-bottom border-violet-press) ' +
      'active:(bg-none bg-violet-press border-#5c3d6b shadow-[inset_0_1px_3px_rgba(40,24,48,0.35)]) ' +
      'disabled:(bg-none bg-violet-disabled border-violet-line text-white/80 shadow-none cursor-not-allowed) sx-focus',
    'sx-btn-ghost':
      'sx-squircle inline-flex items-center justify-center gap-6px h-32px px-12px rounded-14px text-13px font-500 leading-none cursor-pointer select-none ' +
      'text-ink-2 bg-transparent hover:(bg-surface3 text-ink) active:bg-ghost-press sx-focus',
    'sx-btn-tint':
      'sx-squircle inline-flex items-center justify-center gap-6px h-32px px-12px rounded-14px text-13px font-500 leading-none cursor-pointer select-none ' +
      'text-violet-ink sx-grad-tint border border-solid border-violet-line hover:(from-#fdfbff to-violet-tint-hover) sx-focus',
    'sx-btn-danger':
      'sx-squircle inline-flex items-center justify-center gap-6px h-32px px-12px rounded-14px text-13px font-500 leading-none cursor-pointer select-none ' +
      'text-danger bg-gradient-to-b from-#fff7f6 to-danger-soft border border-solid border-danger-line hover:border-danger sx-focus',
    // 提交大按钮（ToolSubmitBar：56 高、两行；材质对齐：按钮档位 r14）
    'sx-submit':
      'sx-squircle flex w-full h-56px flex-col items-center justify-center gap-3px px-12px rounded-14px text-white cursor-pointer select-none ' +
      'sx-grad-primary border border-solid border-violet-border shadow-btn ' +
      'hover:(from-violet-hover-top to-violet-hover-bottom border-violet-press) ' +
      'active:(bg-none bg-violet-press shadow-[inset_0_1px_3px_rgba(40,24,48,0.35)]) ' +
      'disabled:(bg-none bg-violet-disabled border-violet-line text-white/80 shadow-none cursor-not-allowed) sx-focus',
    // 设置按钮 / 模型字段 / 选项按钮共用的 44 高触发条（原型 .op-model：r14 档）
    'sx-field-btn':
      'sx-squircle flex items-center h-44px pl-11px pr-24px rounded-14px text-left cursor-pointer sx-grad-plate border border-solid border-control shadow-plate ' +
      'hover:border-control-hover sx-focus',
    // ---- 输入（§4.1：高 34、焦点 violet 描边 + 3px 外环；材质对齐：输入档位 r15）----
    'sx-input':
      'sx-squircle h-34px px-10px rounded-15px bg-white text-13px text-ink border border-solid border-control shadow-inset-input outline-none ' +
      'placeholder:text-placeholder hover:border-control-hover focus:(border-violet shadow-focus) ' +
      'disabled:(border-line bg-surface3 text-placeholder cursor-not-allowed)',
    'sx-well': 'bg-white rounded-md border border-solid border-line shadow-well',
    // ---- 分段控件 ----
    'sx-seg': 'sx-squircle inline-flex items-center gap-2px p-2px rounded-md bg-surface3 border border-solid border-line shadow-inset-input',
    'sx-seg-item':
      'sx-squircle inline-flex items-center justify-center h-30px px-9px rounded-sm text-11px text-ink-2 border border-solid border-transparent cursor-pointer select-none ' +
      'transition-all duration-seg ease-std active:shadow-[inset_0_1px_2px_rgba(80,55,95,0.16)] disabled:(opacity-45 cursor-not-allowed)',
    'sx-seg-on': 'sx-grad-tint !border-violet-line !text-violet-ink font-600 shadow-[0_1px_2px_rgba(31,35,41,0.05)]',
    // ---- 页签 ----
    'sx-pilltab':
      'inline-flex items-center h-32px px-12px rounded-lg text-14px font-500 text-ink-2 cursor-pointer select-none hover:bg-surface3',
    'sx-pilltab-on': 'bg-#f1ecf3 font-600 text-ink',
    // ---- 卡片与面板（§3 + 材质对齐：面板/卡片档位 r18；raised 资产卡保持 r8 不变）----
    'sx-card': 'sx-squircle bg-white rounded-18px border border-solid border-line shadow-card',
    'sx-card-panel': 'sx-squircle bg-white rounded-18px border border-solid border-line shadow-panel',
    'sx-card-raised':
      'bg-white rounded-lg border border-solid border-raised-line shadow-raised transition-all duration-180 ease-[ease] ' +
      'hover:(border-raised-hover shadow-raised-hover)',
    'sx-section': 'sx-squircle flex flex-col gap-8px p-12px bg-white rounded-18px border border-solid border-line shadow-card-v3',
    'sx-pop': 'sx-squircle bg-white rounded-18px border border-solid border-line shadow-pop',
    // ---- 导航 / 列表行（§4.1：r6、透明描边，hover #f3f4f5，选中内凹灰）----
    'sx-row':
      'flex items-center rounded-md border border-solid border-transparent bg-transparent text-left cursor-pointer hover:bg-surface3 sx-focus',
    'sx-row-on': '!border-line sx-grad-sunk shadow-sunk hover:sx-grad-sunk',
    // ---- 历史卡（材质对齐：r18 档，与 74 高卡片规格配套）----
    'sx-hist-card':
      'sx-squircle flex gap-10px p-10px rounded-18px bg-white border border-solid border-line cursor-pointer ' +
      'hover:(border-control shadow-[0_1px_2px_rgba(31,35,41,0.05)])',
    'sx-hist-card-on': '!border-violet-line sx-grad-tint',
    // ---- 上传区 / 叠片 ----
    'sx-upload':
      'min-h-150px p-12px rounded-lg border border-solid border-control sx-grad-upload transition-colors duration-200 ' +
      'hover:(border-violet-line to-#fbf7fd)',
    'sx-plate': 'w-60px h-100px rounded-plate border border-solid border-white shadow-[0_1px_3px_rgba(31,35,41,0.16)]',
    // ---- 空态 ----
    'sx-empty':
      'flex flex-col items-center justify-center gap-6px min-h-150px p-18px rounded-lg border border-dashed border-line-strong text-center',
    'sx-empty-title': 'text-13px font-600 text-ink',
    'sx-empty-desc': 'max-w-320px text-11px leading-[1.65] text-muted',
    // ---- 文字角色（§2）----
    'sx-label': 'text-11px font-500 text-ink-2',
    'sx-hint': 'text-11px leading-[1.55] text-muted',
    'sx-caption': 'text-11px font-600 tracking-[.04em] text-muted',
    'sx-title-page': 'text-20px font-600 leading-28px text-ink',
    'sx-title-tool': 'text-15px font-600 leading-20px text-ink',
    'sx-title-section': 'text-16px font-600 leading-22px text-ink',
    'sx-title-card': 'text-14px font-600 leading-20px text-ink',
    // ---- 图标按钮（2026-11-07 尺寸整改：用户反馈下载等图标太小、不好点）----
    // 规则：可点区域 ≥ 32×32（WCAG 2.5.8 / 原型 11-t81 §4 图标钮命中 ≥32），触屏 ≥ 40；
    // 视觉可以小（列表行内 24），用 after 伪元素把命中区补足，不挤占布局；外扩 ≤ 相邻间距的一半。
    // 同一排图标按钮之间至少 gap-8px。新代码统一用 <IconButton>。
    // 外扩不能超过与相邻控件间距的一半，否则后一个控件的伪元素会盖住前一个（触屏误点到相邻按钮）
    'sx-hit': 'relative after:(content-empty absolute -inset-4px rounded-[inherit]) [@media(pointer:coarse)]:after:-inset-6px',
    'sx-iconbtn':
      'sx-squircle relative inline-grid place-items-center flex-none w-32px h-32px p-0 rounded-12px text-ink-2 cursor-pointer select-none ' +
      'sx-grad-plate border border-solid border-control shadow-plate transition-colors duration-fast ' +
      'hover:(border-control-hover text-ink) active:(shadow-press from-surface3 to-surface2) ' +
      'disabled:(border-line bg-none bg-surface3 shadow-none text-placeholder cursor-not-allowed) sx-focus ' +
      '[@media(pointer:coarse)]:after:(content-empty absolute -inset-4px)',
    // 列表行内小号：桌面视觉 24、命中 32；触屏直接放大到视觉 32、不再外扩（行内按钮挨得近，外扩会互相覆盖）
    'sx-iconbtn-sm':
      '!w-24px !h-24px !rounded-8px after:(content-empty absolute -inset-4px rounded-[inherit]) ' +
      '[@media(pointer:coarse)]:(!w-32px !h-32px after:inset-0)',
    'sx-iconbtn-lg': '!w-40px !h-40px !rounded-14px',
    // 无底板（工具条、行内）：透明底，hover 才出底色
    'sx-iconbtn-quiet': '!bg-none !bg-transparent !border-transparent !shadow-none hover:(!bg-surface3 !text-ink)',
    // 压在图片 / 视频上：半透明白底 + 模糊，深浅图上都看得清
    'sx-iconbtn-overlay':
      '!bg-none !bg-white/88 !border-white/60 !text-ink backdrop-blur-6px !shadow-[0_1px_3px_rgba(31,35,41,0.18)] hover:!bg-white',
    'sx-iconbtn-danger': 'hover:(!text-danger !border-danger-line !bg-none !bg-danger-soft)',
    // 悬停才出现的操作：触屏（无 hover）与键盘聚焦时始终可见，否则移动端点不到
    'sx-reveal':
      'opacity-0 transition-opacity duration-fast group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100 ' +
      '[@media(hover:none)]:opacity-100',
    // ======== sx-soft-*：「白瓷」材质（智能体页 2026-11-07 对齐原型 AgentView.vue:2029-2079），只在显式使用处生效 ========
    // 面：白 → #f8f9fa；线：#c9cdd0；影：短外影 + 顶高光 + 底部内凹
    'sx-soft-bg': 'bg-[linear-gradient(#fff,#f8f9fa)]',
    'sx-soft': 'sx-soft-bg border border-solid border-soft-line shadow-soft',
    // 工具钮（.sx-btn--sm）：28 高 r14、12px、灰字；悬停藤紫细线 + 藤紫字；按下内凹
    'sx-soft-btn':
      'sx-squircle inline-flex flex-none items-center justify-center gap-5px h-28px px-12px rounded-14px text-12px font-500 leading-none whitespace-nowrap cursor-pointer select-none ' +
      'sx-soft text-muted [transition:border-color_.12s,background_.12s,color_.12s,box-shadow_.12s] motion-reduce:transition-none ' +
      'enabled:hover:(border-violet-line bg-none bg-white text-violet-ink shadow-soft-hover) enabled:active:shadow-[inset_0_1px_2px_rgba(31,35,41,0.10)] ' +
      'disabled:(opacity-50 cursor-not-allowed shadow-none) sx-focus ' +
      // 视觉 28 高，命中外扩 2px → 32；触屏外扩 6px → 40
      'relative after:(content-empty absolute -inset-2px rounded-[inherit]) [@media(pointer:coarse)]:after:-inset-6px',
    // 主钮：藤紫渐变 + 白字
    'sx-soft-btn-primary':
      '!border-violet-border !bg-[linear-gradient(#8a639f,#7a548c)] !text-white !shadow-btn enabled:hover:(!bg-[linear-gradient(#9a6fae,#875c9a)] !text-white) ' +
      'enabled:active:(!bg-none !bg-violet-press !shadow-[inset_0_1px_3px_rgba(40,24,48,0.35)])',
    // 色调钮：白 → #fbf8fd、藤紫字
    'sx-soft-btn-tint':
      '!border-#e3d3ee !bg-[linear-gradient(#fff,#fbf8fd)] !text-violet-ink !shadow-[0_1px_2px_rgba(31,35,41,0.05)] ' +
      'enabled:hover:(!border-violet-line !bg-none !bg-white !shadow-soft-hover)',
    // 危险钮：白底、#f0c9c7 线、#c24545 字；悬停浅红底
    'sx-soft-btn-danger':
      '!border-#f0c9c7 !bg-none !bg-white !text-#c24545 enabled:hover:(!border-#e7b4b2 !bg-#fdf1f0 !text-#b03a3a)',
    // 白瓷输入：r15、鼠标聚焦往里凹（#b9bfc4 线）不加外环；键盘聚焦（focus-visible）另加 2px 藤紫外环，保证可见
    'sx-soft-input':
      'sx-squircle box-border h-30px rounded-15px sx-soft px-12px text-12px text-ink outline-none placeholder:text-placeholder ' +
      '[transition:border-color_.12s,box-shadow_.12s] motion-reduce:transition-none focus:(border-#b9bfc4 shadow-soft-focus) ' +
      'focus-visible:(border-violet-line outline outline-2 outline-solid outline-violet outline-offset-1)',

    // ---- 徽标 / 小圆钮 ----
    'sx-chip': 'inline-flex items-center h-20px px-6px rounded-xs text-11px leading-none',
    // 上传缩略图角上的小圆钮：视觉 20，命中 ≥ 32（after -6px），触屏 44
    'sx-medbtn':
      'relative grid place-items-center w-20px h-20px rounded-full border border-solid border-control bg-white text-ink-2 cursor-pointer ' +
      'after:(content-empty absolute -inset-6px rounded-full) [@media(pointer:coarse)]:after:-inset-8px hover:border-control-hover sx-focus',
  },
})
