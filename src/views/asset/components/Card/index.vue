<script setup lang="ts">
import { inject, ref, watch, type Ref } from 'vue'
import { CHECK_PATH } from '../../constants.ts'
import MediaFallback from '@/components/MediaFallback/index.vue'
import { withWatermark } from '@/utils/oss'

const { data } = defineProps<{
  data: { id: number; resultUrl: string; status: 0 | 1 | 2 | 3; mediaType: 'image' | 'video' }
}>()

// 视频加载失败：以占位图替换。data 变化（虚拟列表复用同一实例）时重置失败态
const videoError = ref(false)
watch(
  () => data.resultUrl,
  () => (videoError.value = false),
)

// 管理模式开关 + 已选资产 id 集合（删除按 id、下载按 resultUrl，故选择以 id 为准）
const manageMode = inject<Ref<boolean> | undefined>('assetManageMode', undefined)
const selectedIds = inject<Ref<Set<number>> | undefined>('assetSelectedIds', undefined)

// 切换单张素材选中
const toggleImage = () => {
  if (selectedIds?.value.has(data.id)) {
    selectedIds?.value.delete(data.id)
  } else {
    selectedIds?.value.add(data.id)
  }
}

// 判断单张素材是否选中
const isImgChecked = () => selectedIds?.value.has(data.id)
</script>

<template>
  <div class="card" :class="{ cursor: manageMode }">
    <template v-if="data.resultUrl">
      <n-image
        v-if="data.mediaType === 'image'"
        :src="withWatermark(data.resultUrl)"
        alt=""
        width="100%"
        height="100%"
        object-fit="cover"
      >
        <template #error>
          <MediaFallback type="image" />
        </template>
      </n-image>
      <template v-else>
        <video
          v-if="!videoError"
          class="video"
          :src="data.resultUrl"
          controls
          @error="videoError = true"
        ></video>
        <MediaFallback v-else type="video" />
      </template>
    </template>
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

    <span v-if="manageMode" class="icon" @click="toggleImage">
      <svg viewBox="0 0 16 16" width="20" height="20">
        <template v-if="isImgChecked()">
          <circle cx="8" cy="8" r="8" fill="#202020" />
          <path :d="CHECK_PATH" fill="#FFFFFF" />
        </template>
        <circle v-else cx="8" cy="8" r="7.33" fill="#FFFFFF" stroke="#D8D8D8" stroke-width="1.33" />
      </svg>
    </span>
  </div>
</template>

<style scoped lang="less">
.card {
  position: relative;
  .video {
    width: 100%;
    height: 100%;
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
    position: absolute;
    top: 10px;
    right: 20px;
    display: inline-flex;
    cursor: pointer;
    > svg {
      display: block;
    }
  }
}
</style>
