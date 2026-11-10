<script setup lang="ts">
import { computed, inject, ref, unref, useId, watch, type Ref } from 'vue'
import Card from '../../../child-pages/components/Card/index.vue'
import { EC_SELECTED_TASK_KEY, selectedGroupOf } from '../../../child-pages/components/HistoryColumn/selection'
import { getDownloadableUrls, downloadImagesAsZip, zipNameOf } from '@/utils/download'
import { mediaAspectRatio } from '@/utils/ratio'
import { useMessage } from 'naive-ui'
import JSZip from 'jszip'
import {
  ColorFixStage,
  bakeStoredColorFix,
  hasStoredColorFix,
  provideColorFixHost,
  saveColorFixToTaskAsset,
  triggerDownload,
} from '@/components/ColorFix'

// 页面 provide 的是 computed（taskList），这里统一解包成数组
const recordsData = inject<Ref<any[] | undefined> | any[] | undefined>('recordsData')
const groups = computed<any[]>(() => unref(recordsData) ?? [])
// 中栏历史卡选中的那一批；没选时跟随最新一批
const selectedId = inject(EC_SELECTED_TASK_KEY, ref<string | null>(null))
const current = computed(() => selectedGroupOf(groups.value, selectedId.value))
const titleId = `ec-result-title-${useId()}`
const selectImgUrls = inject<Ref<Set<string>> | undefined>('selectImgUrls', undefined)
// 视频页下发 'video'（失败态没有 resultUrl 时也能判定组类型）
const groupMediaType = inject<'image' | 'video'>('recordMediaType', 'image')

// 卡片比例：视频组照搬视频模块，容器统一 16:9（竖视频由卡片内 contain 居中）；
// 图片组同图片模块，取素材真实尺寸 → 请求入参比例 → 方形兜底
const cardAspectRatio = (content: any, group: any) =>
  groupMediaType === 'video'
    ? '16 / 9'
    : mediaAspectRatio(content, mediaAspectRatio(group?.inputParams?.params, '1 / 1'))

const message = useMessage()

// ---------------- 校色（components/ColorFix 套件）：每张图各自一份状态，结果列上方的舞台调当前那张 ----------------
// 键 ecom:<批次 taskId>:<序号>；存资产按批次 taskId 查任务中心详情对上素材库资产，对不上只能下载
// 免费档水印：每张图的校色来源 = contents[i].resultUrl，与本页普通「下载」（getDownloadableUrls / downloadImage）
// 同一个地址——前端口径「下载走 resultUrl」，观看者能拿到什么由后端决定（免费档私有原件在 resultUrl 里已换成占位，
// 见后端 CreationTaskViewAssembler.clientResultUrl）。校色 / 打包不另取原件，也不取展示用的 withWatermark 变体。
const colorFixKey = (group: any, index: number) => (group?.taskId ? `ecom:${group.taskId}:${index}` : '')
const fileNameOf = (group: any, index: number) => `${zipNameOf(group)}_${index + 1}`
const colorFixHost = provideColorFixHost({
  save: async (entry) => {
    const group = current.value
    if (!group?.taskId) return message.warning('这批结果没有任务号，暂不能存为资产')
    const images = (group.contents ?? []).filter((c: any) => c?.resultUrl && c?.status === 2)
    const result = await saveColorFixToTaskAsset({
      taskUid: group.taskId,
      cf: entry.cf,
      src: entry.src,
      index: images.findIndex((c: any) => c.resultUrl === entry.src),
      total: images.length,
      fileName: `${entry.name}-校色后.png`,
    })
    if (result === 'saved') message.success('已存为资产：原图 + 校色后两版')
    else if (result === 'duplicate') message.info('这组校色参数已经存过了')
    else if (result === 'no-asset') message.warning('这张结果还没有进入素材库，可先下载校色后的图片')
  },
})
// 切批次：舞台收起（那批的图已不在列表里）
watch(
  () => current.value?.taskId,
  () => colorFixHost.close(),
)

// 正在打包下载的分组 taskId 集合（用于按钮 loading/禁用）
const downloadingIds = ref<Set<string>>(new Set())

/** 一组里可下载的图（与 getDownloadableUrls 同口径），带它在 contents 里的序号（校色键按这个序号） */
function downloadableOf(item: any): { url: string; key: string }[] {
  return ((item?.contents ?? []) as any[]).flatMap((c: any, i: number) =>
    c?.resultUrl && c?.status === 2
      ? [{ url: c.resultUrl as string, key: groupMediaType === 'image' ? colorFixKey(item, i) : '' }]
      : [],
  )
}

/** 这张有没有校色：当前批次看舞台上那份状态，其它批次看本机存的参数 */
function hasFix(url: string, key: string): boolean {
  const entry = colorFixHost.entries.get(url)
  return entry ? entry.cf.active.value : hasStoredColorFix(key)
}

/**
 * 整组里校色过的图烘成 PNG 一起打包（烘失败 / 本机选区丢了的那张退回原图）。逐张来，不并发——
 * 4096 的烘图一张就占几十 MB 画布内存，并发几张 Safari 会直接崩页。
 */
async function downloadGroupWithColorFix(items: { url: string; key: string }[], zipName: string) {
  const files: { blob: Blob; ext: string; baked: boolean }[] = []
  let fellBack = 0
  for (const { url, key } of items) {
    const entry = colorFixHost.entries.get(url)
    let baked: Blob | null = null
    try {
      if (entry) baked = entry.cf.active.value ? await entry.cf.bakeToBlob() : null
      else if (key) baked = await bakeStoredColorFix(key, url)
    } catch {
      baked = null
    }
    if (baked) {
      files.push({ blob: baked, ext: 'png', baked: true })
      continue
    }
    if (hasFix(url, key)) fellBack += 1
    const res = await fetch(url, { mode: 'cors' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const ext = new URL(url).pathname.match(/\.(png|jpe?g|webp|gif|bmp)$/i)?.[1]?.toLowerCase() ?? 'jpg'
    files.push({ blob: await res.blob(), ext, baked: false })
  }
  if (fellBack) message.warning(`有 ${fellBack} 张校色效果未能写入（本机选区丢失或烘图失败），已用原图`)
  if (files.length === 1) {
    triggerDownload(files[0]!.blob, `${zipName}.${files[0]!.ext}`)
    return
  }
  const zip = new JSZip()
  files.forEach((f, i) => zip.file(`${zipName}_${i + 1}${f.baked ? '-校色后' : ''}.${f.ext}`, f.blob))
  triggerDownload(await zip.generateAsync({ type: 'blob' }), `${zipName}.zip`)
}

// 整组下载：打包该组全部生成成功的图片；校色过的那几张给校色后的图（不在当前批次的按本机存的参数烘）
const onGroupDownload = async (item: any) => {
  if (downloadingIds.value.has(item.taskId)) return
  downloadingIds.value.add(item.taskId)
  try {
    const items = downloadableOf(item)
    const urls = items.map((x) => x.url)
    if (items.some((x) => hasFix(x.url, x.key))) {
      try {
        await downloadGroupWithColorFix(items, zipNameOf(item))
        return
      } catch {
        message.warning('校色效果未能写入，已改为下载原图')
      }
    }
    await downloadImagesAsZip(urls, zipNameOf(item))
  } finally {
    downloadingIds.value.delete(item.taskId)
  }
}

// 切换单个分组全部选中
const toggleGroupAll = (group: any) => {
  const { allChecked, allImgUrls } = getGroupSelectState(group)

  if (allChecked) {
    // 本组已全选 → 清空本组所有图片
    allImgUrls.forEach((url: string) => selectImgUrls?.value.delete(url))
  } else {
    // 未全选 → 勾选本组全部图片
    allImgUrls.forEach((url: string) => selectImgUrls?.value.add(url))
  }
}

const getGroupSelectState = (group: any) => {
  // 本组所有图片
  const allImgUrls = group.contents.map((item: any) => item.resultUrl)
  // 本组已选中数量
  const checkedCount = allImgUrls.filter((url: string) => selectImgUrls?.value.has(url)).length

  const total = allImgUrls.length
  const allChecked = total > 0 && checkedCount === total
  const indeterminate = checkedCount > 0 && !allChecked

  return { allChecked, indeterminate, allImgUrls }
}
</script>

<template>
  <!-- 结果列（原型 ToolPreviewPanel，规范 §5.11）：头部 = 标题 14/600 + 时间 12/500/18 + 下载（高 28、内边距 0 8、r4、11px）；
       下方候选网格：图片 5 列、gap 8、r6，视频沿用视频模块的 480 宽 16:9。结果卡上不放常驻操作，下载 / 选择只在悬停时出现 -->
  <section v-if="current" :aria-labelledby="titleId" class="flex flex-col gap-10px p-12px">
    <div class="flex items-center gap-8px min-h-32px">
      <IconButton
        v-if="selectImgUrls"
        size="sm"
        variant="quiet"
        :pressed="getGroupSelectState(current).allChecked"
        label="全选本组"
        @click="toggleGroupAll(current)"
      >
        <i :class="getGroupSelectState(current).allChecked ? 'icon-ic_ds_check_sel' : 'icon-ic_ds_check_nor'" />
      </IconButton>
      <h2 :id="titleId" class="m-0 flex-none text-14px font-600 leading-20px text-ink">生成结果</h2>
      <span class="min-w-0 truncate text-12px font-500 leading-18px text-muted tabular-nums">{{
        current.createTime
      }}</span>

      <button
        v-if="getDownloadableUrls(current).length"
        type="button"
        class="sx-btn !h-32px !px-12px !text-13px ml-auto flex-none"
        :disabled="downloadingIds.has(current.taskId)"
        :aria-busy="downloadingIds.has(current.taskId) || undefined"
        @click="onGroupDownload(current)"
      >
        <svg
          class="w-14px h-14px"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" />
        </svg>
        <span>{{ downloadingIds.has(current.taskId) ? '下载中' : '下载' }}</span>
      </button>
    </div>

    <!-- 校色舞台：点某张图的「校色调整」后出现，调当前那张（参数台、局部调色、校色对比、下载 / 存资产） -->
    <ColorFixStage v-if="colorFixHost.focused.value" :host="colorFixHost" />

    <!-- 各卡片按素材真实比例（内联 aspect-ratio）撑高，顶对齐避免被行高拉伸变形 -->
    <div
      class="grid gap-8px items-start"
      :class="groupMediaType === 'video' ? 'grid-cols-[repeat(auto-fill,minmax(0,480px))]' : 'grid-cols-5'"
    >
      <Card
        v-for="(jtem, ji) in current.contents as any[]"
        :key="jtem.taskId"
        class="w-full"
        :data="jtem"
        :cf-key="groupMediaType === 'image' ? colorFixKey(current, ji) : ''"
        :index="ji"
        :name="fileNameOf(current, ji)"
        :style="{ aspectRatio: cardAspectRatio(jtem, current) }"
      />
    </div>
  </section>
  <!-- 刚提交、第一轮轮询还没回来：先只放标题 -->
  <section v-else :aria-labelledby="titleId" class="p-12px">
    <h2 :id="titleId" class="m-0 text-14px font-600 leading-20px text-ink">生成结果</h2>
  </section>
</template>
