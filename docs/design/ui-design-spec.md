# 小岐AI Web · UI 设计规范与差距报告

> 依据：产品原型 `/Users/apple/Project/xiaoqi-tools-5183`（下称 **原型**，v1.2.1，默认外壳 `html.shell-v3`）。
> 对照：本仓库 `fusion-aigc-web`（下称 **我方**）。
> 生成日期：2026-11-03。本文件只读产出，未改动任何源码与 `uno.config.ts`。
>
> 原型取值优先级：`src/styles/sx-scoped.css`（`--sx-*`，组件地图 §9 定为权威 token）＞ `src/styles/v3-theme.css`（`--v3-*` 与 `html.shell-v3` 覆盖）＞ 组件 scoped 样式 ＞ `src/theme/tokens.ts`（旧 `--color-*`，被 v3 覆盖）。`?shell=v2`、`desktop-ui.css`（仅 pilot 页）、`styles/scoped/*` 视为旧版，不作规范。
>
> **重要换算**：原型 v3 下 `.app-view .rounded-2xl / .rounded-xl` 一律强制为 `8px`（`v3-theme.css:87-90`）。所以原型模板里写的 Tailwind `rounded-2xl(16)/rounded-xl(12)`，实际都是 **8px**。
>
> 路径简写：`P:` = 原型 `src/`，`W:` = 我方 `src/`。

---

## 1 设计 Token

### 1.1 颜色

| 角色 | 原型 token | 值 | 原型出处 | 我方 uno 色名 | 状态 |
|---|---|---|---|---|---|
| 主色 藤紫 | `--sx-violet` / `--v3-violet` | `#875f9a` | P:styles/sx-scoped.css:17 | `violet` | MATCH |
| 主渐变上 | `--sx-violet-top` | `#8a639f` | sx:18 | `violet-top` | MATCH |
| 主渐变下 | `--sx-violet-bottom` | `#7a548c` | sx:19 | `violet-bottom` | MATCH |
| 深紫 | `--sx-violet-deep` | `#6b487c` | sx:20 | `violet-deep` | MATCH |
| 按下 | `--sx-violet-press` | `#5f3f6f` | sx:21 | `violet-press` | MATCH |
| 主按钮描边 | `--sx-violet-border` | `#6a487b` | sx:22 | `violet-border` | MATCH |
| 柔紫底 | `--sx-violet-soft` | `#f3edf8` | sx:23 | `violet-soft` | MATCH |
| 柔紫底 2 | `--sx-violet-soft-2` | `#ede3f2` | sx:24 | `violet-soft-2` | MATCH |
| 紫描边 | `--sx-violet-line` | `#d9c7e3` | sx:25 | `violet-line` | MATCH |
| 紫字 | `--sx-violet-ink` | `#6b487c` | sx:26 | `violet-ink` | MATCH |
| 选中渐变终点 | （字面量） | `#f8f3fc` | sx:200,487 | — | MISSING |
| 主按钮 hover 渐变 | （字面量） | `#9a6fae → #875c9a` | sx:169 | 写死在 `ll-btn-primary` | 无 token |
| 主按钮禁用底 | （字面量） | `#cbb9d5` | sx:174 | 写死 | 无 token |
| 页面底 | `--sx-page` | `#f5f6f7` | sx:29 | `page` | MATCH（但 layout 写死了 `#f5f6f8`，见 §7） |
| 卡面 | `--sx-surface` | `#ffffff` | sx:30 | white | MATCH |
| 次级面 | `--sx-surface-2` | `#f7f8f9` | sx:31 | `surface2` | MATCH |
| 三级面 | `--sx-surface-3` | `#f3f4f5` | sx:32 | `surface3` | MATCH |
| 凹陷面 | `--sx-sunken` | `#eff1f3` | sx:33 | `sunken` | MATCH |
| 幽灵按钮按下 | （字面量） | `#e9ecef` | sx:195 | — | MISSING |
| 标题字 | `--sx-ink` | `#1f2329` | sx:44 | `ink` | MATCH |
| 正文字 | `--sx-ink-2` | `#4b5563` | sx:45 | `ink-2` | MATCH |
| 次要字 | `--sx-muted` | `#5f6673` | sx:46 | `muted` | MATCH |
| 占位、计数 | `--sx-placeholder` | `#6e7681` | sx:47 | `placeholder` | MATCH |
| 分割线 | `--sx-line` | `#e5e7eb` | sx:34 | `line` | MATCH |
| 弱分割 | `--sx-line-soft` | `#eff1f3` | sx:35 | `line-soft` | MATCH |
| 强分割、虚线 | `--sx-line-strong` | `#d9dde2` | sx:36 | `line-strong` | MATCH |
| 控件描边 | `--sx-control-line` | `#c9cfd6` | sx:37 | — | MISSING（我方写死 `#c9cfd6` 共 8 处） |
| 控件描边 hover | `--sx-control-line-hover` | `#aeb6bf` | sx:38 | — | MISSING（写死 5 处） |
| 控件按下描边 | （字面量） | `#b9c0c8` | sx:149 | — | MISSING |
| 浮起卡描边、hover | `--sx-card-raised-line(-hover)` | `#cecece` / `#bdbdbd` | sx:40-41 | — | MISSING |
| 外壳分隔线 | （字面量） | `#e2e2e2` | P:App.vue:441,476 | — | MISSING |
| 危险 | `--sx-danger` / top / soft / line | `#b4433e` / `#c1524c` / `#fdf1f0` / `#ecc9c6` | sx:51-54 | `danger*`（缺 top） | 基本 MATCH |
| 成功 | `--sx-success` / soft / line | `#34795a` / `#f0f8f4` / `#c7e3d5` | sx:55-57 | `success*` | MATCH |
| 警告 | `--sx-warning` / soft / line | `#94651f` / `#fbf4e8` / `#ead8b9` | sx:58-60 | `warning*` | MATCH |
| 信息 | `--sx-info` / soft | `#875f9a` / `#f5eff8` | sx:61-62 | `info-soft` | MATCH |
| 提示条文字 | （字面量） | info `#654876`，danger `#8f4b47`，warning `#7d5a20` | sx:1170-1172 | — | MISSING |
| 端口色（点/标签底/标签字） | （字面量） | 图片 `#3f7f96/#e2f2f8/#1d4b5e`，视频 `#b45650/#fae3e1/#6b2723`，提示词 `#3e8e6a/#dff3e7/#1f5138`，音频 `#875f9a/#f0e7f7/#553267` | sx:1217-1228 | — | MISSING |
| 遮罩 | modal/drawer mask，`.sx-scrim` | `#00000080`，`rgba(31,35,41,.22)` | P:styles/globals.css:824，sx:1138 | — | MISSING |
| 加载蒙层 | `.sx-loading` | `rgba(255,255,255,.8)` | sx:1175 | — | MISSING |
| 文字选中色 | `::selection` | `#e7d9ef` | sx:120（注：只在 `.sx-root` 下生效，实际未挂载） | — | 可选 |

### 1.2 渐变（精确色标）

| 用途 | 值 | 原型出处 |
|---|---|---|
| 主按钮 | `linear-gradient(#8a639f, #7a548c)`（Naive 版写作 180deg，0%→100%） | sx:164，P:theme/v3.ts:149 |
| 主按钮 hover | `linear-gradient(#9a6fae, #875c9a)`；Naive 版 `#926ba6→#835a96` | sx:169，v3:156 |
| 主按钮按下 | 纯色 `#5f3f6f`（Naive 版 `#6b487c→#5f3f6f`） | sx:172，v3:161 |
| 主按钮加载中 | `linear-gradient(#7a548c, #6b487c)` | sx:184 |
| 运行、图标主按钮 hover | `linear-gradient(#90679f, #80588f)` | sx:271,609 |
| 默认按钮（板材） | `(#ffffff, #fbfcfc)`；hover `(#fff, #f7f8f9)`；按下 `(#f3f4f5, #f7f8f9)` | sx:136,147,150 |
| 选中项、色调按钮、分段选中 | `180deg, #ffffff 0% → #f8f3fc 100%`；hover `#fdfbff → #f1e8f9` | sx:200,204,487 |
| 危险按钮 | `(#fff7f6, #fdf1f0)`；实心 `(#c1524c, #b4433e)` | sx:219,227 |
| 内凹选中（导航、行） | `linear-gradient(#f3f4f5, #fafbfc)` | sx:903,1005，P:components/NextSidebar.vue:413-417 |
| 激活磁贴 | `radial-gradient(circle at 50% 35%, #fbf7fd 0%, #efe6f5 100%)` | sx:391 |
| 目录图标底板 | `135deg, #f6effa → #efe6f5` | P:components/NextDirectory.vue:495-507 |
| 功能卡（FunctionSwitcher） | `#fff → #fbf7fe` | P:components/tool/FunctionSwitcher.vue:313-323 |
| 上传、空态 | `(#ffffff, #f9fafb)`；hover `(#fff, #fbf7fd)` | sx:765，v3-theme.css:686,696 |
| 进度条 | `90deg, #8a639f → #7a548c` | sx:1044 |
| 骨架屏 | `90deg, #eff1f3 25%, #f3f4f5 37%, #eff1f3 63%`，`background-size: 400%` | sx:1052 |
| 发丝分割线 | `90deg, rgba(107,72,124,0) 0 → .16 12% → rgba(31,35,41,.13) 50% → .16 88% → 0` | sx:1310-1315 |

页面背景不用渐变，直接用纯色 `--v3-page`（v3-theme.css:80-85）。

### 1.3 阴影

| token | 值 | 出处 | 我方 |
|---|---|---|---|
| `--sx-shadow-card` | `0 10px 16px rgba(0,0,0,.04)` | sx:87 | 落地页白卡在用（W:views/picture/LandingPage.vue:41-46），无 token |
| `.sx-card` 完整叠层 | `inset 0 1px 0 #fff, inset 0 -1px 0 #eff1f3, var(--sx-shadow-card)` | sx:974 | agent 面板 `PANEL_SHADOW` 与之相同（W:views/agent/index.vue:57） |
| `--v3-shadow-card` | `0 1px 2px rgba(31,35,41,.04), 0 8px 18px rgba(31,35,41,.05)` | v3:55 | 工具页结果卡在用（W:views/tools/index.vue:1257） |
| `--sx-shadow-panel` | `0 2px 4px -1px rgba(31,35,41,.08), 0 10px 18px -10px rgba(31,35,41,.22)` | sx:92 | `ll-card`，MATCH |
| `--sx-shadow-pop` | `0 12px 24px rgba(31,35,41,.14), 0 2px 6px rgba(31,35,41,.06)` | sx:88 | CreationSettingsRow 弹层，写死（W:components/creation/CreationSettingsRow.vue:106） |
| `--sx-card-raised-shadow` | `0 1px 2px rgba(16,24,40,.06), 0 4px 12px rgba(16,24,40,.06)`；hover 加 `0 6px 16px rgba(16,24,40,.09)` | sx:42-43 | — |
| `--sx-shadow-btn` | `0 1px 1px rgba(90,60,110,.18), 0 2px 4px rgba(90,60,110,.18)` | sx:93 | 在 `ll-btn-primary` 里，MATCH |
| `--sx-shadow-cast-right` | `10px 0 16px -12px rgba(31,35,41,.22)` | sx:96 | 侧栏、目录，MATCH |
| `--sx-inset-plate` | `inset 0 1px 0 rgba(255,255,255,.9), inset 0 -1px 0 rgba(31,35,41,.04)` | sx:98 | 写死在设置按钮里 |
| `--sx-inset-press` | `inset 0 1px 2px rgba(31,35,41,.12), inset 0 0 0 1px rgba(31,35,41,.03)` | sx:99 | `ll-pill` 按下态只有第一层 |
| `--sx-inset-input` | `inset 0 1px 2px rgba(31,35,41,.055), inset 0 0 0 1px rgba(255,255,255,.7)` | sx:100 | — |
| B3.1 卡（生成卡、提示词框） | `inset 0 0 16px rgba(31,35,41,.12), inset 0 1px 0 rgba(31,35,41,.05)` | v3:2090 | ToolUploadSlot 卡，MATCH |
| 主按钮按下 | `inset 0 1px 3px rgba(40,24,48,.35)` | sx:173 | MATCH |
| 提示气泡、toast | `0 4px 10px rgba(31,35,41,.10)` | sx:1100,1148 | — |
| 悬浮预览卡 | `0 12px 28px rgba(31,35,41,.16), 0 2px 6px rgba(31,35,41,.06)` | P:components/HoverPreview.vue:118-127 | 我方是 `0 12px 32px .18`，DIFF |
| 输入框焦点环 | `0 0 0 3px rgba(135,95,154,.14)` | v3.ts:44，sx:657 | 我方是 `0 0 0 2px rgba(135,95,154,.18)`，DIFF |
| 画布节点 | `0 2px 4px rgba(16,24,40,.06), 0 16px 36px rgba(16,24,40,.13)` | P:styles/canvas-v31.css:30 | MATCH（W:views/canvas/editor/ui.ts:17） |

### 1.4 圆角

| token | 值 | 用途 |
|---|---|---|
| `--sx-r-1` | 3 | Tag、Checkbox |
| `--sx-r-2` = `--v3-radius` | 4 | 按钮、输入、分段项、工具栏按钮 |
| `--sx-r-3` | 6 | 设置按钮、模型行、导航项、目录项、历史缩略图、B3.1 卡 |
| `--sx-r-4` = `--v3-radius-card` | 8 | 卡片（v3 强制）、浮起卡、Naive Card/Popover/Dialog、上传区 |
| `--sx-r-5` | 10 | `.sx-card`、提交按钮、弹层、历史卡、功能卡 |
| `--sx-r-dialog` | 12 | 对话框 |
| `--sx-r-pill` | 999 | 胶囊 chip、开关 |
| 叠片（参考图槽） | 5 | 60×100 浮片 |

出处：sx:78-84，v3:53-54。

### 1.5 间距

- **6 栅格**（sx:69-76）：`--sx-s1..s8` = 3 / 6 / 9 / 12 / 18 / 24 / 30 / 36。
- **实际高频值**：卡内边距 12；卡间距、工具栏间距 8；页面内边距 16（工具页）/ 24（首页、落地页）；按钮内边距 `0 12`；输入内边距 `0 10`；字段 gap 5（sx:636）。
- **工具页密度 token**（v3:1779-1797，只在 `.tool-workspace-columns` 内生效）：

| token | A 档（默认） | B 档（`?density=b`） |
|---|---|---|
| `--tp-col-gap` | 16 | 8 |
| `--tp-card-pad` | 12 | 10 |
| `--tp-op-gap` | 8 | 6 |
| `--tp-preview-gap` | 10 | 8 |
| `--tp-upload-h` | 140 | 128 |
| `--tp-hist-row` | 56 | 48 |
| `--tp-form-h` | 30 | 28 |

### 1.6 字体

| 项 | 值 | 出处 | 我方 |
|---|---|---|---|
| 正文字族 | `'Smartisan Compact', 'Noto Sans SC', 'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', sans-serif` | v3:27，sx:65，v3.ts:13 | **MISSING**：全局没有设置字族（W:assets/base.css、W:App.vue 都没有） |
| 等宽、数字 | `'SFMono-Regular', 'Cascadia Code', Consolas, 'Liberation Mono', monospace` | v3:29，sx:66 | 只有 CanvasDetail 一处 |
| 抗锯齿 | `-webkit-font-smoothing: antialiased` | v3:62 | MISSING |
| 基础字号 | Naive 13 / 1.55；body 14 / 1.43 | v3.ts:89,96，globals.css:818 | `#app` 14（W:assets/base.css:24），Naive 用默认值 |
| 字号下限 | 11px，不设 12 这一档 | v3:65 | 我方大量使用 12 |
| 字重 | 400 / 500 / 600 | v3.ts | 同 |

### 1.7 图标

| 项 | 原型 | 我方 |
|---|---|---|
| 图标库 | `@vicons/ionicons5`（84 处导入）+ 自定义 `components/icons/qi-tool-icons.mjs`（24 个，24×24，单色，currentColor） | 没有图标包；iconfont（`icon-ic_*`，23 个字形）+ 62 个文件内联 SVG |
| 包装组件 | `AppIcon.vue`：`{component, size?}`，默认 16，`aria-hidden`（P:components/AppIcon.vue:8-12） | 无 |
| 工具图标线宽 | `qiToolIcon()`：`viewBox 0 0 24 24`，`fill none`，`stroke currentColor`，线宽 ≤18px 用 1.7、否则 1.6，圆头圆角（P:components/icons/qi-tool-icon.ts:22-35） | 导航 1.5，目录、工具 1.6，信息 1.8，CTA 箭头 2.4（W:views/layout/Navigation/index.vue:85-111，W:views/home/tools.ts） |
| 常用尺寸 | rail 22，侧栏 18，箭头 12，`.sx-medbtn` 20 圆内放 12 图标，首页卡 44 底板内放 20 | 侧栏 18，箭头 12，首页卡 44 内放 20：MATCH |

### 1.8 滚动条与层级

- **滚动条（全局）**：10px，轨道透明，滑块 `rgba(0,0,0,.18)` 带 2px 透明边框（`background-clip: padding-box`），最小高 40，r999，hover `.32`，过渡 .2s（globals.css:819-823）。浮层和目录面板内是 4px，滑块 `#d9dde2`，r2（sx:1660-1665）。
  - 我方 less mixin 是 12px，滑块 `#ccc`、hover `#999`，r10（W:assets/variables.less:4,19）：DIFF。
- **z-index**：

| 层 | 值 | 出处 | 我方 |
|---|---|---|---|
| 上传标签 | 2 | v3:516 | — |
| 卡内小按钮 | 12 | v3:2158 | — |
| rail 提示气泡 | 32 | 文档 | — |
| 目录槽 | 34 | P:App.vue:440 | — |
| `.v3-fly` 浮层 | 36 | P:NextSidebar.vue:587 | — |
| 侧栏 | 38 | P:NextSidebar.vue:319 | **60**（W:views/layout/Navigation/index.vue:321） |
| 弹层 | 40+ | — | — |
| 模型浮层 | 260 | P:components/tool/ModelSelect.vue:475 | — |
| 目录浮层 | 140 | P:App.vue:453 | — |
| 灯箱 | 3000 | P:components/MediaPreview.vue | — |

---

## 2 文字角色

| 角色 | 字号 / 字重 / 行高，颜色 | 原型出处 | 我方现值 | 状态 |
|---|---|---|---|---|
| 页面标题 h1（首页、目录页） | 20 / 600 / 28，`#1f2329` | NextSidebar.vue:356（品牌 20/600/1.2），StudioView.vue:69-73，docs/STUDIO-NOTES.md:123 | 首页 20/600/28（W:views/home/index.vue:58） | MATCH |
| 落地页 h1（探索页） | 24 / 600 / 32 | P:views/explore/AiExploreView.vue:207 | 22/600/30（W:views/picture/LandingPage.vue:60） | DIFF |
| 工具名、顶栏标题 | 15 / 600 / 20 | 组件地图 §11.4，FunctionSwitcher.vue:363-365 | 15/600/20（W:views/tools/index.vue:744） | MATCH |
| 区块、模块标题 | 16 / 600 / 22 | STUDIO-NOTES:123-147，sx:1961 | 16/600/22（LandingPage:139） | MATCH |
| 卡片标题 | 14 / 600 / 20 | v3:105-109，sx:1111 | `ll-section-title` 14/600 | MATCH |
| 卡内小节 | 13 / 600 / 20 | sx:996 | — | 无统一类 |
| 正文、输入文字 | 13 / 400 / 20（textarea 行高 1.6） | sx:649,662，OperatePanel.vue:786 | 13/20 | MATCH |
| 次要文字、提示 | 11 / 1.55，`#5f6673` | v3:123-127，sx:638 | 11–12 混用 | DIFF |
| 表单标签 | 11 / 500，`#4b5563`（设置弹层内 12/18） | v3:118-122，sx:637，SettingsPopover.vue:619-625 | `ll-label` 13，`#4b5563`（W:uno.config.ts:80） | DIFF |
| 分组标题、caption | 11 / 600，字距 .04em | sx:1481-1494 | 目录分组 12/500/18（Navigation:621），工具目录 12/600（W:views/tools/index.vue:651） | DIFF |
| 按钮 | 13 / 500（主按钮 600）；sm 11；lg 14 | sx:139-140,167,237 | `ll-btn-primary` 14/600 | DIFF |
| 提交大按钮 | 16 / 22 / 600 白字；第二行 11 白字 74% | ToolSubmitBar.vue:236-239,217-220 | CreationActionBar 15/600/20，第二行 11/15 透明度 85%（W:components/creation/CreationActionBar.vue:60,68） | DIFF |
| 徽标、chip、tag | 11，高 20 / 22，r3 | sx:1032,735-746，v3:231-234 | `ll-chip` 11，py2（约 15 高），r4 | DIFF |
| 占位文字 | `#6e7681` | sx:653 | `placeholder` | MATCH |
| 计数 | 11 / 16，`#6e7681`，等宽数字 | OperatePanel.vue:837-842 | 11/16 `placeholder`（CreationPromptInput.vue:63） | MATCH（位置不同，见 §7） |
| 下拉选项 | 12 / 18 | v3:267-268 | — | — |
| 统计数字 | 20 / 600 / 1.15 | sx:1049 | — | — |

---

## 3 表面（卡片、面板、阴影、渐变）

| 表面 | 规格 | 原型出处 |
|---|---|---|
| `.sx-card`（标准卡） | 1px `#e5e7eb`；r10；白底；阴影 `inset 0 1px 0 #fff, inset 0 -1px 0 #eff1f3, 0 10px 16px rgba(0,0,0,.04)`。`--pad` 变体内边距 14；卡头 `11px 14px`，标题 13/600 | sx:969-996 |
| 三栏面板卡 | 同 `.sx-card`，阴影换成 `--sx-shadow-panel` | v3:1030-1034 |
| StudioSplit 内的 section 卡 | 内边距 12，1px line，r8，白底，`--v3-shadow-card`，gap 8 | v3:487-500 |
| 浮起卡 `--raised` | 1px `#cecece`，r8，`raised-shadow`；hover 描边 `#bdbdbd` + hover 阴影，过渡 .18s ease | sx:979-989 |
| B3.1 生成卡（C-05） | 宽 434，r6，无外阴影，`inset 0 0 16px rgba(31,35,41,.12), inset 0 1px 0 rgba(31,35,41,.05)`；1440×1000 下高 742，900 高屏下 642 | v3:2080-2091，docs/组件地图与规范-2026-10-27.md:177 |
| 弹层（模型、设置、目录浮层） | 1px line，r10，`--sx-shadow-pop`，入场 120ms：淡入 + 4px 位移 | SettingsPopover.vue:263-291，ModelSelect.vue:475-496 |
| 对话框 | r12（Naive 版 r8），标题 16/600 | sx `--sx-r-dialog`，v3.ts:260 |
| 结果舞台 | 最小高 320，1px line，r8，20px 棋盘格，`inset-input` | v3:1199-1225 |
| 侧栏投影 | `10px 0 16px -12px rgba(31,35,41,.22)` + 右边框 1px `#e5e7eb` | NextSidebar.vue:314-337 |
| 材质红线 | 选中态禁止用 `scale()`；同一层里不要混用内凹和浮起两种材质 | 组件地图 §11.7 |

---

## 4 交互状态与动效

### 4.1 状态

| 组件 | 默认 | hover | 按下 | 禁用 | 选中、焦点 | 出处 |
|---|---|---|---|---|---|---|
| 默认按钮 `.sx-btn` | 高 32，内边距 `0 12`，1px `#c9cfd6`，r4，板材渐变，`inset-plate + 0 1px 2px rgba(31,35,41,.05)`，13/500，字色 `#4b5563` | 描边 `#aeb6bf`，字色 `#1f2329`，底 `(#fff,#f7f8f9)` | 描边 `#b9c0c8`，`inset-press`，底 `(#f3f4f5,#f7f8f9)` | 描边 `#e5e7eb`，底 `#f3f4f5`，无阴影，字色 `#6e7681` | — | sx:127-161 |
| 主按钮 | 渐变 `#8a639f→#7a548c`，描边 `#6a487b`，`inset 0 1px 0 rgba(255,255,255,.18) + shadow-btn`，字重 600 | 渐变 `#9a6fae→#875c9a`，描边 `#5f3f6f` | 底 `#5f3f6f`，描边 `#5c3d6b`，`inset 0 1px 3px rgba(40,24,48,.35)` | 底 `#cbb9d5`，描边 `#d9c7e3`，字 `rgba(255,255,255,.8)` | 加载：渐变 `#7a548c→#6b487c`，spinner 12px、边框 1.5、0.7s 一圈 | sx:162-185,241-245 |
| 幽灵按钮 | 透明 | `#f3f4f5` | `#e9ecef` | — | — | sx:194-195 |
| 链接 | violet-ink | `#5f3f6f`，下划线偏移 3 | — | — | — | sx:216 |
| 输入框 | 高 34，1px `#c9cfd6`，`inset-input`，内边距 `0 10` | 描边 `#aeb6bf` | — | 描边 `#e5e7eb`，底 `#f3f4f5`，字 `#6e7681` | 焦点：描边 `#875f9a` + `0 0 0 3px rgba(135,95,154,.14)`；出错：描边 `#b4433e` + `0 0 0 3px rgba(180,67,62,.10)` | sx:640-663 |
| 分段控件 `.sx-seg--picker` | 轨道内边距 3，`#f3f4f5`，`inset-input`；选项高 30，内边距 `0 14`，r4 | — | `inset 0 1px 2px rgba(80,55,95,.16)` | 透明度 .45 | 选中：描边 violet-line，底 `#fff→#f8f3fc`，阴影 `0 1px 2px rgba(31,35,41,.05)`，字 violet-ink 600 | sx:435-497 |
| 胶囊标签 | — | 描边 `#c9cfd6`，底 `#f7f8f9` | — | .45 | 选中：violet-line / violet-soft / violet-ink，600 | sx:425-432 |
| 导航、列表行 | 1px 透明描边，r6 | 底 `#f3f4f5` | — | — | 描边 `#e5e7eb`，底 `linear-gradient(#f3f4f5,#fafbfc)`，阴影 `inset 0 1px 3px rgba(31,35,41,.1), inset 0 -1px 0 #fff` | NextSidebar.vue:379-417 |
| 历史卡 | 1px line，白底 | 描边 `#c9cfd6` + `0 1px 2px .05` | — | — | 描边 violet-line，底 `#fff→#f8f3fc` | StudioHistoryColumn.vue:1032-1052 |
| 素材格 | 浮起卡 | 浮起 hover | — | — | 额外加 `0 0 0 1px #875f9a` | v3:2119-2122 |
| 画布节点 | 节点阴影 | — | — | — | 加 `0 0 0 2px rgba(135,95,154,.18)` | sx:1190 |
| 通用焦点 | — | — | — | — | `outline: 2px solid #875f9a; outline-offset: 2px`；开关偏移 3 | v3:75-78，SxLiquidSwitch.vue:292 |

**规范与代码冲突**：设计规范 §3.2 写的是"输入框不加外环（描边 `#aeb6bf` + `inset 0 4px 4px rgba(31,35,41,.06)`）"，但代码实现的是 3px 外环。本文以代码为准，见 §9-Q3。

### 4.2 动效 token 与规则

| token | 值 | 出处 |
|---|---|---|
| `--sx-fast` | 110ms | sx:103 |
| `--sx-mid` | 180ms | sx:104 |
| `--sx-ease` | `cubic-bezier(.2,.7,.2,1)` | sx:105 |
| 标准缓动（Material） | `cubic-bezier(.4,0,.2,1)`：分段 300ms、入场 240/300ms | sx:480，motion-enter.css |
| 规则 | 过渡时长控制在 120–240ms；入场慢、退场快（420 进 / 240 出）；只用位移和淡入淡出，不用回弹 | docs/动效规格-2026-10-26.md §0 |

**常用过渡**：
- 分段控件 300ms `(.4,0,.2,1)`（sx:480）。
- rail 提示气泡 150ms，延迟 300ms（sx:1417）。
- 目录收起 150ms（sx:1506）；目录槽宽度 .2s ease（P:App.vue:444）。
- B2 浮层：`transform 240ms (.2,.7,.2,1)`，不做透明度变化（NextSidebar.vue:596-604）。
- 上传区描边、底色 .2s（v3:692）。
- 压沿空态：描边 160ms ease-out，阴影 240ms ease-out（sx-drop-pressed.css:32,46）。
- 参考图槽：悬停 200ms 后展开，移出 100ms 后收起，收起动画 240ms，宽度动画 220ms（MlReferenceSlots.vue:139-156,568）。
- 悬浮预览：延迟 320ms 出现，入场 120ms（HoverPreview.vue）。

### 4.3 关键帧

| 名称 | 动画内容 | 时长、缓动 | 出处 |
|---|---|---|---|
| `sx-spin` | 旋转 360 | 按钮内 .7s linear 无限；加载环 .8s | sx:243-245,1176 |
| `sx-indeterminate` | margin-left 从 -34% 到 100% | 1.2s ease-in-out 无限 | sx:1045 |
| `sx-shimmer` | 背景位置 100% → -100% | 1.4s 无限 | sx:1052 |
| `sx-toast-in` | 透明度 0、Y -4px → 原位 | 180ms `(.2,.7,.2,1)` | sx:1101 |
| `sx-preview-in` | 透明度 0、Y 4px → 原位 | 120ms ease both | v3:2129 |
| `motion-enter-up` | 透明度 0、X -24px → 原位 | `var(--motion-enter-duration,240ms) (.4,0,.2,1) var(--motion-enter-delay) both` | motion-enter.css:2-15 |
| `motion-col-in` | 透明度 0、X -24px → 原位 | `var(--motion-col-duration,300ms) (.4,0,.2,1)` | route-stagger.css:25-38 |
| `xq-logo-loader-*` | float / bounce / shine / pulse | 2.4s ease-in-out；1.2s `(.45,0,.35,1)`；2.4s `(.32,0,.1,1)`；2s | globals.css:827-835 |

**路由分列入场**（只在 AI 区内路由之间切换时生效）：
- 离场：透明度 + `translateX(14px)`，160ms ease-in。
- 入场：透明度 260ms ease-out，延迟 40ms。
- 三栏逐列入场：延迟 [30, 200, 500]ms，时长 [300, 360, 300]ms。
- 出处：route-stagger.css:8-23，useRouteStagger.ts:39-44。

**弹簧参数**：液态分段 k260 / c26；液态开关 k170 / c21.5，hover 时放大 1.06（useLiquidSegments.ts:94，SxLiquidSwitch.vue:83）。

**减少动效**：CSS 端在 route-stagger.css:40、motion-enter.css:16、liquid-controls.css:61、v3:2145 都有 `prefers-reduced-motion`；JS 端用 `useReducedMotion.ts`。

---

## 5 组件规格

每个组件只列：结构、数值、状态、使用规则。下列原型组件都在 `P:components/` 下，除非另有注明。

### 5.1 B1 主导航 NextSidebar
- **结构**：品牌区 → 一级导航 → 二级导航 → 底部（更新条 + 用户条）。
- **数值**：
  - 宽 204，内边距 12，右边框 1px `#e5e7eb`，z 38，`cast-right` 投影。
  - 品牌区 gap 10，logo 40 / r8；名称 20/1.2；副标题 11/16。
  - 导航项 gap 2。一级 `.v3-row` 高 44、14/500；二级 `.v3-sub` 高 40、左内边距 38、14/400；共用 gap 10、内边距 `0 10`、r6。
  - 底部 gap 16，内边距 `12 0`。更新条内边距 `10 10 8`、r8、用主按钮材质、12/18；更新条按钮高 22、内边距 `0 8`、r4、12px。
  - 用户条高 40，内边距 `0 6`，r8；头像 32。
- **状态**：hover 底 `#f3f4f5`；选中用 §4.1 的内凹灰配方。
- **规则**：导航项不加过渡；选中态不用紫底竖条（文档 §6 的旧写法已作废）。
- **出处**：NextSidebar.vue:314-563。
- **本项目入口（2026-11-09 起）**：首页 →「AI 创作」组（智能体 / 画布 / AI 图片 / AI 视频）→ 我的资产 / 任务中心 / 创意广场 / 提示词库。
  「工作流」「AI 电商」「AI 商拍」「本地生活」只隐藏（`hidden: true`），页面与路由保留可深链；子功能按图片 / 视频并进两个总览页与工具目录（见 §10 第 8 条）。

### 5.2 B2 目录 NextDirectory
- **数值**：
  - 展开宽 160，收起宽 44，左边框 1px `#e2e2e2`。
  - 头部高 48，内边距 `0 8 0 14`，标题 16；图标按钮 28 / r4。
  - 列表区内边距 `0 6 10`。组与组之间：上内边距 10 + 0.8px 刻线。组标题高 28、内边距 `0 8`、12px。
  - 条目高 48，内边距 `0 14 0 8`，gap 10，r6。图标 36 / r6，用 135° 渐变底板。名称 13/1.3，说明 11/1.35。
  - 收起条：图标 36，gap 2。悬浮气泡内边距 `5 11`，入场 420ms。
- **断点**：视口 ≥1440 时目录在布局内，展开或收起由用户决定；<1440 时布局里固定收成 44，点开时以浮层出现（left 204，top/bottom 8，宽 160，z 140，1px `#e2e2e2`，r10）。
- **出处**：NextDirectory.vue:381-608，P:App.vue:125-135,430-457。

### 5.3 功能卡 FunctionSwitcher（工具页面板头，C-04）
- **数值**：高 64；外边距 `12 12 0`；内边距 `12 14`；gap 12；1px `#e9dff2`；r10；底 `#fff→#fbf7fe`。缩略图 56×40；名称 15/20。
- **弹层**：宽 = 卡宽（最小 320），最大高 680，r10，`shadow-pop`，头部高 44。
- **列表**：搜索框高 32；分组标题高 28、11px；条目高 44、gap 9、r6；图标 36（分组模式下 24、无底板）；名称 14，说明 11。
- **出处**：FunctionSwitcher.vue:313-400，FunctionSwitchList.vue:113-215。

### 5.4 提示词区 OperatePanel `.op-prompt`（C-06）
- **结构**：参考图头部（MlReferenceHead）→ 输入框 → 底行（"输入润色"开关 + 计数）。
- **数值（ml 版）**：
  - 输入框最小高 220（视口 <1440 时 320），内边距 12，1px `#e5e7eb`，r6，白底。
  - 常驻内影 `inset 0 0 16px rgba(31,35,41,.12), inset 0 1px 0 rgba(31,35,41,.05)`。
  - textarea 13/20；ml 版内边距 `8 0 0`，在框内自己滚动，`field-sizing: fixed`。
  - 底行高 24，上外边距 6。计数 11/16、`#6e7681`、等宽数字，格式 `N / 3000`。润色开关 34×20。
- **状态**：聚焦时只加深内影，**不改描边、不加外环**；占位字用 `--sx-placeholder`。
- **规则**：提示词、描述类统一上限 3000 字，输入第 3001 字时要有明确提示（`PROMPT_LIMITS.standard`，P:data/function-schemas.ts:134-137）。
- **出处**：OperatePanel.vue:568-842，v3:2080-2091。

### 5.5 参数行 `.tool-op__bar`（C-14）
- **数值（ml 版）**：两列等宽 grid，gap 8，无上边框；整行吸底（`position: sticky; bottom: 0`），白底，`box-shadow: 0 12px 0 #fff`，z 3，上方再加一条 8px 白色伪元素作遮挡。
- **设置按钮**：
  - 高 44，内边距 `0 24 0 11`，r6，gap 6，材质同 `.sx-btn`。
  - 图标 13，violet。说明文字 11/16 muted；当前值 11/16/500，右对齐、超长省略；箭头距右 8。
  - 展开时：描边 `#b9c0c8`，底 `#f3f4f5→#f7f8f9`，`inset-press`。
- **规则**：参数行高 44，与下方 56 高的提交按钮间距 8。1440×900 下参数行 y=759–803，提交按钮 y=815–871。
- **出处**：OperatePanel.vue:603-713,1101-1166，docs/工具页-操作台六项整改-2026-10-26.md §3。

### 5.6 设置弹层 SettingsPopover（C-12 / C-13）
- **定位**：宽度等于按钮宽，左边与按钮对齐；默认在按钮上方 8px；上方空间不足 180 且下方更大时改到下方。最大高 `min(520, 可用高度)`，距视口边 12。入场 120ms：淡入 + 4px 位移。
- **数值**：
  - 头部高 44，内边距 `0 8 0 14`，标题 14；关闭钮 26 / r4。
  - 内容区内边距 `4 14 10`。分组标题 11/16/600。
  - 设置行：最小高 48，纵向排列 gap 6，内边距 `8 0`；弹层宽 ≥320（容器查询）时改横排，标签列 64、gap 10。标签 12/18。
  - 分段轨道：内边距 3，gap 2，1px line，r6，底 `#f3f4f5`。选项高 30、内边距 `0 9`、r4、**11px**；选中态同 §4.1 分段控件。
  - 选项多时按 5 列（或 4 列）grid 排；预设按钮高 28、2 列、gap 4；数字输入高 34。
- **出处**：SettingsPopover.vue:263-736。

### 5.7 模型字段与模型浮层 ModelSelect（C-09 / C-10 / C-11）
- **触发条**：与 §5.5 的设置按钮相同（高 44），图标 16。
- **浮层**：
  - 宽 = 触发条宽，上方或下方留 8px，最大高 `min(520, …)`，距视口边 12。
  - z 260，内边距 6，行间 gap 2，r10，1px line，`shadow-pop`。
  - 模型行：高 44，内边距 `0 10`，gap 10，r6，hover 底 `#f3f4f5`，选中态同分段。名称 13/18，标签 11/16。
- **规则**：模型是**列表行**（名称 + 能力标签），不是分段胶囊。
- **出处**：ModelSelect.vue:120-532。

### 5.8 提交按钮 ToolSubmitBar（C-17）
- **数值（ml 版）**：
  - 外层栏透明，无边框、无内边距。
  - 按钮整宽，高 56，r10，gap 3，内边距 `0 12`，主按钮材质。
  - 按钮内两行：第一行 16/22 白字；第二行 `消耗 N 点`，11px，白色 74%。余额不放进按钮。
- **加载态**：spinner 绝对定位在 left 14、垂直居中，文字位置不动。
- **Studio 版 StudioSubmitBar**：
  - 外层 r8（v3），内边距 `12 16`，gap 10，分两行（信息行 + 按钮行），每行 gap 12。
  - 余额 chip：`rounded-full px-2 py-0.5`；进度条高 4、宽 160；帮助按钮 26 圆，弹层最大宽 340。
  - 按钮变体：去充值 / 加载中 / 禁用（"还缺少…"）/ 再生成一次。
- **出处**：ToolSubmitBar.vue:169-239，studio/StudioSubmitBar.vue:27-201。

### 5.9 上传槽

| 变体 | 数值 | 出处 |
|---|---|---|
| `.v3-upload` 单图、视频 | 最小高 150（视频 160），gap 6，内边距 12，1px `#c9cfd6` 实线，r8，底 `#fff→#f9fafb`，`inset 0 1px 3px .04`；hover 描边 violet-line、底 `#fff→#fbf7fd`；拖入时描边 violet、底 violet-soft。图标 28 圆，标题 13/600，提示 11/1.5 | BatchImageZone.vue:388-418，SingleImageZone.vue:235 |
| 压沿空态（C-35，批量） | 静止 `1px dashed rgba(31,35,41,.10)`，r9；hover 改实线 `rgba(31,35,41,.16)` + 上沿内影；拖入时 violet；过渡 160/240ms；小球空态整体下移 36.8px | styles/sx-drop-pressed.css:32-101 |
| 叠片网格（C-37） | 5 列 × 60、4 行 × 100，列距 27、行距 72，容器 408×616；单片 60×100、1px 白描边、r5、`0 1px 3px rgba(31,35,41,.16)`，hover 时阴影 `0 2px 6px .2`；空间不够时整体缩放 `min(1, 宽/408, 高/400)` | BatchImageZone.vue:426-447 |
| 参考图槽 MlReferenceSlots（C-07/C-38） | 片 60×100、r5；叠放时 margin-left -54，只露 6px；展开步长 63（放不下时压缩，最小 8）；角色之间 gap 16；数字角标高 16、10px；"待上传"文字 9/13；素材云按钮 20 圆，挂在 right/bottom -12 | MlReferenceSlots.vue:548-872 |
| 普通批量网格 | `auto-fill minmax(120px,1fr)`，gap 8，缩略图 r6，删除钮用 `sx-medbtn`（20 圆，点击区 28） | BatchImageZone.vue:365-383 |
| 生成卡 C-05 外框 | 见 §3 | — |

### 5.10 历史列 StudioHistoryColumn（C-19）
- **列宽**：224（ml）或 240。
- **列表**：gap 8，内边距 `2 0 10`；按 `taskKind` 分组；ml 下每页 8 条，带搜索框（高 30、11px）和翻页按钮（26 / r4）。
- **历史卡**：
  - 内边距 10，gap 10，1px line，r10，白底。
  - 缩略图 44×44 / r6；多张时用偏移 3/6px 的叠影表示，张数角标高 16、10px。
  - 提示词 12/18，限两行；时间 11/16。
  - 操作按钮 20×20 / r4，与时间间距 4。
- **状态**：hover 和选中见 §4.1。
- **列头**：标题 14；头部操作按钮高 24。
- **空态**：占一张卡大小，高 65，内边距 `0 10`。
- **出处**：StudioHistoryColumn.vue:198-1300，v3:1427-1478,1976-1981。

### 5.11 结果列 ToolPreviewPanel
- **结构**：头部（标题 + 元信息 + 模式切换 + 下载）→ 舞台 → 候选图 → 前后对比。
- **数值**：
  - `.v3-preview` gap 10，内边距 12。标题 14/600；元信息 11；文件名最大宽 240。
  - 模式切换按钮高 26，内边距 `0 10`，11px。操作按钮高 28，内边距 `0 8`，r4，11px。
  - 舞台最小高 320（视口 <1440 时高 `min(52vh,480px)`），产物 contain 居中。
  - 候选图 4 列、gap 6，方形、r4，选中加 1px violet 光晕。
  - 前后对比高 `min(62vh,640px)`，最小 320。
- **生成中**：转圈 34 圆，2px 环，800ms 一圈；文案 11px。
- **空态**：最小高 220，内边距 18；图标 36 圆；标题 13；说明 11/1.55，最大宽 240。没有记录时整列显示 `ToolIntroPanel fill`。
- **规则**：结果卡**没有 hover 浮层**，操作都放在头部；点图片打开灯箱。
- **出处**：v3:1111-1276，ToolPreviewPanel.vue:195-566。

### 5.12 功能介绍 ToolIntroPanel
- gap 14，内边距 14（fill 版 18）。标题 14；正文 13/1.65。
- 适用场景块：内边距 10，1px line-soft，r6，`surface-2` 底。
- 出处：ToolIntroPanel.vue:86-124。

### 5.13 空态、错误态
- **`.sx-empty`**：最小高 150，gap 5，内边距 18，1px 虚线 `#d9dde2`，r8；标题 13/600；说明 11/1.65，最大宽 320（sx:1055-1057）。
- **C-22 规则**：图标 40 + 标题 13/600 + 说明 11；文案不要写"暂无数据"。
- **PageEmpty**：插画 274×146 → 下方 16px 放标题（16/600）→ 再下 4px 放说明（14）。
- **PageLoadError**：叹号圆 48，2px warning 环；标题在下方 12，14/500；副标题在下方 4，12；重试按钮在下方 12，small 尺寸。
- **StudioPreviewEmpty**：最小高 420，内边距 24，r8，gap 6；图标圆 56，内放 26 图标。
- **致命错误**：gap 10，内边距 40；标题 16；正文 12/1.6，最大宽 560；按钮高 32、r8（P:App.vue:382-412）。
- **离线提示**：原型没有独立的离线横幅；轮询失败走 `.sx-alert--danger`（文字 `#8f4b47`，底 `#fdf1f0`）。

### 5.14 其它基础件

| 组件 | 关键数值 | 出处 |
|---|---|---|
| CreationPillTabs（分类页签） | 高 32，内边距 `0 12`，r8，gap 2，14/500；选中为 AI 色 12% 混合底（即 `#f1ecf3`）+ 600 | CreationPillTabs.vue:52-72 |
| NumberStepper | 高 34，1px line，r4，`inset-input`；输入框宽 64、12px；加减按钮宽 30 | tool/NumberStepper.vue:125-177 |
| RangeControl（C-26） | 轨道点击区 18（视觉 4）；滑块 18 圆，阴影 `0 1px 3px .2`；数值最小宽 34、11px violet-ink；两端刻度 10/14 | tool/RangeControl.vue:92-158 |
| SxLiquidSwitch（C-28） | sm 34×20、滑块 14；md 46×26、滑块 18；轨道 1px `#c9cfd6`、r999；开启时用 violet 渐变 | liquid/SxLiquidSwitch.vue:262-295 |
| WakeSlider（C-30） | 柱宽 3，柱距 4，r3；轨道高 = height × 2.6；数值 14/20 violet-ink | motion/WakeSlider.vue:274-356 |
| ImageCompare（C-27） | 标签高 22、r999、底 `rgba(15,20,25,.5)`、11/20；分隔线 `drop-shadow(0 0 6px rgba(135,95,154,.55))`；拖柄 38 圆，主按钮材质 | ImageCompare.vue:310-389 |
| HoverPreview | 媒体尺寸：触发元素 ≤80 宽时 240，≤160 时 280，否则 320（弹窗内 220）；卡内边距 4，r8；媒体最大高 312 | HoverPreview.vue:10-168 |
| MediaPreview 灯箱 | z 3000；左右导航 44 圆、离边 24；工具栏 `px-6 py-3`，按钮 32 / r8；缩略格 56 / r8 | MediaPreview*.vue |
| PromptLibraryFlyout | 锚定浮层，宽 400，高 240–560，r10；头部高 48、15px；条目内边距 `9 10`、r6，标题 13/18，正文 11/16 | tool/PromptLibraryFlyout.vue:82-343 |
| FixedModelPicker | 行内边距 `9 10`、r12（v3 下为 8），头像 36；弹窗宽 680，4 列、gap 10，卡片图片高 150 | FixedModelPicker.vue:61-187 |
| ChoiceFieldButton | 触发条高 44；弹层内边距 6、r10；行高 44；grid 布局 3 列、高 34 | tool/ChoiceFieldButton.vue:254-388 |
| PointsBalanceChip | `rounded-full px-2 py-0.5`、12/16、等宽数字；加载时 56×12 骨架 | PointsBalanceChip.vue:13-30 |

---

## 6 页面布局（数值）

| 页面 | 原型布局 | 出处 |
|---|---|---|
| 外壳 | B1 主导航 204 + B2 目录 160 / 44 + 主区；三者之间各一条 1px `#e2e2e2` 分隔线；主区无顶栏（QuickBar 在 `/tools/*`、`/workflow`、`/explore/*`、`/local-life` 上隐藏）；<1440 时目录变浮层 | P:App.vue:84-135,430-476 |
| QuickBar（其余路由） | 高 52，内边距 `0 24`，下边框；切换按钮高 32、最大宽 360；弹层宽 340 | NextQuickBar.vue:104-203 |
| 工具箱首页 `/tools` | 头部 `pt24 pl24 pb8`，右侧 `24 + 滚动条宽`，gap 16；滚动区 `px24 pt8 pb24`，`scrollbar-gutter: stable`；网格 `repeat(auto-fill,minmax(240px,1fr))` gap 12；卡片 `p16 gap12`，**r8**（v3 强制）；图标底板 44 **r8**，内放 20 图标；描述限两行、最小高 40；hover 上抬 2px + `0 4px 16px` 8% 阴影；可选"新功能"区：mb20 pb20 + 下边框 | P:views/tools/ToolsView.vue:43-118 |
| 工具工作区 `/tools/:id` | 三栏 `460px 224px minmax(0,1fr)`（ml 默认），gap 16（B 档 8），页面内边距 16（≥1440 时左边 15）；视口 ≥1440 三栏等高、各栏内部滚动，<1440 单列堆叠、gap 14；左栏是一张 `.sx-card`，分三段：功能卡 64 / 操作区（伸缩）/ 页脚 `0 12 12` | ToolWorkspaceColumns.vue:112-333，v3:1779-2073 |
| Studio 首页 | 与工具箱首页相同 | StudioView.vue:63-78 |
| Studio 功能页 | 列模板 `--studio-cols`：普通功能 `minmax(360px,22%) minmax(0,1fr)`（两栏）；`historyInMiddle` 功能 `320px 300px minmax(0,1fr)`；手机预览类功能 `minmax(320px,22%) minmax(0,1fr)`；gap 12；滚动区内边距 `16 24 24`；头部 `py20 pl24`，含返回按钮、44 图标、步骤条（数字圆 22，连接线 24×1，最大宽 900）；≥1440 分列；操作列最大高 `calc(100vh-126px)`、内部滚动，上下 30px 渐隐；底部全宽历史面板（`historyInMiddle` 功能除外） | StudioFeatureBody.vue:42-225，StudioSplit.vue:45-196，v3:415-500 |
| 工作流 `/workflow` | 三栏 `460px 224px minmax(0,1fr)`，gap 16，页面内边距 16；左栏依次为模板头（64）→ 素材区 / 备注 / 流程板 → 设置（44）→ 提交（56）；中栏历史；右栏结果；≥1440 等高 | WorkflowView.vue:870-877,1404-1774 |
| 探索落地页 `/explore/:kind` | 最大宽 1180；内边距 `18 20 20`；h1 24/32；hero 行 `1fr 1fr 1.16fr`，gap 16，高 142；hero 卡 r12、`sx-shadow-card`、图片占宽 46%、正文内边距 `14 16`、名称 19/26；卡片网格**固定 4 列**、gap 12；卡片高 74，内边距 `0 14`，r10，图标 40 / r8，名称 14/20，副标题 11/17；按视口**高度**调整卡片和 hero 高度：≥960 → 78/156，≤880 → 64/124，≤760 → 58/112 | AiExploreView.vue:187-497 |
| 画布首页 `/canvas` | 顶栏高 56，内边距 `0 16`，标题 16；按钮高 32、r6、13px；主区宽 `min(1240px,100%-48px)`，内边距 `32 0 56`；hero 最小高 200，内边距 `24 20 28`，h1 24，正文 14、最大宽 560；chip 高 32；模板网格 3 列、gap 14，卡片内边距 12、r10，预览 112×76 / r8；工作流网格 2 列、gap 12，封面 88×58；≤980 单列 | CanvasHomeView.vue:242-656 |
| 画布编辑器 | 顶栏高 48，内边距 `0 12`，按钮高 30 / r4；素材面板宽 248（头 44 / 搜索 32 / 行 44）；左侧工具栏距左 12、底部工具栏距底 16，内边距 6，按钮 28 / r4；控制台 520×360；节点菜单宽 208；节点默认尺寸：文本 320×220、图片 240×200、模型 318×364、视频 338×350、工具 340×340；节点 r8，节点头高 36；端口 10px；点阵：点径 1.15px，间距 24 起、按缩放翻倍或减半保持在 13–42，颜色 `rgba(31,35,41,.2)` | canvas-v31.css:219-1328，useNodeResize.ts:5-10，docs/画布-点阵背景-2026-10-26.md |
| 资产页 `/assets` | 顶栏高 66，内边距 `14 20`；搜索框 230×30 / r6；类型页签高 37、最小宽 82、r8；chip 高 35；网格 `auto-fill minmax(194px,1fr)` gap 16；卡片 r12，媒体区高 120 | AssetsView.vue:878-1096 |
| 智能体 `/agent` | 目录列宽 280，内边距 `20 0 20 20`；对话区内容最大宽 780（左内边距 34），轮次间距 24；用户气泡最大宽 520；输入框 textarea 高 38–120，主按钮高 30 | AgentView.vue:828-1012 |
| 本地生活 | 主区 gap 24，内边距 `16 24 24`；侧栏 384，内边距 10，r8；视口 <1200 改为纵向堆叠 | LocalLifeView.vue:713-1525 |

---

## 7 差距报告

状态说明：
- **MATCH**：与原型数值一致。
- **DIFF**：数值不同（格式为"原型 → 我方"）。
- **MISSING**：我方没有对应实现。
- **EXTRA**：我方有、原型没有。

### 7.1 Token、全局

| 区域 | 状态 | 详情（原型 → 我方） | 我方 file:line | 原型 file:line |
|---|---|---|---|---|
| 主色 | DIFF | Naive `primaryColor` `#875F9A` → `#8E66F9`；`baseColor` 被设成了 `'red'` | W:App.vue:7-12 | P:theme/v3.ts:51-60 |
| 主色变量 | DIFF | `#875f9a` → `--main-color: #8e66f9`（less 页面用了 17 处） | W:assets/base.css:3 | sx:17 |
| Naive 主题 | MISSING | 我方缺：圆角 4；基础字号 13；按钮高 32/38；输入框高 34；选项高 34；Tag r3；Card r8 / 内边距 14 等 | W:App.vue:7-16 | P:theme/v3.ts:51-260 |
| 字族 | MISSING | `'Smartisan Compact','Noto Sans SC',…` → 未设置 | W:assets/base.css | v3:27 |
| 抗锯齿 | MISSING | `antialiased` → 无 | — | v3:62 |
| 正文色 | DIFF | `#4b5563` → body `#333333`；旧页面另有 `#3a3a3a`（79 处）、`#9e9e9e`（34 处） | W:assets/base.css:19 | sx:45 |
| 页面底 | DIFF | `#f5f6f7` → `#f5f6f8` | W:views/layout/index.vue:87 | sx:29 |
| uno 色板 | MATCH | 藤紫、中性、语义色全部一致 | W:uno.config.ts:29-63 | sx:15-62 |
| 控件描边色 | MISSING | `control-line #c9cfd6` / `#aeb6bf` / `#b9c0c8` 没有 token，全部写死 | uno.config.ts | sx:37-38,149 |
| 选中渐变 | MISSING | `#fff→#f8f3fc` 没有 token | — | sx:200 |
| 阴影 token | MISSING | `shadow-card` / `shadow-pop` / `raised` / `inset-plate` / `inset-press` / `inset-input` 都不是 theme 值，各处用任意值写死 | uno.config.ts | sx:87-100 |
| 圆角 token | MISSING | r1–r5 / dialog / pill 无语义名 | uno.config.ts | sx:78-84 |
| 间距 6 栅格 | MISSING | 3 / 6 / 9 / 12 / 18 / 24 / 30 / 36 无 token | — | sx:69-76 |
| 动效 token | MISSING | 110 / 180ms + `(.2,.7,.2,1)` 没有 token；我方另外还有 120 / 150 / 200 / 220 / 240 / 300ms 和四种缓动 | — | sx:103-105 |
| 输入焦点环 | DIFF | `0 0 0 3px rgba(135,95,154,.14)` → `0 0 0 2px rgba(135,95,154,.18)` | W:components/creation/CreationPromptInput.vue:48，W:views/tools/index.vue:575 | sx:657 |
| 通用焦点 outline | MATCH | 2px violet，偏移 2 | W:views/layout/Navigation/index.vue:168 | v3:75 |
| `ll-btn-primary` 圆角 | DIFF | 原型没有 999 这种主按钮：提交按钮 r10，`.sx-btn` r4 → 我方 `rounded-999px` | W:uno.config.ts:94-100 | sx:162，ToolSubmitBar.vue:221 |
| `ll-btn-primary` 字号 | DIFF | 13/600（提交按钮 16/600）→ 14/600 | uno.config.ts:95 | sx:167 |
| `ll-label` | DIFF | 11/500 → 13 | uno.config.ts:80 | v3:118-122 |
| `ll-chip` 高度 | DIFF | 高 20/22、r3 → py2（约 15 高）、r4 | uno.config.ts:85 | sx:735-746 |
| `ll-empty` | DIFF | 原型是框体空态 `.sx-empty`（虚线框、最小高 150、标题 + 说明）→ 我方只有一行 13px 灰字 | uno.config.ts:104 | sx:1055 |
| `ll-card` | MATCH | r10 + 1px line + `shadow-panel` | uno.config.ts:91 | sx:969 + v3:1030 |
| 滚动条 | DIFF | 10px、`rgba(0,0,0,.18)` / hover `.32`、r999、最小高 40 → 12px、`#ccc` / `#999`、r10 | W:assets/variables.less:4-19 | globals.css:819-823 |
| 侧栏 z-index | DIFF | 38 → 60 | Navigation:321 | NextSidebar.vue:319 |
| 图标库 | DIFF | `@vicons/ionicons5` + `qi-tool-icons`（线宽 1.7/1.6）→ iconfont + 内联 SVG（线宽 1.5/1.6/1.8/2.4 混用） | W:assets/iconfont/iconfont.css，Navigation:85-111 | qi-tool-icon.ts:22-35 |
| 图标包装组件 | MISSING | `AppIcon`（默认 16） → 无 | — | AppIcon.vue:8-12 |
| 断点 | MISSING | 1440（三栏、目录浮层）/ 1280 / 1200 / 980 → 外壳和工具页都没有 `@media` | — | StudioSplit.vue:45，App.vue:125 |

### 7.2 外壳、导航

| 区域 | 状态 | 详情 | 我方 | 原型 |
|---|---|---|---|---|
| 侧栏宽 | MATCH | 204 | Navigation:324 | NextSidebar.vue:330 |
| 侧栏收起 | EXTRA | 我方可以收成 44；原型 B1 不收起（收起的是 B2 目录） | Navigation:324 | — |
| 一级、二级行高 | MATCH | 44 / 40，二级左内边距 38 | Navigation:202,209 | NextSidebar.vue:393-404 |
| 导航行圆角 | DIFF | r6 → r8 | Navigation:171-173 | NextSidebar.vue:379-391 |
| 导航选中字重 | DIFF | 一级 500（选中不加粗）→ 选中 600 | Navigation:203-204 | NextSidebar.vue:393 |
| 选中配方 | MATCH | 内凹灰渐变 + 双层 inset | Navigation:176-178 | NextSidebar.vue:413-417 |
| 侧栏投影 | MATCH | `10px 0 16px -12px rgba(31,35,41,.22)` | Navigation:321 | sx:96 |
| 品牌副标题 | DIFF | 11/16 → 12/1.4 | Navigation:335 | NextSidebar.vue:356-368 |
| 侧栏顶部内边距 | DIFF | 12 → 13 | Navigation:323 | NextSidebar.vue:330 |
| 更新条内边距 | DIFF | `10 10 8`（左 10）→ 左 11 | Navigation:516 | NextSidebar.vue:440 |
| 用户条 | DIFF | 高 40、内边距 `0 6`、r8 → 上下内边距 9、外边距 `10 / 20` | Navigation:556-561 | NextSidebar.vue:533-563 |
| 二级目录面板宽 | MATCH | 160 | Navigation:582 | App.vue:432 |
| 目录头部内边距 | DIFF | `0 8 0 14` → 左右各 15 | Navigation:588 | NextDirectory.vue:388 |
| 目录条目内边距 | DIFF | `0 14 0 8` → 左 19（无图标时 40 高） | Navigation:644 | NextDirectory.vue:470-482 |
| 目录分组标题 | DIFF | 高 28、12px → 12/500/18 | Navigation:621 | NextDirectory.vue:457-466 |
| 目录名称、说明 | MATCH | 13/1.3、11/1.35（我方 13/18、11/16，等价） | Navigation:660,663 | NextDirectory.vue:521-536 |
| 外壳分隔线 | DIFF | 1px `#e2e2e2` 分隔线 → 只有投影 + `border-line` | Navigation:323 | App.vue:441,476 |
| 目录 <1440 浮层 | MISSING | 视口 <1440 时目录收成 44、点开为浮层 | — | App.vue:125-135,451-457 |
| QuickBar | MISSING | 52 高快捷栏（非工具路由用） | — | NextQuickBar.vue:104 |
| 余额 chip | MISSING | PointsBalanceChip | — | PointsBalanceChip.vue:13 |
| 致命错误页 | MISSING | 见 §5.13 | — | App.vue:382-412 |

### 7.3 工具工作区

| 区域 | 状态 | 详情 | 我方 | 原型 |
|---|---|---|---|---|
| 三栏列宽、间距、内边距 | MATCH | `460 / 224 / 1fr`，gap 16，内边距 16 | W:views/tools/index.vue:717 | ToolWorkspaceColumns.vue:113-117 |
| <1440 单列 | MISSING | 原型 <1440 堆叠、gap 14；我方固定三栏 | tools/index.vue:717 | v3:2070-2073 |
| ≥1440 左内边距 | DIFF | 15 → 16 | :717 | v3:1909 |
| 密度 B 档 | MISSING | `--tp-*` 两档 | — | v3:1779-1797 |
| 工具目录列 | EXTRA | 我方工具页内另有一列 160 / 60 的目录；原型用的是外壳 B2 目录（160 / 44） | tools/index.vue:591-592 | App.vue:430-448 |
| 目录列收起宽 | DIFF | 44 → 60 | :592 | App.vue:447 |
| 目录条目 | DIFF | 内边距 `0 14 0 8`、r6、高 48 → 左 19、右 8、上下 5、r8 | :667-675 | NextDirectory.vue:470 |
| 功能卡 | DIFF | 高 64 → 62；描边 `#e9dff2` → `#ede3f2`（violet-soft-2）；内边距 `12 14` → 左 15 / 右 10 | :727-729 | FunctionSwitcher.vue:313-323 |
| 功能切换弹层 | MISSING | 点功能卡弹出功能列表（宽 = 卡宽，最小 320） | — | FunctionSwitcher.vue:38-62 |
| 左卡材质 | MATCH | `ll-card` 等同于 `.sx-card` + `shadow-panel` | :719 | v3:1030 |
| 操作区内边距 | DIFF | 12，gap 12 → `pt12 px12 pb14`，gap 12 | :722-723 | OperatePanel.vue:542,1101 |

### 7.4 提示词区

| 区域 | 状态 | 详情 | 我方 | 原型 |
|---|---|---|---|---|
| 输入框圆角 | DIFF | r6 → r8 | W:components/creation/CreationPromptInput.vue:48 | v3:2080-2091 |
| 输入框材质 | DIFF | 常驻内影 `inset 0 0 16px .12` → 无内影，白底 + 描边 | :48 | OperatePanel.vue:778 |
| 聚焦 | DIFF | 只加深内影、不加外环 → 描边变 violet + 2px 外环 | :48 | OperatePanel.vue:782-785 |
| 最小高 | DIFF | 220（<1440 时 320）→ 无最小高，靠 `rows=4`（约 80px）；用户还能 `resize-y` 拖动 | :60 | OperatePanel.vue:720-727,656 |
| textarea 内边距 | DIFF | `8 0 0`（外框内边距 12）→ `10 12 4` | :60 | OperatePanel.vue:801-808 |
| 计数位置 | DIFF | 底行右侧、高 24、上外边距 6，与润色开关同一行 → 左下单独一行 | :63 | OperatePanel.vue:831-842 |
| 计数样式 | MATCH | 11/16 `#6e7681` | :63 | OperatePanel.vue:837 |
| 润色开关 | MISSING | 34×20 液态开关 + "输入润色"标签 | — | OperatePanel.vue:821-828 |
| 提示词库 | DIFF | 锚定浮层宽 400 → 模态框宽 720 | W:views/studio/components/PromptLibraryPicker/index.vue:95 | PromptLibraryFlyout.vue:82 |
| 参考图头部 | MISSING | MlReferenceHead（22 高、图标按钮 24） | — | MlReferenceHead.vue:52-80 |

### 7.5 参数行、设置弹层、模型字段

| 区域 | 状态 | 详情 | 我方 | 原型 |
|---|---|---|---|---|
| 设置按钮高（非 compact） | DIFF | 44 → 40 | W:components/creation/CreationSettingsRow.vue:65 | OperatePanel.vue:1117 |
| 设置按钮内边距 | DIFF | `0 24 0 11` → `0 10 0 12` | :65 | OperatePanel.vue:1117 |
| 设置按钮文字 | DIFF | 说明 11/16、当前值 11/16/500 → 说明 12/16、当前值 13/18 | :85-86 | OperatePanel.vue:1142-1159 |
| 设置按钮图标 | DIFF | 13 → 14 | :74 | OperatePanel.vue:1138 |
| 设置按钮（compact 路径） | MATCH | 高 44、`pl11 pr24`、文字 11 | W:views/tools/index.vue:981,1001 | OperatePanel.vue:1117 |
| 参数行布局 | DIFF | 两列等宽 grid、gap 8 → flex、gap 8（结果等价）；原型整行吸底，我方不吸底 | CreationSettingsRow.vue:51 | OperatePanel.vue:689-707,1104 |
| 弹层宽度、定位 | DIFF | 宽 = 按钮宽，在按钮上方 8px，可自动翻到下方 → 固定 340 宽 | CreationSettingsRow.vue:106，tools/index.vue:1024 | OperatePanel.vue:268-285 |
| 弹层头部 | DIFF | 高 44，内边距 `0 8 0 14` → 高 44，左右各 16 | CreationSettingsRow.vue:109 | SettingsPopover.vue:574 |
| 弹层内容区 | DIFF | `4 14 10` → 16 | :130 | SettingsPopover.vue:582 |
| 分段轨道 | DIFF | r6，底 `#f3f4f5`，1px line → CreationOptionPills 是 r8、`surface2`；工具页 compact 路径是 r6、`surface3`（MATCH） | W:components/creation/CreationOptionPills.vue:49 | SettingsPopover.vue:664 |
| 分段项 | DIFF | 高 30，内边距 `0 9`，r4，11px → OptionPills 是高 30、r6、13/500；compact 路径是 r4、13px、最小宽 55 | OptionPills:58，tools/index.vue:1043 | SettingsPopover.vue:675-684 |
| 分段选中底 | DIFF | `#fff→#f8f3fc` 渐变 + violet-line + violet-ink 600 → 白底 + line 描边（OptionPills）/ 白底 + violet-line（compact） | OptionPills:61，tools:1049 | SettingsPopover.vue:689 |
| 分段过渡 | DIFF | 300ms `(.4,0,.2,1)` → OptionPills 110ms | OptionPills:58 | sx:480 |
| 设置行标签 | DIFF | 12/18（横排时标签列 64）→ 12/500（compact）、13/18（行内） | tools:1029，OptionPills:42 | SettingsPopover.vue:619,719 |
| 模型字段 | DIFF | 44 高触发条 + 模型行列表浮层（名称 13/18 + 标签 11/16，行高 44）→ CreationModelPicker 只是分段胶囊，放在设置弹层里 | W:components/creation/CreationModelPicker.vue:28 | ModelSelect.vue:408-532 |
| 固定模特选择 | MISSING | FixedModelPicker（弹窗宽 680，4 列） | — | FixedModelPicker.vue |
| ChoiceFieldButton | MISSING | 44 高选项触发条 + 列表或 grid 浮层 | — | tool/ChoiceFieldButton.vue |
| NumberStepper | 未核对 | 原型高 34、输入框宽 64；我方 schemas 有 `stepper` 字段，具体数值未核 | tools/schemas.ts:73 | tool/NumberStepper.vue:125 |
| RangeControl / WakeSlider | MISSING | 滑块（C-26）、时长柱状滑条（C-30） | — | RangeControl.vue，WakeSlider.vue |
| 开关 | DIFF | 液态开关 34×20、滑块 14、弹簧动效 → 36×20、滑块 16 | tools/index.vue:948-954 | SxLiquidSwitch.vue:262 |

### 7.6 提交栏

| 区域 | 状态 | 详情 | 我方 | 原型 |
|---|---|---|---|---|
| 按钮高 | DIFF | 统一 56 → 有费用行时 56、无费用行时 52（Studio、无费用的工具） | W:components/creation/CreationActionBar.vue:54 | ToolSubmitBar.vue:221 |
| 圆角 | MATCH | r10 | :53 | :221 |
| 内边距、行距 | DIFF | `0 12`、gap 3 → `0 16`、gap 2 | :53 | :221-235 |
| 主标签 | DIFF | 16/22/600 → 15/600/20（compact 路径是 16/600/22，MATCH） | :60，tools/index.vue:1069 | :236-239 |
| 费用行 | DIFF | 11px、白色 74% → 11/15、85% 透明度；compact 路径 11/600 且数字 900 粗 | :68，tools:1078 | :53,217 |
| spinner | DIFF | 绝对定位 left 14，文字不动 → 行内 12px，会推动文字 | :63 | :120-126 |
| 原因提示 | EXTRA | 按钮上方一行 11/15 警告色 | :47 | — |
| Studio 提交栏 | MISSING | 余额 chip / 预估 / 去充值 / 帮助弹层 / 进度条，两行结构 | W:views/studio/components/StudioSubmitBar | studio/StudioSubmitBar.vue:27-201 |

### 7.7 上传槽

| 区域 | 状态 | 详情 | 我方 | 原型 |
|---|---|---|---|---|
| 生成卡宽、高 | MATCH | 宽 434，高 742（1440×1000） | W:views/tools/ToolUploadSlot.vue:230,312 | 组件地图:177 |
| 生成卡圆角 | DIFF | r6 → r10 | :230 | v3:2080-2091 |
| 生成卡内边距 | DIFF | 12 → 13 | :230 | v3:573-586 |
| 单图空态 | MATCH | 1px `#c9cfd6` 实线、`#fff→#f9fafb`、r8，hover 描边 violet-line | :316-322 | BatchImageZone.vue:388-418 |
| 单图最小高 | 未核对 | 150；我方由卡高撑开 | — | SingleImageZone.vue:235 |
| 批量空态 | DIFF | 压沿虚线 `rgba(31,35,41,.10)`、r9，hover 改实线 `.16` + 内影 → 虚线 `#d9dde2`，hover 描边 violet-line | :316-322 | sx-drop-pressed.css:42-55 |
| 叠片 | MATCH | 60×100，r5，1px 白描边，`0 1px 3px .16`，hover `0 2px 6px .2` | :235 | BatchImageZone.vue:435-447 |
| 叠片网格行距 | DIFF | 72（基准值，按比例缩放）→ 105.33 | :426 | BatchImageZone.vue:426-431 |
| 网格缩放 | MISSING | `scale = min(1, 宽/408, 高/400)` | — | BatchImageZone.vue:228 |
| 悬浮预览 | DIFF | 尺寸按触发元素 240 / 280 / 320，延迟 320ms，阴影 `0 12px 28px .16, 0 2px 6px .06`，内边距 4 → 固定宽 240、图片高 312、阴影 `0 12px 32px .18` | :440-444 | HoverPreview.vue:10-127 |
| 参考图叠放 | 部分 MATCH | 叠放偏移 6、宽度动画 220ms 一致；原型缓动 `(.2,.7,.2,1)`，我方 `(.25,.8,.25,1)`；原型有展开延迟 200 / 收起 100 / 收起动画 240，我方未见 | W:views/studio/components/StudioImageUpload/index.vue:83-86,337-345 | MlReferenceSlots.vue:139-156,568,712 |
| 多槽竖线分隔 | MISSING | 多个上传槽横排时中间 1px 竖线 | — | v3:594-621 |
| 素材云按钮 | DIFF | 20 圆，挂在 right/bottom -12 → "从素材库"药丸按钮 | ToolUploadSlot.vue:374 | MlReferenceSlots.vue:859 |

### 7.8 历史列

| 区域 | 状态 | 详情 | 我方 | 原型 |
|---|---|---|---|---|
| 列宽（工具页） | MATCH | 224 | tools/index.vue:717 | ToolWorkspaceColumns.vue:115 |
| 列宽（Studio） | DIFF | 300（`historyInMiddle` 功能）或无中栏 → 320 | W:views/studio/components/StudioWorkspaceColumns/index.vue:97 | StudioFeatureBody.vue:42-52 |
| 列宽（工作流） | DIFF | 224 → 260 | W:views/workflow/index.vue:375 | WorkflowView.vue:870 |
| 卡内边距、圆角 | DIFF | 内边距 10、r10 → 工具页 p8 / pr30 / r8；Studio p10 / r8 | tools:1153-1157，StudioHistoryColumn:93-97 | StudioHistoryColumn.vue:1032 |
| 列表间距 | DIFF | 8 → 6（工具页） | tools:1149 | :1023 |
| 卡描边 | DIFF | 常驻 1px line、白底 → 工具页无描边，hover 才有 surface2 底 | tools:1153 | :1032 |
| 选中 | DIFF | violet-line + `#fff→#f8f3fc` 渐变 → violet-line + violet-soft（工具）/ `#f8f4fb`（Studio） | tools:1155，Studio:95 | :1048-1052 |
| hover | DIFF | 描边 `#c9cfd6` + `0 1px 2px .05` → 底 surface2（工具）/ 描边 `#d9dde2` + 底 `#fbfcfc`（Studio） | 同上 | :1044 |
| 缩略图 | DIFF | 44 / r6 → 工具 44（MATCH）；Studio 48 | StudioHistoryColumn:102 | :1053 |
| 提示词文字 | DIFF | 12/18 两行 → Studio 标题 12/600、元信息 11 | Studio:109-114 | :1111 |
| 操作按钮 | DIFF | 20×20 / r4，跟在时间后面、间距 4 → 22 / r6，hover 时出现在右上角 6/6 | tools:1180 | :1128,1245 |
| 分组、分页、搜索 | MISSING | 按 `taskKind` 分组，每页 8 条，搜索框高 30，翻页按钮 26 | W:views/tools/useToolHistory.ts:48（平铺，每页 20） | :198-222,1160-1186 |
| 空态 | 部分 MATCH | 高 65 一致；原型是卡片式，我方是虚线框 + 28 圆图标 | tools:1123-1145 | v3:1976-1981 |
| 列头 | DIFF | 标题 14；头部操作按钮高 24 → 内边距 `13 12 9`，标题 14/600，刷新是 11px 链接 | tools:1111，CreationHistoryHeader.vue:31-39 | StudioHistoryColumn.vue:1280-1300 |

### 7.9 结果列、空态

| 区域 | 状态 | 详情 | 我方 | 原型 |
|---|---|---|---|---|
| 结果卡内边距、gap | DIFF | 内边距 12、gap 10 → 内边距 12、标题下 mb12 | tools/index.vue:1257-1260 | v3:1111-1120 |
| 结果卡圆角 | DIFF | 外层用 `.sx-card`（r10）、舞台 r8 → 外层 r10、单张图 r8 | :1257 | v3:1199 |
| 舞台 | DIFF | 最小高 320、20px 棋盘格、`inset-input`、contain 居中 → 图片最大高 480，网格格子 16px 棋盘格 | :1270,570 | v3:1199-1225 |
| 多结果展示 | DIFF | 一个大舞台 + 下方 4 列、gap 6 的方形候选图 → `minmax(220px)` 网格、gap 10，每张最大高 420 | :1299-1302 | v3:1230-1254 |
| 操作位置 | DIFF | 头部只放一个下载图标按钮（高 28）→ 图片下方一排 `ll-pill` | :1304 | ToolPreviewPanel.vue:195-201 |
| 模式切换、前后对比 | MISSING | 分段按钮高 26 + ImageCompare | — | v3:1146-1174,1269 |
| 灯箱 | MISSING | MediaPreview（左右切换、缩放、缩略条） | — | MediaPreview*.vue |
| 生成中 | DIFF | 34 圆转圈、800ms → 骨架呼吸动画 1.2s | tools:1376-1388 | ToolPreviewPanel.vue:497-516 |
| 空态 | DIFF | 最小高 220、内边距 18、图标 36 圆 + 标题 13 + 说明 11/1.55 → 棋盘格 h316 + 一行 13px 灰字 | tools:1341-1342 | ToolPreviewPanel.vue:534-566 |
| 功能介绍卡 | 部分 MATCH | 内边距 18、正文 13/1.65、场景块内边距 10 / r6 / surface2 一致；原型场景块有 1px line-soft 描边，标题与正文间距 14 → 我方 mt20 | tools:1349-1356 | ToolIntroPanel.vue:86-124 |
| 通用空态组件 | MISSING | `.sx-empty`、PageEmpty（274×146 插画）、PageLoadError | 只有 `ll-empty` | sx:1055，PageEmpty.vue，PageLoadError.vue |
| 离线横幅 | EXTRA + DIFF | 原型没有这种横幅；我方颜色 `#fff1f0` / `#cf1322` 是 antd 红，不在色板里，应改为 `danger-soft #fdf1f0` / `#8f4b47` | W:views/tools/PollingOfflineBanner.vue:14，StudioWorkspaceColumns:86 | sx:1170-1172 |

### 7.10 Studio

| 区域 | 状态 | 详情 | 我方 | 原型 |
|---|---|---|---|---|
| 首页卡圆角 | DIFF | r8（v3 强制）→ r16 | W:views/studio/index.vue:194 | v3:87-90，StudioFeatureCard.vue:16 |
| 首页图标底板 | DIFF | r8 → r12；底色 AI 色 12% 混合（`#f1ecf3`）→ violet-soft `#f3edf8` | studio/index.vue:265 | StudioFeatureCard.vue:50 |
| 首页页签 | DIFF | 选中底 `#f1ecf3` → violet-soft；页签间距 2 → 未定（我方首页为 8） | studio/index.vue:228-230 | CreationPillTabs.vue:52-72 |
| 首页网格、头部 | MATCH | `minmax(240px)` gap 12；头部 `24 / 24 / 8` | studio/index.vue:209,255 | StudioView.vue:63-78 |
| 功能页列模板 | DIFF | 普通功能两栏 `minmax(360px,22%) 1fr`，`historyInMiddle` 功能 `320 / 300 / 1fr` → 所有功能都是三栏 `400 / 320 / 1fr` | StudioWorkspaceColumns:97 | StudioFeatureBody.vue:42-52 |
| 功能页间距、内边距 | DIFF | gap 12，滚动区内边距 `16 24 24` → gap 12、内边距 12 | :97 | v3:415-418 |
| 功能页头部与步骤条 | MISSING | 返回按钮 + 44 图标 + 步骤条（数字圆 22、连接线 24） | — | StudioFeatureBody.vue:137-225 |
| 底部全宽历史面板 | MISSING | StudioHistoryPanel（输出 `minmax(96px)` 1:1 网格） | — | StudioHistoryPanel.vue:101-213 |
| section 卡 | DIFF | 内边距 12、r8、`v3-shadow-card`、gap 8 → 页面内用 `ll-section-title` 分节，外层是一整张 `ll-card` | W:views/studio/imagegen/index.vue | v3:487-500 |
| 预览空态 | DIFF | 最小高 420、内边距 24、r8、图标圆 56 / 26 → 最大宽 360、内边距 32、虚线、r10、图标 36 | W:views/studio/components/StudioPreviewPanel/index.vue:98-105 | StudioPreviewEmpty.vue:27-53 |
| 结果展示 | DIFF | 单图最大高 620、r8 → 3:4 网格 `minmax(150px)` | StudioPreviewPanel:138-140 | StudioResult.vue:122-186 |
| 生成中 | DIFF | 圆环进度（半径 54、线宽 9），框最小高 420 → 横条进度，高 4 | StudioPreviewPanel:121 | StudioGenerating.vue:54-65 |
| 参数分段 | DIFF | 选项高 32、内边距 `0 16`、r8；chip 高 28、r999 → OptionPills 高 30、r6 | OptionPills:58 | StudioParamCard.vue:173-216 |
| 预设条、候选、文本卡 | MISSING | StudioPresetRail（104×132）、StudioCandidates（`minmax(200,300)`）、StudioTextCard（AI 按钮高 28、字数 chip） | — | studio/*.vue |
| 素材选择弹窗 | 未核对 | 我方宽 760、3:4 网格；原型 AssetPickerModal 的数值未提取 | W:views/studio/components/AssetPickerModal/index.vue:160 | AssetPickerModal.vue |

### 7.11 工作流

| 区域 | 状态 | 详情 | 我方 | 原型 |
|---|---|---|---|---|
| 三栏列宽 | DIFF | `460 / 224 / 1fr` → `380 / 260 / 1fr` | W:views/workflow/index.vue:375 | WorkflowView.vue:870-877 |
| 间距、内边距 | DIFF | gap 16、内边距 16 → gap 12、内边距 12 | :375 | WorkflowView.vue:1404,1771 |
| 模板头 | DIFF | 高 64 卡片（内边距 `12 14`、r10、缩略图 56×40、名称 15、描述 11）+ 切换弹层 → 文字头（流程标签 12、标题 15/600）+ 模板胶囊 | :380-391 | WorkflowTemplateHead.vue:171-219 |
| 设置按钮 | DIFF | 高 44 → 40（CreationSettingsRow） | :529 | WorkflowSettings.vue:151-191 |
| 提交 | 基本 MATCH | 高 56、r10（主标签字号差异同 §7.6） | :529 | ToolSubmitBar.vue |
| 备注缩略图 | DIFF | 32 → 34 | :444 | WorkflowNotesList.vue:216 |
| 素材投放区 | DIFF | 高 192、内边距 10、r6 → 叠片行 gap 16 | :413 | WorkflowMaterialComposer.vue:214-225 |
| 历史、结果列 | DIFF | 同 §7.8、§7.9 | :557-685 | — |
| ≥1440 等高 | MISSING | — | — | WorkflowView.vue:1755 |
| 流程板 | MISSING | WorkflowFlowBoard（卡片内边距 10、r10，占位最小高 132） | — | WorkflowFlowBoard.vue:71-164 |
| 用法说明框 | EXTRA | r10、surface2、内边距 14 | :689 | — |

### 7.12 首页工具箱

| 区域 | 状态 | 详情 | 我方 | 原型 |
|---|---|---|---|---|
| 头部内边距 | MATCH | `24 / 34 / 8 / 24`（右边 34 = 24 + 10 滚动条），gap 16 | W:views/home/index.vue:56 | ToolsView.vue:43 |
| 网格 | MATCH | `minmax(240px,1fr)`，gap 12；滚动区 `8 / 24 / 24`，`scrollbar-gutter: stable` | :88-93 | ToolsView.vue:55,104 |
| 卡片圆角 | DIFF | r8（v3 强制）→ r16 | :48 | v3:87-90 |
| 卡片内边距、gap、hover | MATCH | 16 / 12；上抬 2px + `0 4px 16px rgba(31,35,41,.08)` | :47-50 | ToolsView.vue:105-109 |
| 图标底板 | DIFF | r8 → r12（44 / 20 / `#f1ecf3` 一致） | :110 | ToolsView.vue:81-85 |
| 卡片文字 | MATCH | 16/600/22、14/500/20、描述最小高 40 | :127,138 | STUDIO-NOTES:123 |
| 页签 | DIFF | 页签间距 2 → 8（高 32、内边距 12、r8、`#f1ecf3` 一致） | :64-78 | CreationPillTabs.vue:52 |
| "新功能"区 | MISSING | mb20 pb20 + 下边框的置顶区 | — | ToolsView.vue:111-118 |

### 7.13 落地页（我方 picture、video 落地页 ↔ 原型探索页）

| 区域 | 状态 | 详情 | 我方 | 原型 |
|---|---|---|---|---|
| 最大宽 | MATCH | 1180 | W:views/picture/LandingPage.vue:58 | AiExploreView.vue:207 |
| 内边距 | DIFF | `18 20 20` → `14 24 24 16` | :58 | :187-195 |
| h1 | DIFF | 24/32 → 22/30 | :60 | :207 |
| hero 比例 | MATCH | `1fr 1fr 1.16fr`（等价于我方 `366fr 366fr 427fr`） | :67 | :224 |
| hero 高、间距 | DIFF | 高 142、gap 16 → 高 124、gap 10、mt12 | :67,79 | :187-195 |
| hero 卡 | DIFF | r12、正文内边距 `14 16`、名称 19/26 → r10、`14 15`、20/26 | :79-100 | :227-308 |
| hero 阴影、图片宽 | MATCH | `0 10px 16px rgba(0,0,0,.04)`、图片占 46% | :41-46 | :227 |
| 工具网格 | DIFF | 固定 4 列、gap 12 → `auto-fill minmax(240px)`、gap 10 | :145 | :384 |
| 工具卡 | DIFF | 高 74、内边距 `0 14`、r10、副标题 11/17 → 内边距 `11 13`、r8、12/18（图标 40 / r8、名称 14/20 一致） | :151-188 | :387-468 |
| 按高度自适应 | MISSING | ≥960 / ≤880 / ≤760 三档高度断点 | — | :485-497 |
| 入场动效 | 部分 MATCH | `motion-enter-up`、`(.4,0,.2,1)` 一致；我方各块延迟、时长是自定义的 | :15-20 | motion-enter.css |

### 7.14 画布

| 区域 | 状态 | 详情 | 我方 | 原型 |
|---|---|---|---|---|
| 首页顶栏 | DIFF | 高 56、内边距 `0 16`、标题 16 → 高 48、内边距 18、标题 14 | W:views/canvas/index.vue:220,238 | CanvasHomeView.vue:242-268 |
| 首页按钮 | DIFF | 高 32、0.8px `#d9d9d9` 描边 → 高 30 | :32-35 | :286-298 |
| 主区宽 | MATCH | `min(1240px, 100% - 48px)` | :280 | :334 |
| 主区内边距 | DIFF | 上 32 → 上 22（下 56 一致） | :280 | :334-337 |
| hero | DIFF | 最小高 200、内边距 `24 20 28`、h1 24、正文 14 → 最小高 246、内边距 `24 20`、虚线框、h2 20/700、正文 13/1.6 | :282-305 | :339-372 |
| 快捷 chip | DIFF | 高 32 → 30 | :339 | :392 |
| 装饰节点 | DIFF | 宽 148 → 146；原型 ≤980 隐藏，我方只在 xl 显示 | :28,346 | :425,653 |
| 模板网格 | DIFF | 3 列、gap 14；卡片内边距 12、r10、阴影 `0 10px 16px rgba(0,0,0,.035)`；预览 112×76 / r8 → md 起 3 列、gap 12；卡片内边距 10、r8；预览 108×72 / r6 | :364-373 | :474-508 |
| 我的画布网格 | DIFF | 2 列横卡、gap 12、封面 88×58 → `auto-fill minmax(260px)` 竖卡、gap 14、封面高 140 | :402-413 | :543-574 |
| 断点 | DIFF | ≤980 改单列 → md（768） | :364 | :653 |
| 编辑器顶栏、按钮 | MATCH | 高 48、内边距 12、gap 8；按钮高 30 / r4 | W:views/canvas/editor/index.vue:459，editor/ui.ts:57 | canvas-v31.css:219-283 |
| 素材面板 | MATCH | 宽 248；头 44 / 搜索 32 / 行 44 | W:views/canvas/editor/EditorAssetPanel.vue:64-121 | canvas-v31.css:319-375 |
| 工具栏 | MATCH | 距左 12、距底 16、内边距 6、按钮 28 / r4 | editor/ui.ts:50-54 | canvas-v31.css:417-432 |
| 节点卡、头部、端口 | MATCH | r8；节点阴影；头高 36、内边距 10；端口 10、1.5px 白边 | ui.ts:17-28，ports.ts:11 | canvas-v31.css:1098-1328 |
| 节点宽：视频 | DIFF | 338 → 260 | editor/nodes/EditorVideoNode.vue:26 | useNodeResize.ts:5-10 |
| 节点宽：工具 | DIFF | 340 → 300 | editor/nodes/EditorToolNode.vue:42 | useNodeResize.ts |
| 点阵 | DIFF | 点径 1.15、间距随缩放自适应（13–42）→ 点径 1.2、间距固定 24 | editor/index.vue:569 | 画布-点阵背景文档 |
| 参数面板 | EXTRA | 右侧固定 360 宽参数面板；原型用 520×360 浮动控制台 | editor/NodeParamsPanel.vue:314 | CanvasConsolePanel.vue:186 |
| 添加面板 | MISSING | 300 宽添加面板（2 列卡片，最小高 62） | — | CanvasAddPanel.vue:134-226 |

### 7.15 其它页（低优先）

| 区域 | 状态 | 详情 | 我方 | 原型 |
|---|---|---|---|---|
| 资产网格 | DIFF | `auto-fill minmax(194px)` → 断点 2 / 3 / 4 / 5 / 7 列（gap 16 一致） | W:views/asset-library/index.vue:555 | AssetsView.vue:1038 |
| 资产页签、chip | DIFF | 页签高 37、chip 高 35 → 34 / 34（30） | :410,433 | :929-1010 |
| 资产卡 | MATCH | r12、媒体区高 120 | components/AssetCard.vue:55-62 | :1070-1096 |
| 资产选中色 | DIFF | 原型是蓝色 `rgba(59,130,246,.55)`，与品牌色冲突 → 我方 violet 更合理 | AssetCard:55 | :1090 |
| 智能体目录列 | DIFF | 280 → 260 | W:views/agent/index.vue:805 | AgentView.vue:828 |
| 智能体内容宽 | DIFF | 780 → 760 | :1072 | :883-886 |
| 本地生活 | DIFF | 主区 gap 24、内边距 `16 24 24`、侧栏 r8 → gap 16、内边距 16、侧栏 r10（`ll-card`）；1200 断点一致 | W:views/local-life/index.vue:243-246 | LocalLifeView.vue:713-733 |
| 旧 less 页面 | DIFF | e-commerce（29 个文件）、picture / video 生成器、ChatInputBox、上传组件、GenerateLoading、asset 页仍在用 `#8e66f9` 和 `#3a3a3a / #9e9e9e / #f5f6f8` 这套中性色 | W:views/e-commerce/**，W:components/ImageUpload 等 | — |

### 7.16 计数汇总

| 区域 | DIFF | MISSING |
|---|---|---|
| Token、全局 | 13 | 11 |
| 外壳、导航 | 10 | 4 |
| 工具工作区 | 5 | 3 |
| 提示词区 | 7 | 2 |
| 参数行、设置、模型 | 15 | 3 |
| 提交栏 | 5 | 1 |
| 上传槽 | 6 | 2 |
| 历史列 | 11 | 1 |
| 结果列、空态 | 8 | 3 |
| Studio | 10 | 3 |
| 工作流 | 7 | 2 |
| 首页工具箱 | 3 | 1 |
| 落地页 | 6 | 1 |
| 画布 | 12 | 1 |
| 其它 | 7 | 0 |
| **合计** | **125** | **38** |

（"部分 MATCH"和"未核对"的行不计入；离线横幅一行同时标了 EXTRA 和 DIFF，按 DIFF 计。）

---

## 8 建议加入 `uno.config.ts` 的 token 与 shortcut（只列清单，本次未修改）

### 8.1 theme 扩展

- **colors**：
  - `control: { DEFAULT:'#c9cfd6', hover:'#aeb6bf', press:'#b9c0c8' }`
  - `raised: { line:'#cecece', hover:'#bdbdbd' }`
  - `shell-line: '#e2e2e2'`
  - `danger-top: '#c1524c'`
  - `violet-tint: '#f8f3fc'`
  - `ghost-press: '#e9ecef'`
  - `alert: { info:'#654876', danger:'#8f4b47', warning:'#7d5a20' }`
  - `port: { image:'#3f7f96', video:'#b45650', prompt:'#3e8e6a', audio:'#875f9a' }`
- **borderRadius**（语义名）：`xs:3, sm:4, md:6, lg:8, xl:10, dialog:12, plate:5`
- **boxShadow**：
  - `card`（`.sx-card` 完整叠层）
  - `card-v3`
  - `panel`
  - `pop`
  - `raised`、`raised-hover`
  - `btn`
  - `cast-r`
  - `plate`
  - `press`
  - `inset-input`
  - `well`（`inset 0 0 16px rgba(31,35,41,.12), inset 0 1px 0 rgba(31,35,41,.05)`）
  - `focus`（`0 0 0 3px rgba(135,95,154,.14)`）
  - `node`
- **spacing**：可选 `s1..s8 = 3/6/9/12/18/24/30/36`
- **duration**：`fast:110ms, mid:180ms, slow:240ms, seg:300ms`
- **easing**：`sx: cubic-bezier(.2,.7,.2,1)`、`std: cubic-bezier(.4,0,.2,1)`
- **fontFamily**：
  - `sans: "'Smartisan Compact','Noto Sans SC','Noto Sans CJK SC','PingFang SC','Microsoft YaHei',sans-serif"`
  - `mono: "'SFMono-Regular','Cascadia Code',Consolas,'Liberation Mono',monospace"`
- **preflight 补充**：`body { font-family: sans; -webkit-font-smoothing: antialiased; color: #4b5563; background: #f5f6f7 }`；滚动条 10px、`rgba(0,0,0,.18)`、hover `.32`。

### 8.2 shortcuts（建议用 `sx-` 前缀，`ll-*` 保留兼容）

| shortcut | 内容要点 |
|---|---|
| `sx-btn` | 高 32，内边距 `0 12`，1px control，r4，板材渐变 + plate 阴影，13/500，ink-2；hover / 按下 / 禁用见 §4.1 |
| `sx-btn-primary` | 在 `sx-btn` 基础上：violet 渐变、violet-border、600、按下内凹、禁用 `#cbb9d5`（**r4，不是 999**） |
| `sx-btn-ghost` / `sx-btn-tint` / `sx-btn-danger` | 见 §1.2 |
| `sx-submit` | 整宽，高 56，r10，内边距 `0 12`，gap 3，两行；第一行 16/22/600，第二行 11 白 74% |
| `sx-field-btn` | 高 44，内边距 `0 24 0 11`，r6，板材；说明 11/16 muted，值 11/16/500（设置按钮、模型字段、选项按钮共用） |
| `sx-input` | 高 34，内边距 `0 10`，1px control，r4，inset-input；聚焦用 violet 描边 + focus 外环 |
| `sx-well` | 1px line，r6，白底，`shadow-well`（生成卡、提示词框） |
| `sx-seg` / `sx-seg-item` / `sx-seg-on` | 轨道内边距 3、gap 2、r6、`#f3f4f5`；选项高 30、内边距 `0 9`、r4、11px；选中 `#fff→#f8f3fc` + violet-line + violet-ink 600；过渡 300ms std |
| `sx-pilltab` / `sx-pilltab-on` | 高 32，内边距 `0 12`，r8，14/500；选中 `#f1ecf3` + 600 |
| `sx-card` | 1px line，r10，白底，`shadow-card`；`sx-card-panel` 改用 `shadow-panel` |
| `sx-section` | 内边距 12，1px line，r8，白底，`shadow-card-v3`，gap 8 |
| `sx-pop` | 1px line，r10，`shadow-pop`；入场 120ms 淡入 + 4px |
| `sx-row` / `sx-row-on` | 导航、列表行：r6，1px 透明描边，hover `#f3f4f5`；选中内凹灰配方 |
| `sx-hist-card` / `sx-hist-card-on` | 内边距 10，gap 10，1px line，r10；hover control 描边；选中 violet-line + tint 渐变 |
| `sx-upload` | 最小高 150，内边距 12，1px control，r8，`#fff→#f9fafb`，hover violet-line + `#fff→#fbf7fd` |
| `sx-plate` | 60×100，r5，1px 白描边，`0 1px 3px rgba(31,35,41,.16)` |
| `sx-empty` / `sx-empty-title` / `sx-empty-desc` | 最小高 150，内边距 18，虚线 line-strong，r8；标题 13/600；说明 11/1.65，最大宽 320 |
| `sx-label` / `sx-hint` / `sx-caption` | 11/500 ink-2 · 11/1.55 muted · 11/600 字距 .04em |
| `sx-title-page` / `sx-title-tool` / `sx-title-section` / `sx-title-card` | 20/600/28 · 15/600/20 · 16/600/22 · 14/600/20 |
| `sx-chip` | 高 20，内边距 `0 6`，r3，11px |
| `sx-medbtn` | 20 圆，1px control，图标 12，`after:inset--4`（点击区 28） |
| `sx-focus` | `focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)` |

---

## 9 待产品方确认的问题

1. **主色统一**：Naive `primaryColor`、`--main-color` 是否全部改成 `#875f9a`？旧 less 页面（e-commerce、picture / video 生成器、上传组件）是否一并迁移，还是先只改主题？
   - 「已决定」「推荐：全站统一为 `#875F9A`，先改主题 token，再分批迁移旧 less 页面（电商、图片 / 视频生成器、上传组件）。（理由：主色已定；先改 token 风险小，旧页面逐页迁移可避免一次性大回归。）」
2. **圆角口径**：原型 v3 把 `rounded-2xl / xl` 强制为 8，首页、Studio 卡片因此都是 r8。我方是 r16 / r12，按 r8 改吗？
   - 「已决定」「推荐：卡片统一 r8，`rounded-2xl / xl` 在卡片场景映射到 8，弹层与大容器可单独保留。（理由：卡片圆角 8 已定，与原型一致。）」
3. **输入框焦点**：设计规范 §3.2 写"不加外环"，原型代码实现的是 3px 外环（`.14`）。以哪个为准？
   - 「已决定」「推荐：输入框用 3px 紫色外环（`.14`），其它可聚焦控件（按钮、卡片、标签）用 2px outline。（理由：已定；保证键盘焦点可见，也与原型代码一致，设计规范 §3.2 应改文。）」
4. **主按钮圆角**：`ll-btn-primary` 的 999 圆角（本地生活、智能体在用）在原型里没有对应。是否改成 r4（普通）/ r10（提交）？
   - 「已确认」「推荐：普通主按钮改 r4，提交按钮改 r10，不再使用 999 胶囊。（理由：原型无对应的胶囊样式，统一后与卡片 r8 的层级协调；改动面限于 `ll-btn-primary`，本地生活和智能体需回归。）」
5. **断点**：是否引入原型的 1440（三栏 ↔ 单列、目录浮层）断点？我方目前桌面固定三栏。
   - 「已确认」「推荐：引入 1440 断点，宽屏三栏，窄屏单列，目录改浮层。（理由：1440 以下固定三栏会挤压内容区，且原型已验证该断点。）」
6. **Studio 版式**：普通功能用两栏 `minmax(360px,22%) 1fr` + 底部全宽历史，`historyInMiddle` 功能才用三栏 `320 / 300 / 1fr`。我方统一用 `400 / 320 / 1fr`，按原型拆分吗？
   - 「已确认」「推荐：按原型拆分，普通功能两栏加底部全宽历史，`historyInMiddle` 功能才用三栏。（理由：原型即目标版式，两栏给输入区更多空间；需保证三栏功能不被破坏。）」
7. **工作流列宽**：按原型改为 `460 / 224 / 1fr`、gap 16，与工具页统一？
   - 「已确认」「推荐：按原型改为 `460 / 224 / 1fr`、gap 16，与工具页统一。（理由：跨页面栅格一致，减少用户切换时的认知负担。）」
8. **模型选择**：原型是 44 高触发条 + 模型列表浮层，我方是分段胶囊。是否按原型改？模型列表里的能力标签数据由谁提供？
   - 「已确认」「推荐：按原型改为 44 高触发条加模型列表浮层，能力标签由后端模型配置（`GenerationModelCapabilityService`）下发。（理由：浮层可承载更多模型信息，44 高与设置行统一；标签由单一数据源提供，避免前端硬编码。）」
9. **提交按钮**：没有费用行时是否也固定 56 高？费用行透明度用 74%（原型）还是 85%（我方）？
   - 「已确认」「推荐：提交按钮固定 56 高，无费用行时也不变；费用行透明度取原型 74%。（理由：避免按钮因费用行出现而跳动，并与原型一致。）」
10. **字体**：`Smartisan Compact` 需要授权、自托管还是 CDN？没有这个字体时退回 `PingFang SC` 可以接受吗？
   - 「已确认」「推荐：先使用 `PingFang SC` 兜底；若要用 `Smartisan Compact`，须先确认授权，再自托管（带 `font-display: swap`）。（理由：授权风险高于字体收益，自托管比 CDN 稳定，兜底字体保证无字体时也不破版。）」
11. **图标**：是否引入 `@vicons/ionicons5`？还是继续内联 SVG，只统一线宽（≤18px 用 1.7，否则 1.6）？
   - 「已确认」「推荐：继续用内联 SVG，仅统一线宽（≤18px 用 1.7，否则 1.6）。（理由：不引入新依赖、不增加包体积，线宽统一已能解决视觉不一致。）」
12. **历史列**：要不要按 `taskKind` 分组、每页 8 条、带搜索？这需要后端支持分组 / 分页参数吗？
   - 「已确认」「推荐：先做每页 8 条加无限滚动，分组和搜索排后；分页必须由后端提供分页参数，分组可由前端按 `taskKind` 先做。（理由：分页对性能与体验收益最大；搜索和分组需后端配合，范围可控后再做。）」
13. **工具页目录**：我方工具页内多了一列 160 / 60 的目录（原型放在外壳 B2，160 / 44）。是保留，还是改为外壳目录？
   - 「已确认」「推荐：保留工具页内目录，但宽度向原型靠拢（160 / 44）；窄屏收起为浮层。（理由：目录能帮助快速切换功能，不应因对齐原型而丢失；改外壳目录会牵动全局导航。）」
14. **原型自身的问题**：资产页选中色是蓝色 `rgba(59,130,246,.55)`，画布首页主按钮阴影是蓝色 `rgba(63,104,226,.22)`，都与藤紫冲突。是否视为原型的笔误？
   - 「已确认」「推荐：视为原型笔误，资产页选中色与画布首页主按钮阴影都改用主色 `#875F9A` 的透明变体。（理由：蓝色与藤紫冲突，破坏主色统一。）」
15. **画布首页 `--ch-*` token**：`canvas-v31.css:10-48` 里有一组给画布首页用的 token，可能在 v3 下覆盖 `CanvasHomeView` 的 56 / 32 等数值。需要产品方确认最终的顶栏高度（56 还是 48）。
   - 「已决定」「推荐：画布顶栏定为 48px，并以此覆盖 `--ch-*` 中的 56 / 32 等旧值。（理由：顶栏 48 已定，应只保留一个高度来源。）」
16. **代码与文档冲突**：组件地图写历史缩略图 56、主导航 44 / 240、目录 280，代码分别是 44、204、160。本文以代码为准，确认吗？
   - 「已确认」「推荐：以代码为准（缩略图 44、主导航 204、目录 160），并同步修订组件地图。（理由：代码是线上事实，文档应跟随，避免错误尺寸被当作目标。）」

---

## 10 · 2026-11-06 交付包（5185）对齐轮补充（2026-11-07）

本轮依据 `小岐AI-5185-技术交付包-2026-11-06`（原型 5185 工程）做细节对齐。**主导航不变**（产品决定：不按原型收成六项，入口结构与顺序保持现状），只改页面内部、共用组件与尺寸。要点：

1. **材质档位升级**：面板/卡片/弹层 r18、输入 r15、按钮 r14（`sx-squircle` 白名单，圆钮/胶囊不挂）；智能体对话工作台保持 r10。
2. **图标按钮与可点区域（用户反馈：下载等图标太小、不好点）**：统一用 `src/components/IconButton`（`label` 必填，同时作读屏标签与悬停提示）。
   - 尺寸：`sm` 视觉 24（列表行内），`md` 32，`lg` 40；可点区域 ≥ 32×32，触屏 `sm` 直接放大到视觉 32、`md` 外扩到 40。
   - 小控件用 `sx-hit` 外扩命中区（桌面 4px、触屏 6px）；**外扩不超过与相邻控件间距的一半，同一排图标按钮之间至少 `gap-8px`**，否则后一个按钮的伪元素会盖住前一个。
   - 只在悬停时出现的操作必须用 `reveal` / `sx-reveal`（父级要有 `.group`）：触屏与键盘聚焦时始终可见。下载类操作不能只靠悬停。
   - 禁用态不用 `pointer-events-none`：要能悬停看到原因（title），点击也不能穿透到外层卡片。
   - 可点文字不小于 12–13px、高度不小于 28–32px；纯说明文字保留 11px。
3. **历史列规格**：卡片最小高 74（进行中 / 失败带原因时自然变高，不重叠）、r18、缩略 44、提示词单行截断、状态胶囊只显示一次、`sm` 操作钮、4px 进度条。进度：Java v1 工具历史项新增 `progress`（2026-11-07 用户授权，需告知端侧），其余列表前端按状态估算。
4. **AI 图片 / AI 视频入口改为总览页**（原型 AiExploreView）：`/image`（原 `/picture`，不保留旧地址）、`/video` 为总览；「图片生成」「视频生成」以原型为准指向工具页 `/tools/image-generate`、`/tools/ai-video-generator`。原通用生成页挪到 `/image/generate`、`/video/generate`（原型没有，不放卡片），只承接老链接 `?entryCode=…`、`?sameStyleId=…`，由 `src/router/generator.ts` 的全局守卫原样（query + hash）转过去，不改 push/replace，返回键正常。
5. **校色闭环 v1（整图）**：五参数面板 + 拖动对比 + 参数随历史还原（只在调过参数时保存）+ 资产「原图/校色后」两版；烘图失败退回下载原图。资产按图址对位，免费用户水印地址可能对不上，彻底解决需 Java 资产引用补结果序号。
6. **画布二轮**：剪贴板（快照 + 新 id + 连线重映射）/ 成组与解组 / 对齐分布 / 锁定 / 小地图 / 快捷键表 / 首启引导 / 导出 JSON 与 PNG（按节点数据重绘）/ 执行前费用确认（只在实际预扣时提示退回）/ 模板 6 套 / 提示词浮层 / 右键菜单。
7. **四个工具页**（图文笔记、数字人口播、爆款视频、模特替换）按原型版式重排，接口不变；模特「性别 / 年龄 / 肤色」是模特库筛选条件，不是后端字段。
8. **主导航收口（2026-11-09 产品决定，取代上文「主导航不变」）**：隐藏「工作流」「AI 电商」「AI 商拍」「本地生活」四个入口（`src/views/layout/Navigation` 里 `hidden: true`，去掉即恢复；路由与页面都在）。
   - 子功能按媒介并进总览页 `src/views/image/landing.ts`，工具页目录 `src/views/tools/catalog.ts` 的非处理组直接取同一份：
     AI 图片 = 图片处理 / 商拍（商拍换装、姿态复刻、商拍生图）/ 电商（+AI商品套图、AI详情页、爆款图复刻、手持商品）/ 服装（服装去皱、AI穿戴套图、AI试衣、AI试鞋、人像换背景、模特替换、模特换脸、双人换衣）/ 本地生活（门店全案、图文笔记、AI海报、AI长图、店铺档案、AI文案）；
     AI 视频 = 视频处理 / 电商（模特带货、商品替换、口播带货、爆款视频、模特替换）/ 本地生活（探店视频、带货短剧、数字人口播、AI数字人、动作迁移、爆款视频复刻）。
   - 同一功能两套实现只放一处（视频复刻 → `/tools/ai-video-clone`，商品替换 → 工作流版，服装去皱 → `/tools` 版）；搭配融图沿用电商首页的摘卡决定不放；工作流服装模板与商拍 / 电商重复的不放。
   - 选中态：停在隐藏模块页面上时按页面媒介高亮「AI 图片」或「AI 视频」（工作流模板页按 `flow`，video 流算视频；目录里查不到的隐藏模块页算图片）。
   - 电商标签条首项改为「返回 AI 图片 / AI 视频」（按当前功能页媒介），关掉最后一个标签也回对应总览。
9. **共用件补记（2026-11-10）**：
   - 空态 / 失败态统一 `PageEmpty`、`PageLoadError`（规格见 §5）；图标按钮统一 `IconButton`（见第 2 条）。
   - `MediaLightbox` 新增可选 `pannable`：滚轮连续缩放 0.5–4×、放大后拖动平移（每轴按显示尺寸夹紧，旋转 90/270 时宽高互换），双击 / 重置同时归位；默认关，旧入口不变。
   - 工具页 `ToolChoiceField`：44 高字段卡，点开贴卡弹面板；`grid` 三列 34 高格子（≥9 项出搜索），`list` 一列 44 高行，可带「试听」；Esc / 点外面 / 滚动收起，↑↓ 换焦点。`ToolPipeLinks`：产品替换图台素材到底图的连线，减少动效时只留静态细线。
   - 提交按钮里的「消耗 N 点」只显示后端报价（`useLLQuote`、`useWorkflowVideoQuote`）；报不出价显示「—」，不显示估算值。
   - 简版商拍工具老链接转工作室，任务中心回填交接未过期时放行到简版页（`studioToolRedirect` + `hasRefill`）。
