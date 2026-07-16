<script setup lang="ts">
const { title, rightDesc, image } = defineProps<{
  title: string
  rightDesc: string
  image?: string
}>()

const VITE_OSS_ASSET_URL = import.meta.env.VITE_OSS_ASSET_URL
</script>

<template>
  <div class="sample-cont">
    <div class="text-cont">
      <div class="title">{{ title }}</div>
      <div class="desc" v-html="rightDesc"></div>
    </div>

    <div class="sample">
      <img v-if="image" class="img" :src="VITE_OSS_ASSET_URL + image" alt="" />
      <slot></slot>
    </div>
  </div>
</template>

<style scoped lang="less">
@import '@/assets/variables.less';
.sample-cont {
  width: 100%;
  height: 100%;
  position: absolute;
  top: 0;
  left: 0;
  padding: 40px 48px;
  overflow: auto;
  .scrollbar(@width: 8px, @trackColor: #fff, @thumbColor: rgba(0, 0, 0, 0.1), @thumbWidth: 4px, @hoverColor: rgba(0, 0, 0, 0.35));
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 40px;
  > .text-cont {
    width: 770px;
    margin: 0 auto;
    text-align: center;
    > .title {
      font-size: 36px;
      font-weight: bold;
      color: #1f1f1f;
      margin-bottom: 8px;
    }
    > .desc {
      font-size: 16px;
      color: #8f8f8f;
    }
  }
  > .sample {
    width: 770px;
    margin: 0 auto;
    > .img {
      width: 100%;
      border-radius: 24px;
    }
  }
}
</style>
