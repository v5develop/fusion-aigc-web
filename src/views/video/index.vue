<script setup lang="ts">
/**
 * /video：左侧导航点进来是「AI 视频」导航首页；带生成页既有入口参数（容器深链 entryCode、
 * 做同款 sameStyleId/sameStyleSource）或从首页带入表单时，照旧打开通用生视频页。
 * 导航首页里的「视频生成」即指向 /video?entryCode=textToVideo。
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useHomeStore } from '@/stores/home'
import LandingPage from '@/views/picture/LandingPage.vue'
import { isGeneratorEntry, videoLanding } from '@/views/picture/landing'
import VideoGenerator from './VideoGenerator.vue'

const route = useRoute()
// 首页带入只在进场那一刻有效（生视频页 setup 会 reset 掉它），定格成常量，否则 reset 后会被切回导航首页
const fromHome = useHomeStore().global_formData.home
const showGenerator = computed(() => fromHome || isGeneratorEntry(route.query))
</script>

<template>
  <VideoGenerator v-if="showGenerator" />
  <LandingPage v-else :data="videoLanding" />
</template>
