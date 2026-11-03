<script setup lang="ts">
import SettingsBar from '@/views/e-commerce/childPages/components/SettingsBar/index.vue'
import SectionTitle from '@/views/e-commerce/childPages/components/SectionTitle/index.vue'
import { useQuotePreview } from '@/utils/hooks'
import { provide, reactive, ref, useId } from 'vue'
import Container from '@/views/e-commerce/childPages/components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import ImageRequirement from './ImageRequirement/index.vue'
import { platformOps, regionOps, languageOps, aspectRatioOps } from '../../constants.ts'
// 与图片模块同一套模型（本地模型 / GPT-Image-2），复用其常量避免两处定义漂移
import { modelOps } from '@/views/picture/constants.ts'
import { useInitCheckTaskStatus } from '@/views/e-commerce/childPages/hooks.ts'
import CheckboxGroup from '@/components/CheckboxGroup/index.vue'
import Sample from '@/views/e-commerce/childPages/components/Sample/index.vue'
import RecordList from '@/views/e-commerce/childPages/components/RecordList/index.vue'
import { useMessage } from 'naive-ui'

// keep-alive 按组件 name 命中缓存。子页文件名全是 index.vue，Vue 推断出的 name 会全部撞车，必须显式声明；
// 这里刻意与路由 name 同名，标签条的 include 项直接用路由 name 即可
defineOptions({ name: 'product-clone' })

const VITE_OSS_ASSET_URL = import.meta.env.VITE_OSS_ASSET_URL

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
  modelCode: 'xiaoqi-image-1.0-flash',
  prompt: '',
  level: [0], // 0 = 高度复刻，1 = 参考风格
  allStyle: '',
})
const refImageLimit = 5
// 描述类统一上限 3000（规范 §5.4）
const ALL_STYLE_MAX = 3000
const allStyleCountId = `ec-clone-style-count-${useId()}`
const { pricePoints: integral, status: quoteStatus } = useQuotePreview(
  () => ({ entryCode: 'hitReplication', modelCode: formData.modelCode }),
  [() => formData.modelCode],
)

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
    modelCode: formData.modelCode,
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
  <Container title="爆款图复刻" :submit="submit" :loading="loading" :integral="integral" :quote-status="quoteStatus">
    <template #default>
      <div>
        <SectionTitle>商品图</SectionTitle>
        <ImageUpload
          fromAsset
          v-model:imgList="formData.imageUrls"
          :limitNumber="3"
          multiple
          bottomTips
          :exampleImages="[
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/product-clone1.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/product-clone2.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/product-clone3.png',
          ]"
        />

        <SectionTitle>参考内容</SectionTitle>
        <ImageUpload
          fromAsset
          v-model:imgList="formData.refImageUrl"
          :limitNumber="refImageLimit"
          multiple
          btnName="上传参考图"
          :customResultHandle="customResultHandle"
        >
          <div class="mt-16px">
            <ImageRequirement v-model:list="formData.refImageUrl" />
          </div>
        </ImageUpload>

        <SectionTitle>复刻程度</SectionTitle>
        <CheckboxGroup
          v-model="formData.level"
          :list="[
            { label: '参考风格', value: 1, desc: '参考整体风格和结构，自动调整色彩和重构场景。' },
            { label: '高度复刻', value: 0, desc: '参照参考图结构替换产品和文案。' },
          ]"
          :col="1"
          :customHandle="(value) => (formData.level = [value])"
        />

        <SectionTitle>复刻要求（选填）</SectionTitle>
        <!-- 提示词框（原型 `.op-prompt`）：r6、line 描边、常驻内影，聚焦只加深内影；右下角计数 N / 3000 -->
        <div
          class="flex flex-col p-12px rounded-md border border-solid border-line bg-white shadow-well transition-shadow duration-mid ease-sx motion-reduce:transition-none focus-within:shadow-[inset_0_0_16px_rgba(31,35,41,0.18),inset_0_1px_0_rgba(31,35,41,0.08)]"
        >
          <textarea
            v-model="formData.allStyle"
            class="block w-full h-84px box-border m-0 p-0 resize-none border-none outline-none bg-transparent text-13px leading-20px text-ink placeholder:text-placeholder"
            aria-label="复刻要求（选填）"
            :aria-describedby="allStyleCountId"
            :maxlength="ALL_STYLE_MAX"
            placeholder="例如：文案统一用英文、模特保持不变、参考图不变只是替换商品。"
          ></textarea>
          <span
            :id="allStyleCountId"
            class="self-end mt-6px text-11px leading-16px tabular-nums select-none"
            :class="formData.allStyle.length >= ALL_STYLE_MAX ? 'text-warning' : 'text-placeholder'"
            >{{ formData.allStyle.length >= ALL_STYLE_MAX ? '已达字数上限 · ' : '' }}{{ formData.allStyle.length }} /
            {{ ALL_STYLE_MAX }}</span
          >
        </div>
      </div>
    </template>

    <template #settings>
      <SettingsBar
        v-model:data="formData"
        :model-options="modelOps"
        :fields="[
          { field: 'platform', label: '平台', options: platformOps },
          { field: 'region', label: '地区', options: regionOps },
          { field: 'language', label: '语言', options: languageOps },
          { field: 'aspectRatio', label: '比例', options: aspectRatioOps },
        ]"
      />
    </template>

    <template #rightContent>
      <RecordList v-if="showList" />
      <Sample
        v-else
        title="爆款图复刻"
        :rightDesc="`导入爆款参考图，复刻构图光影风格，快速产出同质感高清商品宣传图。`"
        image="e-commerce/product-clone-sample.webp"
      />
    </template>
  </Container>
</template>
