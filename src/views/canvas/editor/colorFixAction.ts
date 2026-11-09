/**
 * 画布结果图「校色」的共享状态（模块级单例：节点菜单 / 节点图片悬停钮打开，编辑器根组件渲染 CanvasColorFixDialog）。
 *
 * <p>只对节点自身的图（图片节点的图、模型节点的候选 / 结果、工具节点的产物）校色，不取上游。
 * 校色参数按 `canvas:<nodeId>:<图片地址哈希>` 存本机（components/ColorFix），同一节点多张候选各存各的。
 * 「生成校色节点」把烘好的 PNG 经 canvasUploadMedia 传上去，新建一个结果图节点连在来源后面（不改原节点）。
 */
import { ref } from 'vue'
import { collectImageSources, type IImageSource } from './imageActions.ts'

export const activeColorFix = ref<{ nodeId: string; url?: string } | null>(null)

/** url 不传 = 默认节点当前输出（模型节点的选中候选） */
export function openColorFix(nodeId: string, url?: string): void {
  activeColorFix.value = { nodeId, url }
}

export function closeColorFix(): void {
  activeColorFix.value = null
}

/** 节点自身可校色的图（不含上游） */
export function colorFixSources(nodeId: string): IImageSource[] {
  return collectImageSources(nodeId).filter((item) => !item.upstream)
}

/** 地址短哈希（FNV-1a 32 位，base36）：存储键不放整串地址 */
export function urlHash(url: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < url.length; i += 1) {
    h ^= url.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export const colorFixKey = (nodeId: string, url: string) => `canvas:${nodeId}:${urlHash(url)}`
