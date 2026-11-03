<script setup lang="ts">
import SettingsBar from '@/views/e-commerce/childPages/components/SettingsBar/index.vue'
import SectionTitle from '@/views/e-commerce/childPages/components/SectionTitle/index.vue'
import { useQuotePreview } from '@/utils/hooks'
import { provide, reactive, ref } from 'vue'
import { useHomeStore } from '@/stores/home'
import { storeToRefs } from 'pinia'
import type { ProductKitParams } from '@/views/home/ChatInputBox/targetParams'
import Container from '../../components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import CheckboxGroup from '@/components/CheckboxGroup/index.vue'
import PromptAssist from '../../components/PromptAssist/index.vue'
import Sample from '../../components/Sample/index.vue'
import RecordList from '@/views/e-commerce/childPages/components/RecordList/index.vue'
import { checkboxCustomImageList } from './constants.ts'
import { platformOps, regionOps, languageOps, aspectRatioOps } from '../../constants.ts'
// 与图片模块同一套模型（本地模型 / GPT-Image-2），复用其常量避免两处定义漂移
import { modelOps } from '@/views/picture/constants.ts'
import type { ICheckboxCustomImageItem } from './constants.ts'
import { useInitCheckTaskStatus } from '@/views/e-commerce/childPages/hooks.ts'
import { useMessage } from 'naive-ui'

// keep-alive 按组件 name 命中缓存。子页文件名全是 index.vue，Vue 推断出的 name 会全部撞车，必须显式声明；
// 这里刻意与路由 name 同名，标签条的 include 项直接用路由 name 即可
defineOptions({ name: 'product-kit' })

const VITE_OSS_ASSET_URL = import.meta.env.VITE_OSS_ASSET_URL

const { taskList, showList, execute } = useInitCheckTaskStatus('product-kit')
provide('recordsData', taskList)

const message = useMessage()
const loading = ref(false)
const formData = reactive({
  imageUrls: [],
  platform: '淘宝/天猫',
  region: '中国',
  language: '中文',
  aspectRatio: '1:1',
  modelCode: 'xiaoqi-image-1.0-flash',
  buyPoint: '',
  checked: ['auto'], // auto: 智能匹配（默认）， custom：自定义配置
})
const defaultCustomData = {
  white: 1,
  scence: 1,
  key_points: 1,
  detail: 0,
}
const store = useHomeStore()
const { global_formData } = storeToRefs(store)
if (global_formData.value.home) {
  const p = global_formData.value.ecommerce.params as ProductKitParams
  if (p.imageUrls?.length) (formData as any).imageUrls = p.imageUrls
  if (p.platform) formData.platform = p.platform
  if (p.region) formData.region = p.region
  if (p.language) formData.language = p.language
  if (p.aspectRatio) formData.aspectRatio = p.aspectRatio
  if (p.buyPoint) formData.buyPoint = p.buyPoint
  store.reset()
}

const { customData, checkboxClickHandle, sub, add } = useCheckbox()
const { pricePoints: integral, status: quoteStatus } = useQuotePreview(
  () => ({
    entryCode: 'productSetImages',
    modelCode: formData.modelCode,
    params: formData.checked.includes('auto') ? defaultCustomData : customData,
  }),
  // customData 是 reactive 对象，需 deep 才能监听到内部数量变化
  [() => formData.checked, () => formData.modelCode, () => customData],
  { deep: true },
)

const submit = () => {
  if (loading.value) return

  if (!formData.imageUrls.length) {
    return message.warning('请上传产品图')
  }

  if (!formData.buyPoint) {
    return message.warning('请填写商品卖点')
  }

  const { white, scence, key_points, detail } = formData.checked.includes('auto') ? defaultCustomData : customData
  const params = {
    type: 'productSetImages',
    imageUrls: formData.imageUrls,
    modelCode: formData.modelCode,
    params: {
      platform: formData.platform,
      region: formData.region,
      language: formData.language,
      aspectRatio: formData.aspectRatio,
      buyPoint: formData.buyPoint,
      ...{ white, scence, key_points, detail },
    },
  }
  execute(params, loading)
}

function useCheckbox() {
  const customData = reactive(defaultCustomData)
  const checkboxClickHandle = (value: string) => {
    if (!formData.checked.includes(value)) {
      formData.checked = [value]
    }
  }

  const limit = {
    min: 1,
    max: 5,
  }
  const sub = (item: ICheckboxCustomImageItem) => {
    const total = Object.values(customData).reduce((sum, val) => sum + val, 0)
    // 至少1张
    if (total === limit.min || customData[item.field] === 0) return
    customData[item.field] -= 1
  }
  const add = (item: ICheckboxCustomImageItem) => {
    const total = Object.values(customData).reduce((sum, val) => sum + val, 0)
    // 最多5张
    if (total === limit.max) return
    customData[item.field] += 1
  }

  return { customData, checkboxClickHandle, sub, add, limit }
}
</script>

<template>
  <Container title="AI商品套图" :submit="submit" :loading="loading" :integral="integral" :quote-status="quoteStatus">
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
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/product-kit1.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/product-kit2.png',
            VITE_OSS_ASSET_URL + 'e-commerce/uploadExample/product-kit3.png',
          ]"
        />

        <SectionTitle>商品卖点&要求</SectionTitle>
        <PromptAssist
          v-model:value="formData.buyPoint"
          :params="{
            prompt: 'ai_writing',
            imageUrls: formData.imageUrls,
          }"
          :validate="
            () => {
              if (!formData.imageUrls.length) {
                message.warning('请先上传产品图')
                return false
              }
              return true
            }
          "
          placeholder="建议填写产品名称、核心卖点、适用人群、使用场景、尺寸参数，生成高清写实电商详情图，自然光质感，完整展示产品细节，画面干净简约，符合电商商用标准画质。"
        />

        <SectionTitle>套图结构配置</SectionTitle>
        <CheckboxGroup
          v-model="formData.checked"
          :list="[
            { label: '智能匹配', value: 'auto', desc: 'AI智能分析商品图，匹配最佳的套图' },
            { label: '自定义配置', value: 'custom', desc: '可自由调整图片数量，至少选择1张', slotName: 'custom' },
          ]"
          :col="1"
          :customHandle="checkboxClickHandle"
        >
          <template #custom>
            <div v-if="formData.checked.includes('custom')" class="w-full flex flex-col gap-8px mt-10px cursor-default">
              <div
                v-for="item in checkboxCustomImageList"
                :key="item.field"
                class="flex items-center justify-between gap-12px p-12px rounded-md border border-solid border-line-soft bg-surface2"
              >
                <div class="min-w-0">
                  <div class="text-13px font-500 leading-20px text-ink">{{ item.label }}</div>
                  <div class="text-11px leading-17px text-muted">{{ item.desc }}</div>
                </div>
                <!-- 数量步进（原型 NumberStepper：高 34、line 描边、r4、内凹输入影；数值宽 64、加减按钮宽 30） -->
                <div
                  class="flex-none flex items-stretch h-34px rounded-sm border border-solid border-line bg-white shadow-inset-input overflow-hidden"
                >
                  <button
                    type="button"
                    class="w-30px p-0 border-none bg-transparent text-16px text-ink-2 cursor-pointer select-none hover:(bg-surface3 text-ink) sx-focus"
                    :aria-label="`减少${item.label}`"
                    @click="sub(item)"
                  >
                    -
                  </button>
                  <span
                    class="flex items-center justify-center w-64px border-x border-solid border-line text-12px text-ink tabular-nums"
                    aria-live="polite"
                    >{{ customData[item.field] }}</span
                  >
                  <button
                    type="button"
                    class="w-30px p-0 border-none bg-transparent text-16px text-ink-2 cursor-pointer select-none hover:(bg-surface3 text-ink) sx-focus"
                    :aria-label="`增加${item.label}`"
                    @click="add(item)"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </template>
        </CheckboxGroup>
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
        title="AI商品套图"
        :rightDesc="`上传商品原图，支持自定义提示词或AI自动生成，批量产出全套多角度电商套图。`"
        image="e-commerce/product-kit-sample.webp"
      />
    </template>
  </Container>
</template>
