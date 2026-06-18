export default [
  {
    path: '/e-commerce',
    name: 'e-commerce',
    component: () => import('@/views/e-commerce/index.vue'),
  },
  {
    path: '/e-commerce/product-detail',
    name: 'product-detail',
    component: () => import('@/views/e-commerce/childPages/productImage/productDetail/index.vue'),
  },
  {
    path: '/e-commerce/product-kit',
    name: 'product-kit',
    component: () => import('@/views/e-commerce/childPages/productImage/productKit/index.vue'),
  },
  {
    path: '/e-commerce/product-clone',
    name: 'product-clone',
    component: () => import('@/views/e-commerce/childPages/productImage/productClone/index.vue'),
  },
  {
    path: '/e-commerce/product-in-hand',
    name: 'product-in-hand',
    component: () => import('@/views/e-commerce/childPages/productImage/productInHand/index.vue'),
  },
  {
    path: '/e-commerce/video-clone',
    name: 'video-clone',
    component: () => import('@/views/e-commerce/childPages/productVideo/videoClone/index.vue'),
  },
  {
    path: '/e-commerce/video-hot',
    name: 'video-hot',
    component: () => import('@/views/e-commerce/childPages/productVideo/videoHot/index.vue'),
  },
  {
    path: '/e-commerce/model-replace',
    name: 'model-replace',
    component: () => import('@/views/e-commerce/childPages/productVideo/modelReplace/index.vue'),
  },
  {
    path: '/e-commerce/product-replace',
    name: 'product-replace',
    component: () => import('@/views/e-commerce/childPages/productVideo/productReplace/index.vue'),
  },
  {
    path: '/e-commerce/change-background',
    name: 'change-background',
    component: () => import('@/views/e-commerce/childPages/clothing/changeBackground/index.vue'),
  },
  {
    path: '/e-commerce/clothing-kit',
    name: 'clothing-kit',
    component: () => import('@/views/e-commerce/childPages/clothing/clothingKit/index.vue'),
  },
  {
    path: '/e-commerce/clothing-try',
    name: 'clothing-try',
    component: () => import('@/views/e-commerce/childPages/clothing/clothingTry/index.vue'),
  },
  {
    path: '/e-commerce/clothing-remove-wrinkle',
    name: 'clothing-remove-wrinkle',
    component: () => import('@/views/e-commerce/childPages/clothing/clothingRemoveWrinkle/index.vue'),
  },
  {
    path: '/e-commerce/merge-image',
    name: 'merge-image',
    component: () => import('@/views/e-commerce/childPages/clothing/mergeImage/index.vue'),
  },
  {
    path: '/e-commerce/try-shoe',
    name: 'try-shoe',
    component: () => import('@/views/e-commerce/childPages/clothing/tryShoe/index.vue'),
  },
]
