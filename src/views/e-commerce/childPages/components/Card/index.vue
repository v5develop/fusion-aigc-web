<script setup lang="ts">
import { inject, type Ref } from 'vue'
import { downloadImage } from '@/utils/download'
import { withWatermark } from '@/utils/oss'
import downloadSingleIcon from '@/assets/icons/download-single.svg'
import MediaFallback from '@/components/MediaFallback/index.vue'

const { data } = defineProps<{
  data: { resultUrl: string; status: 0 | 1 | 2 | 3; blocked?: boolean }
}>()

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
    <n-image v-if="data.resultUrl" :src="withWatermark(data.resultUrl)" alt="" width="100%" height="100%" object-fit="cover">
      <template #error>
        <MediaFallback type="image" />
      </template>
    </n-image>
    <div v-else class="status-box">
      <!-- 失败态：只展示文案；其余（排队中 0 / 处理中 1）统一为「生成中」，与设计稿一致 -->
      <span v-if="data.status === 3" class="status-text">生成失败</span>
      <template v-else>
        <i class="icon-ic_ds_loading loading-icon"></i>
        <span class="status-text">生成中</span>
      </template>
    </div>

    <div v-if="data.blocked" class="blocked-overlay">内容已屏蔽</div>

    <i
      v-if="selectImgUrls && !data.blocked"
      :class="isImgChecked() ? 'icon-ic_ds_check_sel' : 'icon-ic_ds_check_nor'"
      class="icon"
      @click="toggleImage"
    />

    <div v-if="data.resultUrl && data.status === 2 && !data.blocked" class="download-pill" @click.stop="onDownload">
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
    gap: 4px;
    border-radius: 8px;
    background: #ffffff;

    .loading-icon {
      font-size: 32px;
      line-height: 1;
      color: var(--main-color);
      animation: spin 1s linear infinite;
    }

    .status-text {
      font-size: 16px;
      line-height: 26px;
      color: #9e9e9e;
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
  > .blocked-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-size: 14px;
    border-radius: 8px;
    z-index: 3;
    pointer-events: none;
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
