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

### 开发环境（本地调试）

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 开发模式，热更新，API 代理到生产 `https://aigc.pengqiwl.com` |
| `pnpm dev:test` | 开发模式，热更新，API 指向测试 `https://aigc-test.pengqiwl.com` |
| `pnpm dev:prod` | 开发模式，热更新，API 代理到生产 + Union 测试 |

### 生产环境（打包构建）

| 命令 | 对应 Vite 命令 | 模式 | API 目标 |
|------|---------------|------|----------|
| `pnpm build` | `vite build` | production（默认） | `https://aigc.pengqiwl.com` |
| `pnpm build:test` | `vite build --mode test` | test | `https://aigc-test.pengqiwl.com` |

产物统一输出到 `dist/` 目录。

### Lint with [ESLint](https://eslint.org/)

```sh
pnpm lint
```
