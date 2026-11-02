// 资产库增强（Go 网关 /api/v1/asset-library）路由。
// 与 local-life 同款：普通路由直达，不进电商标签体系；meta.title 供浏览器标签使用。
// 挂载（并入 src/router/index.ts 的 layout children）由集成者负责。
export default [
  {
    path: '/asset-library',
    name: 'asset-library',
    meta: { title: '资产库增强' },
    component: () => import('@/views/asset-library/index.vue'),
  },
]
