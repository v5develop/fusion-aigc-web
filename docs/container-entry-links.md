# 容器端功能页深链对接

宿主容器（App）直接跳转到 web 具体功能页的 URL 约定。

---

## 1. 通用约定

### 1.1 URL 形态

web 使用 **hash 路由**，所以**所有参数必须写在 `#` 之后**：

```
✅ https://{BASE_URL}/#/video?entryCode=actionTransfer
❌ https://{BASE_URL}/?entryCode=actionTransfer#/video     ← 页面读不到
```

`{BASE_URL}` 由容器按自己所处环境拼接（测试／生产各自的 web 域名）。

### 1.2 与 unionToken 共存

静默登录用的 `unionToken` 与功能参数写在同一个 query 里，用 `&` 连接，顺序不限：

```
https://{BASE_URL}/#/video?unionToken=xxx&entryCode=actionTransfer
https://{BASE_URL}/#/e-commerce/product-kit?unionToken=xxx
```

### 1.3 什么时候需要带 entryCode

**只有「一个页面内承载多个功能」时才需要。** 具体来说：

| 模块 | 是否带 entryCode | 原因 |
|---|---|---|
| 图片 | ✅ 带 | `/picture` 一个页面装了 2 个功能 |
| 视频 | ✅ 带 | `/video` 一个页面装了 4 个功能 |
| 电商 | ❌ 不带 | 14 个功能各有独立路径，路径本身已唯一定位 |

### 1.4 容错行为

`entryCode` 传了非法值、空值或不传时，页面**降级到该页默认功能**，不会白屏或报错：

- `/picture` 默认 → 图生图（`imageToImage`）
- `/video` 默认 → 图生视频（`imageToVideo`）

### 1.5 其它说明

- 用户进入页面后在页面内切换功能，地址栏的 `entryCode` 会跟着同步更新（用 `replace`，不污染返回栈）。所以容器若需要「记住用户当前所在功能」，读地址栏即可。
- 电商功能页会自动在地址栏补一个 `?tab=N`（应用内多标签的实例 id），**容器不需要也不应该主动传这个参数**，给不带 `tab` 的地址即可。

---

## 2. 图片

页面路径 `/picture`，2 个功能，**需带 entryCode**。

| 功能 | entryCode | 链接 |
|---|---|---|
| 文生图 | `textToImage` | `https://{BASE_URL}/#/picture?entryCode=textToImage` |
| 图生图 | `imageToImage` | `https://{BASE_URL}/#/picture?entryCode=imageToImage` |

---

## 3. 视频

页面路径 `/video`，4 个功能，**需带 entryCode**。

| 功能 | entryCode | 链接 |
|---|---|---|
| 文生视频 | `textToVideo` | `https://{BASE_URL}/#/video?entryCode=textToVideo` |
| 图生视频 | `imageToVideo` | `https://{BASE_URL}/#/video?entryCode=imageToVideo` |
| 动作迁移 | `actionTransfer` | `https://{BASE_URL}/#/video?entryCode=actionTransfer` |
| 首尾帧视频 | `firstLastFrames` | `https://{BASE_URL}/#/video?entryCode=firstLastFrames` |

---

## 4. 电商

14 个功能各有独立路径，**链接不带 entryCode**。

分三组，与 web 端电商首页的分组一致。下表的 `title` / `subtitle` / `icon` 即 web 端二级入口卡片所用的文案与图，容器端可直接复用来渲染自己的入口列表。

> ⚠️ **图标是封面图不是小图标**：宽高比 `97 : 52`（约 1.865:1）的横向卡片图，按此比例布局，不要当方形 icon 用。
>
> ⚠️ **图片必须走 https**。OSS 默认域名自带合法证书，直接用下表地址即可。走 http 在浏览器里看不出问题，但页面嵌进宿主应用时会被 iOS ATS / Android 9+ 明文策略拦掉，表现为图裂成问号。

### 4.1 商品图

| title | subtitle | 链接 | icon |
|---|---|---|---|
| AI商品套图 | 上传商品图，一键产出全套电商图 | `https://{BASE_URL}/#/e-commerce/product-kit` | `https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/product-kit.png` |
| AI详情页 | 批量生成详情素材，作图更省心 | `https://{BASE_URL}/#/e-commerce/product-detail` | `https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/product-detail.png` |
| 爆款图复刻 | 对标爆款风格，快速复刻同款商图 | `https://{BASE_URL}/#/e-commerce/product-clone` | `https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/product-clone.png` |
| 手持商品 | 自动生成真人手持商品效果图 | `https://{BASE_URL}/#/e-commerce/product-in-hand` | `https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/product-in-hand.png` |

### 4.2 商品视频

| title | subtitle | 链接 | icon |
|---|---|---|---|
| 爆款视频 | 一键生成适配电商带货短视频 | `https://{BASE_URL}/#/e-commerce/video-hot` | `https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/video-hot.png` |
| 视频复刻 | 复刻热门视频画面，降低创作成本 | `https://{BASE_URL}/#/e-commerce/video-clone` | `https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/video-clone.png` |
| 商品替换 | 保留场景，一键替换画面内商品 | `https://{BASE_URL}/#/e-commerce/product-replace` | `https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/product-replace.png` |
| 模特替换 | 不变场景，自由更换视频模特 | `https://{BASE_URL}/#/e-commerce/model-replace` | `https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/model-replace.png` |

### 4.3 穿戴图

| title | subtitle | 链接 | icon |
|---|---|---|---|
| AI穿戴套图 | 批量生成多模特穿搭展示图 | `https://{BASE_URL}/#/e-commerce/clothing-kit` | `https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/clothing-kit.png` |
| AI试衣 | 上传服饰，真人实景一键上身 | `https://{BASE_URL}/#/e-commerce/clothing-try` | `https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/clothing-try.png` |
| 服装去皱 | 一键抚平褶皱，服饰质感拉满 | `https://{BASE_URL}/#/e-commerce/clothing-remove-wrinkle` | `https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/clothing-remove-wrinkle.png` |
| AI试鞋 | 鞋子上脚实拍，快速生成穿鞋效果图 | `https://{BASE_URL}/#/e-commerce/try-shoe` | `https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/try-shoe.png` |
| 人像换背景 | 人像主体保留，随心更换场景背景 | `https://{BASE_URL}/#/e-commerce/change-background` | `https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/change-background.png` |
| 搭配融图 ⚠️ | 单品融合搭配，直观展示整套穿搭 | `https://{BASE_URL}/#/e-commerce/merge-image` | `https://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/merge-image.png` |

> ⚠️ **搭配融图**：web 端首页入口卡片目前是隐藏状态，但路由和页面都在，直达链接可正常使用。**容器端是否露出这个入口，请先与产品确认。**

---

## 5. 本地生活

左侧导航「本地生活」下的功能矩阵，路由为普通直达（**不需要 entryCode，也不带 `?tab=`**）。入口页 `/#/local-life`。

| 功能 | 链接 | 说明 |
|---|---|---|
| AI文案 | `https://{BASE_URL}/#/local-life/copywriting` | AI帮写 / 爆款仿写 / 自主撰写 |
| 店铺档案 | `https://{BASE_URL}/#/local-life/shop-profile` | 文案、笔记、视频共用的店铺信息底座 |
| AI数字人 | `https://{BASE_URL}/#/local-life/digital-human` | 形象 + 音色 + 配音内容 → 口播视频 |
| 图文笔记 | `https://{BASE_URL}/#/local-life/note` | 构思 → 规划确认 → 出图 |
| AI海报 | `https://{BASE_URL}/#/local-life/poster` | 模板化营销海报 |
| AI长图 | `https://{BASE_URL}/#/local-life/long-image` | 分段引导长图 |
| 数字人口播 | `https://{BASE_URL}/#/local-life/voiceover` | 一段文案 + 一张脸 → 播报视频 |
| 动作迁移 | `https://{BASE_URL}/#/local-life/action-transfer` | 动作视频肢体迁移给指定人物 |
| 探店视频 | `https://{BASE_URL}/#/local-life/explore-shop` | 两步：分镜剧本确认 → 出片 |
| 带货短剧 | `https://{BASE_URL}/#/local-life/short-drama` | 两步：剧情确认 → 出片 |
| 爆款视频复刻 | `https://{BASE_URL}/#/local-life/video-remake` | 上传/链接解析原片 → 复刻 |

> 这组功能走 Go 网关 `/api/v1/local-life`，与 Java 后端共用同一套登录态；生成任务在服务端有记录，刷新页面后列表轮询自动恢复，无需额外参数。

---

## 6. 商拍工作室 / 工具页（Go 网关）

| 功能 | 链接 | 说明 |
|---|---|---|
| 商拍换装 | `https://{BASE_URL}/#/studio/tryon` | 模特 × 服装整批提交，批次拆任务 |
| 姿态复刻 | `https://{BASE_URL}/#/studio/pose` | 人物图 + 姿势图批量复刻 |
| 图片生成 | `https://{BASE_URL}/#/studio/imagegen` | 提示词 / 参考图批量出图 |
| 提示词库 | `https://{BASE_URL}/#/prompt-library` | 官方提示词复制使用，我的可维护 |
| 资产库增强 | `https://{BASE_URL}/#/asset-library` | 分类 / 标签 / 收藏 / 版本 / 相关资产 |
| 画布 | `https://{BASE_URL}/#/canvas` | 画布管理与运行历史（节点编辑器规划中） |

> studio 的上传走 Go 网关预签名直传（/api/v1/local-life/upload/presign），与电商页的 Java STS 通道互不影响；studio 提交为批次-任务模型，历史在服务端，刷新自动恢复轮询。

---

## 附录：电商功能对应的 entryCode

链接上不需要传，但计费、资产筛选等接口会用到这套码值，排查问题时可对照。

| 功能 | 路径 | entryCode |
|---|---|---|
| AI商品套图 | `/e-commerce/product-kit` | `productSetImages` |
| AI详情页 | `/e-commerce/product-detail` | `aPlusDetailPage` |
| 爆款图复刻 | `/e-commerce/product-clone` | `hitReplication` |
| 手持商品 | `/e-commerce/product-in-hand` | `aiGestures` |
| 爆款视频 | `/e-commerce/video-hot` | `hitVideo` |
| 视频复刻 | `/e-commerce/video-clone` | `hitVideoReplication` |
| 商品替换 | `/e-commerce/product-replace` | `productReplacement` |
| 模特替换 | `/e-commerce/model-replace` | `personReplacement` |
| AI穿戴套图 | `/e-commerce/clothing-kit` | `wearingProductSetImages` |
| AI试衣 | `/e-commerce/clothing-try` | `aiClothExchange` |
| 服装去皱 | `/e-commerce/clothing-remove-wrinkle` | `removeWrinkles` |
| AI试鞋 | `/e-commerce/try-shoe` | `shoeSwapping` |
| 人像换背景 | `/e-commerce/change-background` | `backgroundSwitching` |
| 搭配融图 | `/e-commerce/merge-image` | `mergeClothes` |
