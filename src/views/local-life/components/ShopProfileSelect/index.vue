<script setup lang="ts">
/** 关联店铺档案下拉（选填）：AI文案、图文笔记、探店视频、带货短剧表单共用 */
import { onMounted, ref } from 'vue'
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
    placeholder="关联店铺档案（选填）"
  />
</template>
