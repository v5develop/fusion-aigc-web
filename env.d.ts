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
  /**
   * 可选：校色「点选」识别引擎（onnxruntime-web 的 ort-wasm-simd-threaded.asyncify.wasm，约 28.7MB）的 CDN 目录地址，
   * 如 https://cdn.example.com/ort/1.31.1/。实际请求 `<目录>/ort-wasm-simd-threaded.asyncify.wasm?v=<构建哈希>`，
   * 失败再退回站点自带的打包资源；跨域时需 CORS 头。升级 onnxruntime-web 时同步换目录里的文件。
   * 见 src/components/ColorFix/point-segment.ts wasmSources()。
   */
  readonly VITE_POINT_SEGMENT_WASM_BASE?: string
  /**
   * 可选：除 *.aliyuncs.com 外允许拼 OSS 图片缩放参数的自定义域名（公有桶 CDN），逗号分隔，如 img.example.com。
   * 列表 / 历史卡缩略图（utils/oss.ts ossResize）只对这些主机生效；不配则自定义域名一律用原图。
   */
  readonly VITE_OSS_IMAGE_HOSTS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module 'ali-oss'
declare module '@lhlyu/vue-virtual-waterfall'
