<script setup lang="ts">
import { upload } from '@/api/ossUpload.ts'
import { useMessage } from 'naive-ui'
import { ref } from 'vue'

interface IProps {
  limitNumber?: number // 限制上传张数
  exampleImages?: string[] // 示例图
  multiple?: boolean
  bottomTips?: boolean
}
const { limitNumber, multiple = false, bottomTips } = defineProps<IProps>()
const imgList = defineModel<any[]>('imgList', { required: true })
const loading = ref(false)

const message = useMessage()
const uploadRef = ref<HTMLInputElement | null>(null)

const deleteImg = (index: number) => {
  imgList.value.splice(index, 1)
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
  const urls = await upload(fileArray)
  imgList.value.push(...urls.slice(0, (limitNumber ?? 1) - imgList.value.length))
  loading.value = false
  uploadRef.value!.value = ''
}

const beforeUpload = () => {
  if (limitNumber && imgList.value.length >= limitNumber) {
    return message.warning(`最多上传${limitNumber}张图片`)
  }
  uploadRef.value!.click()
}
</script>

<template>
  <div class="image-upload" v-loading="loading">
    <div class="main">
      <div v-if="limitNumber" class="limit-tips">支持多图(最多{{ limitNumber }}张)</div>

      <input
        ref="uploadRef"
        type="file"
        accept="image/*"
        :multiple="multiple"
        id="file-upload"
        @change="handleUpload"
        style="display: none"
      />
      <div class="upload-btn" @click="beforeUpload">
        <i class="icon-ic_ds_CloudUpload1"></i>
        <span>上传产品图</span>
      </div>

      <div v-if="exampleImages" class="example-cont">
        <span>示例</span>
        <n-image
          v-for="item in exampleImages"
          :key="item"
          width="44"
          height="44"
          :src="item"
          object-fit="cover"
          style="border-radius: 4px"
        />
      </div>

      <div class="upload-img-list">
        <div class="item" v-for="(item, i) in imgList" :key="item">
          <n-image width="58" height="58" :src="item" object-fit="cover" style="border-radius: 8px" />

          <div class="delete" @click="deleteImg(i)">
            <i class="icon-ic_ds_return-2"></i>
          </div>
        </div>
      </div>

      <slot></slot>

      <div v-if="bottomTips" class="bottom-tips">请上传清晰且能够尽量展示商品全貌的图片</div>
    </div>
  </div>
</template>

<style scoped lang="less">
.image-upload {
  position: relative;
  > .main {
    //min-height: 242px;
    padding-bottom: 16px;
    border-radius: 12px;
    box-sizing: border-box;
    border: 1px solid #f0f0f0;
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
    overflow: hidden;
    > .limit-tips {
      width: 124px;
      height: 24px;
      font-size: 12px;
      position: absolute;
      top: 0;
      right: 0;
      border-radius: 0 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(101deg, #e8e4ff 0%, #ffdada 100%);
    }

    > .upload-btn {
      width: 130px;
      height: 40px;
      margin-top: 32px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 16px;
      gap: 8px;
      cursor: pointer;
      background: #f5f6f8;
      &:hover {
        background: #f0f0f0;
      }
      > i {
        font-size: 20px;
      }
    }

    > .example-cont {
      height: 44px;
      margin-top: 8px;
      display: flex;
      align-items: center;
      gap: 4px;
      color: #9e9e9e;
    }

    > .upload-img-list {
      margin-top: 8px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 4px;
      > .item {
        width: 58px;
        height: 58px;
        position: relative;
        cursor: pointer;
        > .delete {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          position: absolute;
          top: 4px;
          right: 4px;
          background-color: #333333;
          &:hover {
            opacity: 0.9;
          }
          > i {
            color: white;
            font-size: 10px;
          }
        }
      }
    }

    > .bottom-tips {
      width: 100%;
      height: 36px;
      margin-top: auto;
      font-size: 12px;
      background: #fff4e6;
      color: #ff9500;
      display: flex;
      align-items: center;
      padding: 0 12px;
      position: relative;
      bottom: -16px;
    }
  }
}
</style>
