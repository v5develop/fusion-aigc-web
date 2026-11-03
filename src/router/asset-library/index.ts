// 资产库增强（Go 网关 /api/v1/asset-library）路由。
// 与 local-life 同款：普通路由直达，不进电商标签体系；meta.title 供浏览器标签使用。
// 挂载（并入 src/router/index.ts 的 layout children）由集成者负责。
// 路径对齐原型「资产」#/assets；旧路径 /asset-library 重定向过来，书签照常可开。
// 路由名仍叫 asset-library：页面 defineOptions 同名，keep-alive / 命名跳转都按它认。
export default [
  {
    path: '/assets',
    name: 'asset-library',
    meta: { title: '资产库增强' },
    component: () => import('@/views/asset-library/index.vue'),
  },
  { path: '/asset-library', redirect: '/assets' },
]
