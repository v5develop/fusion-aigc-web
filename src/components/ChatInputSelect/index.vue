<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

interface IOption {
  label: string
  value: string | number
  icon?: string
}

const { options } = defineProps<{ options: IOption[] }>()
const value = defineModel<string | number>('value', { required: true })

const visible = ref(false)
const dropdownRef = ref<HTMLElement | null>(null)

// 当前选中项
const currentOption = computed(() => options.find((o) => o.value === value.value))

const toggle = () => {
  visible.value = !visible.value
}

const select = (option: IOption) => {
  value.value = option.value
  visible.value = false
}

// ============ 全局单例点击管理器 ============
type CloseFn = () => void
const instances: { el: HTMLElement; close: CloseFn }[] = []
let listenerRegistered = false

function globalClickHandler(e: MouseEvent) {
  const target = e.target as HTMLElement
  // 找到被点击的 .chat-select 容器
  const clickedContainer = target.closest('.chat-select') as HTMLElement | null

  // 遍历所有已注册的实例
  for (let i = instances.length - 1; i >= 0; i--) {
    const instance = instances[i]!
    // 如果点击的是当前实例自己的容器 → 不关闭
    if (clickedContainer === instance.el) continue
    // 否则关闭该实例的下拉
    instance.close()
  }
}

function registerInstance(el: HTMLElement, close: CloseFn) {
  instances.push({ el, close })
  if (!listenerRegistered) {
    document.addEventListener('click', globalClickHandler, true)
    listenerRegistered = true
  }
}

function unregisterInstance(el: HTMLElement) {
  const idx = instances.findIndex((i) => i.el === el)
  if (idx !== -1) instances.splice(idx, 1)
  if (instances.length === 0 && listenerRegistered) {
    document.removeEventListener('click', globalClickHandler, true)
    listenerRegistered = false
  }
}

// 注册/注销当前实例
onMounted(() => {
  if (dropdownRef.value) {
    registerInstance(dropdownRef.value, () => {
      visible.value = false
    })
  }
})

onUnmounted(() => {
  if (dropdownRef.value) {
    unregisterInstance(dropdownRef.value)
  }
})
</script>

<template>
  <div ref="dropdownRef" class="chat-select">
    <div class="trigger" @click="toggle">
      <i v-if="currentOption?.icon" :class="currentOption.icon" class="trigger-icon"></i>
      <span class="label">{{ currentOption?.label || '请选择' }}</span>
      <svg
        class="arrow"
        :class="{ open: visible }"
        width="18"
        height="18"
        viewBox="0 0 12 12"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M3 4.5L6 7.5L9 4.5"
          stroke="rgba(0,0,0,0.25)"
          stroke-width=".8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>

    <Transition name="slide-fade">
      <ul v-show="visible" class="dropdown">
        <li
          v-for="option in options"
          :key="option.value"
          class="option"
          :class="{ active: value === option.value }"
          @click.stop="select(option)"
        >
          <i v-if="option.icon" :class="option.icon"></i>
          <span>{{ option.label }}</span>
        </li>
      </ul>
    </Transition>
  </div>
</template>

<style scoped lang="less">
.chat-select {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;

  .trigger {
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    user-select: none;

    .trigger-icon {
      font-size: 18px;
      color: #3a3a3a;
    }

    .label {
      font-size: 14px;
      color: #3a3a3a;
      line-height: 20px;
      white-space: nowrap;
    }

    .arrow {
      flex-shrink: 0;
      transition: transform 0.2s ease;

      &.open {
        transform: rotate(180deg);
      }
    }
  }

  .dropdown {
    position: absolute;
    top: calc(100% + 2px);
    left: -8px;
    min-width: calc(100% + 16px);
    margin: 0;
    padding: 4px;
    list-style: none;
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
    display: flex;
    flex-direction: column;
    z-index: 1000;

    .option {
      padding: 8px 16px;
      font-size: 14px;
      color: #3a3a3a;
      border-radius: 2px;
      cursor: pointer;
      white-space: nowrap;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s ease;

      &:hover {
        background: #f5f5f5;
      }

      &.active {
        color: #8e66f9;
        background: #f5f0ff;
      }
    }
  }
}

// 下拉动画
.slide-fade-enter-active {
  transition: all 0.2s ease-out;
}
.slide-fade-leave-active {
  transition: all 0.15s ease-in;
}
.slide-fade-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
.slide-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
