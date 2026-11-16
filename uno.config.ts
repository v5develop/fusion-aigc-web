import { defineConfig, presetUno, transformerVariantGroup } from 'unocss'
import { themeCss, unoColor as c } from './src/theme/tokens.ts'
import { isShadowProp, rewriteShadow } from './src/theme/shadow-rewrite.ts'

/**
 * UnoCSS 配置 —— 本地生活（local-life）新功能模块起启用。
 *
 * <p>色板与 shortcuts 对齐小岐AI 官方「新锤子风 · 藤紫」设计系统
 * （小岐AI-5181-s1.1 交付包 foundation/sx-scoped.css v0.1.8）：
 * 藤紫 #875f9a 主色 + 灰白中性 + 低饱和语义色；轻拟物材质（细描边 + 短投影 + 内凹按压）。
 *
 * <p><b>浅色 / 深色</b>：所有颜色与阴影指向 CSS 变量，两套值在 src/theme/tokens.ts（下方 preflight 注入）。
 * 新代码只写令牌类（bg-surface / text-ink-2 / border-line / shadow-pop），不要写 #fff、bg-#f7f8f9 这类死色——
 * 死色在深色下会变成一块白补丁。图片 / 视频内容本身不受主题影响。
 *
 * <p>老页面保持独立 less 不动；新代码优先用这里的原子类与 shortcuts，
 * 复杂选择器（滚动条 mixin、深度选择器）仍落 <style scoped lang="less">。
 */
export default defineConfig({
  presets: [presetUno()],
  // 支持 hover:(a b) 这类变体分组写法（否则分组内的类不会生成 CSS）
  transformers: [transformerVariantGroup()],
  preflights: [
    // 主题变量：:root / [data-theme=light] 一套、[data-theme=dark] 一套（子树可单独锁定主题，如设置页预览卡）
    { getCSS: () => themeCss() },
    // 基础边框（与 Tailwind preflight 一致）：默认宽度 0、样式实线、颜色同 line 令牌。浏览器原生按钮/输入框的默认边框由此清除，只有显式写了 border 类的元素才显示边框
    {
      getCSS: () => '*, ::before, ::after { border-width: 0; border-style: solid; border-color: var(--xq-line); }',
    },
  ],
  // 手写的任意阴影（shadow-[0_1px_2px_rgba(31,35,41,0.05)]）里的墨色投影 / 白色顶光跟主题走，见 src/theme/shadow-rewrite.ts
  postprocess: (util) => {
    for (const entry of util.entries) {
      if (typeof entry[0] === 'string' && typeof entry[1] === 'string' && isShadowProp(entry[0])) {
        entry[1] = rewriteShadow(entry[1])
      }
    }
  },
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
    // 阴影 token：值在 src/theme/tokens.ts（浅色逐字照搬原表 sx-scoped.css:87-100、v3.ts、v3-theme.css、AgentView.vue；
    // 深色换成「黑色加深 + 极淡顶光」）。btn-plate = sx-btn 的白钮三层影，hairline = 选中卡 1px 落影
    boxShadow: Object.fromEntries(
      (
        [
          'card',
          'card-v3',
          'panel',
          'pop',
          'raised',
          'raised-hover',
          'btn',
          'btn-plate',
          'cast-r',
          'plate',
          'press',
          'press-accent',
          'inset-input',
          'sunk',
          'well',
          'focus',
          'focus-danger',
          'toast',
          'preview',
          'node',
          'soft',
          'soft-hover',
          'soft-focus',
          'hairline',
          'thumb',
          'overlay-btn',
        ] as const
      ).map((k) => [k, `var(--xq-shadow-${k})`]),
    ),
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
    // 颜色全部指向 CSS 变量（src/theme/tokens.ts 两套值），工具类随 <html data-theme> 自动切换；
    // 浅色变量值 = 改造前的色值，原有页面观感不变。text-ink/50 这类透明度写法照常可用（%alpha）
    colors: {
      // ---- 藤紫（fujimurasaki）主色系 ----
      violet: {
        DEFAULT: c('violet'),
        // 文字用藤紫：text-violet 由 shortcuts 转到这里（深色提亮到 ≥ 4.5，浅色与 DEFAULT 同值）
        fg: c('violet-fg'),
        // 压白字的实色底（徽标 / 角标 / 选中分段）：两套主题白字都 ≥ 4.5，深色比 DEFAULT 略深
        solid: c('violet-solid'),
        top: c('violet-top'),
        bottom: c('violet-bottom'),
        deep: c('violet-deep'),
        press: c('violet-press'),
        'press-fg': c('violet-press-fg'),
        'press-border': c('violet-press-border'),
        border: c('violet-border'),
        soft: c('violet-soft'),
        'soft-2': c('violet-soft-2'),
        'soft-line': c('violet-soft-line'),
        'soft-tint': c('violet-soft-tint'),
        line: c('violet-line'),
        ink: c('violet-ink'),
        // 选中渐变终点（surface → tint），分段选中 / 色调按钮 / 历史卡选中
        tint: c('violet-tint'),
        'tint-hover': c('violet-tint-hover'),
        'tint-top': c('violet-tint-top'),
        // 主按钮 hover 渐变、禁用底
        'hover-top': c('violet-hover-top'),
        'hover-bottom': c('violet-hover-bottom'),
        disabled: c('violet-disabled'),
        pill: c('violet-pill'),
        'icon-a': c('violet-icon-a'),
        'icon-b': c('violet-icon-b'),
      },
      // ---- 控件描边（sx-scoped.css:37-38,149）----
      control: { DEFAULT: c('control'), hover: c('control-hover'), press: c('control-press') },
      // ---- 浮起卡：面 + 描边（sx-scoped.css:40-41）----
      raised: { DEFAULT: c('raised'), line: c('raised-line'), hover: c('raised-hover') },
      // 外壳分隔线（原型 App.vue:441,476）与目录分组刻线
      'shell-line': c('shell-line'),
      engrave: c('engrave'),
      'ghost-press': c('ghost-press'),
      // ---- 面：页面底 → 基础卡面 → 浮层；sunken 内凹 ----
      page: c('page'),
      surface: c('surface'),
      surface2: c('surface2'),
      surface3: c('surface3'),
      sunken: c('sunken'),
      overlay: c('overlay'),
      plate: { top: c('plate-top'), bottom: c('plate-bottom'), edge: c('plate-edge') },
      'upload-bottom': c('upload-bottom'),
      'upload-hover-bottom': c('upload-hover-bottom'),
      'sunk-bottom': c('sunk-bottom'),
      'soft-bottom': c('soft-bottom'),
      // ---- 线 ----
      line: c('line'),
      'line-soft': c('line-soft'),
      'line-strong': c('line-strong'),
      // ---- 文字 ----
      ink: c('ink'),
      'ink-2': c('ink-2'),
      muted: c('muted'),
      placeholder: c('placeholder'),
      // 压在藤紫 / 危险实色上的字（两套都是白）；text-white 本身不随主题变
      'on-accent': c('on-accent'),
      // ---- 语义（低饱和；text-danger / text-success / text-warning 由 shortcuts 转到 *-fg）----
      danger: c('danger'),
      'danger-fg': c('danger-fg'),
      'danger-top': c('danger-top'),
      'danger-soft': c('danger-soft'),
      'danger-soft-top': c('danger-soft-top'),
      'danger-line': c('danger-line'),
      'danger-hover-fg': c('danger-hover-fg'),
      'danger-strong': c('danger-strong'),
      'danger-strong-hover': c('danger-strong-hover'),
      'danger-soft-line': c('danger-soft-line'),
      'danger-soft-line-hover': c('danger-soft-line-hover'),
      success: c('success'),
      'success-fg': c('success-fg'),
      'success-soft': c('success-soft'),
      'success-line': c('success-line'),
      warning: c('warning'),
      'warning-fg': c('warning-fg'),
      'warning-soft': c('warning-soft'),
      'warning-line': c('warning-line'),
      'info-soft': c('info-soft'),
      // 提示条文字（sx-scoped.css:1170-1172）
      alert: { info: c('alert-info'), danger: c('alert-danger'), warning: c('alert-warning') },
      // 白瓷描边（智能体页材质，原型 AgentView.vue:2079 --soft-line）
      'soft-line': c('soft-line'),
      'soft-line-focus': c('soft-line-focus'),
      // 画布端口色（sx-scoped.css:1217-1228）
      port: { image: c('port-image'), video: c('port-video'), prompt: c('port-prompt'), audio: c('port-audio') },
      focus: c('focus'),
      skeleton: { a: c('skeleton-a'), b: c('skeleton-b') },
    },
  },
  shortcuts: [
    /*
     * ---- 主题桥接：老写法照常可用，自动跟主题走 ----
     * - bg-white / from-white / to-white / via-white / border-white 在本站一律是「卡面」的意思 → surface 令牌
     *   （浅色仍是 #fff；真要死白——色卡、白描边压在图上——写 bg-#fff）。text-white 不动：它压在实色 / 图片上，两套都该是白。
     *   透明度 < 60 的（bg-white/10、border-white/8）不转：那是压在深色底 / 图片上的「白色薄雾」，本来就该是白。
     * - text-violet / text-violet-press / text-danger / text-success / text-warning → *-fg 文字档（深色提亮到 ≥ 4.5；浅色同值）。
     *   描边、底色、开关仍用 fill 档，所以同名色在文字与色块上可以各取所需。
     */
    [
      /^(bg|from|to|via|border|outline|ring|divide)-white(?:\/(\d+))?$/,
      ([, p, a]) => (a && Number(a) < 60 ? undefined : `${p}-surface${a ? `/${a}` : ''}`),
    ],
    [/^text-(violet|danger|success|warning|violet-press)(?:\/(\d+))?$/, ([, n, a]) => `text-${n}-fg${a ? `/${a}` : ''}`],
    {
      // ---- 胶囊切换项：白底细描边轻拟物，选中 = 柔紫底内凹 ----
      'll-pill':
        'inline-flex items-center px-14px py-6px rounded-4px text-12px leading-none cursor-pointer select-none ' +
        'text-ink-2 bg-gradient-to-b from-plate-top to-plate-bottom border border-line-strong shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] ' +
        'transition-colors hover:(border-control-hover text-ink) active:(bg-surface3 shadow-[inset_0_1px_2px_rgba(31,35,41,0.12)])',
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
      'll-card': 'sx-squircle bg-surface rounded-18px border border-line shadow-panel',
      // ---- 主按钮（生成 CTA）：藤紫渐变 + 深描边 + 短投影，按下内凹 ----
      'll-btn-primary':
        'inline-flex items-center justify-center gap-8px rounded-999px text-on-accent text-14px font-600 cursor-pointer select-none ' +
        'bg-gradient-to-b from-violet-top to-violet-bottom border border-violet-border ' +
        'shadow-btn ' +
        'transition-all hover:(from-violet-hover-top to-violet-hover-bottom border-violet-press) ' +
        'active:(bg-violet-press from-violet-press to-violet-press shadow-press-accent) ' +
        'disabled:(bg-violet-disabled from-violet-disabled to-violet-disabled !border-violet-line cursor-not-allowed)',
      // ---- 危险文字操作 ----
      'll-danger-link': 'text-danger cursor-pointer hover:text-danger-hover-fg',
      // 输入/卡片空态文字
      'll-empty': 'text-center text-muted text-13px',

      // ======== sx-*：原型 v3 规范（docs/design/ui-design-spec.md §8.2），新代码优先用这一组 ========
      // ---- 曲率（材质对齐 2026-11-06）：只挂有圆角档位的组件；圆钮 50% / 胶囊 999 不挂，避免变超椭圆 ----
      'sx-squircle': '[corner-shape:squircle]',
      // ---- 渐变（§1.2）----
      'sx-grad-primary': 'bg-gradient-to-b from-violet-top to-violet-bottom',
      'sx-grad-plate': 'bg-gradient-to-b from-plate-top to-plate-bottom',
      'sx-grad-tint': 'bg-gradient-to-b from-surface to-violet-tint',
      'sx-grad-sunk': 'bg-[linear-gradient(var(--xq-surface3),var(--xq-sunk-bottom))]',
      'sx-grad-icon': 'bg-[linear-gradient(135deg,var(--xq-violet-icon-a),var(--xq-violet-icon-b))]',
      'sx-grad-upload': 'bg-gradient-to-b from-surface to-upload-bottom',
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
        'text-ink-2 sx-grad-plate border border-solid border-control shadow-btn-plate ' +
        'hover:(border-control-hover text-ink to-surface2) active:(border-control-press shadow-press from-surface3 to-surface2) ' +
        'disabled:(border-line bg-surface3 bg-none shadow-none text-placeholder cursor-not-allowed) sx-focus',
      'sx-btn-primary':
        'sx-squircle inline-flex items-center justify-center gap-6px h-32px px-12px rounded-14px text-13px font-600 leading-none cursor-pointer select-none ' +
        'text-on-accent sx-grad-primary border border-solid border-violet-border shadow-btn ' +
        'hover:(from-violet-hover-top to-violet-hover-bottom border-violet-press) ' +
        'active:(bg-none bg-violet-press border-violet-press-border shadow-press-accent) ' +
        'disabled:(bg-none bg-violet-disabled border-violet-line text-on-accent/80 shadow-none cursor-not-allowed) sx-focus',
      'sx-btn-ghost':
        'sx-squircle inline-flex items-center justify-center gap-6px h-32px px-12px rounded-14px text-13px font-500 leading-none cursor-pointer select-none ' +
        'text-ink-2 bg-transparent hover:(bg-surface3 text-ink) active:bg-ghost-press sx-focus',
      'sx-btn-tint':
        'sx-squircle inline-flex items-center justify-center gap-6px h-32px px-12px rounded-14px text-13px font-500 leading-none cursor-pointer select-none ' +
        'text-violet-ink sx-grad-tint border border-solid border-violet-line hover:(from-violet-tint-top to-violet-tint-hover) sx-focus',
      'sx-btn-danger':
        'sx-squircle inline-flex items-center justify-center gap-6px h-32px px-12px rounded-14px text-13px font-500 leading-none cursor-pointer select-none ' +
        'text-danger bg-gradient-to-b from-danger-soft-top to-danger-soft border border-solid border-danger-line hover:border-danger sx-focus',
      // 提交大按钮（ToolSubmitBar：56 高、两行；材质对齐：按钮档位 r14）
      'sx-submit':
        'sx-squircle flex w-full h-56px flex-col items-center justify-center gap-3px px-12px rounded-14px text-on-accent cursor-pointer select-none ' +
        'sx-grad-primary border border-solid border-violet-border shadow-btn ' +
        'hover:(from-violet-hover-top to-violet-hover-bottom border-violet-press) ' +
        'active:(bg-none bg-violet-press shadow-press-accent) ' +
        'disabled:(bg-none bg-violet-disabled border-violet-line text-on-accent/80 shadow-none cursor-not-allowed) sx-focus',
      // 设置按钮 / 模型字段 / 选项按钮共用的 44 高触发条（原型 .op-model：r14 档）
      'sx-field-btn':
        'sx-squircle flex items-center h-44px pl-11px pr-24px rounded-14px text-left cursor-pointer sx-grad-plate border border-solid border-control shadow-plate ' +
        'hover:border-control-hover sx-focus',
      // ---- 输入（§4.1：高 34、焦点 violet 描边 + 3px 外环；材质对齐：输入档位 r15）----
      'sx-input':
        'sx-squircle h-34px px-10px rounded-15px bg-surface text-13px text-ink border border-solid border-control shadow-inset-input outline-none ' +
        'placeholder:text-placeholder hover:border-control-hover focus:(border-violet shadow-focus) ' +
        'disabled:(border-line bg-surface3 text-placeholder cursor-not-allowed)',
      'sx-well': 'bg-surface rounded-md border border-solid border-line shadow-well',
      // ---- 分段控件 ----
      'sx-seg':
        'sx-squircle inline-flex items-center gap-2px p-2px rounded-md bg-surface3 border border-solid border-line shadow-inset-input',
      'sx-seg-item':
        'sx-squircle inline-flex items-center justify-center h-30px px-9px rounded-sm text-11px text-ink-2 border border-solid border-transparent cursor-pointer select-none ' +
        'transition-all duration-seg ease-std active:shadow-[inset_0_1px_2px_rgba(80,55,95,0.16)] disabled:(opacity-45 cursor-not-allowed)',
      'sx-seg-on': 'sx-grad-tint !border-violet-line !text-violet-ink font-600 shadow-hairline',
      // ---- 页签 ----
      'sx-pilltab':
        'inline-flex items-center h-32px px-12px rounded-lg text-14px font-500 text-ink-2 cursor-pointer select-none hover:bg-surface3',
      'sx-pilltab-on': 'bg-violet-pill font-600 text-ink',
      // ---- 卡片与面板（§3 + 材质对齐：面板/卡片档位 r18；raised 资产卡保持 r8 不变）----
      'sx-card': 'sx-squircle bg-surface rounded-18px border border-solid border-line shadow-card',
      'sx-card-panel': 'sx-squircle bg-surface rounded-18px border border-solid border-line shadow-panel',
      'sx-card-raised':
        'bg-raised rounded-lg border border-solid border-raised-line shadow-raised transition-all duration-180 ease-[ease] ' +
        'hover:(border-raised-hover shadow-raised-hover)',
      'sx-section':
        'sx-squircle flex flex-col gap-8px p-12px bg-surface rounded-18px border border-solid border-line shadow-card-v3',
      'sx-pop': 'sx-squircle bg-overlay rounded-18px border border-solid border-line shadow-pop',
      // ---- 导航 / 列表行（§4.1：r6、透明描边，hover #f3f4f5，选中内凹灰）----
      'sx-row':
        'flex items-center rounded-md border border-solid border-transparent bg-transparent text-left cursor-pointer hover:bg-surface3 sx-focus',
      'sx-row-on': '!border-line sx-grad-sunk shadow-sunk hover:sx-grad-sunk',
      // ---- 历史卡（材质对齐：r18 档，与 74 高卡片规格配套）----
      'sx-hist-card':
        'sx-squircle flex gap-10px p-10px rounded-18px bg-surface border border-solid border-line cursor-pointer ' +
        'hover:(border-control shadow-hairline)',
      'sx-hist-card-on': '!border-violet-line sx-grad-tint',
      // ---- 上传区 / 叠片 ----
      'sx-upload':
        'min-h-150px p-12px rounded-lg border border-solid border-control sx-grad-upload transition-colors duration-200 ' +
        'hover:(border-violet-line to-upload-hover-bottom)',
      'sx-plate': 'w-60px h-100px rounded-plate border border-solid border-surface shadow-thumb',
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
      'sx-hit':
        'relative after:(content-empty absolute -inset-4px rounded-[inherit]) [@media(pointer:coarse)]:after:-inset-6px',
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
      // 压在图片 / 视频上：半透明玻璃底 + 模糊（浅色白玻璃、深色深玻璃），深浅图上都看得清
      'sx-iconbtn-overlay':
        '!bg-none !bg-[var(--xq-glass)] !border-[var(--xq-glass-line)] !text-ink backdrop-blur-6px !shadow-overlay-btn hover:!bg-surface',
      'sx-iconbtn-danger': 'hover:(!text-danger !border-danger-line !bg-none !bg-danger-soft)',
      // 悬停才出现的操作：触屏（无 hover）与键盘聚焦时始终可见，否则移动端点不到
      'sx-reveal':
        'opacity-0 transition-opacity duration-fast group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100 ' +
        '[@media(hover:none)]:opacity-100',
      // ======== sx-soft-*：「白瓷」材质（智能体页 2026-11-07 对齐原型 AgentView.vue:2029-2079），只在显式使用处生效 ========
      // 面：白 → #f8f9fa；线：#c9cdd0；影：短外影 + 顶高光 + 底部内凹
      'sx-soft-bg': 'bg-[linear-gradient(var(--xq-surface),var(--xq-soft-bottom))]',
      'sx-soft': 'sx-soft-bg border border-solid border-soft-line shadow-soft',
      // 工具钮（.sx-btn--sm）：28 高 r14、12px、灰字；悬停藤紫细线 + 藤紫字；按下内凹
      'sx-soft-btn':
        'sx-squircle inline-flex flex-none items-center justify-center gap-5px h-28px px-12px rounded-14px text-12px font-500 leading-none whitespace-nowrap cursor-pointer select-none ' +
        'sx-soft text-muted [transition:border-color_.12s,background_.12s,color_.12s,box-shadow_.12s] motion-reduce:transition-none ' +
        'enabled:hover:(border-violet-line bg-none bg-surface text-violet-ink shadow-soft-hover) enabled:active:shadow-[inset_0_1px_2px_rgba(31,35,41,0.10)] ' +
        'disabled:(opacity-50 cursor-not-allowed shadow-none) sx-focus ' +
        // 视觉 28 高，命中外扩 2px → 32；触屏外扩 6px → 40
        'relative after:(content-empty absolute -inset-2px rounded-[inherit]) [@media(pointer:coarse)]:after:-inset-6px',
      // 主钮：藤紫渐变 + 白字
      'sx-soft-btn-primary':
        '!border-violet-border !bg-[linear-gradient(var(--xq-violet-top),var(--xq-violet-bottom))] !text-on-accent !shadow-btn ' +
        'enabled:hover:(!bg-[linear-gradient(var(--xq-violet-hover-top),var(--xq-violet-hover-bottom))] !text-on-accent) ' +
        'enabled:active:(!bg-none !bg-violet-press !shadow-press-accent)',
      // 色调钮：白 → #fbf8fd、藤紫字
      'sx-soft-btn-tint':
        '!border-violet-soft-line !bg-[linear-gradient(var(--xq-surface),var(--xq-violet-soft-tint))] !text-violet-ink !shadow-hairline ' +
        'enabled:hover:(!border-violet-line !bg-none !bg-surface !shadow-soft-hover)',
      // 危险钮：白底、#f0c9c7 线、#c24545 字；悬停浅红底
      'sx-soft-btn-danger':
        '!border-danger-soft-line !bg-none !bg-surface !text-danger-strong ' +
        'enabled:hover:(!border-danger-soft-line-hover !bg-danger-soft !text-danger-strong-hover)',
      // 白瓷输入：r15、鼠标聚焦往里凹（#b9bfc4 线）不加外环；键盘聚焦（focus-visible）另加 2px 藤紫外环，保证可见
      'sx-soft-input':
        'sx-squircle box-border h-30px rounded-15px sx-soft px-12px text-12px text-ink outline-none placeholder:text-placeholder ' +
        '[transition:border-color_.12s,box-shadow_.12s] motion-reduce:transition-none focus:(border-soft-line-focus shadow-soft-focus) ' +
        'focus-visible:(border-violet-line outline outline-2 outline-solid outline-violet outline-offset-1)',

      // ---- 徽标 / 小圆钮 ----
      'sx-chip': 'inline-flex items-center h-20px px-6px rounded-xs text-11px leading-none',
      // 上传缩略图角上的小圆钮：视觉 20，命中 ≥ 32（after -6px），触屏 44
      'sx-medbtn':
        'relative grid place-items-center w-20px h-20px rounded-full border border-solid border-control bg-surface text-ink-2 cursor-pointer ' +
        'after:(content-empty absolute -inset-6px rounded-full) [@media(pointer:coarse)]:after:-inset-8px hover:border-control-hover sx-focus',
    },
  ],
})
