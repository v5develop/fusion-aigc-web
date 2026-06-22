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
- 全局变量定义在 src/assets/variables.less
- 页面级样式使用独立 .less 文件
- 组件样式使用 `<style scoped lang="less">`

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
