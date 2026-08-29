# fusion-aigc-web

This template should help get you started developing with Vue 3 in Vite.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Recommended Browser Setup

- Chromium-based browsers (Chrome, Edge, Brave, etc.):
  - [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd)
  - [Turn on Custom Object Formatter in Chrome DevTools](http://bit.ly/object-formatters)
- Firefox:
  - [Vue.js devtools](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/)
  - [Turn on Custom Object Formatter in Firefox DevTools](https://fxdx.dev/firefox-devtools-custom-object-formatters/)

## Type Support for `.vue` Imports in TS

TypeScript cannot handle type information for `.vue` imports by default, so we replace the `tsc` CLI with `vue-tsc` for type checking. In editors, we need [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) to make the TypeScript language service aware of `.vue` types.

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Project Setup

```sh
pnpm install
```

工程只有**测试**和**生产**两套环境，无 Vite proxy，本地调试与构建产物直连同一批域名。

| 环境 | mode | AIGC 后台 | 联盟后台 |
|------|------|-----------|----------|
| 测试 | test | `http://t81-aigc.pengqiwl.com.cn` | `http://t81-xxlm-app.pengqiwl.com.cn` |
| 生产 | production | `https://aigc.pengqiwl.com` | `https://xxlm-app.pengqiwl.com` |

### 本地调试

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 热更新，直连测试后台（日常开发用这个） |
| `pnpm dev:prod` | 热更新，直连生产后台 |

### 打包构建

| 命令 | mode | 目标 |
|------|------|------|
| `pnpm build:test` | test | 测试后台 |
| `pnpm build` | production | 生产后台 |

产物统一输出到 `dist/` 目录。详见 [构建与调试指南](./docs/build-debug.md)。

### Lint with [ESLint](https://eslint.org/)

```sh
pnpm lint
```
