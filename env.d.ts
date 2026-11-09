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
  /**
   * 可选：校色「点选」本机分割模型（SlimSAM ONNX）的目录地址，如 https://cdn.example.com/models/slimsam-77-uniform/。
   * 依次尝试：这里 → 站点自身 `${BASE_URL}models/slimsam-77-uniform/`（public/models，不进仓库）→ Hugging Face 固定修订版。
   * 跨域时该目录需返回 CORS 头。见 src/components/ColorFix/pointSegment.ts modelSources()。
   */
  readonly VITE_POINT_SEGMENT_MODEL_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module 'ali-oss'
declare module '@lhlyu/vue-virtual-waterfall'
