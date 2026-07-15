<script setup lang="ts">
import { inject, type Ref } from 'vue'
import { downloadImage } from '@/utils/download'
import downloadSingleIcon from '@/assets/icons/download-single.svg'

const { data } = defineProps<{ data: { resultUrl: string; status: 0 | 1 | 2 | 3 } }>()

const selectImgUrls = inject<Ref<Set<string>> | undefined>('selectImgUrls', undefined)

// 切换单张图片选中
const toggleImage = () => {
  if (selectImgUrls?.value.has(data.resultUrl)) {
    selectImgUrls?.value.delete(data.resultUrl)
  } else {
    selectImgUrls?.value.add(data.resultUrl)
  }
}

// 判断单张图片是否选中
const isImgChecked = () => selectImgUrls?.value.has(data.resultUrl)

// 下载当前单张图片
const onDownload = () => downloadImage(data.resultUrl)
</script>

<template>
  <div class="card" :class="{ cursor: selectImgUrls }">
    <n-image v-if="data.resultUrl" :src="data.resultUrl" alt="" width="100%" height="100%" object-fit="cover" />
    <div
      v-else
      class="status-box"
      :class="{
        pending: data.status === 0,
        processing: data.status === 1,
        failed: data.status === 3,
      }"
    >
      <template v-if="data.status === 0">
<!--        <i class="icon-ic_ds_clock"></i>-->
        <span>排队中</span>
      </template>
      <template v-else-if="data.status === 1">
<!--        <i class="icon-ic_ds_loading"></i>-->
        <span>处理中</span>
      </template>
      <template v-else-if="data.status === 3">
<!--        <i class="icon-ic_ds_error"></i>-->
        <span>生成失败</span>
      </template>
    </div>

    <i
      v-if="selectImgUrls"
      :class="isImgChecked() ? 'icon-ic_ds_check_sel' : 'icon-ic_ds_check_nor'"
      class="icon"
      @click="toggleImage"
    />

    <div v-if="data.resultUrl" class="download-pill" @click.stop="onDownload">
      <img :src="downloadSingleIcon" width="24" height="24" alt="下载" />
    </div>
  </div>
</template>

<style scoped lang="less">
.card {
  position: relative;
  &:hover {
    > .icon,
    > .download-pill {
      opacity: 1;
    }
  }
  :deep(.n-image) {
    width: 100%;
    height: 100%;
  }
  &.cursor {
    cursor: pointer;
  }

  > .status-box {
    width: 100%;
    height: 100%;
    min-width: 150px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border-radius: 8px;

    &.pending {
      background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
      color: #666;
      i {
        font-size: 32px;
      }
      span {
        font-size: 14px;
      }
    }

    &.processing {
      background: linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%);
      color: #333;
      i {
        font-size: 32px;
        animation: spin 1s linear infinite;
      }
      span {
        font-size: 14px;
      }
    }

    &.failed {
      background: linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%);
      color: #d32f2f;
      i {
        font-size: 32px;
      }
      span {
        font-size: 14px;
      }
    }
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
  > .icon {
    font-size: 28px;
    position: absolute;
    top: 10px;
    right: 20px;
    opacity: 0;
    transition: opacity 0.2s;
  }

  > .download-pill {
    position: absolute;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8px 12px;
    background: rgba(0, 0, 0, 0.5);
    border-radius: 12px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.2s;

    img {
      display: block;
      width: 24px;
      height: 24px;
    }
  }
}
</style>
