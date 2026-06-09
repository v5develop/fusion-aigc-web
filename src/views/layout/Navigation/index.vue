<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router'
import { ref, watch } from 'vue'

const router = useRouter() // 用来跳转
const route = useRoute() // 用来获取当前地址

const menuList = [
  { name: '首页', path: '/', icon: 'icon-ic_nav_home', iconActive: 'icon-ic_nav_home_full' },
  { name: '图片', path: '/picture', icon: 'icon-ic_nav_pic', iconActive: 'icon-ic_nav_pic_full' },
  { name: '视频', path: '/video', icon: 'icon-ic_nav_video', iconActive: 'icon-ic_nav_video_full' },
  { name: '电商', path: '/e-commerce', icon: 'icon-ic_nav_ds', iconActive: 'icon-ic_nav_ds_full' },
  { name: '资产', path: '/asset', icon: 'icon-ic_nav_asset', iconActive: 'icon-ic_nav_asset_full' },
]
const beansNum = ref(100)

function handleRouterActive(path: string) {
  if (path === '/') {
    return route.path === '/'
  }
  return route.path.includes(path)
}
</script>

<template>
  <div class="container">
    <div class="logo">logo</div>

    <div class="menu-content">
      <div class="item" v-for="item in menuList" :key="item.name" @click="router.push(item.path)">
        <i :class="handleRouterActive(item.path) ? item.iconActive : item.icon"></i>
        <span>{{ item.name }}</span>
      </div>
    </div>

    <div class="bottom-content">
      <div class="beans-cont">
        <i class="icon-ic_hone_bean"></i>
        <span>{{ beansNum }}</span>
      </div>
      <img
        src="https://feilianyun-aicdn.oss-cn-hangzhou.aliyuncs.com/permanent_client_upload/user/40179/ai_model/203441c5-2b04-4270-8014-282be543ec3d.jpg?x-oss-process=image/format,webp"
        alt=""
      />
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
  position: sticky;
  top: 0;
  > .logo {
    width: 40px;
    height: 40px;
    text-align: center;
    line-height: 40px;
    border-radius: 4px;
    margin-top: 40px;
    background: #eed0ff;
  }
  > .menu-content {
    width: 100%;
    margin-top: 49px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 36px;
    > .item {
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      cursor: pointer;
      &:hover {
        > i {
          transform: scale(1.15);
        }
      }
      > i {
        font-size: 20px;
        transition: 0.2s;
      }
    }
  }

  > .bottom-content {
    margin: auto 0 40px 0;
    > .beans-cont {
      display: flex;
      align-items: center;
      gap: 6px;
      >.icon-ic_hone_bean{
        color: var(--main-color);
      }
    }
    > img {
      width: 40px;
      height: 40px;
      object-fit: cover;
      border-radius: 50%;
      margin-top: 19px;
    }
  }
}
</style>
