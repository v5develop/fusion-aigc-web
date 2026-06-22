<script setup lang="ts">
import { provide, reactive, ref } from 'vue'
import Container from '../../components/Container/index.vue'
import ImageUpload from '@/components/ImageUpload/index.vue'
import SelectGroup from '@/components/SelectGroup/index.vue'
import CheckboxGroup from '@/components/CheckboxGroup/index.vue'
import PromptAssist from '../../components/PromptAssist/index.vue'
import Sample from '../../components/Sample/index.vue'
import RecordList from '@/views/e-commerce/childPages/components/RecordList/index.vue'
import { checkboxCustomImageList } from './constants.ts'
import { platformOps, regionOps, languageOps, aspectRatioOps } from '../../constants.ts'
import type { ICheckboxCustomImageItem } from './constants.ts'
import { useInitCheckTaskStatus } from '@/views/e-commerce/childPages/hooks.ts'
import { useMessage } from 'naive-ui'

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
  buyPoint: '',
  checked: ['auto'], // auto: 智能匹配（默认）， custom：自定义配置
})
const defaultCustomData = {
  white: 1,
  scence: 1,
  key_points: 1,
  detai: 0,
}
const { customData, checkboxClickHandle, sub, add } = useCheckbox()

const submit = () => {
  if (loading.value) return

  if (!formData.imageUrls.length) {
    return message.warning('请上传产品图')
  }

  const { white, scence, key_points, detai } = formData.checked.includes('auto') ? defaultCustomData : customData
  const params = {
    type: 'productSetImages',
    imageUrls: formData.imageUrls,
    params: {
      platform: formData.platform,
      region: formData.region,
      language: formData.language,
      aspectRatio: formData.aspectRatio,
      buyPoint: formData.buyPoint,
      ...{ white, scence, key_points, detai },
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
  <Container class="commerce" title="商品套图" :submit="submit" :loading="loading">
    <template #default>
      <div class="default-content">
        <div class="module-title">商品图</div>
        <ImageUpload
          v-model:imgList="formData.imageUrls"
          :limitNumber="3"
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
          placeholder="请输入商品信息包括:商品名称、商品描述、商品尺寸、目标受众、商品卖点。您也可以在上传多视角商品图后点击【A帮写】一键分析"
        />

        <div class="module-title">套图结构配置</div>
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
            <div v-if="formData.checked.includes('custom')" class="checkbox-custom-slot">
              <div class="item" v-for="item in checkboxCustomImageList" :key="item.field">
                <div class="label-cont">
                  <div>{{ item.label }}</div>
                  <div>{{ item.desc }}</div>
                </div>
                <div class="operation-cont">
                  <span class="icon" @click="sub(item)">-</span>
                  <span class="value">{{ customData[item.field] }}</span>
                  <span class="icon" @click="add(item)">+</span>
                </div>
              </div>
            </div>
          </template>
        </CheckboxGroup>
      </div>
    </template>

    <template #rightContent>
      <div v-if="showList" class="result-cont">
        <div class="right-content-title">生成结果</div>
        <RecordList />
      </div>
      <Sample
        v-else
        title="AI商品套图"
        :rightDesc="`上传商品图，Al 即刻生成符合 <span style='color: #8e66f9'>多电商平台规范</span> 的高转化率商品套图。`"
        image="e-commerce/product-kit-sample.webp"
      />
    </template>
  </Container>
</template>

<style scoped lang="less">
@import '../../common.less';

.commerce {
  height: 100vh;
  .default-content {
    .checkbox-custom-slot {
      width: 108%;
      cursor: default;
      > .item {
        margin-top: 10px;
        padding: 15px;
        border-radius: 5px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        background-color: #f3f5f7;
        > .label-cont {
        }
        > .operation-cont {
          background-color: white;
          border-radius: 4px;
          display: flex;
          align-items: center;
          padding: 2px;
          > .icon {
            width: 25px;
            height: 100%;
            text-align: center;
            font-size: 22px;
            cursor: pointer;
            user-select: none;
            &:hover {
              background-color: #f6f2ff;
            }
          }
          > .value {
            padding: 8px;
          }
        }
      }
    }
  }
}
</style>
