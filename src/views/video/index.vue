<script setup lang="ts">
/** /video：「AI 视频」导航首页（hero + 分组工具卡）。通用生视频页在 /video/generate。 */
import LandingPage from '@/views/image/LandingPage.vue'
import { videoLanding } from '@/views/image/landing'
</script>

<template>
  <LandingPage :data="videoLanding" />
</template>
