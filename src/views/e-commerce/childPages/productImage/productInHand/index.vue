<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import Container from '@/views/e-commerce/childPages/components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import GridImage from '@/views/e-commerce/childPages/components/GridImage/index.vue'
import ManySelect from '@/components/SelectGroup/index.vue'
import {
  platformOptions,
  countryOptions,
  languageOptions,
  ratioOptions,
} from '@/views/e-commerce/childPages/constants.ts'
import Tab from '@/components/Tab/index.vue'

const formData = reactive({
  imgList: ref([]),
  imgList2: ref([]),
  platform: ref(0),
  country: ref(0),
  language: ref(0),
  ratio: ref(0),
})

const useTab1 = () => {
  const tab1 = ref('model')
  const tabList1 = [
    { label: '模特手持', value: 'model' },
    { label: '纯手手持', value: 'hand' },
  ]

  return { tab1, tabList1 }
}
const { tab1, tabList1 } = useTab1()

const useTab2 = () => {
  const tab2 = ref('model')
  const tabList2 = [
    { label: '背景库', value: 'model' },
    { label: '上传背景图', value: 'hand' },
  ]

  return { tab2, tabList2 }
}
const { tab2, tabList2 } = useTab2()
</script>

<template>
  <Container
    class="commerce"
    title="手持商品 "
    rightTitle="手持商品"
    :rightDesc="`上传商品图，Al 即刻生成符合 <span style='color: #8e66f9'>多电商平台规范</span> 的手持商品。`"
  >
    <template #default>
      <div class="default-content">
        <div class="module-title">商品图</div>
        <ImageUpload
          v-model:imgList="formData.imgList"
          :limitNumber="3"
          :exampleImages="[
            'https://i.pixiv.re/c/540x540_70/img-master/img/2023/10/24/06/00/01/112804798_p0_master1200.jpg',
            'https://i.pixiv.re/c/540x540_70/img-master/img/2023/10/24/06/00/01/112804798_p0_master1200.jpg',
          ]"
          multiple
          bottomTips
        />

        <div class="module-title">生成设置</div>
        <ManySelect
          v-model:data="formData"
          :list="[
            { field: 'platform', options: platformOptions },
            { field: 'country', options: countryOptions },
            { field: 'language', options: languageOptions },
            { field: 'ratio', options: ratioOptions },
          ]"
        />

        <div class="module-title">手持姿势</div>
        <Tab v-model:value="tab1" :tabs="tabList1" />
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

        <template v-if="tab1 === 'model'">
          <div class="module-title">选择模特</div>
          <ManySelect
            v-model:data="formData"
            :list="[
              { field: 'platform', options: platformOptions },
              { field: 'country', options: countryOptions },
              { field: 'language', options: languageOptions },
            ]"
            :col="3"
            gap="4px"
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
        </template>

        <div class="module-title">选择背景</div>
        <Tab v-model:value="tab2" :tabs="tabList2" />
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
  }

  .sample-cont {
  }
}
</style>
