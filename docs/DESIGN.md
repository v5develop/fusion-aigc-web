# Slot 模式结构化输入框 技术文档

## 1. 组件结构

```
ChatInputBox/
├── index.vue              # 容器，mode='default'|'slot' 双模式
├── PromptEditor.vue       # 混合编辑平面，contenteditable + 内联块
├── types.ts               # PromptSlot、SlotOption、FileItem 类型
├── utils.ts               # slotsToPrompt
└── slots/
    ├── icons.ts            # SVG 图标，通过 ?raw 引入切图文件
    ├── select.ts           # buildSelectHTML、showDropdown、closeAllDropdowns
    └── upload.ts           # buildUploadHTML、updateUploadBlockDOM
```

SVG 切图：
```
src/assets/icons/ecommerce/
├── ratio-1-1.svg
├── ratio-3-4.svg           # 设计稿 S5 原始切图
├── ratio-9-16.svg          # 设计稿 S7 原始切图
└── ratio-16-9.svg          # 设计稿 S8 原始切图
```

## 2. 数据模型

```typescript
// types.ts

interface FileItem { url: string; thumbnail?: string; name?: string }

interface SlotOption {
  label: string
  value: string
  icon?: string     // SVG 字符串
}

type PromptSlot = SlotText | SlotUpload | SlotSelect

interface SlotText   { type: 'text';   value: string }
interface SlotUpload { type: 'upload'; label: string; value: FileItem[]; limit?: number; accept?: 'image'|'video' }
interface SlotSelect { type: 'select'; label: string; value: string; options: SlotOption[]; title?: string }
```

### 2.1 示例

输入框渲染效果：
```
📷 上传产品图 ，生成一套完整主图，商品名称为____ ，适配 淘宝/天猫 ▾ 平台，单图比例为 1:1 ▾ 。
```

对应的 `PromptSlot[]`：

```json
[
  { "type": "upload",  "label": "上传产品图", "value": [], "limit": 5 },
  { "type": "text",    "value": "，生成一套完整主图，商品名称为" },
  { "type": "text",    "value": "" },
  { "type": "text",    "value": "，适配" },
  {
    "type": "select",
    "title": "选择平台",
    "label": "淘宝/天猫",
    "value": "taobao",
    "options": [
      { "label": "淘宝/天猫", "value": "taobao", "icon": "<svg>...</svg>" },
      { "label": "京东",     "value": "jd",     "icon": "<svg>...</svg>" },
      { "label": "拼多多",   "value": "pdd",    "icon": "<svg>...</svg>" }
    ]
  },
  { "type": "text",    "value": " 平台，单图比例为" },
  {
    "type": "select",
    "title": "选择比例",
    "label": "1:1",
    "value": "1:1",
    "options": [
      { "label": "1:1",  "value": "1:1",  "icon": "<svg>...</svg>" },
      { "label": "3:4",  "value": "3:4",  "icon": "<svg>...</svg>" },
      { "label": "9:16", "value": "9:16", "icon": "<svg>...</svg>" },
      { "label": "16:9", "value": "16:9", "icon": "<svg>...</svg>" }
    ]
  },
  { "type": "text",    "value": "。" }
]
```

## 3. 编辑模型

PromptEditor 基于 contenteditable 实现混合编辑：

- **文字**：浏览器原生编辑，input 事件不做任何同步
- **内联块**：`<span contenteditable="false">` 渲染，Backspace/Delete 通过 beforeinput 精确删除
- **数据同步**：只在离散操作时调用 `syncFromDOM()`（下拉选择、上传、删除文件），通过 `suppressRender` 标志阻止 watch 重渲染
- **预设加载**：父组件修改 `slots` → deep watch 触发 → `renderSlots()` 全量替换 innerHTML

## 4. 渲染策略

| 场景 | 触发方式 | 光标 |
|------|---------|------|
| 文字输入 | 浏览器原生 | 保持 |
| Backspace/Delete 删块 | beforeinput 精确移除 DOM | 保持 |
| 下拉选择 / 上传 / 删文件 | 局部 DOM + syncFromDOM | 保持 |
| 点击预设按钮 | watch → renderSlots | 重置 |

## 5. 下拉面板

- 挂载到 `document.body`，`position: fixed` + `getBoundingClientRect()` 定位
- 非 scoped 样式，避免 Vue 作用域隔离
- 分组标题（灰色 `#8F8F8F`）+ 图标 + 文本 + 选中标记 ✓
- 选中项：灰色背景 `#F5F6F8` + 右侧紫色 ✓

## 6. ChatInputBox 双模式

```
mode='default' → 原有 picture/video 逻辑，上传按钮 + contenteditable textarea
mode='slot'    → PromptEditor + 独立侧边上按钮 (v-model:sideImages)
```

侧边上传和内联 SlotUpload 完全独立，提交时合并。

## 7. 预设模板

首页 `usePreinstall()` 定义 4 个电商预设，每个预设是 `PromptSlot[]`。默认填入"全套主图生成"。点击预设按钮深拷贝替换 `formData.ecommerce.slots`，触发 PromptEditor 全量重渲染。

## 8. 提交流程

```typescript
const { plainText, images: slotImages } = slotsToPrompt(formData.ecommerce.slots)
const allImages = [...slotImages, ...formData.ecommerce.images]
// → global_formData → router.push('e-commerce')
```
