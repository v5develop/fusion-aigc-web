// 任务中心（Java /api/v1/creation/task-center/*）：普通路由直达，不进电商标签体系；meta.title 供浏览器标签使用。
export default [
  {
    path: '/tasks',
    name: 'task-center',
    meta: { title: '任务中心' },
    component: () => import('@/views/task-center/index.vue'),
  },
]
