<script setup lang="ts">
/** 本地生活功能矩阵入口页 */
import { NConfigProvider } from 'naive-ui'
import { llTheme } from './theme.ts'
import Row from './components/Row/index.vue'

const copyRow = [
  { title: 'AI文案', desc: 'AI帮写、爆款仿写，商品文案一键成稿', path: '/local-life/copywriting', emoji: '✍️' },
  { title: '店铺档案', desc: '店铺信息一次录入，各创作模块共用', path: '/local-life/shop-profile', emoji: '🏪' },
]

const dhRow = [
  { title: 'AI数字人', desc: '形象 + 音色 + 文案，生成口播数字人视频', path: '/local-life/digital-human', emoji: '🧑‍💼' },
  { title: '数字人口播', desc: '一段文案一张脸，快速产出播报视频', path: '/local-life/voiceover', emoji: '🎙️' },
]

const mediaRow = [
  { title: '图文笔记', desc: '构思 → 规划 → 出图，小红书图文一条龙', path: '/local-life/note', emoji: '📒' },
  { title: 'AI海报', desc: '模板 + 海报信息，批量生成节日营销海报', path: '/local-life/poster', emoji: '🖼️' },
  { title: 'AI长图', desc: '商品与卖点，生成分段引导长图', path: '/local-life/long-image', emoji: '📜' },
  { title: '动作迁移', desc: '把动作视频的肢体迁移给指定人物', path: '/local-life/action-transfer', emoji: '🕺' },
]

const videoRow = [
  { title: '探店视频', desc: '文案 + 门店实拍，生成分镜探店大片', path: '/local-life/explore-shop', emoji: '🍜' },
  { title: '带货短剧', desc: '主题 + 商品图，剧情带货短剧自动成片', path: '/local-life/short-drama', emoji: '🎬' },
  { title: '爆款视频复刻', desc: '粘贴爆款链接，解析分镜同款复刻', path: '/local-life/video-remake', emoji: '🔥' },
]
</script>

<template>
  <n-config-provider :theme-overrides="llTheme" abstract>
    <div class="local-life">
      <Row :data="copyRow" title="文案与档案" />
      <Row style="margin-top: 32px" :data="dhRow" title="数字人" />
      <Row style="margin-top: 32px" :data="mediaRow" title="图文与海报" />
      <Row style="margin-top: 32px" :data="videoRow" title="视频创作" />
    </div>
  </n-config-provider>
</template>

<style scoped lang="less">
.local-life {
  padding: 40px 48px;
  background: #f5f6f7;
  min-height: 100%;
}
</style>
