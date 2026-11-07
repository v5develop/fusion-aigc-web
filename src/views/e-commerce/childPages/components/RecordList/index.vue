<script setup lang="ts">
import { computed, inject, ref, unref, useId, type Ref } from 'vue'
import Card from '../Card/index.vue'
import { EC_SELECTED_TASK_KEY, selectedGroupOf } from '../HistoryColumn/selection'
import { getDownloadableUrls, downloadImagesAsZip, zipNameOf } from '@/utils/download'
import { mediaAspectRatio } from '@/utils/ratio'

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

// 正在打包下载的分组 taskId 集合（用于按钮 loading/禁用）
const downloadingIds = ref<Set<string>>(new Set())

// 整组下载：打包该组全部生成成功的图片
const onGroupDownload = async (item: any) => {
  if (downloadingIds.value.has(item.taskId)) return
  downloadingIds.value.add(item.taskId)
  try {
    await downloadImagesAsZip(getDownloadableUrls(item), zipNameOf(item))
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

    <!-- 各卡片按素材真实比例（内联 aspect-ratio）撑高，顶对齐避免被行高拉伸变形 -->
    <div
      class="grid gap-8px items-start"
      :class="groupMediaType === 'video' ? 'grid-cols-[repeat(auto-fill,minmax(0,480px))]' : 'grid-cols-5'"
    >
      <Card
        v-for="jtem in current.contents"
        :key="jtem.taskId"
        class="w-full"
        :data="jtem"
        :style="{ aspectRatio: cardAspectRatio(jtem, current) }"
      />
    </div>
  </section>
  <!-- 刚提交、第一轮轮询还没回来：先只放标题 -->
  <section v-else :aria-labelledby="titleId" class="p-12px">
    <h2 :id="titleId" class="m-0 text-14px font-600 leading-20px text-ink">生成结果</h2>
  </section>
</template>
