<script setup lang="ts">
/** 404：不认识的地址。不静默跳走，让错链接看得见；给一个回首页的出口 */
import { useRoute, useRouter } from 'vue-router'
import PageEmpty from '@/components/PageEmpty/index.vue'

const route = useRoute()
const router = useRouter()
</script>

<template>
  <div class="h-100vh bg-page">
    <PageEmpty text="页面不存在" :description="`没有找到「${route.fullPath}」，链接可能已失效或地址有误。`">
      <button type="button" class="sx-btn-primary" @click="router.push('/')">返回首页</button>
    </PageEmpty>
  </div>
</template>
