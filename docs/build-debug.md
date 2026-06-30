# 构建与调试指南

## 环境概览

| 环境 | mode | Fusion 后端 | Union 后端 |
|------|------|------------|------------|
| 开发 | development | Vite 代理 → `192.168.0.3:18080` | Vite 代理 → `uniontest.pengqiwl.com` |
| 测试 | test | `aigc-test.pengqiwl.com` | `uniontest.pengqiwl.com` |
| 生产调试 | production-dev | Vite 代理 → `aigc.pengqiwl.com` | Vite 代理 → `union.pengqiwl.com` |
| 生产构建 | production | `aigc.pengqiwl.com` | `union.pengqiwl.com` |

## 命令

| 操作 | 开发 | 测试 | 生产调试 | 生产构建 |
|------|------|------|----------|----------|
| 启动调试 | `pnpm dev` | `pnpm dev:test` | `pnpm dev:prod` | — |
| 构建 | — | `pnpm build:test` | — | `pnpm build` |
| 预览构建 | — | `pnpm preview` | — | `pnpm preview` |
| 类型检查 | `pnpm type-check` | `pnpm type-check` | `pnpm type-check` | `pnpm type-check` |
| Lint | `pnpm lint` | `pnpm lint` | `pnpm lint` | `pnpm lint` |

## 环境变量

| 变量 | 开发 | 测试 | 生产调试 | 生产构建 |
|------|------|------|----------|----------|
| `VITE_FUSION_API_BASE` | `""` | `https://aigc-test...` | `""` | `https://aigc.pengqiwl.com` |
| `VITE_UNION_API_BASE` | `""` | `https://uniontest...` | `""` | `https://union.pengqiwl.com` |

> `dev` 和 `dev:prod` 的 BaseURL 均为空，请求走 Vite 代理，因此不会有跨域问题。区别仅在于代理转发的目标不同。

## VSCode 调试

`launch.json` 提供以下配置：

| 配置名称 | 说明 |
|----------|------|
| 调试 (开发) | 启动 `pnpm dev` + 打开 Chrome |
| 调试 (测试) | 启动 `pnpm dev:test` + 打开 Chrome |
| 调试 (生产) | 启动 `pnpm dev:prod` + 打开 Chrome |

## 独立运行登录

在浏览器中独立打开（非 APP 容器）时，若未登录会自动跳转登录页。使用联盟账号验证码登录：

1. 输入手机号 → 获取验证码
2. 输入验证码 → 登录
3. 自动换取 fusion token 并进入应用

开发服验证码默认值：`123456`（在 Union 开发服中生效）
