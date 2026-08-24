<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useEcTabsStore } from '@/stores/e-commerce/tabs'

const route = useRoute()
const router = useRouter()
const tabsStore = useEcTabsStore()
const { tabs, runningMap } = storeToRefs(tabsStore)

// 首页不在 tabs 里（它不进缓存也不可关闭），标签条上单独渲染为固定首项
const isHomeActive = computed(() => route.name === 'e-commerce')

const close = (name: string) => {
  const next = tabsStore.closeTab(name)
  // 关的不是当前标签就不用动路由，停在原地
  if (route.name !== name) return
  router.push(next ? { name: next.name } : { name: 'e-commerce' })
}
</script>

<template>
  <div class="ec-tabs">
    <div class="tab" :class="{ active: isHomeActive }" @click="router.push({ name: 'e-commerce' })">
      <span class="label">电商首页</span>
    </div>

    <div
      v-for="tab in tabs"
      :key="tab.name"
      class="tab closable"
      :class="{ active: route.name === tab.name }"
      @click="router.push({ name: tab.name })"
    >
      <!-- 后台标签仍在轮询，用小圆点把「还在跑」透出来，这是多标签的主要价值 -->
      <i v-if="runningMap[tab.name]" class="running-dot"></i>
      <span class="label">{{ tab.title }}</span>
      <span class="close-btn" @click.stop="close(tab.name)">&times;</span>
    </div>
  </div>
</template>

<style scoped lang="less">
.ec-tabs {
  // 与 layout 的 .container 同底色：sticky 吸顶时下方内容不能从背后透出来
  background: #f5f6f8;
  height: 48px;
  flex-shrink: 0;
  padding: 0 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  overflow-y: hidden;
  // 电商首页是长页面、走 body 滚动，标签条必须吸顶才不会被滚走
  position: sticky;
  top: 0;
  z-index: 10;

  // 标签多了横向滚动，但不要为此撑出一条滚动条占掉高度
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }

  > .tab {
    flex-shrink: 0;
    height: 32px;
    // 胶囊造型，刻意区别于宿主客户端顶部的方形浏览器标签，避免看成两条同类标签栏
    border-radius: 16px;
    padding: 0 14px;
    display: flex;
    align-items: center;
    gap: 6px;
    background: #fff;
    color: #666;
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
    user-select: none;
    transition: 0.2s;
    max-width: 180px;

    &:hover {
      color: #1f1f1f;
    }

    &.active {
      background: var(--main-color);
      color: #fff;
    }

    &.closable {
      padding-right: 8px;
    }

    > .label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    > .running-dot {
      flex-shrink: 0;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--main-color);
      animation: ec-tab-pulse 1.2s ease-in-out infinite;
    }

    &.active > .running-dot {
      background: #fff;
    }

    > .close-btn {
      flex-shrink: 0;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      opacity: 0.5;
      transition: 0.2s;
      &:hover {
        opacity: 1;
        background: rgba(0, 0, 0, 0.08);
      }
    }

    &.active > .close-btn:hover {
      background: rgba(255, 255, 255, 0.25);
    }
  }
}

@keyframes ec-tab-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.25;
  }
}
</style>
