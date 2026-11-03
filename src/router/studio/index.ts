// 商拍工作室（Go 网关 /api/v1/studio）路由：hub 页 + 3 个工具页。
// 不进电商标签体系，普通路由直达；meta.title 填中文名，接线由集成者并入 src/router/index.ts
// 工具页路径段对齐原型工具 id（ai-digital-model / ai-posture-fission / image-generate）；
// 仍挂在 /studio 下：这三页是商拍工作室新做的功能，/tools/:toolId 同名工具页另有其页，不能被遮住。
// 旧路径（/studio/tryon、/studio/pose、/studio/imagegen）保留重定向，书签与站外深链照常可开。
export default [
  {
    path: '/studio',
    name: 'studio',
    component: () => import('@/views/studio/index.vue'),
  },
  {
    path: '/studio/ai-digital-model',
    name: 'studio-tryon',
    meta: { title: '商拍换装' },
    component: () => import('@/views/studio/tryon/index.vue'),
  },
  {
    path: '/studio/ai-posture-fission',
    name: 'studio-pose',
    meta: { title: '姿态复刻' },
    component: () => import('@/views/studio/pose/index.vue'),
  },
  {
    path: '/studio/image-generate',
    name: 'studio-imagegen',
    meta: { title: '图片生成' },
    component: () => import('@/views/studio/imagegen/index.vue'),
  },
  { path: '/studio/tryon', redirect: '/studio/ai-digital-model' },
  { path: '/studio/pose', redirect: '/studio/ai-posture-fission' },
  { path: '/studio/imagegen', redirect: '/studio/image-generate' },
]
