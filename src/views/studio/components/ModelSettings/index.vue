<script setup lang="ts">
/**
 * 三个工作台共用的生图参数：模型四档 / 分辨率 / 比例。
 *
 * <p>展示名与传值分离：通用 / GPT Image 2 / Nano Banana Pro / Seedream 5 Pro，
 * 传值 通用 / GPT / Banana / Seedream。tryon / pose 比例支持「自动」（空 = 按输入图
 * 比例取最近档），imagegen 固定 1:1 起始、无自动档。
 *
 * <p>页面在「生图参数」分组标题下使用它，这里的字段标签按 12px 子标签处理。
 */
import { MODEL_OPTIONS, RESOLUTION_OPTIONS, ASPECT_RATIO_OPTIONS } from '../../constants.ts'

const { autoRatio = false } = defineProps<{
  /** true 时比例下拉含「自动」档（value ''，tryon / pose 用） */
  autoRatio?: boolean
}>()

const model = defineModel<string>('model', { required: true })
const resolution = defineModel<string>('resolution', { required: true })
const aspectRatio = defineModel<string>('aspectRatio', { required: true })

const ratioOptions = autoRatio ? [{ label: '自动', value: '' }, ...ASPECT_RATIO_OPTIONS] : ASPECT_RATIO_OPTIONS
</script>

<template>
  <div class="flex gap-10px mb-12px">
    <div class="flex-1 min-w-0">
      <div class="text-12px text-ink-2 mb-6px">生图模型</div>
      <n-select v-model:value="model" size="small" :options="MODEL_OPTIONS" />
    </div>
    <div class="flex-1 min-w-0">
      <div class="text-12px text-ink-2 mb-6px">分辨率</div>
      <n-select v-model:value="resolution" size="small" :options="RESOLUTION_OPTIONS" />
    </div>
  </div>
  <div class="mb-2px">
    <div class="text-12px text-ink-2 mb-6px">比例</div>
    <n-select v-model:value="aspectRatio" size="small" :options="ratioOptions" />
  </div>
</template>
