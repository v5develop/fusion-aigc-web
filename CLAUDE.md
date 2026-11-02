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

## 本地生活模块（src/views/local-life）

对接 Go 网关 `/api/v1/local-life`（fusion_aigc_go），API 封装在 src/api/localLife.ts（snake_case 字段原样收发）。
入口页 /local-life + 11 个功能页（AI文案 / 店铺档案 / AI数字人 / 图文笔记 / AI海报 / AI长图 / 数字人口播 / 动作迁移 / 探店视频 / 带货短剧 / 爆款视频复刻）。
关键约定：提交生成带 `Idempotency-Key`；首次生成前走 useAgreement 约定弹窗；列表用 useLLList（有在跑任务自动轮询、跑完刷积分）；详情轮询用 usePollingWhile。

## Go 后端其余模块（同为藤紫设计体系）

- **商拍工作室 src/views/studio**（/api/v1/studio，api-studio.md）：商拍换装 / 姿态复刻 / 图片生成，批次-任务模型，历史游标分页 + 批次轮询（2s，终态 4–7）；批次 payload 可回填「重新编辑」。上传走 src/api/goUpload.ts：Java 直传 `/api/v1/storage/direct`（presign → PUT → confirm，visibility=public）；studio 与资产库只接受白名单内的公有桶地址（运维配置 STUDIO_INPUT_URL_PREFIXES）
- **提示词库 src/views/prompt-library**（/api/v1/prompt-library）：官方电商/官方通用/我的 三页签，我的支持 CRUD
- **资产库增强 src/views/asset-library**（/api/v1/asset-library）：分类条/来源/类型/收藏/标签筛选 + 批量打标签 + 详情（版本/相关资产/生成结果）
- **画布管理 src/views/canvas**（/api/v1/canvas）：画布列表 / 从模板创建 / 重命名 / 另存为 / 删除 / 运行历史；节点编辑器未做
- 左侧导航（src/views/layout/Navigation）含 9 项 + 分组线；无 iconfont 的入口用内联 SVG path

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
