// 商拍工作室（Go 网关 /api/v1/studio）路由：hub 页 + 3 个工具页。
// 不进电商标签体系，普通路由直达；meta.title 填中文名，接线由集成者并入 src/router/index.ts
export default [
  {
    path: '/studio',
    name: 'studio',
    component: () => import('@/views/studio/index.vue'),
  },
  {
    path: '/studio/tryon',
    name: 'studio-tryon',
    meta: { title: '商拍换装' },
    component: () => import('@/views/studio/tryon/index.vue'),
  },
  {
    path: '/studio/pose',
    name: 'studio-pose',
    meta: { title: '姿态复刻' },
    component: () => import('@/views/studio/pose/index.vue'),
  },
  {
    path: '/studio/imagegen',
    name: 'studio-imagegen',
    meta: { title: '图片生成' },
    component: () => import('@/views/studio/imagegen/index.vue'),
  },
]
