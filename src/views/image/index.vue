<script setup lang="ts">
/** /image：「AI 图片」导航首页（hero + 分组工具卡）。通用生图页在 /image/generate。 */
import LandingPage from './LandingPage.vue'
import { pictureLanding } from './landing'
</script>

<template>
  <LandingPage :data="pictureLanding" />
</template>
