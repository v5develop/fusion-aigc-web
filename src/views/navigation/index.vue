<script setup lang="ts">
const menuList = [
  { name: '首页', icon: '' },
  { name: '图片', icon: '' },
  { name: '视频', icon: '' },
  { name: '电商', icon: '' },
  { name: '资产', icon: '' },
]
</script>

<template>
  <div class="container">
    <div class="logo">logo</div>

    <div class="menuContent">
      <div class="item" v-for="item in menuList" :key="item.name">
        <span>{{ item.icon }}</span>
        <span>{{ item.name }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.container {
  width: 80px;
  height: 100vh;
  background: #edeff5;
  display: flex;
  flex-direction: column;
  align-items: center;
  > .logo {
    width: 40px;
    height: 40px;
    text-align: center;
    line-height: 40px;
    border-radius: 4px;
    margin-top: 40px;
    background: #eed0ff;
  }
  > .menuContent {
    margin-top: 49px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 36px;
  }
}
</style>
