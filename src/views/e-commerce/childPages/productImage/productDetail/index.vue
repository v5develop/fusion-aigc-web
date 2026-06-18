<script setup lang="ts">
import { provide, reactive, ref } from 'vue'
import Container from '../../components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import SelectGroup from '@/components/SelectGroup/index.vue'
import CheckboxGroup from '@/components/CheckboxGroup/index.vue'
import PromptAssist from '../../components/PromptAssist/index.vue'
import Sample from '@/views/e-commerce/childPages/components/Sample/index.vue'
import RecordList from '@/views/e-commerce/childPages/components/RecordList/index.vue'
import { useInitCheckTaskStatus } from '@/views/e-commerce/childPages/hooks.ts'
import { platformOps, regionOps, languageOps, aspectRatioOps } from '../../constants.ts'
import { useMessage } from 'naive-ui'

const { taskList, showList, execute } = useInitCheckTaskStatus('product-detail')
provide('recordsData', taskList)

const message = useMessage()
const loading = ref(false)
const formData = reactive({
  imageUrls: [],
  platform: '淘宝/天猫',
  region: '中国',
  language: '中文',
  aspectRatio: '1:1',
  buyPoint: '',
  image_types: ref([]),
})

const submit = () => {
  if (loading.value) return

  if (!formData.imageUrls.length) {
    return message.warning('请上传产品图')
  }

  const params = {
    type: 'aplusDetailPage',
    imageUrls: formData.imageUrls,
    params: {
      image_types: formData.image_types,
      platform: formData.platform,
      region: formData.region,
      language: formData.language,
      aspectRatio: formData.aspectRatio,
      buyPoint: formData.buyPoint,
    },
  }
  execute(params, loading)
}
</script>

<template>
  <Container class="commerce" title="商品详情图" :submit="submit" :loading="loading">
    <template #default>
      <div class="default-content">
        <div class="module-title">商品图</div>
        <ImageUpload
          v-model:imgList="formData.imageUrls"
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

        <div class="module-title">商品卖点&要求</div>
        <PromptAssist
          v-model:value="formData.buyPoint"
          placeholder="1、商品名称：LYCOCELLE绽家303丝绸桑蚕丝专用丝毛洗涤剂\n2、核心卖点：\n专用丝净配方，呵护丝织物纤维柔顺\n温和清洁成分，去污同时护衣不发硬\n典雅香调留香，洗净衣物自带淡香氛"
        />

        <div class="module-title">包含模块（多选）</div>
        <CheckboxGroup
          v-model="formData.image_types"
          :list="[
            { label: '主屏主视觉', value: 'hero', desc: '传递核心价值' },
            { label: '核心卖点图', value: 'key_selling', desc: '突出差点优势' },
            { label: '使用场景图', value: 'lifestyle', desc: '呈现真实使用场景' },
            { label: '多角度图', value: 'multi_angle', desc: '多角度呈现外观' },
            { label: '场景氛围图', value: 'ambience', desc: '展示使用场景' },
            { label: '商品细节图', value: 'detail', desc: '放大材质与工艺' },
          ]"
        />
      </div>
    </template>
    <template #rightContent>
      <div v-if="showList" class="result-cont">
        <div class="right-content-title">生成结果</div>
        <RecordList />
      </div>
      <Sample
        v-else
        title="AI商品详情"
        :rightDesc="`上传商品图，Al 即刻生成符合 <span style='color: #8e66f9'>多电商平台规范</span> 的商品详情页。`"
        image="e-commerce/product-detail-sample.webp"
      />
    </template>
  </Container>
</template>

<style scoped lang="less">
@import '../../common.less';

.commerce {
  height: 100vh;
  .default-content {
  }
}
</style>
