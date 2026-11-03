<script setup lang="ts">
import SectionTitle from '@/views/e-commerce/childPages/components/SectionTitle/index.vue'
import { useQuotePreview } from '@/utils/hooks'
import { provide, reactive, ref } from 'vue'
import Container from '../../components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import RecordList from '@/views/e-commerce/childPages/components/RecordList/index.vue'
import Sample from '@/views/e-commerce/childPages/components/Sample/index.vue'
import { useInitCheckTaskStatus } from '@/views/e-commerce/childPages/hooks.ts'
import { useMessage } from 'naive-ui'

// keep-alive 按组件 name 命中缓存。子页文件名全是 index.vue，Vue 推断出的 name 会全部撞车，必须显式声明；
// 这里刻意与路由 name 同名，标签条的 include 项直接用路由 name 即可
defineOptions({ name: 'clothing-remove-wrinkle' })

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
  <Container title="服装去皱" :submit="submit" :loading="loading" :integral="integral" :quote-status="quoteStatus">
    <template #default>
      <div>
        <SectionTitle>商品图</SectionTitle>
        <ImageUpload
          fromAsset
          v-model:imgList="formData.imageUrls"
          btnName="上传产品图"
          :topRightTips="false"
          :limitNumber="1"
        >
          <span class="mt-12px text-11px leading-17px text-muted">图片大小20k-15M，分辨率大于400*400</span>
        </ImageUpload>
      </div>
    </template>

    <template #rightContent>
      <RecordList v-if="showList" />
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
