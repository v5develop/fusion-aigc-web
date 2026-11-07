<script setup lang="ts">
/**
 * #/local-life：「本地生活」导航首页，与 AI 图片 / AI 视频共用 LandingPage.vue，内容见 ../landingData.ts。
 * 原入口页（全案设计）移到 #/local-life/full-set。
 */
import LandingPage from '@/views/image/LandingPage.vue'
import { localLifeLanding } from '../landingData'

defineOptions({ name: 'local-life' })
</script>

<template>
  <LandingPage :data="localLifeLanding" />
</template>
