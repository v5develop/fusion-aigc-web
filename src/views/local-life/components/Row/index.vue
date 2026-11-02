<script setup lang="ts">
/**
 * 本地生活入口卡片行。
 *
 * 与电商 Row 同构，但按「新锤子风 · 藤紫」重做材质：
 * 白底浮起卡（1px #cecece + 双层短影）+ 柔紫渐变图标区。
 * 色相统一在藤紫系——官方原则「颜色只表达状态，不做装饰」，入口的差异靠图标本身表达。
 */
const { data, title } = defineProps<{
  data: { title: string; desc: string; path: string; emoji: string }[]
  title: string
}>()
</script>

<template>
  <div class="ll-row">
    <div class="row-title">
      {{ title }}
      <span class="count-pill">{{ data.length }}</span>
    </div>
    <div class="card-list">
      <div v-for="item in data" :key="item.title" class="card" @click="$router.push(item.path)">
        <div class="image-area">
          <span class="emoji-plate">{{ item.emoji }}</span>
        </div>
        <div class="content">
          <div class="card-title">{{ item.title }}</div>
          <div class="card-desc">{{ item.desc }}</div>
        </div>
        <span class="go">→</span>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.ll-row {
  > .row-title {
    font-size: 18px;
    font-weight: 700;
    color: #1f2329;
    margin-bottom: 20px;
    display: flex;
    align-items: center;
    gap: 8px;

    .count-pill {
      font-size: 11px;
      font-weight: 500;
      color: #6b487c;
      background: #f3edf8;
      border: 1px solid #d9c7e3;
      border-radius: 999px;
      padding: 1px 8px;
    }
  }

  > .card-list {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;

    > .card {
      position: relative;
      width: 15%;
      min-width: 194px;
      max-width: 308px;
      border-radius: 10px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      background: #fff;
      border: 1px solid #cecece;
      box-shadow:
        0 1px 2px rgba(16, 24, 40, 0.06),
        0 4px 12px rgba(16, 24, 40, 0.06);
      cursor: pointer;
      transition:
        box-shadow 0.18s cubic-bezier(0.2, 0.7, 0.2, 1),
        border-color 0.18s cubic-bezier(0.2, 0.7, 0.2, 1),
        transform 0.18s cubic-bezier(0.2, 0.7, 0.2, 1);

      &:hover {
        border-color: #bdbdbd;
        box-shadow:
          0 1px 2px rgba(16, 24, 40, 0.08),
          0 6px 16px rgba(16, 24, 40, 0.09);
        transform: translateY(-2px);

        .go {
          opacity: 1;
          transform: translateX(0);
        }
      }

      .image-area {
        width: 100%;
        aspect-ratio: 97 / 52;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, #f3edf8 0%, #ede3f2 60%, #f7f2fb 100%);
        border-bottom: 1px solid #eff1f3;

        .emoji-plate {
          width: 56px;
          height: 56px;
          border-radius: 14px;
          background: #fff;
          border: 1px solid #e5e7eb;
          box-shadow: 0 1px 2px rgba(16, 24, 40, 0.06);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 28px;
          line-height: 1;
        }
      }

      .content {
        flex: 1;
        padding: 14px 14px 16px;

        .card-title {
          font-size: 14px;
          font-weight: 600;
          color: #1f2329;
          margin-bottom: 4px;
        }

        .card-desc {
          font-size: 12px;
          color: #5f6673;
          line-height: 17px;
        }
      }

      .go {
        position: absolute;
        right: 12px;
        bottom: 14px;
        font-size: 14px;
        color: #6b487c;
        opacity: 0;
        transform: translateX(-4px);
        transition: all 0.18s cubic-bezier(0.2, 0.7, 0.2, 1);
      }
    }
  }
}
</style>
