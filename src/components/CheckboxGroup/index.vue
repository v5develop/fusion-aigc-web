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

/**
 * 选项卡片（原型选中配方，规范 §4.1）：内边距 12、1px line、r8、白底；hover 描边 control + 短影；
 * 选中 violet-line + 白→#f8f3fc 渐变。标签 13/600/20，说明 11/17 muted。
 */
const itemCls =
  'group flex gap-8px p-12px box-border rounded-lg border border-solid cursor-pointer text-left outline-none ' +
  'transition-[border-color,background,box-shadow] duration-fast ease-sx motion-reduce:transition-none ' +
  'focus-visible:(outline outline-2 outline-solid outline-violet outline-offset-2)'
const isOn = (value: CheckboxItem['value']) => modelValue.value.includes(value)
const stateCls = (value: CheckboxItem['value']) =>
  isOn(value)
    ? 'border-violet-line sx-grad-tint shadow-[0_1px_2px_rgba(31,35,41,0.05)]'
    : 'border-line bg-white hover:(border-control shadow-[0_1px_2px_rgba(31,35,41,0.05)])'

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
  <div class="grid" :style="{ gridTemplateColumns: `repeat(${col}, minmax(0, 1fr))`, gap }">
    <div
      v-for="item in list"
      :key="item.value"
      role="checkbox"
      tabindex="0"
      :aria-checked="isOn(item.value)"
      :class="[itemCls, stateCls(item.value), vertical ? 'flex-col' : 'flex-row']"
      @click="toggle(item.value)"
      @keydown.self.enter.prevent="toggle(item.value)"
      @keydown.self.space.prevent="toggle(item.value)"
    >
      <i
        v-if="vertical"
        class="text-20px leading-none"
        :class="isOn(item.value) ? 'icon-ic_ds_check_sel text-violet' : 'icon-ic_ds_check_nor text-control'"
        aria-hidden="true"
      ></i>
      <div class="flex-1 min-w-0 flex flex-col justify-center gap-4px">
        <div class="text-13px font-600 leading-20px text-ink">{{ item.label }}</div>
        <div v-if="item.desc" class="text-11px leading-17px text-muted">{{ item.desc }}</div>
        <slot v-if="!vertical && item.slotName" :name="item.slotName"></slot>
      </div>
      <i
        v-if="!vertical"
        class="flex-none text-20px leading-none"
        :class="isOn(item.value) ? 'icon-ic_ds_check_sel text-violet' : 'icon-ic_ds_check_nor text-control'"
        aria-hidden="true"
      ></i>
    </div>
  </div>
</template>
