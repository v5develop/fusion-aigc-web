<script setup lang="ts">
// AI 生成中加载动画（源自设计稿「图片加载动效 V1.0」，纯 CSS）
// 自适应填满父卡片：背景 cover 铺满，图标/星星/文字/进度条居中成列并按卡片宽度(cqw)缩放
// 样式全部为 UnoCSS 原子类；底部非 scoped <style> 只放本组件专用的 @keyframes（gl- 前缀防撞名），没有其它规则
import bgImg from '@/assets/generate-loading/bg.png'
import iconImg from '@/assets/generate-loading/icon.png'
import starPurpleImg from '@/assets/generate-loading/star-purple.png'
import starWhiteImg from '@/assets/generate-loading/star-white.png'

const { text = 'AI正在生成' } = defineProps<{ text?: string }>()

// 注意：每个原子类必须完整落在同一个字符串字面量里（UnoCSS 按字面量提取），长渐变类不能跨 + 拆行
// GPU 加速；减少动效时停掉所有动画（停在基础态，与原 0.01ms 单次播放的终态一致）
const GPU = '[will-change:transform,opacity,left] backface-hidden motion-reduce:animate-none'

// === 1. 流光渐变背景（插画配色，跟随背景 PNG 的浅紫粉基调，不走产品色板） ===
const FLOW_1 =
  'absolute -top-1/2 -left-1/2 w-200% h-200% z-2 opacity-35 pointer-events-none ' +
  'bg-[radial-gradient(ellipse_80%_50%_at_30%_40%,rgba(255,182,193,0.6)_0%,transparent_60%),radial-gradient(ellipse_60%_40%_at_70%_60%,rgba(167,187,250,0.5)_0%,transparent_55%),radial-gradient(ellipse_70%_45%_at_50%_30%,rgba(255,160,180,0.4)_0%,transparent_50%),linear-gradient(135deg,rgba(255,200,210,0.3)_0%,rgba(220,180,240,0.25)_25%,rgba(167,187,250,0.3)_50%,rgba(255,170,190,0.28)_75%,rgba(230,190,230,0.3)_100%)] ' +
  `animate-[gl-flow-main_8s_ease-in-out_infinite] ${GPU}`
const FLOW_2 =
  'absolute -top-30% -right-30% w-160% h-160% z-2 opacity-25 pointer-events-none ' +
  'bg-[radial-gradient(ellipse_50%_35%_at_60%_50%,rgba(200,160,255,0.5)_0%,transparent_55%),radial-gradient(ellipse_65%_45%_at_25%_65%,rgba(255,185,200,0.45)_0%,transparent_50%)] ' +
  `animate-[gl-flow-sub_6s_ease-in-out_infinite_reverse] ${GPU}`
const FLOW_3 =
  'absolute top-0 -left-full w-60% h-full z-3 opacity-0 pointer-events-none ' +
  'bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.08)_20%,rgba(255,220,235,0.15)_50%,rgba(255,255,255,0.08)_80%,transparent_100%)] ' +
  `animate-[gl-shimmer_5s_ease-in-out_infinite] ${GPU}`

// === 图标 + 星星 ===
const STAR = 'absolute w-42% aspect-square bg-contain bg-no-repeat bg-center origin-center'
const STAR_PURPLE = `${STAR} top-0 left-0 animate-[gl-star-purple_2.4s_ease-in-out_infinite] ${GPU}`
const STAR_WHITE = `${STAR} top-26% left-44% animate-[gl-star-white_2.4s_ease-in-out_0.6s_infinite] ${GPU}`
const ICON = `w-full h-full object-contain animate-[gl-icon-bounce_2s_cubic-bezier(0.36,0.56,0.26,1.06)_infinite] ${GPU}`

// === 流光进度条 ===
const PROGRESS_TRACK =
  'absolute top-0 left-0 w-full h-full rounded-2px ' +
  'bg-[linear-gradient(90deg,rgba(255,255,255,0.15)_0%,rgba(255,255,255,0.25)_50%,rgba(255,255,255,0.15)_100%)]'
const PROGRESS_GLOW =
  'absolute -top-4px -left-full w-80% h-[calc(100%+8px)] rounded-4px blur-4px ' +
  'bg-[linear-gradient(90deg,transparent_0%,transparent_30%,rgba(167,187,250,0.15)_50%,transparent_70%,transparent_100%)] ' +
  `animate-[gl-progress-sweep_1.8s_ease-in-out_infinite] ${GPU}`
const PROGRESS_SWEEP =
  'absolute top-0 -left-full w-80% h-full rounded-2px ' +
  'bg-[linear-gradient(90deg,transparent_0%,transparent_15%,rgba(167,187,250,0.3)_35%,rgba(167,187,250,0.85)_50%,rgba(167,187,250,0.3)_65%,transparent_85%,transparent_100%)] ' +
  'shadow-[0_0_8px_rgba(167,187,250,0.5),0_0_16px_rgba(167,187,250,0.25),0_0_24px_rgba(167,187,250,0.1)] ' +
  `animate-[gl-progress-sweep_1.8s_ease-in-out_infinite] ${GPU}`
</script>

<template>
  <!-- 容器查询上下文：内部尺寸用 cqw 随卡片宽度缩放（基准设计稿宽 375px）。
       背景 PNG 边缘半透明，底色用卡片本身的浅紫基调 #e3ccfe，否则半透明边缘叠在深色上会显示为黑边 -->
  <div
    class="relative w-full h-full overflow-hidden [container-type:inline-size] bg-#e3ccfe font-sans"
    role="img"
    aria-label="AI生成加载中"
  >
    <!-- 背景：图内置圆角（四角透明），轻微放大溢出（inset -6%）由根节点裁掉，圆角改由卡片自身裁切决定 -->
    <div class="absolute -inset-6% z-1 bg-cover bg-center" :style="{ backgroundImage: `url(${bgImg})` }"></div>
    <!-- 流光层 -->
    <div :class="FLOW_1"></div>
    <div :class="FLOW_2"></div>
    <div :class="FLOW_3"></div>

    <!-- 居中内容：图标 / 文字 / 进度条 一列排布，随卡片缩放 -->
    <div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-[clamp(10px,5cqw,20px)]">
      <!-- 88 / 375 ≈ 23.5cqw -->
      <div class="relative w-[clamp(48px,23.5cqw,88px)] aspect-[88/76]">
        <!-- 星星位于图标上沿偏左 -->
        <div class="absolute -top-18% -left-4% w-55% h-42% z-1">
          <div :class="STAR_PURPLE" :style="{ backgroundImage: `url(${starPurpleImg})` }"></div>
          <div :class="STAR_WHITE" :style="{ backgroundImage: `url(${starWhiteImg})` }"></div>
        </div>
        <img :class="ICON" :src="iconImg" alt="" draggable="false" />
      </div>

      <!-- 17 / 375 ≈ 4.5cqw -->
      <div
        class="text-white/95 [font-size:clamp(12px,4.5cqw,17px)] font-500 tracking-1.5px [text-shadow:0_1px_4px_rgba(150,130,180,0.3)]"
      >
        {{ text }}
      </div>

      <!-- 200 / 375 ≈ 53cqw -->
      <div class="w-[clamp(120px,53cqw,200px)]" role="progressbar" aria-label="加载进度">
        <div class="relative w-full h-4px rounded-2px bg-white/20 overflow-hidden">
          <div :class="PROGRESS_TRACK"></div>
          <div :class="PROGRESS_GLOW"></div>
          <div :class="PROGRESS_SWEEP"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<!-- 仅关键帧：UnoCSS 没有对应的内置 animate 预设，故保留这一个非 scoped 块；名称统一 gl- 前缀防全局撞名 -->
<style>
@keyframes gl-flow-main {
  0% {
    transform: translate(0, 0) rotate(0deg) scale(1);
    filter: blur(20px);
  }
  25% {
    transform: translate(8%, 5%) rotate(3deg) scale(1.05);
    filter: blur(22px);
  }
  50% {
    transform: translate(12%, -3%) rotate(-2deg) scale(1.08);
    filter: blur(18px);
  }
  75% {
    transform: translate(-5%, 6%) rotate(2deg) scale(1.03);
    filter: blur(24px);
  }
  100% {
    transform: translate(0, 0) rotate(0deg) scale(1);
    filter: blur(20px);
  }
}
@keyframes gl-flow-sub {
  0% {
    transform: translate(0, 0) rotate(0deg) scale(1) skewX(0deg);
    filter: blur(25px);
  }
  33% {
    transform: translate(-10%, 8%) rotate(-4deg) scale(1.08) skewX(2deg);
    filter: blur(22px);
  }
  66% {
    transform: translate(6%, -5%) rotate(3deg) scale(1.04) skewX(-1deg);
    filter: blur(26px);
  }
  100% {
    transform: translate(0, 0) rotate(0deg) scale(1) skewX(0deg);
    filter: blur(25px);
  }
}
@keyframes gl-shimmer {
  0%,
  80% {
    left: -100%;
    opacity: 0;
  }
  90% {
    opacity: 1;
  }
  100% {
    left: 120%;
    opacity: 0;
  }
}
@keyframes gl-progress-sweep {
  0% {
    left: -80%;
  }
  100% {
    left: 120%;
  }
}
@keyframes gl-star-purple {
  0%,
  100% {
    opacity: 0.25;
    transform: scale(0.8) rotate(0deg);
  }
  20% {
    opacity: 1;
    transform: scale(1.15) rotate(15deg);
  }
  40% {
    opacity: 0.7;
    transform: scale(0.95) rotate(-5deg);
  }
  60% {
    opacity: 0.9;
    transform: scale(1.05) rotate(8deg);
  }
  80% {
    opacity: 0.4;
    transform: scale(0.88) rotate(-3deg);
  }
}
@keyframes gl-star-white {
  0%,
  100% {
    opacity: 0.15;
    transform: scale(0.75) rotate(0deg);
  }
  20% {
    opacity: 0.95;
    transform: scale(1.1) rotate(-12deg);
  }
  40% {
    opacity: 0.6;
    transform: scale(0.9) rotate(5deg);
  }
  60% {
    opacity: 0.85;
    transform: scale(1.02) rotate(-6deg);
  }
  80% {
    opacity: 0.3;
    transform: scale(0.82) rotate(3deg);
  }
}
@keyframes gl-icon-bounce {
  0%,
  100% {
    transform: translateY(0) scale(1);
  }
  25% {
    transform: translateY(-8px) scale(1.02);
  }
  50% {
    transform: translateY(2px) scale(0.99);
  }
  75% {
    transform: translateY(-4px) scale(1.01);
  }
}
</style>
