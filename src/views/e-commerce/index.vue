<script setup lang="ts">
import Row from './Row/index.vue'
import { chuandaitu_data, shangpingshiping_data, shangpingtu_data } from './entries'

defineOptions({ name: 'e-commerce-home' })

const headAnim = 'animate-[motion-enter-up_200ms_cubic-bezier(0.4,0,0.2,1)_0ms_both]'
const sectionAnim = [
  'animate-[motion-enter-up_340ms_cubic-bezier(0.4,0,0.2,1)_80ms_both]',
  'animate-[motion-enter-up_280ms_cubic-bezier(0.4,0,0.2,1)_200ms_both]',
  'animate-[motion-enter-up_260ms_cubic-bezier(0.4,0,0.2,1)_320ms_both]',
]
const pageClass = [
  'pt-18px px-20px pb-20px',
  '[@media(min-height:960px)]:pt-20px [@media(min-height:960px)]:pb-24px',
  '[@media(min-height:761px)_and_(max-height:880px)]:pt-14px [@media(min-height:761px)_and_(max-height:880px)]:px-16px [@media(min-height:761px)_and_(max-height:880px)]:pb-16px',
  '[@media(max-height:760px)]:pt-10px [@media(max-height:760px)]:px-14px [@media(max-height:760px)]:pb-12px',
]
const deckGap =
  'gap-16px [@media(min-height:960px)]:gap-18px [@media(min-height:761px)_and_(max-height:880px)]:gap-10px [@media(max-height:760px)]:gap-8px'
</script>

<template>
  <div class="h-full overflow-y-auto box-border bg-page" :class="pageClass">
    <div class="max-w-1180px mx-auto w-full flex flex-col" :class="deckGap">
      <h1 class="m-0 text-24px font-600 leading-32px text-ink motion-reduce:animate-none" :class="headAnim">AI 电商</h1>
      <Row :data="shangpingtu_data" title="商品图" class="motion-reduce:animate-none" :class="sectionAnim[0]" />
      <Row :data="shangpingshiping_data" title="商品视频" class="motion-reduce:animate-none" :class="sectionAnim[1]" />
      <Row :data="chuandaitu_data" title="穿戴图" class="motion-reduce:animate-none" :class="sectionAnim[2]" />
    </div>
  </div>
</template>

<style>
/* 同名关键帧与 image/LandingPage.vue 一致（不 scoped，UnoCSS animate-[…] 只引用名字） */
@keyframes motion-enter-up {
  0% {
    opacity: 0;
    transform: translateX(-24px);
  }
  100% {
    opacity: 1;
    transform: none;
  }
}
</style>
