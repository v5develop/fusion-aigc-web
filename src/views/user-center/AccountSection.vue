<script setup lang="ts">
/** 账户信息：只读展示 + 退出登录（二次确认后调 signOut） */
import { computed } from 'vue'
import { useDialog } from 'naive-ui'
import { signOut } from '@/api/auth.ts'
import { formatDate } from './shared.ts'
import type { IUserCenterInfo } from './shared.ts'

const props = defineProps<{ info?: IUserCenterInfo; points?: number }>()

const dialog = useDialog()

const rows = computed(() => {
  const info = props.info
  const points = props.points ?? info?.availablePoints
  const status = info?.status
  return [
    { label: '可用点数', value: points === undefined || points === null ? '' : String(points) },
    { label: '账号', value: info?.username ?? '' },
    { label: '注册时间', value: formatDate(info?.createTime) },
    // 前端没有现成的状态文案，按原值展示
    { label: '状态', value: status === undefined || status === null ? '' : String(status) },
  ]
})

function onSignOut() {
  dialog.warning({
    title: '退出登录',
    content: '确定退出当前账号吗？',
    positiveText: '退出',
    negativeText: '取消',
    onPositiveClick: () => signOut(),
  })
}
</script>

<template>
  <section aria-labelledby="uc-account-title" class="flex flex-col gap-20px">
    <h2 id="uc-account-title" class="m-0 sx-title-section">账户信息</h2>

    <dl class="m-0 flex flex-col gap-14px max-w-420px">
      <div v-for="r in rows" :key="r.label" class="flex items-center gap-12px">
        <dt class="w-72px shrink-0 sx-label">{{ r.label }}</dt>
        <dd class="m-0 min-w-0 truncate text-13px text-ink">{{ r.value }}</dd>
      </div>
    </dl>

    <div class="pt-16px border-t border-t-solid border-line">
      <button type="button" class="sx-btn-danger" @click="onSignOut">退出登录</button>
    </div>
  </section>
</template>
