<script setup lang="ts">
import { RouterView } from 'vue-router'
import Navigation from '@/views/layout/Navigation/index.vue'
</script>

<template>
  <div class="layout">
    <div class="navigation-content">
      <Navigation />
    </div>

    <div class="container">
      <RouterView />
    </div>
  </div>
</template>

<style scoped lang="less">
.layout {
  display: flex;

  > .navigation-content {
    flex-shrink: 0;
  }

  > .container {
    flex: 1;
    background: #f5f6f8;
    position: relative;
  }
}
</style>
