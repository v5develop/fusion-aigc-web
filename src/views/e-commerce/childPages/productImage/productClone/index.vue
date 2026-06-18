<script setup lang="ts">
import { provide, reactive, ref } from 'vue'
import Container from '@/views/e-commerce/childPages/components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import ImageRequirement from './ImageRequirement/index.vue'
import { platformOps, regionOps, languageOps, aspectRatioOps } from '../../constants.ts'
import { useInitCheckTaskStatus } from '@/views/e-commerce/childPages/hooks.ts'
import SelectGroup from '@/components/SelectGroup/index.vue'
import CheckboxGroup from '@/components/CheckboxGroup/index.vue'
import Sample from '@/views/e-commerce/childPages/components/Sample/index.vue'
import RecordList from '@/views/e-commerce/childPages/components/RecordList/index.vue'
import { useMessage } from 'naive-ui'

const { taskList, showList, execute } = useInitCheckTaskStatus('product-clone')
provide('recordsData', taskList)

const message = useMessage()
const loading = ref(false)
const formData = reactive({
  imageUrls: [],
  refImageUrl: [] as any[],
  userInput: [],
  platform: '淘宝/天猫',
  region: '中国',
  language: '中文',
  aspectRatio: '1:1',
  prompt: '',
  level: [0], // 0 = 高度复刻，1 = 参考风格
  allStyle: '',
})
const refImageLimit = 5

const submit = () => {
  if (loading.value) return

  if (!formData.imageUrls.length) {
    return message.warning('请上传产品图')
  }
  if (!formData.refImageUrl.length) {
    return message.warning('请上传参考图')
  }

  const params = {
    type: 'hitReplication',
    imageUrls: formData.imageUrls,
    params: {
      refImageUrl: formData.refImageUrl.map((item) => item.image),
      userInput: formData.refImageUrl.map((item) => item.input),
      platform: formData.platform,
      region: formData.region,
      language: formData.language,
      aspectRatio: formData.aspectRatio,
      level: formData.level[0],
      allStyle: formData.allStyle,
    },
  }
  execute(params, loading)
}
const customResultHandle = (urls: string[]) => {
  formData.refImageUrl.push(
    ...urls.slice(0, refImageLimit - formData.refImageUrl.length).map((url) => ({ image: url, input: '' })),
  )
}
</script>

<template>
  <Container class="commerce" title="爆款图复刻 " :submit="submit" :loading="loading">
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

        <div class="module-title">参考内容</div>
        <ImageUpload
          v-model:imgList="formData.refImageUrl"
          :limitNumber="refImageLimit"
          multiple
          btnName="上传参考图"
          :customResultHandle="customResultHandle"
        >
          <div style="margin-top: 16px">
            <ImageRequirement v-model:list="formData.refImageUrl" />
          </div>
        </ImageUpload>

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

        <div class="module-title">复刻程度</div>
        <CheckboxGroup
          v-model="formData.level"
          :list="[
            { label: '参考风格', value: 1, desc: '参考整体风格和结构，自动调整色彩和重构场景。' },
            { label: '高度复刻', value: 0, desc: '参照参考图结构替换产品和文案。' },
          ]"
          :col="1"
          :customHandle="(value) => (formData.level = [value])"
        />

        <div class="module-title">复刻要求（选填）</div>
        <textarea
          class="textarea"
          v-model="formData.allStyle"
          placeholder="例如：文案统一用英文、模特保持不变、参考图不变只是替换商品。"
        ></textarea>
      </div>
    </template>

    <template #rightContent>
      <div v-if="showList" class="result-cont">
        <div class="right-content-title">生成结果</div>
        <RecordList />
      </div>
      <Sample
        v-else
        title="爆款图复刻"
        :rightDesc="`上传商品图，Al 即刻生成符合 <span style='color: #8e66f9'>多电商平台规范</span> 的商品详情页。`"
        image="e-commerce/product-clone-sample.webp"
      />
    </template>
  </Container>
</template>

<style scoped lang="less">
@import '../../common.less';

.commerce {
  height: 100vh;
  .default-content {
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
