# 前端命名与目录约定（web / admin 共用）

目标：同一类文件用同一种写法，找文件不靠猜。

## 文件

| 类别 | 写法 | 例子 |
| --- | --- | --- |
| Vue 单文件组件 | PascalCase | `CreationHistoryHeader.vue` |
| 组件目录的入口 | `index.vue` / `index.ts` | `components/ImagePopover/index.vue` |
| composable | `useXxx.ts`，camelCase | `useFileDropPaste.ts` |
| 其他 TS 模块（api、utils、stores、types、directives、worker） | kebab-case | `api-keys.ts`、`go-http.ts`、`canvas-snapshot.ts` |
| 单词文件 | 全小写 | `time.ts`、`oss.ts` |
| 类型声明 | `*.d.ts`，kebab-case | `bridge.d.ts` |
| Web Worker | `*.worker.ts`，kebab-case | `point-segment.worker.ts` |
| 静态资源 | kebab-case | `download-all.svg` |

## 目录

- 目录一律 kebab-case，例外：组件目录用 PascalCase（与组件名一致，如 `components/ImagePopover/`）。
- 页面目录（`views/`）与路由路径一致，用 kebab-case。
- API 模块按后端域命名，前缀与网关路由保持一致：`/api/v1/asset-library` → `asset-library.ts` / `asset-library-admin.ts`。

## 代码标识符

- 变量、函数、属性：camelCase。
- 与后端交互的 **query 参数** 例外：前端仍用 camelCase，统一经 `toSnakeKeys` / `goGet` 转成 snake_case 再发出（见 `src/utils/api-keys.ts`、`src/api/go-http.ts`）。
- 请求体、响应体：camelCase（与 Java 一致）。Go 网关已按白名单双写，过渡期两种都有。

## 现状（2026-11-10）

已按约定完成（两个仓库）：

- web：`api/`、`utils/`、`stores/`、`directives/`、`views/` 与 `components/` 下的非组件 TS 模块改为 kebab-case（含 worker：`point-segment.worker.ts`）；
- web：`components/` 下 7 个目录改为 PascalCase（`CheckIn`、`Creation`、`Icons`、`ModelPicker`、`Notifications`、`Points`、`PromptWrite`）；
- web：`views/` 下页面目录（如 `local-life/video-remake/`、`e-commerce/child-pages/product-image/`）改为 kebab-case；
- admin：`views/` 目录已全部 kebab-case，`components/` 目录已全部 PascalCase；`api/asset-library-admin.ts` 与后端前缀对齐。

有意保留的例外：

- `use*.ts` composable 保持 camelCase；
- `views/**/components/` 与 `components/` 下的组件目录保持 PascalCase；
- 混合 Go 与 Java 接口的前端文件（如 `api/index.ts`）中，Java 字段保持原样。

验证方式：改名后以 `vue-tsc --build`、`vite build`、eslint 通过为准；未做全量 prettier（web 基线本身不干净，只格式化了基线干净的文件）。
