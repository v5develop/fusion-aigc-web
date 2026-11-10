# Fusion AIGC Web 项目规范

## 技术栈

- Vue 3 + TypeScript + Composition API（`<script setup lang="ts">`）
- Naive UI 组件库（通过 unplugin-vue-components 自动导入）
- Vue API 通过 unplugin-auto-import 自动导入，无需手动 import ref/computed 等
- Pinia 状态管理
- Vite 构建工具
- Less 样式预处理器
- 包管理器：pnpm
- Node 版本要求：^20.19.0 || >=22.12.0

## 项目结构

```
src/
├── api/           # API 层（含拦截器）
├── assets/        # 静态资源
├── components/    # 可复用组件
├── directives/    # 自定义指令
├── router/        # Vue Router 配置（按模块拆分）
├── stores/        # Pinia stores（按业务模块拆分）
├── utils/         # 工具函数/composables
└── views/         # 页面视图
```

## 业务上下文

- AIGC（AI生成内容）平台前端
- 主要功能：电商图片生成、视频生成、AI 对话、素材资产管理
- 电商模块包含：商品图、服装试穿、视频克隆等子功能
- 使用轮询（usePolling）机制获取 AI 生成任务结果
- 图片/视频上传使用阿里云 OSS（ali-oss）

## 编码规范

### Vue 3 双向绑定
- 使用 `defineModel` 而非 `defineProps` + `defineEmits`（Vue 3.4+）
```typescript
// 推荐
const modelValue = defineModel<string>({ required: true })
// 不推荐
const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
```

### API 请求
```typescript
import { post, get } from '@/api'
const result = await post('/api/v1/storage/direct/sts', { subDir: 'uploads' })
const data = await get('/api/v1/users', { id: 1 })
```

### Composables
```typescript
import { useDebounce } from '@/utils/composables'
useDebounce(reactiveObj, callback, 300)
```

### 样式规范
- **本地生活模块（src/views/local-life）及之后的新功能使用 UnoCSS**（uno.config.ts：presetUno + ll-* shortcuts），复杂选择器仍可落 `<style scoped lang="less">`
- **配色对齐小岐AI 官方「新锤子风 · 藤紫」设计系统**（参考包：小岐AI-5181-s1.1 `foundation/sx-scoped.css`）：藤紫主色 #875f9a（渐变 top #8a639f / bottom #7a548c / press #5f3f6f）、中性 ink #1f2329 / ink-2 #4b5563 / muted #5f6673、语义色 danger #b4433e / success #34795a / warning #94651f（一律 soft 底 + 深字）、轻拟物材质（1px 细描边 + 短投影 + 内凹按压）。局部 naive-ui 主题见 `src/views/local-life/theme.ts`
- 老页面保持亮紫 #8e66f9 与独立 less：全局变量定义在 src/assets/variables.less，页面级样式使用独立 .less 文件，组件样式使用 `<style scoped lang="less">`
- ⚠️ UnoCSS 已 blocklist 内置 `container` utility——老代码大量用 `.container` 做布局类名，不能放开
- ⚠️ 不要新建与 UnoCSS 内置 utility 撞名的全局类（如 `container`、`grid`）
- ⚠️ 全局 App.vue themeOverrides 的 `common.baseColor: 'red'` 会把彩色按钮文字推导成红色——藤紫按钮必须显式覆盖 naive Button 的 textColor*（见 theme.ts）

### 尺寸与可点区域（2026-11-07 整改，用户反馈下载等图标太小、不好点）
- **主导航**：不按 5185 原型收成六项；2026-11-09 起隐藏「工作流」「AI 电商」「AI 商拍」「本地生活」（只隐藏，见「路由要点」），其余入口结构与顺序不动
- **图标按钮一律用 `src/components/IconButton`**：`label` 必填（读屏标签 + 悬停提示）；`size` sm 24（列表行内）/ md 32 / lg 40；`variant` plate / quiet / overlay（压在图上）/ danger；`href` + `download` 渲染成下载链接；不要再手写 `w-16px h-16px p-0` 这类按钮
- 可点区域 ≥ 32×32、触屏 ≥ 40：小控件用 `sx-hit` 外扩；外扩不超过相邻间距的一半，**同一排图标按钮之间至少 `gap-8px`**
- 只在悬停时出现的操作用 `reveal` / `sx-reveal`（父级要有 `.group`），触屏与键盘聚焦时始终可见；下载类操作不能只靠悬停
- 禁用态不用 `pointer-events-none`（要能悬停看到原因，点击也不能穿透到外层卡片）
- 可点文字 ≥ 12–13px、高 ≥ 28–32px；纯说明文字保留 11px；货币一律叫「点数」
- 设计规范与 5185 对齐记录见 `docs/design/ui-design-spec.md` §10

### 共用组件与钩子（2026-11-10 补）
- **空态 / 失败态**：整块无数据用 `src/components/PageEmpty`（`text` + `description` + 默认插槽放一个主操作，`compact` 用于栏内）；整块取不到用 `src/components/PageLoadError`（`retryable` + `@retry`）。字段级错误不用它们
- **大图预览** `src/components/MediaLightbox`：需要看细节的入口（高清放大等）传 `pannable`，开滚轮缩放 0.5–4× 与放大后拖动平移；不传时行为不变
- **工具页**：「选一项」字段（目标语言 / 音色）用 `src/views/tools/ToolChoiceField`（`grid` 长列表带搜索，`list` 行尾可带试听）；产品替换图台的连线用 `ToolPipeLinks`，只认 DOM 标记 `data-pr-anchor` / `data-pr-base`（/ `data-pr-hint`）
- **提交前报价**：本地生活 `useLLQuote`（Workbench）、视频复刻 `useWorkflowVideoQuote`；防抖 300ms、只认最后一次响应、卸载即丢。报价中 / 失败 / 不可提交一律显示「—」，**不拿旧值或前端估算顶上**，点数只来自后端
- **回填守卫**：`/tools/ai-digital-model`、`/tools/ai-posture-fission` 默认转商拍工作室完整版（`studioToolRedirect`）；只有 `hasRefill` 发现 2 分钟内发给简版工具的「做同款 / 参数回填」交接时才放行。新增这类转向要同样先看交接

### 路由要点
- **主导航隐藏四项（2026-11-09）**：「工作流」「AI 电商」「AI 商拍」「本地生活」在 `src/views/layout/Navigation` 里标 `hidden: true`（去掉即恢复），路由与页面都在、深链照开。子功能按图片 / 视频并进 `src/views/image/landing.ts` 的分组（AI 图片：图片处理 / 商拍 / 电商 / 服装 / 本地生活；AI 视频：视频处理 / 电商 / 本地生活），工具页目录 `src/views/tools/catalog.ts` 除处理组外直接取这份；新增这几个模块的功能要在这里登记，否则没有入口。停在隐藏模块页上时按媒介高亮「AI 图片」/「AI 视频」（`mediaKindOf`）。模块内「回首页」类按钮回对应总览页（电商标签条已改；商拍 `StudioWorkspaceColumns` 返回键的兜底仍是 `{ name: 'studio' }`）
- `/image`、`/video` 是 AI 图片 / AI 视频总览页（对齐原型 /ai/image；不保留 `/picture` 旧地址）。「图片生成」「视频生成」卡片指向原型同名工具页 `/tools/image-generate`、`/tools/ai-video-generator`（与左侧导航目录同一页面）。原通用生图 / 生视频在 `/image/generate`、`/video/generate`，原型没有、不放卡片，只承接老链接 `?entryCode=…`、`?sameStyleId=…`（`src/router/generator.ts` 全局守卫原样转过去，不加 replace，返回键正常）

## 本地生活模块（src/views/local-life）

对接 Go 网关 `/api/v1/local-life`（fusion_aigc_go），API 封装在 src/api/localLife.ts（snake_case 字段原样收发）。
入口页 /local-life（主导航已隐藏，深链可开；功能从 AI 图片 / AI 视频总览进）+ 11 个功能页（AI文案 / 店铺档案 / AI数字人 / 图文笔记 / AI海报 / AI长图 / 数字人口播 / 动作迁移 / 探店视频 / 带货短剧 / 爆款视频复刻）。
关键约定：提交生成带 `Idempotency-Key`；首次生成前走 useAgreement 约定弹窗；列表用 useLLList（有在跑任务自动轮询、跑完刷积分）；详情轮询用 usePollingWhile。

## Go 后端其余模块（同为藤紫设计体系）

- **商拍工作室 src/views/studio**（/api/v1/studio，api-studio.md）：商拍换装 / 姿态复刻 / 图片生成，批次-任务模型，历史游标分页 + 批次轮询（2s，终态 4–7）；批次 payload 可回填「重新编辑」。上传走 src/api/goUpload.ts：Java 直传 `/api/v1/storage/direct`（presign → PUT → confirm，visibility=public）；studio 与资产库只接受白名单内的公有桶地址（运维配置 STUDIO_INPUT_URL_PREFIXES）
- **提示词库 src/views/prompt-library**（/api/v1/prompt-library）：官方电商/官方通用/我的 三页签，我的支持 CRUD
- **资产库增强 src/views/asset-library**（/api/v1/asset-library）：分类条/来源/类型/收藏/标签筛选 + 批量打标签 + 详情（版本/相关资产/生成结果）
- **画布 src/views/canvas**（/api/v1/canvas）：画布列表 / 从模板创建 / 重命名 / 另存为 / 删除 / 运行历史；节点编辑器（剪贴板、成组、对齐分布、锁定、小地图、快捷键、导出 JSON/PNG、执行前费用确认）
- **姿态复刻多人配对**（/api/v1/studio/pose/preview）：提交前「识别人物与配对」，免费但慢（20 秒–2 分钟，前端超时 260 秒）；换图即失效；单人照片提交体与以前一致
- 左侧导航（src/views/layout/Navigation）现渲染：首页 / AI 创作（智能体、画布、AI 图片、AI 视频）/ 我的资产 / 任务中心 / 创意广场 / 提示词库；工作流、AI 电商、AI 商拍、本地生活为 `hidden`；无 iconfont 的入口用内联 SVG path

### 文件命名
- 组件目录使用 PascalCase，入口文件为 index.vue/index.ts
- 工具函数文件使用 camelCase

## 组件清单

| 组件 | 路径 | 说明 |
|------|------|------|
| ChatImageUpload | src/components/ChatImageUpload | 聊天式图片上传 |
| ChatInputSelect | src/components/ChatInputSelect | 通用下拉选择器 |
| WaterfallVirtualScroller | src/components/WaterfallVirtualScroller | 虚拟滚动瀑布流 |
| ChatTab | src/views/home/ChatTab | Tab 导航组件 |
| Textarea | src/components/Textarea | 增强文本框 |
| ImageUpload | src/components/ImageUpload | 图片上传 |
| VideoUpload | src/components/VideoUpload | 视频上传 |
| CheckboxGroup | src/components/CheckboxGroup | 复选框组 |
| SelectGroup | src/components/SelectGroup | 选择器组 |
| ImagePopover | src/components/ImagePopover | 图片弹出层 |

## 自定义指令

- `v-observer-scroll-to-bottom` - 滚动位置监听
- `v-loading` - 加载状态

## 认证流程

1. 登录 → `/api/v1/auth/login`
2. access token 存入 localStorage
3. 401 时自动用 refresh token 刷新
4. 刷新期间请求排队

## 构建命令

```bash
pnpm dev        # 开发服务器
pnpm build      # 生产构建
pnpm lint       # ESLint 检查
pnpm type-check # TypeScript 类型检查
```

## 注意事项

- 不要修改 unplugin 自动生成的类型声明文件
- 路由按模块拆分，电商路由在 src/router/e-commerce/
