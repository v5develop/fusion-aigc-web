import { createRouter, createWebHistory,createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
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
          path: '/e-commerce/product-detail',
          name: 'product-detail',
          component: () => import('@/views/e-commerce/childPages/productDetail/index.vue'),
        },
        {
          path: '/e-commerce/product-kit',
          name: 'product-kit',
          component: () => import('@/views/e-commerce/childPages/productKit/index.vue'),
        },
        {
          path: '/e-commerce/product-clone',
          name: 'product-clone',
          component: () => import('@/views/e-commerce/childPages/productClone/index.vue'),
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
