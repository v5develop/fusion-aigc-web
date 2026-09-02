/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** AIGC 后台地址，按 mode 取 .env.test / .env.production */
  readonly VITE_FUSION_API_BASE: string
  /** 联盟后台地址，按 mode 取 .env.test / .env.production */
  readonly VITE_UNION_API_BASE: string
  /** OSS 静态资源前缀，必须 https（见 .env 注释） */
  readonly VITE_OSS_ASSET_URL: string
  /** 订阅套餐 / 加量包购买页，按 mode 取 .env.test / .env.production */
  readonly VITE_BILLING_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module 'ali-oss'
declare module '@lhlyu/vue-virtual-waterfall'
