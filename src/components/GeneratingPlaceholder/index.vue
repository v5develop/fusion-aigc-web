<script setup lang="ts">
// 生成中占位：白底 + 三个跳动圆点 + 文案（设计稿 282×282：圆点 4px/#8F8F8F、文案 16px/26/#9E9E9E）
// 与 MediaFallback 同一套白卡视觉，自适应父容器：内部尺寸用 cqw 随卡片宽度等比缩放
const { text = '生成中' } = defineProps<{ text?: string }>()
</script>

<template>
  <div class="generating-placeholder" role="img" :aria-label="text">
    <div class="dots">
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
    </div>
    <span class="text">{{ text }}</span>
  </div>
</template>

<style scoped lang="less">
.generating-placeholder {
  width: 100%;
  height: 100%;
  // 容器查询上下文：基准设计稿卡片宽 282px
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: clamp(2px, 1.4cqw, 4px);
  background: #fff;

  .dots {
    display: flex;
    align-items: center;
    // 圆点中心距 10px，点径 4px → 间隙 6px（6 / 282 ≈ 2.13cqw）
    gap: clamp(4px, 2.13cqw, 8px);

    .dot {
      // 4 / 282 ≈ 1.42cqw
      width: clamp(3px, 1.42cqw, 6px);
      aspect-ratio: 1;
      border-radius: 50%;
      /* token: 中性色/辅助文字 */
      background: #8f8f8f;
      animation: dotPulse 1.4s ease-in-out infinite;

      &:nth-child(2) {
        animation-delay: 0.2s;
      }
      &:nth-child(3) {
        animation-delay: 0.4s;
      }
    }
  }

  .text {
    // 16 / 282 ≈ 5.67cqw；行高 26/16 ≈ 1.63
    font-size: clamp(12px, 5.67cqw, 16px);
    line-height: 1.63;
    color: #9e9e9e;
    text-align: center;
  }
}

@keyframes dotPulse {
  0%,
  80%,
  100% {
    opacity: 0.3;
    transform: scale(0.8);
  }
  40% {
    opacity: 1;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .generating-placeholder .dot {
    animation: none;
    opacity: 0.6;
  }
}
</style>
