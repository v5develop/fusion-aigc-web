<script setup lang="ts">
import { computed, ref } from 'vue'

const {
  presets = [],
  selected = false,
  loading = false,
  display = '',
} = defineProps<{
  presets?: string[] // 20 个预制纯色背景图 URL
  selected?: boolean // 颜色场景是否为当前选中项
  loading?: boolean // 自选色生成/上传中
  display?: string // 触发块展示：http 开头按图片、否则按颜色
}>()

const emit = defineEmits<{
  'select-preset': [url: string]
  'select-custom': [hex: string]
}>()

// 弹框显隐、自选色
const showPanel = ref(false)
const customColor = ref('')

const isUrl = (v: string) => /^https?:\/\//.test(v)
// 触发块背景：优先展示当前所选（图片或颜色）
const triggerStyle = computed(() => {
  if (!display) return {}
  return isUrl(display)
    ? { backgroundImage: `url(${display})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { backgroundColor: display }
})

const onPreset = (url: string) => {
  emit('select-preset', url)
  showPanel.value = false
}
const onCustomConfirm = (hex: string) => {
  emit('select-custom', hex)
  showPanel.value = false
}
</script>

<template>
  <!-- 与 GridImage 的格子一致，用 padding-bottom 撑正方形，避免依赖同行格子的行高 -->
  <div class="relative w-full h-0 pb-[100%]">
    <!-- display-directive=show：弹框隐藏时仍保留 DOM，避免内嵌拾色器被卸载 -->
    <n-popover
      raw
      trigger="click"
      placement="bottom-start"
      :show-arrow="false"
      :show="showPanel"
      display-directive="show"
      @update:show="(v: boolean) => (showPanel = v)"
    >
      <template #trigger>
        <button
          type="button"
          class="absolute inset-0 w-full h-full p-0 overflow-hidden rounded-lg bg-surface3 border border-solid cursor-pointer transition-[border-color,box-shadow] duration-fast ease-sx motion-reduce:transition-none outline-none focus-visible:(border-violet shadow-focus)"
          :class="
            selected
              ? 'border-violet shadow-[0_0_0_1px_#875f9a]'
              : 'border-raised-line hover:(border-raised-hover shadow-raised)'
          "
          :style="triggerStyle"
          :aria-pressed="selected"
          :aria-expanded="showPanel"
          aria-haspopup="dialog"
          aria-label="颜色场景"
        >
          <i
            class="icon-ic_home_upload1 absolute left-1/2 top-[30%] -translate-x-1/2 text-20px text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.3)]"
            aria-hidden="true"
          ></i>
          <span
            class="absolute inset-x-0 bottom-0 flex items-center justify-center h-24px bg-black/40 text-11px text-white"
            >颜色场景</span
          >
          <span v-if="loading" class="absolute inset-0 flex items-center justify-center bg-white/60">
            <n-spin :size="18" />
          </span>
        </button>
      </template>

      <!-- 自定义弹框（sx-pop：line 描边、r10、shadow-pop，与触发块隔 8）：20 宫格预制图 + 「+自选」入口 -->
      <div class="my-8px w-320px p-12px box-border sx-pop" role="dialog" aria-label="选择颜色场景">
        <div class="grid grid-cols-5 gap-8px">
          <button
            v-for="(url, i) in presets"
            :key="i"
            type="button"
            class="relative h-0 pb-[100%] px-0 pt-0 overflow-hidden rounded-md border border-solid border-line bg-surface3 cursor-pointer hover:border-control-hover sx-focus"
            :aria-label="`预制背景 ${i + 1}`"
            @click="onPreset(url)"
          >
            <img class="absolute inset-0 w-full h-full object-cover" :src="url" alt="" />
          </button>

          <n-color-picker
            v-model:value="customColor"
            :show-alpha="false"
            :actions="['confirm']"
            @confirm="onCustomConfirm"
          >
            <template #trigger="{ onClick }">
              <button
                type="button"
                class="relative h-0 pb-[100%] px-0 pt-0 overflow-hidden rounded-md border border-dashed border-line-strong bg-surface2 text-muted cursor-pointer hover:(border-violet-line text-violet-ink) sx-focus"
                @click="onClick"
              >
                <i
                  class="icon-ic_home_upload1 absolute left-1/2 top-[26%] -translate-x-1/2 text-16px"
                  aria-hidden="true"
                ></i>
                <span class="absolute inset-x-0 bottom-[18%] text-11px leading-none">自选</span>
              </button>
            </template>
          </n-color-picker>
        </div>
      </div>
    </n-popover>
  </div>
</template>
