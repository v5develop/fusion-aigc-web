<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import Container from '../../components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import Tab from '@/components/Tab/index.vue'
import { countryOptions, languageOptions, platformOptions } from '@/views/e-commerce/childPages/constants.ts'
import SelectGroup from '@/components/SelectGroup/index.vue'
import GridImage from '@/views/e-commerce/childPages/components/GridImage/index.vue'
import PromptAssist from '../../components/PromptAssist/index.vue'

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
    title="搭配融图"
    rightTitle="搭配融图"
    :rightDesc="`上传商品图，Al 即刻生成符合 <span style='color: #8e66f9'>多电商平台规范</span> 的商品详情页。`"
  >
    <template #default>
      <div class="default-content">
        <div class="module-title">选择模特</div>
        <Tab
          v-model:value="tabValue"
          :tabs="[
            { label: '模特库', value: 0 },
            { label: '上传模特', value: 1 },
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

        <div class="module-title">选择搭配图</div>
        <ImageUpload v-model:imgList="formData.imgList" :limitNumber="7" btnName="上传搭配图" />

        <div class="module-title">生成设置</div>
        <SelectGroup
          v-model:data="formData"
          :list="[
            { field: 'platform', options: platformOptions },
            { field: 'platform', options: platformOptions },
          ]"
          style="margin-top: 12px"
        />

        <div class="module-title">生成要求</div>
        <PromptAssist
          v-model:value="formData.prompt"
          placeholder="请输入生成穿搭描述，您也可以在上传多张素材图后点击【A帮写】一键分析"
          style="margin-bottom: 15px"
        />
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
