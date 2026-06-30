import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'

import AutoImport from 'unplugin-auto-import/vite'
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers'
import Components from 'unplugin-vue-components/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

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
      proxy: {
        '/api': {
          target: env.FUSION_API_PROXY || 'http://192.168.0.3:18080',
          changeOrigin: true,
        },
        '/union-api': {
          target: env.UNION_API_PROXY || 'https://uniontest.pengqiwl.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/union-api/, ''),
        },
      },
    },
  }
})
