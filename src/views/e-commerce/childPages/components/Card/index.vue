<script setup lang="ts">
import { inject, type Ref } from 'vue'
import { downloadImage } from '@/utils/download'
import { withWatermark } from '@/utils/oss'
import { isTimeout } from '@/utils/utils'
import downloadSingleIcon from '@/assets/icons/download-single.svg'
import MediaFallback from '@/components/MediaFallback/index.vue'
import GenerateLoading from '@/components/GenerateLoading/index.vue'

const { data } = defineProps<{
  data: { resultUrl: string; status: 0 | 1 | 2 | 3; blocked?: boolean; errorMsg?: string; statusView?: any }
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
    <!-- 违规优先：白卡占位 -->
    <MediaFallback v-if="data.blocked" type="image" reason="blocked" />
    <n-image v-else-if="data.resultUrl" :src="withWatermark(data.resultUrl)" alt="" width="100%" height="100%" object-fit="cover">
      <template #error>
        <!-- 成功图但加载失败：网络原因 -->
        <MediaFallback type="image" reason="loadFailed" />
      </template>
    </n-image>
    <!-- 生成失败：超时/一般失败占位 -->
    <MediaFallback
      v-else-if="data.status === 3"
      type="image"
      :reason="isTimeout(data) ? 'timeout' : 'generateFailed'"
    />
    <!-- 生成中（排队中 0 / 处理中 1）：AI 生成加载动画 -->
    <GenerateLoading v-else />

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
