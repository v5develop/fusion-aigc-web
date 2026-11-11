import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import UnoCSS from 'unocss/vite'

import AutoImport from 'unplugin-auto-import/vite'
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers'
import Components from 'unplugin-vue-components/vite'
import path from 'path'
import { isShadowProp, rewriteShadow } from './src/theme/shadow-rewrite'
import { themeBootScript } from './src/theme/theme-decide'

// 两套环境（test / production）各自直连后端，不再有 dev 代理层：
// 后端已对任意 Origin 开放 CORS，dev 与构建产物因此走完全相同的链路，
// 本地能复现的问题线上也能复现。
const SUPPORTED_MODES = ['test', 'production']

// 漏配的后果都要到运行时才暴露——base 缺失时请求静默打到页面自身域名，
// OSS 前缀缺失时图片 src 变成 undefined/xxx.png——所以在这里当场把构建打挂。
const REQUIRED_ENV = ['VITE_FUSION_API_BASE', 'VITE_UNION_API_BASE', 'VITE_OSS_ASSET_URL']

/**
 * 「字体显示」偏好的构建期改写（运行时只改 <html> 上的 CSS 变量，见 src/utils/textPrefs.ts）：
 * - `font-size: 13px` / `0.875rem`（含组件里改写的 `--n-*font-size` 变量）→ `calc(13px * var(--xq-fs, 1))`：
 *   字号随用户档位缩放，盒子尺寸与坐标不变；
 * - 站点字体栈 → `var(--xq-font-family, 原字体栈)`：用户可换字体，没设置时与原来完全一致。
 * 不碰 em / % / clamp / calc（已是相对值或另有意图）、等宽与图标字体、node_modules 与 iconfont.css。
 * 不引 postcss 包：PostCSS 插件就是一个带 postcssPlugin 的对象，Vite 内置的 PostCSS 会执行它。
 */
const FONT_SIZE_ABS = /^(-?\d*\.?\d+)(px|rem)(\s*!important)?$/
const SITE_FONT_HINT = /Smartisan Compact|PingFang SC|Noto Sans SC|Microsoft YaHei|Source Han Sans SC/
interface CssDecl {
  prop: string
  value: string
  source?: { input?: { file?: string } }
}
function skipTextScale(decl: CssDecl): boolean {
  const file = decl.source?.input?.file ?? ''
  return file.includes('node_modules') || /iconfont/i.test(file)
}
const textScalePostcss = {
  postcssPlugin: 'xq-text-scale',
  Declaration(decl: CssDecl) {
    if (skipTextScale(decl)) return
    const prop = decl.prop.toLowerCase()
    const value = decl.value.trim()
    // 组件样式里直接改写 Naive 的 CSS 变量（--n-font-size、--n-option-font-size…）的，同样缩放
    if (prop === 'font-size' || /^--n-[\w-]*font-size$/.test(prop)) {
      const m = FONT_SIZE_ABS.exec(value)
      if (m && Number(m[1]) !== 0) decl.value = `calc(${m[1]}${m[2]} * var(--xq-fs, 1))${m[3] ?? ''}`
    } else if (prop === 'font-family') {
      if (value.includes('var(') || /mono|iconfont/i.test(value) || !SITE_FONT_HINT.test(value)) return
      decl.value = `var(--xq-font-family, ${value})`
    }
  },
}

/**
 * 「外观」深色的构建期阴影改写：手写 box-shadow 里的墨色投影 / 白色顶光换成跟主题走的变量表达式，
 * 浅色下结果与原值一致。规则与理由见 src/theme/shadow-rewrite.ts（uno 工具类走 uno.config.ts 的 postprocess，同一函数）。
 */
const themeShadowPostcss = {
  postcssPlugin: 'xq-theme-shadow',
  Declaration(decl: CssDecl) {
    if ((decl.source?.input?.file ?? '').includes('node_modules')) return
    if (isShadowProp(decl.prop)) decl.value = rewriteShadow(decl.value)
  },
}

/**
 * 「外观」首帧脚本注入：把 index.html 的 `<!--xq-theme-boot-->` 换成内联脚本，判定函数取自
 * src/theme/theme-decide.ts（运行时 themePrefs.ts 用的同一个），dev / build 都走 transformIndexHtml。
 * 占位符丢了直接构建失败，免得悄悄失去防闪。
 */
const themeBootPlugin = {
  name: 'xq-theme-boot',
  transformIndexHtml(html: string) {
    const mark = '<!--xq-theme-boot-->'
    if (!html.includes(mark)) throw new Error(`[xq-theme-boot] index.html 缺少占位符 ${mark}`)
    return html.replace(mark, () => `<script>\n${themeBootScript()}\n</script>`)
  },
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 裸跑 vite 会落到 development，那个 mode 已经没有对应的 .env 文件了；
  // 与其报「请检查 .env.development」把人指向一个不该存在的文件，不如直接说清楚
  if (!SUPPORTED_MODES.includes(mode)) {
    throw new Error(
      `不支持的 mode「${mode}」：只有 test / production 两套环境。` +
        `本地调试请用 pnpm dev（测试）或 pnpm dev:prod（生产）`,
    )
  }

  const env = loadEnv(mode, process.cwd(), 'VITE_')
  for (const key of REQUIRED_ENV) {
    if (!env[key]) throw new Error(`缺少 ${key}，请检查 .env 与 .env.${mode}`)
  }

  return {
    plugins: [
      themeBootPlugin,
      vue(),
      vueJsx(),
      UnoCSS(),
      AutoImport({
        imports: [
          'vue',
          {
            'naive-ui': ['useDialog', 'useMessage', 'useNotification', 'useLoadingBar'],
          },
        ],
      }),
      Components({
        resolvers: [NaiveUiResolver()],
      }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    // 显式声明确保 Vite 预构建 jszip（电商素材打包下载用）
    optimizeDeps: {
      include: ['jszip'],
      // onnxruntime-web 按 import.meta.url 找自己的 .wasm，预构建会改路径（校色「点选」本机分割用）
      exclude: ['onnxruntime-web'],
    },
    // 点选分割 Worker 里 onnxruntime-web 需要 ES 模块格式（动态 import / import.meta.url）
    worker: {
      format: 'es',
    },
    css: {
      // 内联 postcss 配置后 Vite 不再找 postcss.config.*（仓库里本来也没有）
      postcss: { plugins: [textScalePostcss, themeShadowPostcss] },
      preprocessorOptions: {
        less: {
          resolve: {
            alias: {
              '@': path.resolve(__dirname, 'src'),
            },
          },
          javascriptEnabled: true,
        },
      },
    },
    server: {
      host: true,
    },
  }
})
