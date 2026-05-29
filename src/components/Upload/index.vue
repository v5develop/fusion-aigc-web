<script setup lang="ts">
import { ref } from 'vue'

const fileList = ref<string[]>([
  'https://feilianyun-aicdn.oss-cn-hangzhou.aliyuncs.com/permanent_client_upload/user/40179/ai_model/203441c5-2b04-4270-8014-282be543ec3d.jpg?x-oss-process=image/format,webp',
  'https://feilianyun-aicdn.oss-cn-hangzhou.aliyuncs.com/permanent_client_upload/user/40179/ai_model/203441c5-2b04-4270-8014-282be543ec3d.jpg?x-oss-process=image/format,webp',
])
const fileRef = ref<HTMLInputElement | null>(null)
const expand = ref(false)

function uploadFile() {
  fileRef.value?.click()
}
function fileChange() {
  console.log(fileRef.value?.files)
  // fileList.value.push(
  //   'https://feilianyun-aicdn.oss-cn-hangzhou.aliyuncs.com/permanent_client_upload/user/40179/ai_model/203441c5-2b04-4270-8014-282be543ec3d.jpg?x-oss-process=image/format,webp',
  // )
}
</script>

<template>
  <div class="uploadComponent">
    <input class="fileComponent" type="file" ref="fileRef" @change="fileChange" />

    <div class="content">
      <div class="previewCont" @mouseleave="expand = false">
        <div
          class="item"
          :style="{ '--transformX': expand ? 60 * i + 'px' : 0 }"
          v-for="(item, i) in fileList"
          :key="item"
        >
          <img :src="item" alt="" @mouseenter="expand = true" />
        </div>

        <div
          :style="{ '--transformX': expand ? 60 * fileList.length + 'px' : 0 }"
          class="item uploadBtn"
          :class="fileList.length && !expand ? 'uploadBtnSmall' : ''"
          @click="uploadFile"
        >
          <i class="icon-ic_home_upload"></i>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.uploadComponent {
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  > .fileComponent {
    display: none;
  }
  > .content {
    width: 100%;
    height: 100%;
    display: flex;
    position: relative;
    > .previewCont {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      position: absolute;
      left: 0;
      top: 0;
      > .item {
        width: 60px;
        height: 70px;
        position: absolute;
        left: var(--transformX);
        top: 0;
        transition: all 0.3s;
        > img {
          width: 100%;
          height: 100%;
          cursor: pointer;
          .transformToRight();
        }
      }
      > .item:nth-child(even) {
        > img {
          .transformToLeft();
        }
      }

      > .uploadBtn {
        border: 1px solid #ffffff;
        box-shadow: 0 1px 6px 0 rgba(0, 0, 0, 0.03);
        background: linear-gradient(319deg, #fff6fb 2%, #ede6ff 97%);
        border-radius: 8px;
        cursor: pointer;
        display: flex;
        justify-content: center;
        align-items: center;
        transform: rotate(-@rotate);
        transition: all 0.3s;
        &:hover {
          transform: translateY(-5px);
        }
        > i {
          color: #8f8f8f;
        }
      }
      > .uploadBtnSmall {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        transform: translateX(0) translateY(0) !important;
        position: absolute;
        left: 60%;
        top: 60%;
      }
    }
  }
}

@rotate: 5deg;
.transformToLeft() {
  transform: rotate(@rotate);
  transition: transform 0.2s;
  &:hover {
    transform: rotate(@rotate) translateY(-5px) scale(1.1);
  }
}
.transformToRight() {
  transform: rotate(-@rotate);
  transition: transform 0.2s;
  &:hover {
    transform: rotate(-@rotate) translateY(-5px) scale(1.1);
  }
}
</style>
