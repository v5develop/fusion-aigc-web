<script setup lang="ts">
import { upload } from '@/api/ossUpload.ts'
import { useMessage } from 'naive-ui'
import { computed, ref } from 'vue'

interface IProps {
  type?: 'card' // 上传控件样式
  limitNumber?: number // 限制上传张数
  exampleImages?: string[] // 示例图
  btnName?: string // 按钮名称
  multiple?: boolean
  topRightTips?: boolean // 把topRightTips=false和limitNumber=1，就能提示只能上传一张
  bottomTips?: boolean
  tryImages?: any[] // 试一试图片
  field?: string // imgList为对象数组时，取图片地址的key，默认image
  customResultHandle?: (value: string[]) => void // 自定义返回处理
  customBeforeUpload?: () => boolean // 文件上传之前的回调，返回 false 会取消本次上传
}
const {
  type = 'default',
  limitNumber,
  exampleImages,
  multiple = false,
  topRightTips = true,
  bottomTips,
  btnName = '上传产品图',
  field = 'image',
  customResultHandle,
  customBeforeUpload = () => true,
} = defineProps<IProps>()
const imgList = defineModel<any[]>('imgList', {
  default: () => [],
})

const message = useMessage()
const loading = ref(false)
const uploadRef = ref<HTMLInputElement | null>(null)

// 已达上传上限：此时按钮点击只会弹「最多上传N张」，没有操作意义，直接隐藏。
// 需要换图时先删除已传图片，上传按钮会重新出现。
const limitReached = computed(() => !!limitNumber && imgList.value.length >= limitNumber)

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
  upload(fileArray)
    .then((urls) => {
      if (customResultHandle) {
        customResultHandle(urls)
        return
      }
      imgList.value.push(...urls.slice(0, (limitNumber ?? 1) - imgList.value.length))
    })
    .finally(() => {
      loading.value = false
      uploadRef.value!.value = ''
    })
}

const beforeUpload = () => {
  if (!customBeforeUpload?.()) return

  if (limitNumber && imgList.value.length >= limitNumber) {
    return message.warning(`最多上传${limitNumber}张图片`)
  }
  uploadRef.value!.click()
}

const tryClick = (url: string) => {
  if (imgList.value.includes(url)) return

  if (limitNumber && imgList.value.length >= limitNumber) {
    return message.warning(`最多上传${limitNumber}张图片`)
  }

  imgList.value.push(url)
}
</script>

<template>
  <input
    ref="uploadRef"
    type="file"
    accept="image/*"
    :multiple="multiple"
    id="file-upload"
    @change="handleUpload"
    style="display: none"
  />

  <div v-if="type === 'default'" class="default-style" v-loading="loading">
    <div class="main">
      <div v-if="limitNumber && topRightTips" class="limit-tips">支持多图(最多{{ limitNumber }}张)</div>

      <div v-if="!limitReached" class="upload-btn" @click="beforeUpload">
        <i class="icon-ic_ds_CloudUpload1"></i>
        <span>{{ btnName }}</span>
      </div>

      <div v-if="exampleImages" class="example-cont">
        <span>示例</span>
        <!--        <n-image
          v-for="item in exampleImages"
          :key="item"
          width="44"
          height="44"
          :src="item"
          object-fit="cover"
          style="border-radius: 4px"
        />-->
        <template v-for="item in exampleImages" :key="item">
          <n-popover trigger="hover">
            <template #trigger>
              <img class="img" :src="item" alt="" />
            </template>
            <img class="preview" :src="item" alt="" />
          </n-popover>
        </template>
      </div>

      <div class="upload-img-list">
        <div class="item" v-for="(item, i) in imgList" :key="item">
          <n-image width="58" height="58" :src="item[field] ?? item" object-fit="cover" style="border-radius: 8px" />

          <div class="delete" @click="deleteImg(i)">
            <i class="icon-ic_ds_return-2"></i>
          </div>
        </div>
      </div>

      <slot></slot>

      <div v-if="bottomTips" class="bottom-tips">请上传清晰且能够尽量展示商品全貌的图片</div>
    </div>

    <div v-if="tryImages" class="try-try">
      <span class="title">试一试</span>
      <div class="content">
        <template v-for="item in tryImages" :key="item">
          <n-popover trigger="hover">
            <template #trigger>
              <img class="img" :src="item" alt="" @click="tryClick(item)" />
            </template>
            <img class="preview" :src="item" alt="" />
          </n-popover>
        </template>
      </div>
    </div>
  </div>

  <div v-else-if="type === 'card'" class="card-style" v-loading="loading">
    <div class="upload-trigger" @click="beforeUpload">
      <i class="icon-ic_ds_CloudUpload1"></i>
      <span>{{ btnName }}</span>
    </div>
  </div>
</template>

<style scoped lang="less">
.default-style {
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
      min-width: 130px;
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
      .img {
        height: 44px;
        border-radius: 4px;
      }
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

  > .try-try {
    margin-top: 12px;
    /* 收窄左右内边距，给 7 张试用图腾出宽度（原 14px 时第 7 张会被截断） */
    padding: 0 8px;
    height: 44px;
    border-radius: 8px;
    background: #edeff5;
    display: flex;
    align-items: center;
    > .title {
      font-size: 12px;
      color: #9e9e9e;
      padding: 0 4px 0 0;
      flex-shrink: 0;
    }
    > .content {
      /* 按内容收缩而非占满剩余宽度：排得下时右侧不留富余，左右视觉间距同为 .try-try 的 8px；
         排不下时被压缩到可用宽度并横向滚动，右侧同样紧贴 8px 内边距 */
      flex: 0 1 auto;
      min-width: 0;
      height: 90%;
      display: flex;
      align-items: center;
      gap: 4px;
      overflow-x: auto;
      overflow-y: hidden;
      /* 隐藏滚动条，靠滚轮/触控板横滑。不占高度，图片得以铺满 .try-try */
      scrollbar-width: none; /* Firefox */
      &::-webkit-scrollbar {
        display: none;
      }
      .img {
        height: 100%;
        aspect-ratio: 1/1;
        border-radius: 8px;
        object-fit: cover;
        cursor: pointer;
      }
    }
  }
}

.card-style {
  width: 100%;
  height: 100%;
  //max-width: 86px;
  //max-height: 86px;

  .upload-trigger {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    cursor: pointer;
    background-color: #f5f6f8;
    border-radius: 8px;
    transition: all 0.3s ease;

    &:hover {
      background-color: #ebecef;
    }

    &:active {
      transform: scale(0.98);
    }

    i {
      font-size: 20px;
      color: #3a3a3a;
    }

    span {
      font-size: 14px;
      line-height: 20px;
      color: #3a3a3a;
    }
  }
}
</style>
