/**
 * 「本地生活」导航首页（#/local-life）的内容表，交给 views/image/LandingPage.vue 渲染，版式与 AI 图片 / AI 视频落地页一致。
 *
 * <p>本地生活没有原型：三张 banner 是我们按已有功能自拟的（门店全案 / 店铺档案 / AI文案），不是原型内容；
 * banner 右侧占位渐变与 AI 图片落地页同值（见 LandingPage.vue photoTint）。
 * 分组：与 banner 重复的三项（门店全案 / 店铺档案 / AI文案）不进分组，
 * 分组是本地生活路由（router/local-life）里的单项工具，分组名、名称与说明照原入口页「单项工具」区的原文。
 * 图标是按功能意思画的近似件（24×24、单色 currentColor）。
 */
import type { LandingPageData, LandingSection, LandingTool } from '@/views/image/landing'

export const FULL_SET_ROUTE = '/local-life/full-set'

const ICONS = {
  store: `
    <path d="M3.4 9.2 4.8 4.2h14.4l1.4 5"/>
    <path d="M3.4 9.2a2.9 2.9 0 0 0 5.8 0 2.9 2.9 0 0 0 5.6 0 2.9 2.9 0 0 0 5.8 0"/>
    <path d="M4.8 12.4v7.4h14.4v-7.4"/>
    <path d="M9.8 19.8v-4.4h4.4v4.4"/>`,
  copywriting: `
    <path d="M14.6 3.6H6.4a1.6 1.6 0 0 0-1.6 1.6v13.6a1.6 1.6 0 0 0 1.6 1.6h11.2a1.6 1.6 0 0 0 1.6-1.6V8.2z"/>
    <path d="M14.6 3.6v4.6h4.6M8.4 12.4h7.2M8.4 16h4.4"/>`,
  shopProfile: `
    <rect x="3.6" y="5" width="16.8" height="14" rx="2"/>
    <circle cx="9" cy="11" r="2.2"/>
    <path d="M5.8 16.4c.6-1.8 1.7-2.8 3.2-2.8s2.6 1 3.2 2.8M14.4 10h3.2M14.4 13.4h3.2"/>`,
  digitalHuman: `
    <circle cx="12" cy="8" r="3.6"/>
    <path d="M4.8 20c.8-4 3.6-6.2 7.2-6.2s6.4 2.2 7.2 6.2"/>
    <path d="M17.6 3.6l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/>`,
  voiceover: `
    <rect x="9" y="3.4" width="6" height="10.4" rx="3"/>
    <path d="M5.8 11.2a6.2 6.2 0 0 0 12.4 0M12 17.4v3.2M8.8 20.6h6.4"/>`,
  note: `
    <rect x="4" y="3.6" width="16" height="16.8" rx="2"/>
    <path d="M4 14.4l4.2-4.2 3.4 3.4 2.2-2.2L20 17.6"/>
    <circle cx="15.4" cy="8" r="1.4"/>`,
  poster: `
    <rect x="5" y="3.4" width="14" height="17.2" rx="1.8"/>
    <path d="M8.4 7.6h7.2M8.4 10.6h4.4"/>
    <path d="M5 16.4l3.6-3 3 2.4 2.4-1.8 5 3.6"/>`,
  longImage: `
    <rect x="7" y="2.8" width="10" height="18.4" rx="1.8"/>
    <path d="M7 8.6h10M7 14.4h10"/>`,
  actionTransfer: `
    <circle cx="7.6" cy="5" r="1.8"/>
    <path d="M7.6 7.6v5.2l-2.2 5.6M7.6 12.8l2.4 5.6M4.6 10.2h6"/>
    <path d="M13.4 12h6.4M17.4 9.4l2.4 2.6-2.4 2.6"/>`,
  exploreShop: `
    <rect x="3.4" y="6" width="12.4" height="12" rx="2"/>
    <path d="M15.8 10.4l4.8-2.8v8.8l-4.8-2.8"/>
    <path d="M7.4 14.4v-3l2.4-1.6 2.4 1.6v3"/>`,
  shortDrama: `
    <rect x="3.4" y="5.2" width="17.2" height="13.6" rx="2"/>
    <path d="M3.4 9h17.2M7.6 5.2 6 9M12.4 5.2 10.8 9M17.2 5.2 15.6 9"/>
    <path d="M10.4 11.8v4.4l3.6-2.2z"/>`,
  videoRemake: `
    <rect x="3.4" y="7.2" width="12" height="12" rx="2"/>
    <path d="M7.6 7.2V5.6a2 2 0 0 1 2-2h8.8a2 2 0 0 1 2 2v8.8a2 2 0 0 1-2 2h-3"/>
    <path d="M8 11v4.4l3.4-2.2z"/>`,
}

type Spec = [name: string, tagline: string, route: string, icon: string]

const section = (label: string, specs: Spec[]): LandingSection => ({
  label,
  tools: specs.map(([name, tagline, route, icon]): LandingTool => ({ id: route, name, tagline, route, icon })),
})

export const localLifeLanding: LandingPageData = {
  title: '本地生活',
  banners: [
    {
      id: 'local-life-full-set',
      title: '门店全案',
      desc: '选择品牌档案与设计模板，一键生成全案',
      cta: '开始生成',
      route: FULL_SET_ROUTE,
      accent: true,
    },
    {
      id: 'local-life-shop-profile',
      title: '店铺档案',
      desc: '店铺信息一次录入，各创作模块共用',
      cta: '去看看',
      route: '/local-life/shop-profile',
    },
    {
      id: 'local-life-copywriting',
      title: 'AI文案',
      desc: 'AI帮写、爆款仿写，商品文案一键成稿',
      cta: '去看看',
      route: '/local-life/copywriting',
    },
  ],
  /** 与上面三张 banner 重复的条目（门店全案 / 店铺档案 / AI文案）不再进分组，只在 banner 出现 */
  sections: [
    section('数字人', [
      ['AI数字人', '形象音色成片', '/local-life/digital-human', ICONS.digitalHuman],
      ['数字人口播', '文案生成口播', '/local-life/voiceover', ICONS.voiceover],
    ]),
    section('图文与海报', [
      ['图文笔记', '小红书图文', '/local-life/note', ICONS.note],
      ['AI海报', '节日营销海报', '/local-life/poster', ICONS.poster],
      ['AI长图', '卖点引导长图', '/local-life/long-image', ICONS.longImage],
      ['动作迁移', '动作迁移人物', '/local-life/action-transfer', ICONS.actionTransfer],
    ]),
    section('视频创作', [
      ['探店视频', '分镜探店大片', '/local-life/explore-shop', ICONS.exploreShop],
      ['带货短剧', '剧情带货成片', '/local-life/short-drama', ICONS.shortDrama],
      ['爆款视频复刻', '解析分镜同款', '/local-life/video-remake', ICONS.videoRemake],
    ]),
  ],
}

/** 被 banner 吸收的条目：不在本地生活首页分组里重复出现，但 AI 图片落地页的「本地生活」分组仍按路由取用 */
export const localLifeBannerTools: LandingTool[] = section('', [
    ['门店全案', '品牌档案成套', FULL_SET_ROUTE, ICONS.store],
    ['AI文案', '商品文案成稿', '/local-life/copywriting', ICONS.copywriting],
    ['店铺档案', '一次录入共用', '/local-life/shop-profile', ICONS.shopProfile],
  ]).tools
