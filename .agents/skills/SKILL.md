---
description: Fusion AIGC Web 项目规范和最佳实践 - Vue 3 + TypeScript 电商图片生成平台
globs: ["src/**/*"]
alwaysApply: true
---

# Fusion AIGC Web 项目规范

## 技术栈

- Vue 3 + TypeScript + Composition API
- Naive UI 组件库
- Pinia 状态管理
- Vite 构建工具
- Less 样式预处理器

## 项目结构

```
src/
├── api/           # API 层（含拦截器）
├── assets/        # 静态资源
├── components/    # 可复用组件
├── directives/    # 自定义指令
├── router/        # Vue Router 配置
├── stores/        # Pinia stores
├── utils/         # 工具函数/composables
└── views/         # 页面视图
```

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

## 组件清单

| 组件 | 路径 | 说明 |
|------|------|------|
| ChatImageUpload | src/components/ChatImageUpload | 聊天式图片上传 |
| ChatInputSelect | src/components/ChatInputSelect | 通用下拉选择器 |
| WaterfallVirtualScroller | src/components/WaterfallVirtualScroller | 虚拟滚动瀑布流 |
| ChatTab | src/views/home/ChatTab | Tab 导航组件 |
| Textarea | src/components/Textarea | 增强文本框 |

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
