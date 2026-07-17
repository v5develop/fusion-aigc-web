<script setup lang="ts">
import { useQuotePreview } from '@/utils/hooks'
import { provide, reactive, ref } from 'vue'
import Container from '../../components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import RecordList from '@/views/e-commerce/childPages/components/RecordList/index.vue'
import Sample from '@/views/e-commerce/childPages/components/Sample/index.vue'
import { useInitCheckTaskStatus } from '@/views/e-commerce/childPages/hooks.ts'
import { useMessage } from 'naive-ui'

const { taskList, showList, execute } = useInitCheckTaskStatus('clothing-remove-wrinkle')
provide('recordsData', taskList)

const message = useMessage()
const loading = ref(false)
const formData = reactive({
  imageUrls: [],
})
const { pricePoints: integral, status: quoteStatus } = useQuotePreview(() => ({ entryCode: 'removeWrinkles' }), [])

const submit = () => {
  if (loading.value) return

  if (!formData.imageUrls.length) {
    return message.warning('请上传服装图片')
  }

  const params = {
    type: 'removeWrinkles',
    imageUrls: formData.imageUrls,
  }
  execute(params, loading)
}

</script>

<template>
  <Container class="commerce" title="服装去皱" :submit="submit" :loading="loading" :integral="integral" :quote-status="quoteStatus">
    <template #default>
      <div class="default-content">
        <div class="module-title">商品图</div>
        <ImageUpload v-model:imgList="formData.imageUrls" btnName="上传产品图" :topRightTips="false" :limitNumber="1">
          <span style="color: #9e9e9e; margin-top: 15px">图片大小20k-15M，分辨率大于400*400</span>
        </ImageUpload>
      </div>
    </template>

    <template #rightContent>
      <div v-if="showList" class="result-cont">
        <div class="right-content-title">生成结果</div>
        <RecordList />
      </div>
      <Sample
        v-else
        title="服装去皱"
        :rightDesc="`上传带褶皱服饰原图，一键智能抚平面料褶皱，还原平整高级服装质感。`"
        image="e-commerce/clothing-remove-wrinkle.webp"
      >
      </Sample>
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
