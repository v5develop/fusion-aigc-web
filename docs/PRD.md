# Fusion AIGC Web 产品需求文档（PRD）

## 1. 产品概述

### 1.1 产品名称
Fusion AIGC Web — AI 生成内容平台

### 1.2 产品定位
面向电商商家和内容创作者的一站式 AI 内容生成平台，提供图片生成、视频生成、电商专用素材生成等能力，帮助用户低成本、高效率地产出商业级视觉内容。

### 1.3 目标用户
- 电商商家（淘宝/天猫、拼多多、抖音电商等平台卖家）
- 内容创作者
- 设计师（快速产出商品素材）
- 品牌运营人员

### 1.4 核心价值
- 无需专业设计能力，通过 AI 一键生成电商级商品图/视频
- 支持多平台规范适配（淘宝/天猫、拼多多、抖音等）
- 多语言、多区域市场支持
- 积分制付费模型，按需使用

---

## 2. 系统架构

### 2.1 整体布局
- **左侧导航栏**（80px 宽度，固定定位）：Logo、功能菜单、积分余额、用户头像
- **右侧内容区**：根据路由动态加载对应模块页面

### 2.2 导航菜单
| 菜单项 | 路由 | 功能说明 |
|--------|------|----------|
| 首页 | `/` | 创意广场 + 快速入口 |
| 图片 | `/picture` | AI 图片生成工作台 |
| 视频 | `/video` | AI 视频生成工作台 |
| 电商 | `/e-commerce` | 电商专用功能矩阵 |
| 资产 | `/asset` | 生成资产管理中心 |

### 2.3 认证体系
- **登录方式**：账号密码登录 / unionToken 免密登录
- **Token 机制**：双 Token（accessToken + refreshToken）
- **无感刷新**：accessToken 过期时自动使用 refreshToken 刷新，请求排队等待
- **三方桥接**：支持通过 `ThirdServiceBridge.refreshUnionToken` 与宿主应用联动刷新

### 2.4 积分系统
- 用户拥有可用积分（availablePoints），每次生成任务消耗积分
- 任务提交前通过 `/api/v1/billing/quote/preview` 预览消耗积分
- 任务完成后自动刷新积分余额
- 积分显示在左侧导航栏底部

---

## 3. 功能模块详细设计

### 3.1 首页模块

#### 3.1.1 功能概述
首页是用户的统一入口，采用「对话式交互 + 内容广场」设计。

#### 3.1.2 对话式输入区
- **Tab 切换**：图片 / 视频 / 电商，三种创作模式
- **输入框**：支持提示词输入 + 图片/视频上传
- **参数选择**：根据模式显示对应参数选项
  - 图片模式：生成方式（图生图/文生图）、比例
  - 视频模式：生成方式、模型、比例、分辨率、时长
  - 电商模式：快捷入口卡片
- **提交后跳转**：参数通过全局 Store 传递，跳转到对应工作台页面

#### 3.1.3 内容广场
- **筛选 Tab**：按内容类型和分类筛选
- **瀑布流展示**：使用虚拟滚动瀑布流组件（WaterfallVirtualScroller）
- **无限滚动加载**：触底自动加载更多
- **回到顶部**：滚动超过 400px 显示回到顶部按钮
- **数据接口**：`GET /api/v1/asset/public/display`

#### 3.1.4 电商快捷入口
- 全套主图生成
- 商品场景图
- 电商详情页
- AI 模特试衣

---

### 3.2 图片生成模块

#### 3.2.1 功能概述
类聊天界面的 AI 图片生成工作台，支持文生图和图生图。

#### 3.2.2 生成方式
| 方式 | entryCode | 输入 | 输出 |
|------|-----------|------|------|
| 图生图 | `imageToImage` | 参考图片 + 提示词 | 1 张图片 |
| 文生图 | `textToImage` | 提示词 | 4 张图片 |

#### 3.2.3 可配置参数
- **比例**：1:1(1024x1024)、2:3、3:2、3:4、4:3、9:16、16:9
- **模型**：local-image（本地模型）

#### 3.2.4 交互设计
- 无历史记录时，显示居中引导文案"和我聊聊，你想要什么设计～"
- 有历史记录时，采用聊天式消息流布局
- 使用 DynamicScroller 虚拟滚动，优化大量消息渲染性能
- 首次进入自动滚动到最新消息（底部）
- 向上滚动触发历史消息加载（分页 8 条/页）

#### 3.2.5 消息卡片内容
- 日期标题
- 用户输入的提示词
- 元信息（生成方式 + 比例）
- 图片网格（支持预览大图）
- 状态提示：处理中 / 失败原因
- AI 生成声明
- 操作按钮：再次生成 / 全部下载

#### 3.2.6 任务流程
1. 用户填写参数 → 点击提交
2. 调用 `POST /api/v1/creation/submit` 创建任务
3. 进入轮询状态（3s 间隔），查询会话下所有任务状态
4. 所有内容到达终态后停止轮询
5. 完成后刷新积分余额

---

### 3.3 视频生成模块

#### 3.3.1 功能概述
类聊天界面的 AI 视频生成工作台，支持多种生成方式和模型选择。

#### 3.3.2 生成方式
| 方式 | entryCode | 输入要求 |
|------|-----------|----------|
| 文生视频 | `textToVideo` | 提示词 |
| 图生视频 | `imageToVideo` | 图片(最多5张) + 提示词 |
| 动作迁移 | `actionTransfer` | 图片(1张) + 视频(1个) + 提示词 |
| 首尾帧视频 | `firstLastFrames` | 图片(2张) + 提示词 |

#### 3.3.3 可选模型
| 模型 | modelCode | 分辨率 |
|------|-----------|--------|
| 本地模型 | `local-video` | 720p / 1080p |
| seedance2.0 | `doubao-seedance-2-0-260128` | 480p / 720p / 1080p |
| seedance2.0-fast | `doubao-seedance-2-0-fast-260128` | 480p / 720p |

#### 3.3.4 可配置参数
- **比例**：9:16、16:9
- **时长**：4s ~ 15s（1s 步进）
- **分辨率**：随模型变化

#### 3.3.5 交互设计
与图片模块一致的聊天式界面，视频结果以 `<video>` 标签展示，支持播放控制。

---

### 3.4 电商模块

#### 3.4.1 功能矩阵
电商模块是平台核心，分为三大类共 15 个子功能：

**商品图（4 个）**
| 功能 | 路由 | type | 说明 |
|------|------|------|------|
| AI 商品套图 | `/e-commerce/product-kit` | productSetImages | 一键生成全套电商主图 |
| AI 详情页 | `/e-commerce/product-detail` | aPlusDetailPage | 生成 A+ 商品详情页 |
| 爆款图复刻 | `/e-commerce/product-clone` | hitReplication | 参考爆款图风格生成 |
| 手持商品 | `/e-commerce/product-in-hand` | aiGestures | 生成手持商品图 |

**商品视频（4 个）**
| 功能 | 路由 | type | 说明 |
|------|------|------|------|
| 爆款视频 | `/e-commerce/video-hot` | hitVideo | AI 生成商品推广视频 |
| 视频复刻 | `/e-commerce/video-clone` | hitVideoReplication | 参考视频风格复刻 |
| 商品替换 | `/e-commerce/product-replace` | productReplacement | 视频中替换商品 |
| 模特替换 | `/e-commerce/model-replace` | personReplacement | 视频中替换模特 |

**穿戴图（6 个）**
| 功能 | 路由 | type | 说明 |
|------|------|------|------|
| AI 穿戴套图 | `/e-commerce/clothing-kit` | wearingProductSetImages | 服装完整套图 |
| AI 试衣 | `/e-commerce/clothing-try` | aiClothExchange | AI 模特试穿展示 |
| 服装去皱 | `/e-commerce/clothing-remove-wrinkle` | removeWrinkles | 服装图片去皱处理 |
| 搭配融图 | `/e-commerce/merge-image` | mergeClothes | 多件服装搭配合成 |
| AI 试鞋 | `/e-commerce/try-shoe` | shoeSwapping | AI 模特试鞋展示 |
| 人像换背景 | `/e-commerce/change-background` | backgroundSwitching | 更换人像背景 |

#### 3.4.2 电商模块通用页面结构
所有电商子功能采用统一的双栏布局（Container 组件）：
- **左栏**：参数配置区（图片上传、参数选择、提示词等）
- **右栏**：结果展示区（生成结果列表 / 功能示例 Sample）

#### 3.4.3 AI 商品套图（productKit）详细设计

**输入参数：**
- 商品图片上传（最多 3 张，支持多选）
- 平台选择：淘宝/天猫、拼多多、抖音
- 目标区域：中国、东南亚、欧美
- 语言：中文、英文
- 图片比例：1:1、3:4、4:3
- 商品卖点（支持 AI 帮写）
- 套图结构配置：
  - 智能匹配（默认）：AI 自动分析最佳套图结构
  - 自定义配置：可调白底图、场景图、卖点图、细节图数量（总计 1~5 张）

**AI 帮写功能：**
- 调用 `POST /api/v1/creation/optimize-prompt`
- 基于上传的商品图 AI 分析生成商品卖点文案
- 场景类型：ai_writing / ai_writing_background / aiMergeClothes

**积分预览：**
- 根据自定义配置动态计算消耗积分
- 使用防抖（1000ms）避免频繁请求

#### 3.4.4 AI 试衣（clothingTry）详细设计

**输入参数：**
- 商品服装图上传（1 张，限制 20KB~15MB，分辨率 > 400x400）
- 模特选择：
  - 模特库：支持性别、年龄、肤色筛选 + 分页加载
  - 上传模特：自定义上传模特图片
- 试衣模版选择：
  - 模版库：支持性别、年龄、角度、景别、风格、款式筛选
  - 自定义模版：上传自定义试衣模版
- 场景背景选择：从背景库选取

**素材库接口：**
- `GET /api/v1/asset/public/template`
- 按 moduleCode + slotCode 获取对应素材
- slotCode: model(模特库) / tryOnTemplate(试衣模板) / background(背景库) / shoeTemplate(鞋库) / gestures(手持姿势库)

#### 3.4.5 爆款视频（videoHot）详细设计

**输入参数：**
- 商品图片上传（最多 3 张）
- 目标市场与语言：区域、语言
- 比例：9:16、16:9
- 时长：16s（默认）
- 商品卖点（支持 AI 帮写）
- 视频类型选择（单选 Checkbox）
- 模型选择：本地模型 / 外部模型
- 定制专属模特（可开关）：
  - 定制达人：配置性别、年龄、外观、体型 → 生成专属达人
  - 我的达人：选择已生成/已上传的达人

**定制达人流程：**
1. 配置达人属性（性别、年龄段、外观特征、体型）
2. 补充外貌细节描述
3. 调用 `POST /api/v1/creation/ecommerce/submit` (type: aiExpert)
4. 轮询 `GET /api/v1/creation/query/{taskId}` 等待生成完成
5. 生成结果存入"我的达人"列表

**人脸认证流程（非本地模型）：**
1. 上传达人图片
2. 调用 `POST /api/v1/creation/face-recognition/submit`
3. 返回认证链接和二维码
4. 支持电脑端直接认证 / 手机扫码认证
5. 轮询 `GET /api/v1/creation/faceRecognition/{taskId}` 等待认证结果
6. 认证成功后达人可用

#### 3.4.6 电商任务统一执行流程
1. 用户配置参数 → 点击提交
2. 生成/获取 sessionId（格式：`AiSession_` + UUID）
3. 调用 `POST /api/v1/creation/ecommerce/submit`（携带幂等性 Header）
4. 开始轮询 `GET /api/v1/creation/session/{sessionId}`（3s 间隔）
5. 检查所有 task 的 contents 状态：
   - status 0: 排队中
   - status 1: 处理中
   - status 2: 成功
   - status 3: 失败
   - status 4: 取消
6. 所有内容到达终态（status=2 或 terminal=true）时停止轮询
7. 清除 sessionId，刷新积分余额

---

### 3.5 资产管理模块

#### 3.5.1 功能概述
管理用户所有生成的图片、视频和电商素材资产。

#### 3.5.2 资产分类
**一级分类：**
- 图片
- 视频
- 电商

**二级分类（电商专属）：**
- AI 商品套图、AI 详情、爆款图复刻、手持商品
- 视频复刻、爆款视频、模特替换、商品替换
- 人像换背景、AI 穿搭套图、AI 试衣、服装去皱、搭配图、AI 试鞋

#### 3.5.3 交互设计
- 两级 Tab 切换筛选
- 卡片列表展示
- 无限滚动加载（9 条/页）
- 加载中状态指示器（v-loading）
- 切换分类时重置列表

#### 3.5.4 数据接口
- `GET /api/v1/asset/all`
- 参数：category(类型) + type(电商子类型) + page + pageSize

---

## 4. 文件上传系统

### 4.1 上传流程
1. 前端调用 `POST /api/v1/storage/direct/sts` 获取临时凭证
2. 使用阿里云 OSS SDK 直传文件到 OSS
3. 上传完成后调用 `POST /api/v1/storage/direct/confirm` 确认
4. 返回文件访问 URL

### 4.2 STS 凭证参数
- subDir：子目录（uploads/images/videos/audios）
- fileName：文件名
- contentType：MIME 类型
- fileSize：文件大小
- visibility：公开(public) / 私有(private)

### 4.3 STS Token 自动刷新
- 配置 refreshSTSTokenInterval: 300000ms（5 分钟）
- 过期自动重新获取凭证

---

## 5. 轮询机制

### 5.1 通用轮询 Hook（usePolling）
- 可配置轮询间隔（默认 3000ms）
- 支持自动停止条件（autoStop 回调）
- 支持错误回调（onError）
- 组件卸载时自动清理定时器
- 支持 start/stop/reset 手动控制

### 5.2 图片/视频模块轮询
- 基于 sessionId 轮询 `GET /api/v1/creation/session/{sessionId}`
- 首次进入页面检查 localStorage 中是否有未完成的 sessionId
- 有则恢复轮询，无则显示空状态

### 5.3 电商模块轮询
- 同上基于 sessionId
- sessionId 格式：`AiSession_` + crypto.randomUUID()
- 持久化到 localStorage，刷新页面后可恢复

### 5.4 达人定制轮询
- 基于单个 taskId 轮询 `GET /api/v1/creation/query/{taskId}`
- taskId 持久化到 localStorage（key: modelTaskId）

---

## 6. 接口清单

### 6.1 认证相关
| 方法 | 接口 | 说明 |
|------|------|------|
| POST | `/api/v1/auth/login` | 账号密码登录 |
| POST | `/api/v1/auth/union-token-login` | unionToken 登录 |
| POST | `/api/v1/auth/refresh` | 刷新 Token |
| GET | `/api/v1/auth/user-info` | 获取用户信息 |

### 6.2 存储相关
| 方法 | 接口 | 说明 |
|------|------|------|
| POST | `/api/v1/storage/direct/sts` | 获取 OSS 上传凭证 |
| POST | `/api/v1/storage/direct/confirm` | 确认上传完成 |

### 6.3 创作相关
| 方法 | 接口 | 说明 |
|------|------|------|
| POST | `/api/v1/creation/submit` | 提交图片/视频生成任务 |
| POST | `/api/v1/creation/ecommerce/submit` | 提交电商生成任务 |
| GET | `/api/v1/creation/session/{sessionId}` | 轮询会话任务状态 |
| GET | `/api/v1/creation/query/{taskId}` | 查询单个任务状态 |
| GET | `/api/v1/creation/history` | 获取创作历史 |
| POST | `/api/v1/creation/optimize-prompt` | AI 优化提示词 |
| POST | `/api/v1/creation/face-recognition/submit` | 人脸认证提交 |
| GET | `/api/v1/creation/faceRecognition/{taskId}` | 人脸认证状态查询 |

### 6.4 资产相关
| 方法 | 接口 | 说明 |
|------|------|------|
| GET | `/api/v1/asset/all` | 获取用户资产列表 |
| GET | `/api/v1/asset/public/display` | 公开内容展示（广场） |
| GET | `/api/v1/asset/public/template` | 公共素材模板库 |

### 6.5 计费相关
| 方法 | 接口 | 说明 |
|------|------|------|
| POST | `/api/v1/billing/quote/preview` | 积分消耗预览 |

---

## 7. 状态管理设计

### 7.1 useHomeStore
- **用途**：首页 → 工作台的参数传递桥梁
- **数据**：global_formData（图片/视频/电商参数）
- **机制**：首页提交后写入，工作台初始化时读取并 reset

### 7.2 useSessionIdStore
- **用途**：电商模块会话 ID 管理
- **数据**：sessionIdMap（type → sessionId 映射）
- **持久化**：localStorage（key: sessionIdMap）
- **生命周期**：任务提交时生成，轮询完成后清除

### 7.3 useUserInfoStore
- **用途**：用户信息（积分、头像）
- **数据**：availablePoints（可用积分）、avatar（头像）
- **刷新时机**：初始化 / 任务完成后

---

## 8. 非功能需求

### 8.1 性能优化
- 虚拟滚动：聊天消息列表使用 DynamicScroller（vue-virtual-scroller）
- 瀑布流虚拟滚动：首页广场使用自定义 WaterfallVirtualScroller
- 图片懒加载：结合滚动监听按需加载
- ResizeObserver：动态计算滚动容器高度
- 防抖：参数变化时对接口请求做防抖处理

### 8.2 用户体验
- 无感 Token 刷新：请求排队机制，用户无感知
- 任务恢复：页面刷新后通过 localStorage 恢复轮询状态
- 幂等性保障：ecommerce/submit 请求携带 `Idempotency-Key` Header
- 加载态反馈：按钮 loading + 区域 v-loading
- 错误提示：统一使用 Naive UI message 组件

### 8.3 兼容性
- 路由模式：Hash 模式（`createWebHashHistory`）
- 运行环境：现代浏览器（需支持 crypto.randomUUID、ResizeObserver）
- 嵌入场景：支持通过 unionToken 嵌入第三方应用

---

## 9. 部署信息

- **生产域名**：`https://aigc.pengqiwl.com`
- **静态资源 CDN**：阿里云 OSS（`feilianyun-aicdn.oss-cn-hangzhou.aliyuncs.com`）
- **构建工具**：Vite
- **包管理器**：pnpm
- **Node 版本**：^20.19.0 || >=22.12.0
