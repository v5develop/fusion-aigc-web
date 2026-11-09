/**
 * 多结果图的校色宿主（2026-11-09）：结果列表里每张图各有一份 useResultColorFix（见 ./ColorFixItem.vue），
 * 宿主只管「当前在调哪一张」——列表上方的大图舞台（./ColorFixStage.vue）与参数台都跟着它走。
 *
 * <p>用法：结果列表组件 `const host = provideColorFixHost({ save })`，每张图用 `<ColorFixItem>` 包起来，
 * 列表里 `<ColorFixStage v-if="host.focused.value" :host="host" />`。`save` 可选：能对上素材库资产时传
 * （见 ./assetVersion.ts saveColorFixToTaskAsset），不传 = 只能下载。
 */
import { inject, provide, shallowReactive, shallowRef, type InjectionKey, type ShallowRef } from 'vue'
import type { ResultColorFix } from './useResultColorFix.ts'

export interface ColorFixHostEntry {
  cf: ResultColorFix
  /** 持久化键（ecom:<taskUid>:<index> / ll:<id>:<index>） */
  key: string
  /** 原图地址（cf.src 的原值，按它找回某张图的校色状态） */
  src: string
  /** 第几张（0 起） */
  index: number
  /** 下载文件名（不带扩展名） */
  name: string
}

export interface ColorFixHostOptions {
  /** 存为资产（校色后版本）；不传 = 舞台不给「存为资产」 */
  save?: (entry: ColorFixHostEntry) => Promise<unknown>
}

export interface ColorFixHost {
  /** 正在舞台上调的那一张；null = 舞台收起 */
  focused: ShallowRef<ColorFixHostEntry | null>
  /** 在场的所有图（按原图地址），整组下载时取各张的校色状态 */
  entries: Map<string, ColorFixHostEntry>
  options: ColorFixHostOptions
  focus(entry: ColorFixHostEntry): void
  /** 收起舞台（参数台一并收起，调过的参数照常落存储） */
  close(): void
  register(entry: ColorFixHostEntry): void
  unregister(entry: ColorFixHostEntry): void
}

const HOST_KEY: InjectionKey<ColorFixHost> = Symbol('colorFixHost')

export function provideColorFixHost(options: ColorFixHostOptions = {}): ColorFixHost {
  const focused = shallowRef<ColorFixHostEntry | null>(null)
  const entries = shallowReactive(new Map<string, ColorFixHostEntry>())
  const host: ColorFixHost = {
    focused,
    entries,
    options,
    focus(entry) {
      const prev = focused.value
      if (prev && prev.cf !== entry.cf && prev.cf.panelOpen.value) prev.cf.close()
      focused.value = entry
    },
    close() {
      const prev = focused.value
      if (prev?.cf.panelOpen.value) prev.cf.close()
      focused.value = null
    },
    register(entry) {
      entries.set(entry.src, entry)
      // 同一张图的组件重建（换批次再切回）：舞台跟着换成新实例
      if (focused.value && focused.value.src === entry.src && focused.value.cf !== entry.cf) focused.value = entry
    },
    unregister(entry) {
      if (entries.get(entry.src) === entry) entries.delete(entry.src)
      if (focused.value?.cf === entry.cf) focused.value = null
    },
  }
  provide(HOST_KEY, host)
  return host
}

export function useColorFixHost(): ColorFixHost | null {
  return inject(HOST_KEY, null)
}
