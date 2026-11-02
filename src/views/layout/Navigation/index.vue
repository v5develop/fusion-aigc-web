<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router'
import { useUserInfoStore } from '@/stores/userInfo.ts'
import { storeToRefs } from 'pinia'

const router = useRouter() // 用来跳转
const route = useRoute() // 用来获取当前地址
const store = useUserInfoStore()
const { userInfo } = storeToRefs(store)

const VITE_OSS_ASSET_URL = import.meta.env.VITE_OSS_ASSET_URL

interface MenuItem {
  name: string
  path: string
  /** iconfont 类名（老入口） */
  icon?: string
  iconActive?: string
  /** 无现成 iconfont 的入口用内联 SVG path（active 态由 CSS 换色） */
  svg?: string
  /** 该项之上画一条分组细线 */
  divider?: boolean
}

const menuList: MenuItem[] = [
  { name: '首页', path: '/', icon: 'icon-ic_nav_home', iconActive: 'icon-ic_nav_home_full' },
  { name: '图片', path: '/picture', icon: 'icon-ic_nav_pic', iconActive: 'icon-ic_nav_pic_full' },
  { name: '视频', path: '/video', icon: 'icon-ic_nav_video', iconActive: 'icon-ic_nav_video_full' },
  { name: '电商', path: '/e-commerce', icon: 'icon-ic_nav_ds', iconActive: 'icon-ic_nav_ds_full' },
  // —— 以下没有现成 iconfont 图标，用内联 SVG（active 态由 CSS 换色）——
  { name: '商拍', path: '/studio', svg: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM9 3 7.2 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9z' },
  { name: '本地生活', path: '/local-life', svg: 'M4 4h16v2H4V4zm1 12v-8h14v8h-4v-6h-6v6H5zm2 0h4v-4H7v4zm12 2v-2H5v2H3v-2h2v-2h14v2h2v2h-2z' },
  { name: '资产', path: '/asset', icon: 'icon-ic_nav_asset', iconActive: 'icon-ic_nav_asset_full', divider: true },
  { name: '提示词库', path: '/prompt-library', svg: 'M18 22a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12zM6 4h5v9l-2.5-1.5L6 13V4z' },
  { name: '画布', path: '/canvas', svg: 'M3 3h8v10H3V3zm10 0h8v6h-8V3zM3 15h8v6H3v-6zm10-4h8v10h-8V11z' },
]

function handleRouterActive(path: string) {
  if (path === '/') {
    return route.path === '/'
  }
  return route.path.includes(path)
}
</script>

<template>
  <div class="container">
    <img class="logo" :src="VITE_OSS_ASSET_URL + 'logo.png'" alt="" />

    <div class="menu-content">
      <template v-for="item in menuList" :key="item.name">
        <div v-if="item.divider" class="group-divider"></div>
        <div
          class="item"
          :class="{ active: handleRouterActive(item.path) }"
          @click="router.push(item.path)"
        >
          <svg v-if="item.svg" viewBox="0 0 24 24" class="nav-svg"><path :d="item.svg" /></svg>
          <i v-else :class="handleRouterActive(item.path) ? item.iconActive : item.icon"></i>
          <span>{{ item.name }}</span>
        </div>
      </template>
    </div>

    <div class="bottom-content">
      <div class="beans-cont">
        <i class="icon-ic_hone_bean"></i>
        <span>{{ userInfo?.availablePoints }}</span>
      </div>

      <img v-if="userInfo?.avatar" :src="userInfo?.avatar" alt="" />
      <img
        v-else
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
  // 菜单项从 5 个涨到 9 个：矮视口下允许滚动，兜底不把金豆/头像挤出去
  > .menu-content {
    width: 100%;
    margin-top: 32px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 26px;
    overflow-y: auto;
    min-height: 0;
    // 菜单极少需要滚动，滚动条藏掉保持侧栏干净
    scrollbar-width: none;
    &::-webkit-scrollbar {
      display: none;
    }

    > .group-divider {
      width: 32px;
      height: 1px;
      background: #d9dde2;
    }

    > .item {
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      &:hover {
        > i,
        > .nav-svg {
          transform: scale(1.15);
        }
      }
      > i {
        font-size: 20px;
        transition: 0.2s;
      }
      > .nav-svg {
        width: 20px;
        height: 20px;
        fill: #666;
        transition: 0.2s;
      }
      > span {
        font-size: 12px;
        white-space: nowrap;
      }
      &.active > .nav-svg {
        fill: var(--main-color);
      }
      &.active > span {
        color: var(--main-color);
      }
    }
  }

  > .bottom-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0 5px;
    margin: auto 0 40px 0;
    > .beans-cont {
      display: flex;
      align-items: center;
      gap: 6px;
      word-break: break-all;
      > .icon-ic_hone_bean {
        flex-shrink: 0;
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
