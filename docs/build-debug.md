# 构建与调试指南

## 环境概览

工程只有**测试**和**生产**两套环境，分别对应 `test` / `production` 两个 mode，配置在 `.env.test` / `.env.production`。

| 环境 | mode | AIGC 后台 | 联盟后台 |
|------|------|-----------|----------|
| 测试 | test | `http://t81-aigc.pengqiwl.com.cn` | `http://t81-xxlm-app.pengqiwl.com.cn` |
| 生产 | production | `https://aigc.pengqiwl.com` | `https://xxlm-app.pengqiwl.com` |

两个后端都已对任意 Origin 开放 CORS，因此**工程内没有 Vite proxy**：本地调试与构建产物直连同一批域名，走完全相同的链路，本地能复现的问题线上也能复现。

测试站点为 http 部署，直连 http 后台不会触发混合内容拦截；生产两侧均为 https。

## 命令

| 操作 | 测试 | 生产 |
|------|------|------|
| 启动调试 | `pnpm dev` | `pnpm dev:prod` |
| 构建 | `pnpm build:test` | `pnpm build` |
| 预览构建产物 | `pnpm preview` | `pnpm preview` |

`pnpm dev` 默认打测试后台，避免日常开发误改生产数据。类型检查 `pnpm type-check`、Lint `pnpm lint` 与环境无关。产物统一输出到 `dist/`。

## 环境变量

| 变量 | 位置 | 说明 |
|------|------|------|
| `VITE_FUSION_API_BASE` | `.env.test` / `.env.production` | AIGC 后台地址 |
| `VITE_UNION_API_BASE` | `.env.test` / `.env.production` | 联盟后台地址 |
| `VITE_OSS_ASSET_URL` | `.env`（两环境公共） | OSS 静态资源前缀，**必须 https**，否则内嵌进宿主 App 时会被 ATS / network security config 拦成裂图 |

类型声明在 `env.d.ts`。`vite.config.ts` 会在启动和构建时校验前两个变量非空——漏配的后果是所有请求静默打到页面自身域名，要到运行时才暴露，所以直接让构建失败。

## VSCode 调试

`launch.json` 提供以下配置：

| 配置名称 | 说明 |
|----------|------|
| 调试 (测试) | 启动 `pnpm dev` + 打开 Chrome |
| 调试 (生产) | 启动 `pnpm dev:prod` + 打开 Chrome |

## 独立运行登录

在浏览器中独立打开（非 APP 容器）时，若未登录会自动跳转登录页。使用联盟账号验证码登录：

1. 输入手机号 → 获取验证码
2. 输入验证码 → 登录
3. 自动换取 fusion token 并进入应用

开发服验证码默认值：`123456`（在 Union 开发服中生效）

在 APP 容器内（`window.ThirdServiceBridge` 存在）则不走登录页，由路由守卫拿 unionToken 静默换取 fusion token。

## OSS 存储桶 CORS：断点续传需要暴露 ETag

大于 10MB 的文件（如视频复刻的原片）走 ali-oss 分片上传（`multipartUpload`，1MB 分片、并发 3，带进度条与取消）。浏览器只有拿到每个分片响应里的 `ETag` 才能合并分片，所以**上传用的 OSS 存储桶 CORS 规则必须配置 `ExposeHeaders: ETag`**（同时允许 `PUT` / `POST` / `GET` / `HEAD` 方法与 `*` 请求头）。

没配时不会导致上传失败：分片出错会自动退回一次普通 `put`（没有进度条），并在控制台打印一条 `[oss-upload] 分片上传失败，已退回普通上传` 警告。看到这条警告先检查 CORS。
