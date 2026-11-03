// 工作流页路由：契约 14 个 wf:* 共用一个 schema 驱动的页面（见 views/workflow/schemas.ts）。
// query 形状与 v1.0 原型一致：/workflow?flow=fashion&category=model&template=模特替换。
// /workflow/home 是导航首页（侧栏「工作流」进这里）；/workflow 仍按 query 深链打开模板。
// 只导出数组，由 src/router/index.ts 挂到布局 children 下
export default [
  {
    path: '/workflow/home',
    name: 'workflow-home',
    meta: { title: '工作流' },
    component: () => import('@/views/workflow/home/index.vue'),
  },
  {
    path: '/workflow',
    name: 'workflow-workspace',
    meta: { title: '工作流' },
    component: () => import('@/views/workflow/index.vue'),
  },
]
