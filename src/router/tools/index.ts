// 工具页路由：提示词库、画布管理、工具箱共用工具页。
// 只导出数组，由集成者挂到 src/router/index.ts 的布局 children 下，本文件不自行注册
export default [
  {
    path: '/prompt-library',
    name: 'prompt-library',
    meta: { title: '提示词库' },
    component: () => import('@/views/prompt-library/index.vue'),
  },
  {
    path: '/canvas',
    name: 'canvas',
    meta: { title: '画布' },
    component: () => import('@/views/canvas/index.vue'),
  },
  {
    // 节点编辑器：全屏页（编辑器自身带顶栏，不套管理页内容壳）
    path: '/canvas/:id',
    name: 'canvas-editor',
    meta: { title: '画布编辑器' },
    component: () => import('@/views/canvas/editor/index.vue'),
  },
  {
    // 工具箱 12 个工具共用一个 schema 驱动的页面；toolId = 首页卡片 id（见 views/tools/schemas.ts）
    path: '/tools/:toolId',
    name: 'tool-workspace',
    meta: { title: '工具' },
    component: () => import('@/views/tools/index.vue'),
  },
]
