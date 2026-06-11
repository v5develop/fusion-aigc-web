<script setup lang="ts">
const { title, rightDesc } = defineProps<{
  title: string
  rightDesc: string
}>()
</script>

<template>
  <div class="sample-cont">
    <div class="text-cont">
      <div class="title">{{ title }}</div>
      <div class="desc" v-html="rightDesc"></div>
    </div>

    <div class="sample">
      <img
        class="img"
        src="http://aigc-base-img.oss-cn-hangzhou.aliyuncs.com/fusion-aigc-web/e-commerce/merge-image-inset.webp"
        alt=""
      />
    </div>
  </div>
</template>

<style scoped lang="less">
.sample-cont {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  > .text-cont {
    text-align: center;
    margin-bottom: 48px;
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
    max-width: 770px;
    > .img {
      width: 100%;
      border-radius: 24px;
    }
  }
}
</style>
