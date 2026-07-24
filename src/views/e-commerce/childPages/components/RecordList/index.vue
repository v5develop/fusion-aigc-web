<script setup lang="ts">
import { inject, ref, type Ref } from 'vue'
import Card from '../Card/index.vue'
import { getDownloadableUrls, downloadImagesAsZip } from '@/utils/download'
import { mediaAspectRatio } from '@/utils/ratio'
import downloadIcon from '@/assets/icons/download-single.svg'

const recordsData = inject<any[]>('recordsData')
const selectImgUrls = inject<Ref<Set<string>> | undefined>('selectImgUrls', undefined)
// 视频页下发 'video'：卡片统一 16:9 容器（视频内 contain 居中）；图片页按素材真实比例撑高
const groupMediaType = inject<'image' | 'video'>('recordMediaType', 'image')
const cardAspectRatio = (content: any) =>
  groupMediaType === 'video' ? '16 / 9' : mediaAspectRatio(content, '1 / 1')

// 正在打包下载的分组 taskId 集合（用于按钮 loading/禁用）
const downloadingIds = ref<Set<string>>(new Set())

// 下载文件名：AI素材_<创建时间>，非法字符替换为下划线
const zipNameOf = (item: any) => {
  const t = String(item?.createTime ?? '')
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return t ? `AI素材_${t}` : 'AI素材'
}

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
  <div class="record-list">
    <div class="record-item" v-for="item in recordsData" :key="item.taskId">
      <div class="title-cont">
        <div class="left-cont">
          <i
            v-if="selectImgUrls"
            :class="getGroupSelectState(item).allChecked ? 'icon-ic_ds_check_sel' : 'icon-ic_ds_check_nor'"
            @click="toggleGroupAll(item)"
          />
          <span>{{ item.createTime }}</span>
        </div>

        <button
          v-if="getDownloadableUrls(item).length"
          class="group-download-btn"
          :disabled="downloadingIds.has(item.taskId)"
          @click="onGroupDownload(item)"
        >
          <img :src="downloadIcon" width="16" height="16" alt="下载" />
          <span>{{ downloadingIds.has(item.taskId) ? '下载中' : '下载' }}</span>
        </button>
      </div>

      <div class="card-cont">
        <Card
          class="card-item"
          v-for="jtem in item.contents"
          :key="jtem.taskId"
          :data="jtem"
          :style="{ aspectRatio: cardAspectRatio(jtem) }"
        />
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.record-list {
  > .record-item {
    margin-bottom: 50px;
    > .title-cont {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 16px;
      font-weight: 600;
      line-height: 22px;
      margin-bottom: 26px;
      > .left-cont {
        display: flex;
        align-items: center;
        gap: 4px;
        > .icon-ic_ds_check_sel,
        > .icon-ic_ds_check_nor {
          font-size: 24px;
          cursor: pointer;
        }
      }

      > .group-download-btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        height: 40px;
        padding: 0 16px;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        /* token: AI智慧紫/AI主渐变 */
        background: linear-gradient(0deg, #bba2ff 0%, #ccbaff 99%);
        color: #fff;
        font-size: 14px;
        font-weight: 400;
        line-height: 20px;
        transition: opacity 0.15s ease;

        > img {
          display: block;
        }

        &:hover {
          opacity: 0.9;
        }

        &:disabled {
          opacity: 0.6;
          cursor: default;
        }
      }
    }

    > .card-cont {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 8px;
      font-size: 0;
      // 各卡片按素材真实比例（内联 aspect-ratio）撑高，顶对齐避免被行高拉伸变形
      align-items: start;
      > .card-item {
        width: 100%;
        // aspect-ratio 由模板按素材真实比例内联下发（缺数据时回退 1/1）
      }
    }
  }
}
</style>
