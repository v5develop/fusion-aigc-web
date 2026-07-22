<script setup lang="ts">
// AI 生成中加载动画（源自设计稿「图片加载动效 V1.0」，纯 CSS）
// 自适应填满父卡片：背景 cover 铺满，图标/星星/文字/进度条居中成列并按卡片宽度(cqw)缩放
import bgImg from '@/assets/generate-loading/bg.png'
import iconImg from '@/assets/generate-loading/icon.png'
import starPurpleImg from '@/assets/generate-loading/star-purple.png'
import starWhiteImg from '@/assets/generate-loading/star-white.png'

const { text = 'AI正在生成' } = defineProps<{ text?: string }>()
</script>

<template>
  <div class="generate-loading" role="img" aria-label="AI生成加载中">
    <!-- 背景 -->
    <div class="bg-base" :style="{ backgroundImage: `url(${bgImg})` }"></div>
    <!-- 流光层 -->
    <div class="flow-light-1"></div>
    <div class="flow-light-2"></div>
    <div class="flow-light-3"></div>

    <!-- 居中内容 -->
    <div class="content">
      <div class="icon-group">
        <div class="stars-wrapper">
          <div class="star star-purple" :style="{ backgroundImage: `url(${starPurpleImg})` }"></div>
          <div class="star star-white" :style="{ backgroundImage: `url(${starWhiteImg})` }"></div>
        </div>
        <img class="icon-img" :src="iconImg" alt="" draggable="false" />
      </div>

      <div class="loading-text">{{ text }}</div>

      <div class="progress-wrapper" role="progressbar" aria-label="加载进度">
        <div class="progress-bar">
          <div class="progress-track"></div>
          <div class="progress-glow"></div>
          <div class="progress-sweep"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.generate-loading {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  // 容器查询上下文：内部尺寸用 cqw 随卡片宽度缩放（基准设计稿宽 375px）
  container-type: inline-size;
  // 背景 PNG 边缘半透明，底色需用卡片本身的浅紫基调（而非设计稿演示页的深色），否则半透明边缘叠在深色上会显示为黑边
  background: #e3ccfe;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', sans-serif;

  /* === 1. 流光渐变背景 === */
  .bg-base {
    position: absolute;
    // 背景图内置了圆角（四角透明）。轻微放大溢出、由根节点 overflow:hidden 裁掉这圈圆角，
    // 使背景不透明地铺满到卡片边缘，圆角改由卡片自身裁切决定，避免与卡片圆角不一致而露出底色。
    inset: -6%;
    background-size: cover;
    background-position: center;
    z-index: 1;
  }
  .flow-light-1 {
    position: absolute;
    top: -50%;
    left: -50%;
    width: 200%;
    height: 200%;
    z-index: 2;
    opacity: 0.35;
    pointer-events: none;
    background:
      radial-gradient(ellipse 80% 50% at 30% 40%, rgba(255, 182, 193, 0.6) 0%, transparent 60%),
      radial-gradient(ellipse 60% 40% at 70% 60%, rgba(167, 187, 250, 0.5) 0%, transparent 55%),
      radial-gradient(ellipse 70% 45% at 50% 30%, rgba(255, 160, 180, 0.4) 0%, transparent 50%),
      linear-gradient(
        135deg,
        rgba(255, 200, 210, 0.3) 0%,
        rgba(220, 180, 240, 0.25) 25%,
        rgba(167, 187, 250, 0.3) 50%,
        rgba(255, 170, 190, 0.28) 75%,
        rgba(230, 190, 230, 0.3) 100%
      );
    animation: flowCurveMain 8s ease-in-out infinite;
  }
  .flow-light-2 {
    position: absolute;
    top: -30%;
    right: -30%;
    width: 160%;
    height: 160%;
    z-index: 2;
    opacity: 0.25;
    pointer-events: none;
    background:
      radial-gradient(ellipse 50% 35% at 60% 50%, rgba(200, 160, 255, 0.5) 0%, transparent 55%),
      radial-gradient(ellipse 65% 45% at 25% 65%, rgba(255, 185, 200, 0.45) 0%, transparent 50%);
    animation: flowCurveSub 6s ease-in-out infinite reverse;
  }
  .flow-light-3 {
    position: absolute;
    top: 0;
    left: -100%;
    width: 60%;
    height: 100%;
    z-index: 3;
    opacity: 0;
    pointer-events: none;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(255, 255, 255, 0.08) 20%,
      rgba(255, 220, 235, 0.15) 50%,
      rgba(255, 255, 255, 0.08) 80%,
      transparent 100%
    );
    animation: flowShimmer 5s ease-in-out infinite;
  }

  /* === 居中内容：图标 / 文字 / 进度条 一列排布，随卡片缩放 === */
  .content {
    position: absolute;
    inset: 0;
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: clamp(10px, 5cqw, 20px);
  }

  /* === 图标 + 星星 === */
  .icon-group {
    position: relative;
    // 88 / 375 ≈ 23.5cqw
    width: clamp(48px, 23.5cqw, 88px);
    aspect-ratio: 88 / 76;
  }
  .icon-img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    animation: iconBounce 2s cubic-bezier(0.36, 0.56, 0.26, 1.06) infinite;
  }
  .stars-wrapper {
    position: absolute;
    // 相对图标左上方（设计稿星星位于图标上沿偏左）
    top: -18%;
    left: -4%;
    width: 55%;
    height: 42%;
    z-index: 1;
  }
  .star {
    position: absolute;
    width: 42%;
    aspect-ratio: 1;
    background-size: contain;
    background-repeat: no-repeat;
    background-position: center;
    transform-origin: center center;
  }
  .star-purple {
    top: 0;
    left: 0;
    animation: starBlinkPurple 2.4s ease-in-out infinite;
  }
  .star-white {
    top: 26%;
    left: 44%;
    animation: starBlinkWhite 2.4s ease-in-out infinite;
    animation-delay: 0.6s;
  }

  /* === 文字 === */
  .loading-text {
    color: rgba(255, 255, 255, 0.95);
    // 17 / 375 ≈ 4.5cqw
    font-size: clamp(12px, 4.5cqw, 17px);
    font-weight: 500;
    letter-spacing: 1.5px;
    text-shadow: 0 1px 4px rgba(150, 130, 180, 0.3);
  }

  /* === 流光进度条 === */
  .progress-wrapper {
    // 200 / 375 ≈ 53cqw
    width: clamp(120px, 53cqw, 200px);
  }
  .progress-bar {
    position: relative;
    width: 100%;
    height: 4px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.2);
    overflow: hidden;
  }
  .progress-track {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    border-radius: 2px;
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.15) 0%,
      rgba(255, 255, 255, 0.25) 50%,
      rgba(255, 255, 255, 0.15) 100%
    );
  }
  .progress-sweep {
    position: absolute;
    top: 0;
    left: -100%;
    width: 80%;
    height: 100%;
    border-radius: 2px;
    background: linear-gradient(
      90deg,
      transparent 0%,
      transparent 15%,
      rgba(167, 187, 250, 0.3) 35%,
      rgba(167, 187, 250, 0.85) 50%,
      rgba(167, 187, 250, 0.3) 65%,
      transparent 85%,
      transparent 100%
    );
    animation: progressSweep 1.8s ease-in-out infinite;
    box-shadow:
      0 0 8px rgba(167, 187, 250, 0.5),
      0 0 16px rgba(167, 187, 250, 0.25),
      0 0 24px rgba(167, 187, 250, 0.1);
  }
  .progress-glow {
    position: absolute;
    top: -4px;
    left: -100%;
    width: 80%;
    height: calc(100% + 8px);
    border-radius: 4px;
    background: linear-gradient(
      90deg,
      transparent 0%,
      transparent 30%,
      rgba(167, 187, 250, 0.15) 50%,
      transparent 70%,
      transparent 100%
    );
    animation: progressSweep 1.8s ease-in-out infinite;
    filter: blur(4px);
  }

  /* GPU 加速 & 性能优化 */
  .flow-light-1,
  .flow-light-2,
  .flow-light-3,
  .progress-sweep,
  .progress-glow,
  .star,
  .icon-img {
    will-change: transform, opacity, left;
    backface-visibility: hidden;
  }
}

@keyframes flowCurveMain {
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
@keyframes flowCurveSub {
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
@keyframes flowShimmer {
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
@keyframes progressSweep {
  0% {
    left: -80%;
  }
  100% {
    left: 120%;
  }
}
@keyframes starBlinkPurple {
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
@keyframes starBlinkWhite {
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
@keyframes iconBounce {
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

@media (prefers-reduced-motion: reduce) {
  .generate-loading *,
  .generate-loading *::before,
  .generate-loading *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
</style>
