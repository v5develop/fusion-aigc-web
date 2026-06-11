<script setup lang="ts">
import { provide, reactive, ref } from 'vue'
import Container from '@/views/e-commerce/childPages/components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import GridImage from '@/views/e-commerce/childPages/components/GridImage/index.vue'
import SelectGroup from '@/components/SelectGroup/index.vue'
import { platformOps, regionOps, languageOps, aspectRatioOps } from '../../constants.ts'
import Tab from '@/components/Tab/index.vue'
import Sample from '@/views/e-commerce/childPages/components/Sample/index.vue'
import RecordList from '@/views/asset/components/RecordList/index.vue'
import { ecommerceSubmit } from '@/api/methods.ts'
import { useInitCheckTaskStatus } from '@/views/e-commerce/childPages/hooks.ts'

const { result: taskList = [], getSessionId, startPolling } = useInitCheckTaskStatus('product-kit')
provide('recordsData', taskList)

const loading = ref(false)
const formData = reactive({
  images: [],
  modelGesturesUrl: [], // 模特手持图
  gesturesUrl: [], // 纯手持图
  personUrl: [], // 模特图
  bgImageUrl: [], // 背景图
  platform: '淘宝/天猫',
  region: '中国',
  language: '中文',
  aspectRatio: '1:1',
})
const gestureActive = ref('model')
const modelFilter = reactive({
  sex: '',
  age: '',
  skinColor: '',
})

const useTab2 = () => {
  const tab2 = ref('model')
  const tabList2 = [
    { label: '背景库', value: 'model' },
    { label: '上传背景图', value: 'hand' },
  ]

  return { tab2, tabList2 }
}
const { tab2, tabList2 } = useTab2()

const submit = () => {
  if (loading.value) return

  const sessionId = getSessionId()
  const params = {
    sessionId,
    type: 'aiGestures',
    images: formData.images,
    params: {
      modelGesturesUrl: formData.modelGesturesUrl[0],
      gesturesUrl: formData.gesturesUrl[0],
      personUrl: formData.personUrl[0],
      bgImageUrl: formData.bgImageUrl[0],
      platform: formData.platform,
      region: formData.region,
      language: formData.language,
      aspectRatio: formData.aspectRatio,
    },
  }
  loading.value = true
  ecommerceSubmit(params)
    .then((res) => {
      if (res.code === 0) {
        // 开始轮询
        startPolling(sessionId)
      }
    })
    .finally(() => (loading.value = false))
}
</script>

<template>
  <Container class="commerce" title="手持商品" :submit="submit" :loading="loading">
    <template #default>
      <div class="default-content">
        <div class="module-title">商品图</div>
        <ImageUpload
          v-model:imgList="formData.images"
          :limitNumber="3"
          :exampleImages="[
            'https://i.pixiv.re/c/540x540_70/img-master/img/2023/10/24/06/00/01/112804798_p0_master1200.jpg',
            'https://i.pixiv.re/c/540x540_70/img-master/img/2023/10/24/06/00/01/112804798_p0_master1200.jpg',
          ]"
          multiple
          bottomTips
        />

        <div class="module-title">生成设置</div>
        <SelectGroup
          v-model:data="formData"
          :list="[
            { field: 'platform', options: platformOps },
            { field: 'region', options: regionOps },
            { field: 'language', options: languageOps },
            { field: 'aspectRatio', options: aspectRatioOps },
          ]"
        />

        <div class="module-title">手持姿势</div>
        <Tab
          v-model:value="gestureActive"
          :tabs="[
            { label: '模特手持', value: 'model' },
            { label: '纯手手持', value: 'hand' },
          ]"
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

        <template v-if="gestureActive === 'model'">
          <div class="module-title">选择模特</div>
          <SelectGroup
            v-model:data="modelFilter"
            :list="[
              {
                field: 'sex',
                options: [
                  { label: '男', value: '男' },
                  { label: '女', value: '女' },
                ],
              },
              {
                field: 'age',
                options: [
                  { label: '童年', value: 'chid' },
                  { label: '青年', value: 'young' },
                  { label: '老年', value: 'old' },
                ],
              },
              {
                field: 'skinColor',
                options: [
                  { label: '亚洲人', value: 'asia' },
                  { label: '欧洲人', value: 'europe' },
                  { label: '其他', value: 'other' },
                ],
              },
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

    <template #rightContent>
      <Sample
        v-if="taskList?.length"
        title="手持商品"
        :rightDesc="`上传商品图，Al 即刻生成符合 <span style='color: #8e66f9'>多电商平台规范</span> 的手持商品。`"
      />
      <div v-else>
        <div class="right-content-title">生成结果</div>
        <RecordList :showSelect="false" />
      </div>
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
