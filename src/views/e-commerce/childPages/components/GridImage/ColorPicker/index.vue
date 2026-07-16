<script setup lang="ts">
import { computed, ref } from 'vue'

const { presets = [], selected = false, loading = false, display = '' } = defineProps<{
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
  <div class="color-picker">
    <!-- display-directive=show：弹框隐藏时仍保留 DOM，避免内嵌拾色器被卸载 -->
    <n-popover
      trigger="click"
      placement="bottom-start"
      :show-arrow="false"
      :show="showPanel"
      display-directive="show"
      @update:show="(v: boolean) => (showPanel = v)"
    >
      <template #trigger>
        <div class="trigger-area" :class="{ active: selected }" :style="triggerStyle">
          <i class="icon-ic_home_upload1"></i>
          <div class="color-label">颜色场景</div>
          <div v-if="loading" class="loading-mask"><n-spin :size="18" /></div>
        </div>
      </template>

      <!-- 自定义弹框：20 宫格预制图 + 「+自选」入口（临时排版，待弹框设计稿精修） -->
      <div class="scene-panel">
        <div class="preset-grid">
          <div class="preset-item" v-for="(url, i) in presets" :key="i" @click="onPreset(url)">
            <img :src="url" alt="" />
          </div>

          <n-color-picker
            v-model:value="customColor"
            :show-alpha="false"
            :actions="['confirm']"
            @confirm="onCustomConfirm"
          >
            <template #trigger="{ onClick }">
              <div class="custom-item" @click="onClick">
                <i class="icon-ic_home_upload1"></i>
                <span>自选</span>
              </div>
            </template>
          </n-color-picker>
        </div>
      </div>
    </n-popover>
  </div>
</template>

<style scoped lang="less">
.color-picker {
  // 与 GridImage 的 .item 一致，用 padding-bottom 撑正方形，避免依赖同行 item 的行高
  width: 100%;
  height: 0;
  padding-bottom: 100%;
  position: relative;

  .trigger-area {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border-radius: 8px;
    overflow: hidden;
    cursor: pointer;
    border: 2px solid transparent;
    background-color: #f5f6f8;
    &.active {
      border-color: var(--main-color);
    }
    .icon-ic_home_upload1 {
      position: absolute;
      left: 50%;
      top: 30%;
      transform: translateX(-50%);
      color: #fff;
      font-size: 20px;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    }
    .color-label {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 24px;
      background: rgba(0, 0, 0, 0.4);
      color: #fff;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .loading-mask {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.6);
    }
  }
}

.scene-panel {
  width: 320px;
  .preset-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 8px;
    .preset-item,
    .custom-item {
      position: relative;
      height: 0;
      padding-bottom: 100%;
      border-radius: 6px;
      overflow: hidden;
      cursor: pointer;
      border: 1px solid #ebebeb;
      > img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    }
    .custom-item {
      border: 1px dashed #d0d0d0;
      background: #f5f6f8;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #8f8f8f;
      > i {
        position: absolute;
        top: 26%;
        font-size: 16px;
      }
      > span {
        position: absolute;
        bottom: 18%;
        font-size: 11px;
      }
    }
  }
}
</style>
