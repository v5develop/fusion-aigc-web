<script setup lang="ts">
interface CheckboxItem {
  label: string
  value: string | number
  desc?: string
  [propName: string]: any
}

interface IProps {
  list: CheckboxItem[]
  col?: number
  gap?: string
  vertical?: boolean // 是否垂直排列，默认否
  customHandle?: (value: any) => void // 自定义点击处理
}

const { list, col = 2, gap = '8px', vertical = false, customHandle } = defineProps<IProps>()
const modelValue = defineModel<(string | number)[]>('modelValue', { required: true })

function toggle(value: CheckboxItem['value']) {
  if (customHandle) {
    customHandle(value)
    return
  }
  const index = modelValue.value.indexOf(value)
  if (index > -1) {
    modelValue.value.splice(index, 1)
  } else {
    modelValue.value.push(value)
  }
}
</script>

<template>
  <div class="container" :style="{ '--col': col, '--gap': gap }">
    <template v-if="vertical">
      <div v-for="item in list" :key="item.value" class="checkbox-item" @click="toggle(item.value)">
        <div class="checkbox-wrap">
          <i :class="modelValue.includes(item.value) ? 'icon-ic_ds_check_sel' : 'icon-ic_ds_check_nor'"></i>
        </div>
        <div class="content">
          <div class="label">{{ item.label }}</div>
          <div v-if="item.desc" class="desc">{{ item.desc }}</div>
        </div>
      </div>
    </template>

    <template v-else>
      <div v-for="item in list" :key="item.value" class="checkbox-item horizontal" @click="toggle(item.value)">
        <div class="content">
          <div class="label">{{ item.label }}</div>
          <div v-if="item.desc" class="desc">{{ item.desc }}</div>
          <slot v-if="item.slotName" :name="item.slotName"></slot>
        </div>
        <div class="checkbox-wrap">
          <i :class="modelValue.includes(item.value) ? 'icon-ic_ds_check_sel' : 'icon-ic_ds_check_nor'"></i>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped lang="less">
.container {
  display: grid;
  grid-template-columns: repeat(var(--col), 1fr);
  gap: var(--gap);
}

.checkbox-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px;
  background: #ffffff;
  border: 1px solid #f0f0f0;
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.3s ease;
  &.horizontal {
    flex-direction: row;
    //align-items: center;
  }
  &:hover {
    background: #fafafa;
  }

  .checkbox-wrap {
    > .icon-ic_ds_check_sel,
    > .icon-ic_ds_check_nor {
      font-size: 20px;
    }
  }

  .content {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
    .label {
      font-size: 14px;
      font-weight: 600;
      color: #333333;
    }

    .desc {
      font-size: 12px;
      color: #999999;
      line-height: 1.5;
    }
  }
}
</style>
