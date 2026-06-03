<script setup lang="ts">
const { title, desc } = defineProps<{
  title: string
  desc: string
}>()

const checked = defineModel('checked', { required: true })
</script>

<template>
  <div class="checkbox" :class="{ checked }" @click="checked = !checked">
    <div class="content">
      <div class="title">{{ title }}</div>
      <div class="desc">{{ desc }}</div>
    </div>

    <i :class="checked ? 'icon-ic_ds_check_sel' : 'icon-ic_ds_check_nor'"></i>
  </div>
</template>

<style scoped lang="less">
.checkbox {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border: 1px solid #f0f0f0;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.3s;
  &:hover {
    border-color: #e0e0e0;
    background: #f8f8f8;
  }
  > .content {
    flex: 1;
    .title {
      font-weight: 600;
      color: #1f1f1f;
      margin-bottom: 8px;
    }
    .desc {
      font-size: 13px;
      color: #999;
      line-height: 1.5;
    }
  }

  > .icon-ic_ds_check_sel,
  > .icon-ic_ds_check_nor {
    font-size: 20px;
    color: #202020;
  }
}
</style>
