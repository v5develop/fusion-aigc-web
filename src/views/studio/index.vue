<script setup lang="ts">
/**
 * 商拍工作室入口页：三个工具的卡片矩阵。
 * 卡片行直接复用本地生活的 Row 组件（data 传 studio 三项），主题同用 llTheme。
 */
import { NConfigProvider } from 'naive-ui'
import { llTheme } from '@/views/local-life/theme.ts'
import Row from '@/views/local-life/components/Row/index.vue'

const tools = [
  { title: '商拍换装', desc: '服装 + 模特整批试穿，批量出商拍大片', path: '/studio/tryon', emoji: '👗' },
  { title: '姿态复刻', desc: '一张人物图 + 姿势参考，同款姿态批量复刻', path: '/studio/pose', emoji: '🤸' },
  { title: '图片生成', desc: '提示词 + 参考图，文生图 / 图生图一次多张', path: '/studio/imagegen', emoji: '🎨' },
]
</script>

<template>
  <n-config-provider :theme-overrides="llTheme" abstract>
    <div class="px-48px py-40px bg-page min-h-full">
      <Row :data="tools" title="商拍工作室" />
    </div>
  </n-config-provider>
</template>
