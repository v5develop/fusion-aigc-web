<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import Container from '../../components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import Tab from '@/components/Tab/index.vue'
import { countryOptions, languageOptions, platformOptions } from '@/views/e-commerce/childPages/constants.ts'
import SelectGroup from '@/components/SelectGroup/index.vue'
import GridImage from '@/views/e-commerce/childPages/components/GridImage/index.vue'
import CheckboxGroup from '@/components/CheckboxGroup/index.vue'
import Textarea from '@/components/Textarea/index.vue'

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
const switchValue = ref(true)
</script>

<template>
  <Container
    class="commerce"
    title="穿戴套图"
    rightTitle="穿戴套图"
    :rightDesc="`上传商品图，Al 即刻生成符合 <span style='color: #8e66f9'>多电商平台规范</span> 的商品详情页。`"
  >
    <template #default>
      <div class="default-content">
        <div class="module-title">商品图</div>
        <ImageUpload v-model:imgList="formData.imgList" btnName="上传参产品图" :limitNumber="5" multiple>
          <span style="color: #9e9e9e; margin-top: 15px">整套搭配或同一件服装不同角度图</span>
        </ImageUpload>

        <div class="module-title">选择模特</div>
        <Tab
          v-model:value="tabValue"
          :tabs="[
            { label: '模特库', value: 0 },
            { label: '上传新模特', value: 1 },
          ]"
        />
        <SelectGroup
          v-model:data="formData"
          :list="[
            { field: 'platform', options: platformOptions },
            { field: 'platform', options: platformOptions },
            { field: 'platform', options: platformOptions },
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

        <div class="module-title">图片比例</div>
        <Tab
          v-model:value="tabValue"
          :tabs="[
            { label: '3:4', value: 0 },
            { label: '1:1', value: 1 },
            { label: '9:16', value: 2 },
          ]"
        />

        <div class="module-title">拍摄场景（多选）</div>
        <div class="switch-cont">
          <span>AI推荐</span>
          <n-switch v-model:value="switchValue" />
        </div>
        <template v-if="switchValue">
          <CheckboxGroup
            v-model="formData.checked"
            :list="[
            {
              label: 'UGG 种草',
              value: 'ugg',
            },
            {
              label: '带货短剧',
              value: 'short_video_1',
            },
            {
              label: '产品演示',
              value: 'product_demo',
            },
            {
              label: '产品口播',
              value: 'product_talk',
            },
            {
              label: 'TVC广告',
              value: 'tvc_ad',
            },
            {
              label: '带货短剧',
              value: 'short_video_2',
            },
            {
              label: '开箱种草',
              value: 'unboxing',
            },
            {
              label: '痛点解决',
              value: 'pain_solve',
            },
          ]"
            :col="2"
            gap="8px"
          />
          <div class="textarea-cont">
            <div class="label">或自定义描述场景（可选）</div>
            <Textarea
              v-model:value="formData.prompt"
              placeholder="描述你想要的场景：春日樱花漫道、柔白窗边天光、女生斜倚木质窗台…"
            />
          </div>
        </template>
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
    > .switch-cont {
      height: 52px;
      border-radius: 12px;
      border: 1px solid #f0f0f0;
      padding: 0 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    > .textarea-cont {
      margin: 12px 0;
      > .label {
        line-height: 20px;
        color: #9e9e9e;
        margin-bottom: 12px;
      }
    }
  }

  .sample-cont {
  }
}
</style>
