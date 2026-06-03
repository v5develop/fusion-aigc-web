<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Container from '../components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import SelectContent from '../components/SelectContent/index.vue'
import PromptAssist from '../components/PromptAssist/index.vue'
import Checkbox from '../components/Checkbox/index.vue'

const formData = reactive({
  imgList: ref([]),
  platform: ref(0),
  country: ref(0),
  language: ref(0),
  ratio: ref(0),
  prompt: ref(''),
  checked1: ref(false),
  checked2: ref(false),
  checked3: ref(false),
  checked4: ref(false),
})
</script>

<template>
  <Container
    class="commerce"
    title="商品详情图"
    rightTitle="AI商品详情"
    :rightDesc="`上传商品图，Al 即刻生成符合 <span style='color: #8e66f9'>多电商平台规范</span> 的商品详情页。`"
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
        <SelectContent
          v-model:platform="formData.platform"
          v-model:country="formData.country"
          v-model:language="formData.language"
          v-model:ratio="formData.ratio"
        />

        <div class="module-title">商品卖点&要求</div>
        <PromptAssist v-model:prompt="formData.prompt" />

        <div class="module-title">包含模块（多选）</div>
        <div class="checkbox-cont">
          <Checkbox class="item" v-model:checked="formData.checked1" title="主屏主视觉" desc="传递核心价值" />
          <Checkbox class="item" v-model:checked="formData.checked2" title="核心卖点图" desc="突出差点优势" />
          <Checkbox class="item" v-model:checked="formData.checked3" title="使用场景图" desc="呈现真实使用场景" />
          <Checkbox class="item" v-model:checked="formData.checked4" title="多角度图" desc="多角度呈现外观" />
        </div>
      </div>
    </template>
    <template #sample>
      <div class="sample-cont"></div>
    </template>
  </Container>
</template>

<style scoped lang="less">
@import '../common.less';

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
  }

  .sample-cont {
  }
}
</style>
