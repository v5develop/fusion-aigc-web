import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'

import AutoImport from 'unplugin-auto-import/vite'
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers'
import Components from 'unplugin-vue-components/vite'
import path from 'path'

// 两套环境（test / production）各自直连后端，不再有 dev 代理层：
// 后端已对任意 Origin 开放 CORS，dev 与构建产物因此走完全相同的链路，
// 本地能复现的问题线上也能复现。
const SUPPORTED_MODES = ['test', 'production']

// 漏配的后果都要到运行时才暴露——base 缺失时请求静默打到页面自身域名，
// OSS 前缀缺失时图片 src 变成 undefined/xxx.png——所以在这里当场把构建打挂。
const REQUIRED_ENV = ['VITE_FUSION_API_BASE', 'VITE_UNION_API_BASE', 'VITE_OSS_ASSET_URL']

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
      vue(),
      vueJsx(),
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
    },
    css: {
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
