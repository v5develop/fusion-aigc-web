<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import Container from '@/views/e-commerce/childPages/components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import SelectContent from '@/views/e-commerce/childPages/components/SelectContent/index.vue'
import Checkbox from '@/views/e-commerce/childPages/components/Checkbox/index.vue'
import ImageRequirement from './ImageRequirement/index.vue'

const formData = reactive({
  imgList: ref([]),
  imgList2: ref([]),
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
    title="爆款图复刻 "
    rightTitle="爆款图复刻"
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

        <div class="module-title">参考内容</div>
        <ImageUpload v-model:imgList="formData.imgList2" :limitNumber="5" multiple btnName="上传参考图">
          <div style="margin-top: 16px">
            <ImageRequirement :imgList="formData.imgList2" />
          </div>
        </ImageUpload>

        <div class="module-title">生成设置</div>
        <SelectContent
          v-model:platform="formData.platform"
          v-model:country="formData.country"
          v-model:language="formData.language"
          v-model:ratio="formData.ratio"
        />

        <div class="module-title">复刻程度</div>
        <div class="checkbox-cont">
          <Checkbox
            v-model:checked="formData.checked1"
            title="参考风格"
            desc="参考整体风格和结构，自动调整色彩和重构场景。"
          />
          <Checkbox v-model:checked="formData.checked2" title="高度复刻" desc="参照参考图结构替换产品和文案。" />
        </div>

        <div class="module-title">复刻要求（选填）</div>
        <textarea
          class="textarea"
          v-model="formData.prompt"
          placeholder="例如：文案统一用英文、模特保持不变、参考图不变只是替换商品。"
        ></textarea>
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
      flex-direction: column;
      gap: 8px;
    }
    .textarea {
      width: 100%;
      height: 108px;
      border: 1px solid #f0f0f0;
      outline: none;
      resize: none;
      padding: 16px;
      border-radius: 5px;
      transition: all 0.3s;
      &:focus {
        border-color: var(--main-color);
      }
    }
  }

  .sample-cont {
  }
}
</style>
