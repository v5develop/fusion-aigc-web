<script setup lang="ts">
import { ref } from 'vue'
import { useMessage } from 'naive-ui'
import { upload } from '@/api/ossUpload.ts'

interface IProps {
  limitNumber?: number // 限制上传张数
  multiple?: boolean
}
const { limitNumber, multiple = false } = defineProps<IProps>()
const imgList = defineModel<any[]>('imgList', { required: true })

const message = useMessage()
const uploadRef = ref<HTMLInputElement | null>(null)
const expand = ref(false)
const loading = ref(false)

const beforeUpload = () => {
  if (loading.value) return

  if (limitNumber && imgList.value.length >= limitNumber) {
    return message.warning(`最多上传${limitNumber}张图片`)
  }
  uploadRef.value!.click()
}

const handleUpload = async (e: Event) => {
  const target = e.target as HTMLInputElement
  const files = target.files
  if (!files || files.length === 0) return

  // 校验是否为图片类型
  const fileArray = Array.from(files)
  for (const file of fileArray) {
    if (!file.type.startsWith('image/')) {
      return message.warning(`${file.name} 不是有效的图片`)
    }
  }
  loading.value = true
  upload(fileArray)
    .then((urls) => {
      if (limitNumber) {
        imgList.value.push(...urls.slice(0, limitNumber - imgList.value.length))
      } else {
        imgList.value.push(urls)
      }
    })
    .finally(() => {
      loading.value = false
      uploadRef.value!.value = ''
    })
}

const deleteImg = (index: number) => {
  imgList.value.splice(index, 1)
}
</script>

<template>
  <div class="upload-component">
    <input
      ref="uploadRef"
      type="file"
      accept="image/*"
      :multiple="multiple"
      id="file-upload"
      @change="handleUpload"
      style="display: none"
    />

    <div class="content">
      <div class="preview-cont" @mouseleave="expand = false">
        <div
          class="item"
          :style="{ '--transformX': expand ? 60 * i + 'px' : 0 }"
          v-for="(item, i) in imgList"
          :key="item"
        >
          <img class="img-item" :src="item" alt="" @mouseenter="expand = true" />

          <div class="delete-box" @click="deleteImg(i)">
            <i class="icon-ic_ds_return-2"></i>
          </div>
        </div>

        <div
          :style="{ '--transformX': expand ? 60 * imgList.length + 'px' : 0 }"
          class="item upload-btn"
          :class="[imgList.length && !expand ? 'upload-btn-small' : '', { disabled: loading }]"
          @click="beforeUpload"
          v-loading="loading"
        >
          <i class="icon-ic_home_upload1"></i>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.upload-component {
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  > .content {
    width: 100%;
    height: 100%;
    display: flex;
    position: relative;
    > .preview-cont {
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
        .rotate-to-right();
        &:hover {
          .delete-box {
            opacity: 1;
          }
        }
        > .img-item {
          width: 100%;
          height: 100%;
          object-fit: cover;
          cursor: pointer;
          transition: all 0.2s;
        }

        > .delete-box {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          position: absolute;
          top: -8px;
          right: 0;
          background-color: #444444;
          color: white;
          font-size: 12px;
          cursor: pointer;
          opacity: 0;
          transition: opacity 0.3s;
          > .icon-ic_ds_return-2 {
            font-size: 8px;
          }
        }
      }
      > .item:nth-child(even) {
        .rotate-to-left();
      }

      > .upload-btn {
        border: 1px solid #ffffff;
        box-shadow: 0 1px 6px 0 rgba(0, 0, 0, 0.03);
        background: linear-gradient(319deg, #fff6fb 2%, #ede6ff 97%);
        border-radius: 8px;
        cursor: pointer;
        display: flex;
        justify-content: center;
        align-items: center;
        transform: rotate(-@rotate);
        > .icon-ic_home_upload1 {
          color: #8f8f8f;
        }
      }
      > .upload-btn-small {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        transform: translateX(0) translateY(0) !important;
        position: absolute;
        left: 60%;
        top: 60%;
      }
      > .disabled {
        pointer-events: none;
      }
    }
  }
}

@rotate: 5deg;
.rotate-to-left() {
  transform: rotate(@rotate);
  &:hover {
    transform: rotate(@rotate) translateY(-5px) scale(1.1);
  }
}
.rotate-to-right() {
  transform: rotate(-@rotate);
  &:hover {
    transform: rotate(-@rotate) translateY(-5px) scale(1.1);
  }
}
</style>
