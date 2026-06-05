<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import Container from '../../components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import PromptAssist from '../../components/PromptAssist/index.vue'
import ManySelect from '@/components/SelectGroup/index.vue'
import { countryOptions, languageOptions, platformOptions } from '@/views/e-commerce/childPages/constants.ts'
import Tab from '@/components/Tab/index.vue'
import Textarea from '@/components/Textarea/index.vue'
import GridImage from '@/views/e-commerce/childPages/components/GridImage/index.vue'

const formData = reactive({
  imgList: ref([]),
  platform: ref(0),
  country: ref(0),
  language: ref(0),
  ratio: ref(0),
  prompt: ref(''),
  checked: ref([]),
})
const tabValue = ref(0)
</script>

<template>
  <Container
    class="commerce"
    title="模特替换"
    rightTitle="模特替换"
    :rightDesc="`上传商品图，Al 即刻生成符合 <span style='color: #8e66f9'>多电商平台规范</span> 的商品详情页。`"
  >
    <template #default>
      <div class="default-content">
        <Tab
          v-model:value="tabValue"
          :tabs="[
            { label: '只换模特', value: 0 },
            { label: '换模特/服装', value: 1 },
          ]"
          style="margin-top: 26px"
        />

        <div class="tab-content">
          <template v-if="!tabValue">
            <div class="module-title">参考视频</div>
            <ImageUpload v-model:imgList="formData.imgList" btnName="上传参考视频">
              <span style="color: #9e9e9e; margin-top: 15px">视频过长时，将自动压缩至15秒，确保最佳效果。</span>
            </ImageUpload>

            <div class="module-title">选择模特</div>
            <Tab
              v-model:value="tabValue"
              :tabs="[
                { label: '模特库', value: 0 },
                { label: '上传模特', value: 1 },
              ]"
            />
            <ManySelect
              v-model:data="formData"
              :list="[
                { field: 'platform', options: platformOptions },
                { field: 'country', options: countryOptions },
                { field: 'language', options: languageOptions },
              ]"
              :col="3"
              style="margin-top: 12px"
            />
            <GridImage
              style="margin-top: 8px"
              :imgList="[
                'https://i.pixiv.re/c/540x540_70/img-master/img/2023/10/24/06/00/01/112804798_p0_master1200.jpg',
                'https://i.pixiv.re/c/540x540_70/img-master/img/2023/10/24/06/00/01/112804798_p0_master1200.jpg',
                'https://i.pixiv.re/c/540x540_70/img-master/img/2023/10/24/06/00/01/112804798_p0_master1200.jpg',
                'https://i.pixiv.re/c/540x540_70/img-master/img/2023/10/24/06/00/01/112804798_p0_master1200.jpg',
                'https://i.pixiv.re/c/540x540_70/img-master/img/2023/10/24/06/00/01/112804798_p0_master1200.jpg',
                'https://i.pixiv.re/c/540x540_70/img-master/img/2023/10/24/06/00/01/112804798_p0_master1200.jpg',
              ]"
            />

            <div class="module-title">替换区域</div>
            <Tab
              v-model:value="tabValue"
              :tabs="[
                { label: '换脸', value: 0 },
                { label: '换头', value: 1 },
                { label: '换全身', value: 2 },
              ]"
            />
          </template>

          <template v-else>
            <div class="module-title">参考视频</div>
            <ImageUpload v-model:imgList="formData.imgList" btnName="上传参考视频">
              <span style="color: #9e9e9e; margin-top: 15px">视频过长时，将自动压缩至15秒，确保最佳效果。</span>
            </ImageUpload>

            <div class="module-title">模特图</div>
            <ImageUpload
              v-model:imgList="formData.imgList"
              btnName="上传模特图"
              :tryImages="[
                'https://i.pixiv.re/c/540x540_70/img-master/img/2023/10/24/06/00/01/112804798_p0_master1200.jpg',
                'https://i.pixiv.re/c/540x540_70/img-master/img/2023/10/24/06/00/01/112804798_p0_master1200.jpg',
                'https://i.pixiv.re/c/540x540_70/img-master/img/2023/10/24/06/00/01/112804798_p0_master1200.jpg',
                'https://i.pixiv.re/c/540x540_70/img-master/img/2023/10/24/06/00/01/112804798_p0_master1200.jpg',
                'https://i.pixiv.re/c/540x540_70/img-master/img/2023/10/24/06/00/01/112804798_p0_master1200.jpg',
                'https://i.pixiv.re/c/540x540_70/img-master/img/2023/10/24/06/00/01/112804798_p0_master1200.jpg',
                'https://i.pixiv.re/c/540x540_70/img-master/img/2023/10/24/06/00/01/112804798_p0_master1200.jpg',
              ]"
            >
              <span style="color: #9e9e9e; margin-top: 15px">图片大小20k-15M，分辨率大于400*400</span>
            </ImageUpload>
          </template>
        </div>
      </div>
    </template>
    <template #sample>
      <div class="sample-cont"></div>
    </template>
  </Container>
</template>

<style scoped lang="less">
@import '../../common.less';

.commerce {
  height: 100vh;
  .default-content {
    > .checkbox-cont {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      > .item {
        flex: 1;
        min-width: 40%;
      }
    }
    .switch-pos {
      position: absolute;
      right: 0;
      top: 50%;
      transform: translateY(-50%);
    }
    .model-diy-cont {
      > .model-diy {
        > .textarea-area {
          font-size: 0;
          > .title {
            font-size: 14px;
            line-height: 20px;
            color: #9e9e9e;
            margin: 12px 0 8px;
          }
        }
        > .generate-btn {
          height: 32px;
          margin: 12px 0;
          border-radius: 8px;
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 8px;
          background: #f5f6f8;
          cursor: pointer;
          &:hover {
            background: #ebecef;
          }
        }
      }
    }
  }

  .sample-cont {
  }
}
</style>
