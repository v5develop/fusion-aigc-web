<script setup lang="ts">
/**
 * 结果列表里的单张图：自带一份 useResultColorFix（按 cfKey 持久化），登记到宿主（./host.ts），
 * 不渲染任何外层元素，把状态与动作交给作用域插槽：
 *
 * - displaySrc / previewStyle / cors：缩略图直接显示校色效果（未校色时 displaySrc 就是 src）；
 * - active：这张图校色开着（调过 / 参数台开着）；focused：正在舞台上；
 * - openFix()：舞台切到这张并打开参数台；download()：校色开着下校色后的 PNG，否则下原图。
 */
import { computed, onBeforeUnmount, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { corsAttr, markCorsBlocked } from '@/utils/colorfix.ts'
import { downloadImage } from '@/utils/download'
import { useResultColorFix } from './useResultColorFix.ts'
import { withImageExt } from './files.ts'
import { useColorFixHost, type ColorFixHostEntry } from './host.ts'

const {
  cfKey,
  src,
  index = 0,
  name = '',
  enabled = true,
} = defineProps<{
  /** 持久化键；空 = 不持久化 */
  cfKey: string
  /**
   * 原图地址（下载 / 烘图都按它）。⚠️ 必须是当前观看者平时「下载」拿到的那个地址（免费档 = 带水印的交付图），
   * 校色后的 PNG 由它烘出、会被下载 / 存资产，不能换成干净原件。
   */
  src: string
  index?: number
  /** 下载文件名（不带扩展名），默认「结果_第 n 张」 */
  name?: string
  /** 只对成功的图片结果开 */
  enabled?: boolean
}>()

const message = useMessage()
const host = useColorFixHost()

const cf = useResultColorFix({
  key: computed(() => cfKey),
  src: computed(() => src),
  enabled: computed(() => enabled && !!src),
})

const fileName = computed(() => name || `结果_第${index + 1}张`)

let entry: ColorFixHostEntry | null = null
watch(
  () => [cfKey, src, enabled] as const,
  () => {
    if (entry) host?.unregister(entry)
    entry = null
    if (!enabled || !src || !host) return
    entry = { cf, key: cfKey, src, index, name: fileName.value }
    host.register(entry)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  if (entry) host?.unregister(entry)
})

const focused = computed(() => host?.focused.value?.cf === cf)

function openFix() {
  if (!enabled || !src) return
  if (host && entry) host.focus(entry)
  cf.open()
}

async function download() {
  if (!src) return
  if (cf.active.value) {
    if (!(await cf.downloadBaked(`${fileName.value}-校色后.png`))) message.warning('校色效果未能写入，已下载原图')
    return
  }
  void downloadImage(src, withImageExt(fileName.value, src))
}

/** 缩略图 <img> 的 crossorigin：烘图要读像素，同一地址先无 CORS 进缓存会让后面的跨域读取失败 */
const cors = computed(() => (enabled ? corsAttr(cf.displaySrc.value) : undefined))
function onImgError() {
  if (enabled) markCorsBlocked(cf.displaySrc.value)
}

defineSlots<{
  default(props: {
    cf: typeof cf
    displaySrc: string
    previewStyle: Record<string, string> | undefined
    cors: 'anonymous' | undefined
    onImgError: () => void
    active: boolean
    touched: boolean
    focused: boolean
    openFix: () => void
    download: () => Promise<void>
  }): unknown
}>()
</script>

<template>
  <slot
    :cf="cf"
    :displaySrc="cf.displaySrc.value"
    :previewStyle="cf.previewStyle.value"
    :cors="cors"
    :onImgError="onImgError"
    :active="cf.active.value"
    :touched="cf.touched.value"
    :focused="focused"
    :openFix="openFix"
    :download="download"
  />
</template>
