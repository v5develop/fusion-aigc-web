<script setup lang="ts">
import type { IProps } from './constants.ts'
import { _platformOptions, _countryOptions, _languageOptions, _ratioOptions } from './constants.ts'

const {
  platformOptions = _platformOptions,
  countryOptions = _countryOptions,
  languageOptions = _languageOptions,
  ratioOptions = _ratioOptions,
} = defineProps<IProps>()

const platform = defineModel('platform', { required: true })
const country = defineModel('country', { required: true })
const language = defineModel('language', { required: true })
const ratio = defineModel('ratio', { required: true })
const productType = defineModel('productType')
</script>

<template>
  <div class="container">
    <n-select v-model:value="platform" :options="platformOptions" />
    <n-select v-model:value="country" :options="countryOptions" />
    <n-select v-model:value="language" :options="languageOptions" />
    <n-select v-model:value="ratio" :options="ratioOptions" />
    <n-select
      v-if="productType !== undefined"
      v-model:value="productType"
      :options="ratioOptions"
      placeholder="商品类型（选填）"
      clearable
      style="width: 100%"
    />
  </div>
</template>

<style scoped lang="less">
.container {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  /deep/.n-select {
    flex: 1;
    min-width: 40%;
    .n-base-selection-label {
      background-color: #f5f6f8;
    }
    .n-base-selection__border {
      display: none;
    }
  }
}
</style>
