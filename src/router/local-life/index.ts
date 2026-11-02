// 本地生活（Go 网关 /api/v1/local-life）路由：hub 页 + 11 个功能页。
// 不进电商标签体系，普通路由直达；meta.title 供浏览器标签与后续面包屑使用
export default [
  {
    path: '/local-life',
    name: 'local-life',
    component: () => import('@/views/local-life/index.vue'),
  },
  {
    path: '/local-life/copywriting',
    name: 'local-life-copywriting',
    meta: { title: 'AI文案' },
    component: () => import('@/views/local-life/copywriting/index.vue'),
  },
  {
    path: '/local-life/shop-profile',
    name: 'local-life-shop-profile',
    meta: { title: '店铺档案' },
    component: () => import('@/views/local-life/shopProfile/index.vue'),
  },
  {
    path: '/local-life/digital-human',
    name: 'local-life-digital-human',
    meta: { title: 'AI数字人' },
    component: () => import('@/views/local-life/digitalHuman/index.vue'),
  },
  {
    path: '/local-life/note',
    name: 'local-life-note',
    meta: { title: '图文笔记' },
    component: () => import('@/views/local-life/note/index.vue'),
  },
  {
    path: '/local-life/poster',
    name: 'local-life-poster',
    meta: { title: 'AI海报' },
    component: () => import('@/views/local-life/poster/index.vue'),
    props: { kind: 'poster' },
  },
  {
    path: '/local-life/long-image',
    name: 'local-life-long-image',
    meta: { title: 'AI长图' },
    component: () => import('@/views/local-life/poster/index.vue'),
    props: { kind: 'longImage' },
  },
  {
    path: '/local-life/voiceover',
    name: 'local-life-voiceover',
    meta: { title: '数字人口播' },
    component: () => import('@/views/local-life/voiceover/index.vue'),
  },
  {
    path: '/local-life/action-transfer',
    name: 'local-life-action-transfer',
    meta: { title: '动作迁移' },
    component: () => import('@/views/local-life/actionTransfer/index.vue'),
  },
  {
    path: '/local-life/explore-shop',
    name: 'local-life-explore-shop',
    meta: { title: '探店视频' },
    component: () => import('@/views/local-life/videoCreation/index.vue'),
    props: { kind: 'exploreShop' },
  },
  {
    path: '/local-life/short-drama',
    name: 'local-life-short-drama',
    meta: { title: '带货短剧' },
    component: () => import('@/views/local-life/videoCreation/index.vue'),
    props: { kind: 'shortDrama' },
  },
  {
    path: '/local-life/video-remake',
    name: 'local-life-video-remake',
    meta: { title: '爆款视频复刻' },
    component: () => import('@/views/local-life/videoRemake/index.vue'),
  },
]
