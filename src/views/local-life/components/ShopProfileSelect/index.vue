<script setup lang="ts">
/**
 * 关联店铺档案下拉（选填）：AI文案、图文笔记、探店视频、带货短剧表单共用。
 * 占位照原型 StudioParamCard（「请选择」+ 字段名）；一条档案都没有时，下拉空态给一句去创建的入口
 * （照原型数字人字段「还没有数字人，可先去「数字人」创建一个」的写法）。
 */
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { llShopProfileList } from '@/api/localLife.ts'
import type { ILShopProfile } from '@/api/localLifeTypes.ts'

const shopProfileId = defineModel<number | undefined>('value', { default: undefined })

const options = ref<{ label: string; value: number }[]>([])
const loading = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    const res = await llShopProfileList()
    options.value = (res.data?.list ?? []).map((p: ILShopProfile) => ({ label: p.name, value: p.id }))
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <n-select
    v-model:value="shopProfileId"
    size="small"
    clearable
    :loading="loading"
    :options="options"
    placeholder="请选择关联店铺档案（选填）"
  >
    <template #empty>
      <span class="flex items-center gap-8px py-4px text-12px leading-18px text-muted">
        还没有店铺档案，可先去「店铺档案」创建一个
        <RouterLink to="/local-life/shop-profile" class="ll-link no-underline">去创建</RouterLink>
      </span>
    </template>
  </n-select>
</template>
