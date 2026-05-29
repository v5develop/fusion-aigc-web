import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: () => import('@/views/layout/index.vue'),
      children: [
        {
          path: '/',
          name: 'home',
          component: () => import('@/views/home/index.vue'),
        },
        {
          path: '/picture',
          name: 'picture',
          component: () => import('@/views/picture/index.vue'),
        },
        {
          path: '/video',
          name: 'video',
          component: () => import('@/views/video/index.vue'),
        },
        {
          path: '/e-commerce',
          name: 'e-commerce',
          component: () => import('@/views/e-commerce/index.vue'),
        },
        {
          path: '/asset',
          name: 'asset',
          component: () => import('@/views/asset/index.vue'),
        },
      ],
    },
  ],
})

export default router
