/**
 * 上传忙碌登记：ImageUpload / VideoUpload 把「上传中 / 有失败」报给最近的外壳（电商 Container、本地生活 Workbench），
 * 外壳据此拦提交——图片还没传完就提交，后端拿到的是缺图的参数。
 *
 * 用法：外壳 `const busy = provideUploadBusy()`，提交前看 `busy.reason.value`（非空即拦）；
 * 上传组件内部 `useUploadBusyReporter('image', () => ({ uploading, failed }))`，卸载时自动注销。
 * 没有外壳提供登记时上传组件照常工作（只是没人拦）。
 */
import {
  computed,
  inject,
  onBeforeUnmount,
  provide,
  reactive,
  watchEffect,
  type ComputedRef,
  type InjectionKey,
} from 'vue'

export type UploadMediaKind = 'image' | 'video'

export interface UploadBusyState {
  uploading: boolean
  failed: boolean
}

export interface UploadBusyRegistry {
  set: (id: symbol, kind: UploadMediaKind, state: UploadBusyState) => void
  unregister: (id: symbol) => void
  /** 有任一上传组件正在上传（含替换） */
  uploading: ComputedRef<boolean>
  /** 有任一上传组件留着上传失败的格子 */
  failed: ComputedRef<boolean>
  /** 拦提交的原因；空串 = 可以提交 */
  reason: ComputedRef<string>
}

export const UPLOAD_BUSY_KEY: InjectionKey<UploadBusyRegistry> = Symbol('uploadBusy')

const KIND_LABEL: Record<UploadMediaKind, string> = { image: '图片', video: '视频' }

export function createUploadBusyRegistry(): UploadBusyRegistry {
  const entries = reactive(new Map<symbol, UploadBusyState & { kind: UploadMediaKind }>())
  const pick = (key: keyof UploadBusyState) => [...entries.values()].filter((e) => e[key])
  const label = (list: { kind: UploadMediaKind }[]) =>
    list.every((e) => e.kind === 'video') ? KIND_LABEL.video : KIND_LABEL.image
  const uploading = computed(() => pick('uploading').length > 0)
  const failed = computed(() => pick('failed').length > 0)
  const reason = computed(() => {
    const up = pick('uploading')
    if (up.length) return `${label(up)}上传中`
    const bad = pick('failed')
    if (bad.length) return `有${label(bad)}上传失败，请重试或移除`
    return ''
  })
  return {
    set: (id, kind, state) => entries.set(id, { kind, ...state }),
    unregister: (id) => entries.delete(id),
    uploading,
    failed,
    reason,
  }
}

/** 外壳调用：创建并向子树提供登记 */
export function provideUploadBusy(): UploadBusyRegistry {
  const registry = createUploadBusyRegistry()
  provide(UPLOAD_BUSY_KEY, registry)
  return registry
}

/** 上传组件调用：有外壳登记就上报状态，卸载时注销 */
export function useUploadBusyReporter(kind: UploadMediaKind, state: () => UploadBusyState) {
  const registry = inject(UPLOAD_BUSY_KEY, null)
  if (!registry) return
  const id = Symbol(kind)
  watchEffect(() => registry.set(id, kind, state()))
  onBeforeUnmount(() => registry.unregister(id))
}

/** 并发上限内依次执行（选多张时不一次性全部发出去） */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
