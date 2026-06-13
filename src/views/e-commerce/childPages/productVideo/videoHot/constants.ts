const VITE_OSS_ASSET_URL = import.meta.env.VITE_OSS_ASSET_URL

export const videoList = [
  {
    title: 'UGC 种草',
    desc: '用户视角真实分享体验',
    url: VITE_OSS_ASSET_URL + 'e-commerce/video/video-hot1.mp4',
    loaded: false,
  },
  {
    title: '带货短剧',
    desc: '短剧带货情节植入',
    url: VITE_OSS_ASSET_URL + 'e-commerce/video/video-hot2.mp4',
    loaded: false,
  },
  {
    title: '产品口播',
    desc: '面对镜头讲解产品卖点',
    url: VITE_OSS_ASSET_URL + 'e-commerce/video/video-hot3.mp4',
    loaded: false,
  },
  {
    title: '产品演示',
    desc: '多角度展示 + 使用演示',
    url: VITE_OSS_ASSET_URL + 'e-commerce/video/video-hot4.mp4',
    loaded: false,
  },
  {
    title: '开箱种草',
    desc: '第一视角拆包惊喜体验',
    url: VITE_OSS_ASSET_URL + 'e-commerce/video/video-hot5.mp4',
    loaded: false,
  },
  {
    title: '痛点解决',
    desc: '痛点场景 → 产品解决',
    url: VITE_OSS_ASSET_URL + 'e-commerce/video/video-hot6.mp4',
    loaded: false,
  },
  {
    title: '反应展示',
    desc: '首次使用惊喜反应',
    url: VITE_OSS_ASSET_URL + 'e-commerce/video/video-hot7.mp4',
    loaded: false,
  },
  {
    title: 'TVC 广告',
    desc: '品牌广告片质感',
    url: VITE_OSS_ASSET_URL + 'e-commerce/video/video-hot8.mp4',
    loaded: false,
  },
]

export const checkboxOps = [
  {
    label: 'UGG 种草',
    value: 'ugc_product_seeding_video',
    desc: '用户视角真实分享体验/TikTok-Reels高转化',
  },
  {
    label: '带货短剧',
    value: 'ecommerce_drama_short',
    desc: '卖点框输入：古装、现代、家庭、搞笑',
  },
  {
    label: '产品演示',
    value: 'product_demo',
    desc: '多角度展示+使用演示/通用',
  },
  {
    label: '产品口播',
    value: 'product_voiceover',
    desc: '面对镜头讲解产品产品卖点/社媒投放首选',
  },
  {
    label: 'TVC广告',
    value: 'tvc_ad',
    desc: '品牌广告片质感/高级产品展示',
  },
  {
    label: '开箱种草',
    value: 'unboxing_product_seeding_video',
    desc: '第一视角拆包惊喜体验/新品礼盒类',
  },
  {
    label: '痛点解决',
    value: 'pain_point_solution',
    desc: '痛点场景→产品解决/功能型产品',
  },
  {
    label: '反应展示',
    value: 'reaction_showcase',
    desc: '首次使用惊喜反应/美妆食品科技',
  },
]
