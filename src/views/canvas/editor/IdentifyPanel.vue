<script setup lang="ts">
/**
 * 识别：在图片上点选或框选 → POST /agent/canvas/identify（同步、不计费、每分钟 30 次），
 * 返回 {id, label, description}，标签与描述标在图上（RegionStage）并列在下方。
 * 区域按图片地址存在模块里，「用这些区域编辑」直接带进图片编辑面板。
 */
import { computed, ref } from 'vue'
import RegionStage from './RegionStage.vue'
import RegionList from './RegionList.vue'
import type { IActionRegion, IImageSource, ImageActionKind, RatioPoint } from './image-actions.ts'
import { addRegion, identifiableUrl, regionsOf } from './image-actions.ts'
import { ACTION_SUBMIT } from './action-ui.ts'

const props = defineProps<{ source: IImageSource }>()
// 识别很快且结果写进模块级区域表，不锁页签：切到编辑后识别中的区域照样会落定
const emit = defineEmits<{ switch: [kind: ImageActionKind] }>()

const mode = ref<'point' | 'box'>('point')
const activeKey = ref('')
const regions = computed(() => regionsOf(props.source.url))
const supported = computed(() => identifiableUrl(props.source.url))
const doneCount = computed(() => regions.value.filter((region) => region.status === 'done').length)

function onDraw(shape: 'point' | 'box', points: RatioPoint[]) {
  addRegion(props.source.url, shape, points)
}

const numberOf = (region: IActionRegion) => regions.value.indexOf(region) + 1
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0">
    <div class="flex-1 min-h-0 overflow-y-auto px-12px pb-12px">
      <div class="sx-seg mb-10px" role="radiogroup" aria-label="选取方式">
        <button
          v-for="item in [
            { key: 'point', label: '点选' },
            { key: 'box', label: '框选' },
          ] as const"
          :key="item.key"
          type="button"
          role="radio"
          class="sx-seg-item sx-focus !px-14px !text-12px"
          :class="{ 'sx-seg-on': mode === item.key }"
          :aria-checked="mode === item.key"
          @click="mode = item.key"
        >
          {{ item.label }}
        </button>
      </div>

      <p v-if="!supported" class="m-0 mb-10px px-10px py-8px rounded-8px bg-warning-soft text-warning text-12px">
        识别只支持 jpg、png、webp 图片，请换一张图
      </p>
      <RegionStage
        :url="source.url"
        :regions="regions"
        :mode="mode"
        :active-key="activeKey"
        :disabled="!supported"
        :number-of="numberOf"
        @draw="onDraw"
        @hover="activeKey = $event"
      />

      <h4 class="m-0 mt-14px mb-8px text-ink text-13px font-600">识别结果</h4>
      <RegionList
        v-if="regions.length"
        :regions="regions"
        :active-key="activeKey"
        :number-of="numberOf"
        @hover="activeKey = $event"
      />
      <p
        v-else
        class="m-0 px-10px py-14px rounded-8px border border-dashed border-line text-muted text-12px text-center"
      >
        在图片上点一下或框一块，识别那里的主体
      </p>
    </div>

    <footer class="shrink-0 flex flex-col gap-8px px-12px py-10px border-t border-t-solid border-line-soft">
      <span class="text-muted text-12px">识别不扣点数，每分钟最多 30 次</span>
      <button type="button" :class="ACTION_SUBMIT" :disabled="!doneCount" @click="emit('switch', 'edit')">
        用这些区域编辑图片{{ doneCount ? `（${doneCount} 个）` : '' }}
      </button>
    </footer>
  </div>
</template>
