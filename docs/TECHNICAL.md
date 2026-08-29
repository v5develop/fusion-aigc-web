# Fusion AIGC Web 技术文档

## 1. 技术栈总览

| 类别 | 技术 | 版本 |
|------|------|------|
| 框架 | Vue | ^3.5.32 |
| 语言 | TypeScript | ~6.0.0 |
| 构建工具 | Vite | ^8.0.8 |
| 包管理器 | pnpm | - |
| 路由 | vue-router | ^5.0.4 |
| 状态管理 | Pinia | ^3.0.4 |
| UI 组件库 | Naive UI | ^2.44.1 |
| CSS 预处理器 | Less | ^4.6.4 |
| HTTP 客户端 | Axios | ^1.16.1 |
| OSS SDK | ali-oss | ^6.23.0 |
| 虚拟滚动 | vue-virtual-scroller | ^3.0.4 |
| 瀑布流 | @lhlyu/vue-virtual-waterfall | ^1.0.9 |
| Node 引擎 | Node.js | ^20.19.0 \|\| >=22.12.0 |

---

## 2. 项目工程化配置

### 2.1 Vite 配置 (`vite.config.ts`)

```typescript
// 核心插件
plugins: [
  vue(),           // Vue SFC 支持
  vueJsx(),        // JSX/TSX 支持（用于 loading 指令）
  AutoImport(),    // Vue API + Naive UI API 自动导入
  Components(),    // Naive UI 组件自动按需导入
]
```

**自动导入策略：**
- `unplugin-auto-import`：自动导入 Vue Composition API（ref, computed, watch 等）和 Naive UI 工具函数（useMessage, useDialog 等）
- `unplugin-vue-components` + `NaiveUiResolver`：Naive UI 组件使用时自动导入，无需手动 import

**路径别名：**
- `@` → `./src`

**开发代理：**
```typescript
proxy: {
  '/api': {
    target: 'http://192.168.0.3:18080',  // 后端开发服务器
    changeOrigin: true,
  }
}
```

**Less 配置：**
- 启用 JavaScript 支持（`javascriptEnabled: true`）
- 路径别名同步配置（Less 内也能使用 `@/`）

### 2.2 TypeScript 配置

```json
// tsconfig.app.json
{
  "extends": "@vue/tsconfig/tsconfig.dom.json",
  "compilerOptions": {
    "noUncheckedIndexedAccess": true,  // 数组/对象索引安全检查
    "paths": { "@/*": ["./src/*"] }
  }
}
```

采用 Vue 官方推荐的 project references 结构：
- `tsconfig.json`：根配置，引用 app 和 node 两个子项目
- `tsconfig.app.json`：应用代码配置
- `tsconfig.node.json`：构建脚本配置

### 2.3 构建脚本

```json
{
  "dev": "vite",                              // 启动开发服务器
  "build": "run-p type-check \"build-only {@}\" --",  // 并行类型检查 + 构建
  "type-check": "vue-tsc --build",            // 增量类型检查
  "lint": "eslint . --fix --cache",           // ESLint 修复 + 缓存
  "format": "prettier --write --experimental-cli src/"
}
```

`build` 使用 `npm-run-all2` 的 `run-p` 实现 type-check 和 vite build 并行执行。

---

## 3. 项目目录结构

```
fusion-aigc-web/
├── src/
│   ├── api/                      # 网络请求层
│   │   ├── index.ts              # Axios 实例、拦截器、Token 刷新逻辑
│   │   ├── methods.ts            # 所有 API 方法封装
│   │   ├── types.ts              # 请求/响应类型定义
│   │   └── ossUpload.ts          # 阿里云 OSS 直传封装
│   ├── assets/                   # 静态资源
│   │   └── variables.less        # 全局 Less 变量/Mixin
│   ├── components/               # 通用业务组件
│   │   ├── ChatImageUpload/      # 聊天式图片/视频上传
│   │   ├── ChatInputSelect/      # 自定义下拉选择器
│   │   ├── CheckboxGroup/        # 复选框组
│   │   ├── CustomModelNotice/    # 自定义模特提示弹窗
│   │   ├── ImagePopover/         # 图片悬浮选择
│   │   ├── ImageUpload/          # 图片上传（通用）
│   │   ├── SelectGroup/          # 下拉选择器组
│   │   ├── Tab/                  # Tab 切换
│   │   ├── Textarea/             # 增强文本框
│   │   ├── VideoUpload/          # 视频上传
│   │   └── WaterfallVirtualScroller/  # 虚拟瀑布流
│   ├── directives/               # 自定义指令
│   │   ├── index.ts              # 指令注册入口
│   │   ├── observerScroll.ts     # 滚动监听指令
│   │   └── loading.tsx           # 加载状态指令
│   ├── router/                   # 路由配置
│   │   ├── index.ts              # 主路由 + 路由守卫
│   │   └── e-commerce/index.ts   # 电商模块路由
│   ├── stores/                   # Pinia 状态管理
│   │   ├── home/index.ts         # 首页→工作台参数桥梁
│   │   ├── e-commerce/index.ts   # 电商会话 ID 管理
│   │   └── userInfo.ts           # 用户信息
│   ├── utils/                    # 工具函数
│   │   ├── hooks/index.ts        # useDebounce
│   │   ├── hooks/usePolling.ts   # 轮询 Hook
│   │   └── utils.ts              # 通用工具
│   └── views/                    # 页面视图
│       ├── layout/               # 布局容器 + 导航
│       ├── home/                 # 首页
│       ├── picture/              # 图片生成
│       ├── video/                # 视频生成
│       ├── e-commerce/           # 电商模块
│       │   ├── childPages/       # 各子功能页面
│       │   │   ├── components/   # 电商共享组件
│       │   │   ├── hooks.ts      # 电商统一任务流程 Hook
│       │   │   ├── constants.ts  # 电商通用常量
│       │   │   ├── productImage/ # 商品图子功能
│       │   │   ├── productVideo/ # 商品视频子功能
│       │   │   └── clothing/     # 穿戴图子功能
│       │   └── Row/              # 功能卡片行组件
│       └── asset/                # 资产管理
```

---

## 4. 网络请求层设计

### 4.1 Axios 实例配置

```typescript
const service = axios.create({
  baseURL: import.meta.env.PROD ? 'https://aigc.pengqiwl.com' : '',
  timeout: 10000,
})
```

- 生产环境直接请求后端域名
- 开发环境通过 Vite proxy 代理到内网后端（`/api` → `http://192.168.0.3:18080`）

### 4.2 请求拦截器

自动为所有请求添加 Bearer Token：
```typescript
service.interceptors.request.use((config) => {
  const token = localStorage.getItem('fusion_accessToken')
  if (token) config.headers.Authorization = 'Bearer ' + token
  return config
})
```

### 4.3 Token 无感刷新机制

**触发条件：**
- 响应 data.code 为 2001/2002/2003（业务层 Token 过期码）
- HTTP 401 状态码

**刷新策略（三级降级）：**
1. **第一级**：使用 refreshToken 调用 `/api/v1/auth/refresh` 获取新 Token
2. **第二级**：调用宿主应用桥接方法 `ThirdServiceBridge.refreshUnionToken` 获取新 unionToken，再通过 `/api/v1/auth/union-token-login` 换取新 Token
3. **第三级**：清除本地 Token，要求用户重新登录

**并发控制：**
- `isRefreshing` 标志位防止并发刷新
- 刷新期间的请求排入 `requestQueue` 队列
- 刷新完成后统一重试队列中的请求
- `refreshing` Promise 单航班模式：多个请求同时触发时只调用一次桥接方法

### 4.4 API 封装模式

统一导出 `post` 和 `get` 方法，返回 `Promise<ApiResponse>` 类型：

```typescript
export interface ApiResponse<T = any> {
  code: number   // 0=成功，非0=失败
  msg: string
  data: T
}
```

业务方法示例：
```typescript
// 幂等请求自动生成 Idempotency-Key
export function ecommerceSubmit(data: any, headers = { 'Idempotency-Key': crypto.randomUUID() }) {
  return post('/api/v1/creation/ecommerce/submit', data, headers)
}
```

---

## 5. 文件上传系统（OSS 直传）

### 5.1 上传流程

```
前端 ─── getSts() ───→ 后端 ───→ 返回 STS 凭证
  │
  ├── 创建 OSS Client（临时凭证）
  │
  ├── client.put(objectKey, file) ───→ 阿里云 OSS
  │
  ├── uploadConfirm({ objectKey }) ───→ 后端确认
  │
  └── 返回文件 URL
```

### 5.2 实现细节

```typescript
export async function upload(files: File[], config?: any) {
  // 并行上传所有文件
  const promises = files.map(file => async () => {
    // 1. 获取 STS 凭证
    const { data } = await getSts({ fileName, contentType, fileSize, ...config })

    // 2. 创建 OSS 客户端（含 STS Token 自动刷新）
    const client = new OSS({
      region: data.region,
      accessKeyId: data.accessKeyId,
      accessKeySecret: data.secretAccessKey,
      bucket: data.bucket,
      stsToken: data.sessionToken,
      endpoint: data.endpoint,
      refreshSTSToken: async () => { /* 重新获取凭证 */ },
      refreshSTSTokenInterval: 300000,  // 5 分钟刷新
    })

    // 3. 上传到 OSS
    await client.put(data.objectKey, file)

    // 4. 通知后端确认
    await uploadConfirm({ objectKey: data.objectKey })

    return data.url
  })

  return await Promise.all(promises.map(f => f()))
}
```

### 5.3 STS 参数说明

| 字段 | 类型 | 说明 |
|------|------|------|
| subDir | `'uploads' \| 'images' \| 'videos' \| 'audios'` | 存储子目录 |
| fileName | string | 原始文件名 |
| contentType | string | MIME 类型 |
| fileSize | number | 文件大小(bytes) |
| visibility | `'public' \| 'private'` | 存储桶可见性 |

---

## 6. 状态管理架构

### 6.1 useHomeStore — 页面间参数传递

**用途**：首页 → 图片/视频工作台的参数传递桥梁

```typescript
const data = {
  home: false,  // 标志位：目标页是否应读取此数据
  picture: { entryCode, prompt, ratio, images },
  video: { entryCode, modelCode, prompt, ratio, resolution, duration, images, video },
  ecommerce: { images, prompt },
}
```

**工作流程**：
1. 首页 submit → 设置 `global_formData.value = { home: true, ...formData }`
2. 跳转到目标页面
3. 目标页初始化时检查 `global_formData.value.home`
4. 读取参数后调用 `store.reset()` 清除

### 6.2 useSessionIdStore — 电商会话管理

**用途**：管理电商各子功能的 sessionId 生命周期

```typescript
function useSessionId(type: string) {
  const getSessionId = (init?: boolean) => {
    // 优先级：store → localStorage → 生成新的
    // init=true 时不生成新的，仅查询
  }
  const clearSessionId = () => { /* 清除 store + localStorage */ }
}
```

**sessionId 格式**：`AiSession_` + `crypto.randomUUID()`

**持久化策略**：
- 存储位置：`localStorage.sessionIdMap`（JSON 序列化的 type→sessionId 映射）
- 页面刷新后可恢复未完成的轮询

### 6.3 useUserInfoStore — 用户信息

```typescript
interface IUserInfo {
  availablePoints: number  // 可用积分
  avatar: string           // 头像 URL
}
```

- Store 初始化时自动 fetch
- `updateUserInfo()` 强制刷新（任务完成后调用）

---

## 7. 轮询机制详解

### 7.1 usePolling — 通用轮询 Hook

```typescript
export function usePolling<T>(
  fn: (params?: string) => Promise<T>,
  interval: number = 3000,
  options: {
    immediate?: boolean           // 是否立即执行（默认 true）
    autoStop?: (result: T) => boolean  // 返回 true 停止轮询
    onError?: (error: unknown) => void
  }
)
```

**返回值**：
| 属性 | 类型 | 说明 |
|------|------|------|
| isPolling | Ref\<boolean\> | 轮询状态 |
| result | Ref\<T\> | 最新结果 |
| error | Ref\<unknown\> | 最新错误 |
| start(params?) | Function | 启动轮询 |
| stop() | Function | 停止轮询 |
| reset() | Function | 停止 + 清空状态 |

**生命周期管理**：组件 `onUnmounted` 时自动 stop，防止内存泄漏。

**执行机制**：使用 `setTimeout` 递归调度（非 `setInterval`），确保前一次请求完成后再等待 interval 再发下一次。

### 7.2 图片/视频模块轮询（`src/views/picture/hooks.ts`）

```typescript
export function useInitCheckTaskStatus(props: IProps) {
  // 1. 初始化检查 localStorage 是否有未完成的 sessionId
  const sessionId = getSessionId(true)
  if (sessionId) {
    loading.value = true
    start(sessionId)  // 恢复轮询
  }

  // 2. 执行新任务
  const execute = (params) => {
    params.sessionId = getSessionId()
    creationSubmit(params).then(() => {
      getData(true)  // 刷新列表
      start(params.sessionId)  // 开始轮询
    })
  }

  // 3. 自动停止条件
  autoStop: (res) => {
    // 遍历所有 task.contents
    // 全部 status=2 或 terminal=true → 停止
    // 停止后：清除 sessionId、刷新列表、刷新积分
  }
}
```

### 7.3 电商模块轮询（`src/views/e-commerce/childPages/hooks.ts`）

与图片/视频模块类似，但有以下区别：
- 使用 `ecommerceSubmit` 而非 `creationSubmit`
- 返回 `taskList`（computed 响应式数据）直接驱动 UI 渲染
- `showList` 控制"生成结果"vs"功能示例"的切换

### 7.4 达人定制轮询

使用单任务 taskId 轮询（非 sessionId）：
- 任务提交后将 taskId 存入 `localStorage.modelTaskId`
- 页面初始化时检查并恢复
- 成功后清除 localStorage 并刷新达人列表

---

## 8. 自定义指令

### 8.1 v-observer-scroll — 滚动监听

**注册名**：`v-observer-scroll`

**绑定值接口**：
```typescript
interface IBindingValue {
  callback?: () => void        // 触底回调
  distance?: number            // 触底提前触发距离（默认 20px）
  callbackTop?: () => void     // 触顶回调
  distanceTop?: number         // 触顶提前触发距离（默认 200px）
  onScroll?: (scrollTop: number) => void  // 滚动实时回调
}
```

**实现策略**：
- **触底检测**：IntersectionObserver + 哨兵元素（1px 不可见 div 插入容器末尾）
  - 优势：性能好，无需计算 scrollHeight
  - 防护：内容不溢出时不触发（避免空列表误触发）
- **触顶检测**：scroll 事件 + `_topTriggered` 防重复标志
  - 触顶时标记已触发，滚离后重置
  - 适合聊天场景的"向上加载历史消息"

**清理**：`unmounted` 时断开 Observer 并移除事件监听。

### 8.2 v-loading — 加载状态覆盖层

**注册名**：`v-loading`

**绑定值**：`boolean`

**实现**：
- 使用 JSX 渲染 Naive UI 的 `<NSpin>` 组件
- 覆盖层为 absolute 定位的半透明白色遮罩（z-index: 9999）
- 通过 `display: flex/none` 控制显示/隐藏
- `unmounted` 时清理 DOM

---

## 9. 通用 Composables

### 9.1 useDebounce — 响应式防抖

```typescript
export function useDebounce(config: {
  data: WatchSource | WatchSource[] | object  // 监听源
  callback: () => void                         // 防抖后执行
  delay?: number                               // 延迟（默认 300ms）
  options?: WatchOptions                       // watch 选项
})
```

**特点**：
- 基于 `watch` 实现，监听任意响应式数据
- 支持 WatchSource / WatchSource[] / reactive object
- 组件卸载时自动清理 timer 和 stop watcher

**使用场景**：
- 电商模块积分预览（1000ms 防抖）
- 首页筛选 Tab 切换（0ms，仅合并同步变更）

---

## 10. 组件设计

### 10.1 ImageUpload — 图片上传组件

**Props**：
| Prop | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| type | `'default' \| 'card'` | `'default'` | 展示风格 |
| limitNumber | number | - | 上传数量限制 |
| exampleImages | string[] | - | 示例图列表 |
| btnName | string | `'上传产品图'` | 按钮文案 |
| multiple | boolean | false | 是否多选 |
| topRightTips | boolean | true | 右上角数量提示 |
| bottomTips | boolean | false | 底部提示文字 |
| tryImages | any[] | - | "试一试"快速填充图列表 |
| field | string | `'image'` | 对象数组取图片 URL 的 key |
| customResultHandle | Function | - | 自定义上传结果处理 |
| customBeforeUpload | Function | - | 上传前校验钩子 |

**Model**：`imgList: any[]`（双向绑定图片 URL 数组）

**上传逻辑**：
1. MIME 校验（只允许 `image/*`）
2. 调用 `ossUpload.upload()` 直传 OSS
3. 结果裁剪到 limitNumber 限制
4. loading 状态覆盖

### 10.2 ChatInputSelect — 自定义下拉选择器

**特点**：
- 轻量级替代 Naive UI Select（节省空间）
- 弹出方向自适应（检测上下可用空间）
- 全局单例管理器：打开新实例时自动关闭其他实例
- 动画效果：slide-fade，上下弹出方向反转
- options 变化时自动选中第一项（防止悬空选中）

**全局单例机制**：
```typescript
// 所有实例注册到全局数组
const instances: { el: HTMLElement; close: CloseFn }[] = []
// 全局 click 监听器（捕获阶段）
// 点击任何实例外的区域 → 关闭非当前实例
```

### 10.3 WaterfallVirtualScroller — 虚拟瀑布流

**底层库**：`@lhlyu/vue-virtual-waterfall` 的 `VirtualWaterfall` 组件

**配置参数**：
```typescript
const waterfallOption = {
  virtual: true,          // 启用虚拟化
  enableCache: true,      // 启用缓存
  gap: 4,                 // 间距 4px
  itemMinWidth: 220,      // 最小列宽
  minColumnCount: 2,      // 最少 2 列
  maxColumnCount: 6,      // 最多 6 列
  padding: '1px 0',       // 边距（防止初始化无滚动条时图片不渲染）
}
```

**高度计算**：根据原始宽高比动态计算渲染高度
```typescript
const calcItemHeight = (item, itemWidth) => item.height * (itemWidth / item.width)
```

### 10.4 ChatInputBox — 聊天输入框

**设计决策**：使用 `contenteditable` div 而非 `<textarea>`

**原因**：
- 支持更灵活的布局（图片上传区与文本区并排）
- 自适应高度
- CSS placeholder 通过 `:empty::before` + `attr(data-placeholder)` 实现

**关键实现**：
- 粘贴拦截：`@paste` 事件中 `e.preventDefault()`，只保留纯文本
- 双向绑定：`@input` 事件手动同步 `formData.prompt`
- Tab 切换时通过 watch 同步 DOM innerText

---

## 11. 路由架构

### 11.1 路由模式

使用 **Hash 模式**（`createWebHashHistory`），适配嵌入第三方应用场景。

### 11.2 路由结构

```
/                     ← Layout（侧边导航 + 内容区）
├── /                 ← 首页
├── /picture          ← 图片生成
├── /video            ← 视频生成
├── /e-commerce       ← 电商功能列表
├── /e-commerce/product-kit       ← 商品套图
├── /e-commerce/product-detail    ← AI详情页
├── /e-commerce/product-clone     ← 爆款复刻
├── /e-commerce/product-in-hand   ← 手持商品
├── /e-commerce/video-hot         ← 爆款视频
├── /e-commerce/video-clone       ← 视频复刻
├── /e-commerce/model-replace     ← 模特替换
├── /e-commerce/product-replace   ← 商品替换
├── /e-commerce/change-background ← 人像换背景
├── /e-commerce/clothing-kit      ← 穿戴套图
├── /e-commerce/clothing-try      ← AI试衣
├── /e-commerce/clothing-remove-wrinkle ← 服装去皱
├── /e-commerce/merge-image       ← 搭配融图
├── /e-commerce/try-shoe          ← AI试鞋
└── /asset            ← 资产管理
```

所有路由为 Layout 的 `children`，共享侧边导航。电商子功能路由为平铺结构（非嵌套），与 Layout children 同级。

### 11.3 路由守卫

```typescript
router.beforeEach(async (to, from) => {
  const token = localStorage.getItem('fusion_accessToken')
  if (!token) {
    // 生产环境：unionToken 登录
    // 开发环境：硬编码账号自动登录
  }
})
```

---

## 12. 样式体系

### 12.1 全局变量 (`src/assets/variables.less`)

```less
@main-color: var(--main-color);  // 主题色（CSS 变量引用）

.scrollbar(@width, @trackColor, @thumbColor) {
  // 自定义滚动条 Mixin
}
```

主题色通过 CSS 自定义属性实现，组件中使用 `var(--main-color)` 引用，品牌紫色 `#8e66f9`。

### 12.2 样式规范

| 场景 | 方式 |
|------|------|
| 全局变量/Mixin | `src/assets/variables.less`（手动引入） |
| 页面级样式 | 独立 `.less` 文件（如 `picture/index.less`） |
| 组件样式 | `<style scoped lang="less">` |
| 电商模块公共样式 | `childPages/common.less`（`@import` 引入） |

### 12.3 布局方案

- 整体布局：左导航（80px fixed）+ 右内容区（flex: 1）
- 电商子页面：左操作栏 + 右结果区（双栏）
- 图片/视频页面：聊天式上下布局（虚拟列表 + 底部输入框）
- 首页：居中卡片式布局 + 瀑布流广场

---

## 13. 关键设计模式

### 13.1 聊天式交互模式

图片和视频页面采用"类微信聊天"交互：
- 消息从上往下排列，最新消息在底部
- 首次加载自动滚动到底部
- 向上滚动触发历史加载（分页 8 条/页）
- 生成中显示 loading，完成后原地更新

**技术实现**：
- `DynamicScroller`（vue-virtual-scroller）处理虚拟滚动
- `ResizeObserver` 动态计算容器高度
- `scrollToBottom()` 利用库内部 `_undefinedSizes` 计数器确保所有 item 测量完成后滚动

### 13.2 任务状态机

```
提交 → 排队(0) → 处理中(1) → 成功(2) / 失败(3) / 取消(4)
```

**终态判断**：`status === 2 || statusView.terminal === true`

### 13.3 会话 ID 管理

每个电商子功能对应一个独立 sessionId，通过 `useSessionIdStore` 的 `useSessionId(type)` 闭包隔离。多个子功能可同时有任务在运行，互不干扰。

### 13.4 幂等性保障

电商提交接口携带 `Idempotency-Key: crypto.randomUUID()`，防止网络重试导致重复提交。

### 13.5 Composable 抽取模式

电商页面大量使用「函数内闭包」模式组织代码：

```typescript
// 在 <script setup> 中
const { modelList, scrollCallBack } = useModelList()
function useModelList() {
  const pagingData = reactive({...})
  const modelList = ref([])
  // ... 内部逻辑
  return { modelList, scrollCallBack }
}
```

这种方式在不抽离文件的前提下，保持了逻辑的内聚性和变量作用域的隔离。

---

## 14. 第三方集成

### 14.1 宿主应用桥接

通过 `window.ThirdServiceBridge` 对象与宿主应用通信。桥只在**桌面端宿主**内存在，浏览器直开与移动端宿主里整个对象都是 `undefined`；且各方法是分批加上去的（旧版桌面端只有 `refreshUnionToken`），故调用点一律走可选链。类型声明见 `src/types/bridge.d.ts`。

| 方法 | 用途 |
|------|------|
| `refreshUnionToken()` | 请求宿主应用刷新 unionToken |
| `onDeviceNotice(cb)` | 订阅设备侧提示，返回退订函数（**可能是 undefined**，退订前判空） |
| `requestDoubaoRelogin()` | 请求宿主还原并聚焦主窗、弹出豆包登录框。无参无返回，重复调用无害 |

#### 设备侧提示（onDeviceNotice）

站点发起的生成可能被派回**本机豆包**执行。失败的真实原因（掉登录 / 额度用完 / 豆包繁忙）只有桌面端知道——走服务端往返只能拿到 401/5xx。故桌面端把失败翻成用户友好文案后经桥直推，站点负责展示。

载荷 `DeviceNotice`：

| 字段 | 说明 |
|------|------|
| `source` | 提示来源，当前恒 `'doubao'`。未知 source 也照常展示 `message` |
| `kind` | `need-login` / `quota-exhausted` / `busy` / `timeout` / `failed`。**词表会增长，未知 kind 兜底展示** |
| `message` | 用户友好文案，**原样展示**，不改写、不拼接错误码 |
| `ts` | 产生时刻（epoch ms） |

站点侧实现：`src/components/DeviceNoticeHost/index.ts`（挂在 `App.vue` 的 `<n-message-provider>` 内）。`kind` 只用于决定 message 的颜色与停留时长；`need-login` 用 `duration: 0` 常驻并内嵌「去登录」按钮（naive 的 message 没有 action 槽，走 `content` 渲染函数），点击调 `requestDoubaoRelogin()`。

两条边界：

1. **不做前端去重/节流**——桌面端已按 kind 做 60s 节流，再加一层只会互相干扰。唯一的例外是 `need-login`：它是 `duration: 0` 的常驻提示，屏幕上已经挂着一条时**直接丢弃新的**，否则挂机久了会攒出一叠红条。

   注意是「拦住不建」而不是「先 destroy 再建」：naive 的 `MessageReactive.destroy()` 走 `messageRefs[key]?.hide()`，而那个 ref 要等渲染刷新才登记，**同一 tick 内建完就销毁是静默 no-op**（实测连推三条会叠三条）。代价是常驻期间若宿主换了文案，用户看到的仍是旧那条——掉登录文案基本固定，且可操作的部分（「去登录」按钮）一样，可接受。
2. **本通道与 `src/api/index.ts` 的 401/业务错误提示互补，都不能省**——本通道只覆盖「派到本机的供给失败」，服务端错误覆盖其余一切。

### 14.2 阿里云 OSS

- SDK：`ali-oss ^6.23.0`
- 上传方式：STS 临时凭证直传
- 凭证刷新间隔：5 分钟
- 存储桶区分：公开桶（图片展示）/ 私有桶

---

## 15. 性能优化策略

| 优化点 | 技术手段 | 应用场景 |
|--------|----------|----------|
| 虚拟滚动 | vue-virtual-scroller DynamicScroller | 图片/视频消息列表 |
| 虚拟瀑布流 | @lhlyu/vue-virtual-waterfall | 首页广场 |
| 触底检测 | IntersectionObserver + 哨兵元素 | 无限加载列表 |
| 防抖 | useDebounce (watch + setTimeout) | 参数变化触发 API |
| 懒加载路由 | `() => import(...)` | 所有页面路由 |
| 组件按需导入 | unplugin-vue-components | Naive UI |
| API 按需导入 | unplugin-auto-import | Vue + Naive UI |
| 类型检查增量化 | vue-tsc --build (.tsbuildinfo) | 构建加速 |
| ESLint 缓存 | --cache 标志 | lint 加速 |
| 并行构建 | run-p type-check build-only | CI 加速 |

---

## 16. 环境配置

### 16.1 环境变量

| 变量 | 用途 |
|------|------|
| `VITE_OSS_ASSET_URL` | OSS 静态资源 CDN 前缀 |
| `import.meta.env.PROD` | 是否生产环境 |
| `import.meta.env.BASE_URL` | 应用基础路径 |

### 16.2 环境差异

| 项目 | 开发环境 | 生产环境 |
|------|----------|----------|
| API 基地址 | 空（走 Vite proxy） | `https://aigc.pengqiwl.com` |
| 登录方式 | 硬编码账号自动登录 | unionToken 从 URL 获取 |
| 代理目标 | `http://192.168.0.3:18080` | 直连 |

---

## 17. 错误处理

### 17.1 全局层面
- Axios 响应拦截器：非 0 code 自动弹出 `message.error(data.msg)`
- Token 过期自动刷新，刷新失败才要求重新登录

### 17.2 业务层面
- 表单校验：`useMessage().warning()` 提示缺失字段
- 轮询错误：`onError` 回调中重置 loading 状态
- 上传失败：通过 `.finally()` 确保 loading 状态恢复

### 17.3 任务失败
- status=3 时显示 `errorMsg` 文案
- 不阻断轮询（等所有 content 到达终态）

---

## 18. 数据持久化策略

| Key | 位置 | 说明 | 清理时机 |
|-----|------|------|----------|
| `fusion_accessToken` | localStorage | 访问令牌 | 登出/刷新失败 |
| `fusion_refreshToken` | localStorage | 刷新令牌 | 登出/刷新失败 |
| `sessionIdMap` | localStorage | 电商会话 ID 映射 | 任务完成 |
| `modelTaskId` | localStorage | 达人定制任务 ID | 定制完成 |
| `userInfo` | localStorage | 用户头像缓存 | - |
