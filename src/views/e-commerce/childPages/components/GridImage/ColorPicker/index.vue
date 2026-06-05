<script setup lang="ts">
const { selected } = defineProps<{
  selected: boolean // 是否选中，选中加上border想过
}>()
const color = defineModel<string>('color', { required: true })

</script>

<template>
  <div class="color-picker">
    <n-color-picker v-model:value="color">
      <template #trigger="{ value, onClick, ref: triggerRef }">
        <div
          class="trigger-area"
          :class="selected ? 'active' : ''"
          :ref="triggerRef"
          :style="{ backgroundColor: value || color }"
          @click="onClick"
        >
          <i class="icon-ic_home_upload1"></i>
          <div class="color-label">颜色场景</div>
        </div>
      </template>
    </n-color-picker>
  </div>
</template>

<style scoped lang="less">
.color-picker {
  width: 100%;
  height: 100%;

  :deep(.n-color-picker) {
    width: 100%;
    height: 100%;

    .n-color-picker-trigger {
      width: 100%;
      height: 100%;
      border: none;
      padding: 0;
    }
  }

  .trigger-area {
    width: 100%;
    height: 100%;
    border-radius: 8px;
    overflow: hidden;
    position: relative;
    cursor: pointer;
    border: 2px solid transparent;
    &.active {
      border-color: var(--main-color);
    }
    .icon-ic_home_upload1 {
      position: absolute;
      left: 50%;
      top: 20%;
      transform: translateX(-50%);
      color: white;
      font-size: 20px;
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
  }
}
</style>
