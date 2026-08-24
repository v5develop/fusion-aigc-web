// meta.title 是标签条上标签名的唯一来源：URL 直达（刷新、容器初始地址）时也能拿到标题。
// 文案与 src/views/e-commerce/index.vue 里的入口卡片保持一致。
export default [
  {
    path: '/e-commerce',
    name: 'e-commerce',
    component: () => import('@/views/e-commerce/index.vue'),
  },
  {
    path: '/e-commerce/product-detail',
    name: 'product-detail',
    meta: { title: 'AI详情页' },
    component: () => import('@/views/e-commerce/childPages/productImage/productDetail/index.vue'),
  },
  {
    path: '/e-commerce/product-kit',
    name: 'product-kit',
    meta: { title: 'AI商品套图' },
    component: () => import('@/views/e-commerce/childPages/productImage/productKit/index.vue'),
  },
  {
    path: '/e-commerce/product-clone',
    name: 'product-clone',
    meta: { title: '爆款图复刻' },
    component: () => import('@/views/e-commerce/childPages/productImage/productClone/index.vue'),
  },
  {
    path: '/e-commerce/product-in-hand',
    name: 'product-in-hand',
    meta: { title: '手持商品' },
    component: () => import('@/views/e-commerce/childPages/productImage/productInHand/index.vue'),
  },
  {
    path: '/e-commerce/video-clone',
    name: 'video-clone',
    meta: { title: '视频复刻' },
    component: () => import('@/views/e-commerce/childPages/productVideo/videoClone/index.vue'),
  },
  {
    path: '/e-commerce/video-hot',
    name: 'video-hot',
    meta: { title: '爆款视频' },
    component: () => import('@/views/e-commerce/childPages/productVideo/videoHot/index.vue'),
  },
  {
    path: '/e-commerce/model-replace',
    name: 'model-replace',
    meta: { title: '模特替换' },
    component: () => import('@/views/e-commerce/childPages/productVideo/modelReplace/index.vue'),
  },
  {
    path: '/e-commerce/product-replace',
    name: 'product-replace',
    meta: { title: '商品替换' },
    component: () => import('@/views/e-commerce/childPages/productVideo/productReplace/index.vue'),
  },
  {
    path: '/e-commerce/change-background',
    name: 'change-background',
    meta: { title: '人像换背景' },
    component: () => import('@/views/e-commerce/childPages/clothing/changeBackground/index.vue'),
  },
  {
    path: '/e-commerce/clothing-kit',
    name: 'clothing-kit',
    meta: { title: 'AI穿戴套图' },
    component: () => import('@/views/e-commerce/childPages/clothing/clothingKit/index.vue'),
  },
  {
    path: '/e-commerce/clothing-try',
    name: 'clothing-try',
    meta: { title: 'AI试衣' },
    component: () => import('@/views/e-commerce/childPages/clothing/clothingTry/index.vue'),
  },
  {
    path: '/e-commerce/clothing-remove-wrinkle',
    name: 'clothing-remove-wrinkle',
    meta: { title: '服装去皱' },
    component: () => import('@/views/e-commerce/childPages/clothing/clothingRemoveWrinkle/index.vue'),
  },
  {
    path: '/e-commerce/merge-image',
    name: 'merge-image',
    meta: { title: '搭配融图' },
    component: () => import('@/views/e-commerce/childPages/clothing/mergeImage/index.vue'),
  },
  {
    path: '/e-commerce/try-shoe',
    name: 'try-shoe',
    meta: { title: 'AI试鞋' },
    component: () => import('@/views/e-commerce/childPages/clothing/tryShoe/index.vue'),
  },
]
