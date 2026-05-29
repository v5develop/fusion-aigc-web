<script setup lang="ts">
import { RouterView } from 'vue-router'
import Navigation from './navigation/index.vue'
</script>

<template>
  <div class="layout">
    <div class="navigationContent">
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
  > .navigationContent {
    flex-shrink: 0;
    position: relative;
    z-index: 1;
  }
  > .container {
    flex: 1;
    background: #f5f6f8;
  }
}
</style>
