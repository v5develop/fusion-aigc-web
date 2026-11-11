<script setup lang="ts">
/**
 * 用户中心：左侧竖向菜单（基本资料 / 账户安全 / 账户信息 / 字体显示），右侧白卡展示选中分区。
 * 「字体显示」可用 /user-center?section=display 直达。
 * 资料字段（昵称、邮箱、账号、注册时间、状态）store 未暴露，本页直接调 GET /api/v1/auth/user-info。
 */
import { onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute } from 'vue-router'
import { getUserInfo } from '@/api/methods.ts'
import { useUserInfoStore } from '@/stores/user-info.ts'
import ProfileSection from './ProfileSection.vue'
import SecuritySection from './SecuritySection.vue'
import AccountSection from './AccountSection.vue'
import DisplaySection from './DisplaySection.vue'
import type { IUserCenterInfo } from './shared.ts'

defineOptions({ name: 'user-center' })

type SectionKey = 'profile' | 'security' | 'account' | 'display'

const MENU: { key: SectionKey; label: string }[] = [
  { key: 'profile', label: '基本资料' },
  { key: 'security', label: '账户安全' },
  { key: 'account', label: '账户信息' },
  { key: 'display', label: '字体显示' },
]

const route = useRoute()
const initialSection = MENU.find((m) => m.key === route.query.section)?.key
const active = ref<SectionKey>(initialSection ?? 'profile')

const userStore = useUserInfoStore()
const { userInfo } = storeToRefs(userStore)

const info = ref<IUserCenterInfo>()
const loading = ref(true)

async function load() {
  loading.value = true
  try {
    const res = await getUserInfo()
    if (res.code === 0) info.value = res.data as IUserCenterInfo
  } catch {
    // 业务失败已由请求拦截器提示
  } finally {
    loading.value = false
  }
}

/** 资料保存成功：本页与全局 store（导航栏头像等）一起刷新 */
function onSaved() {
  void load()
  void userStore.updateUserInfo()
}

onMounted(load)
</script>

<template>
  <div class="h-full overflow-auto bg-page text-ink">
    <div class="flex items-start gap-16px max-w-1080px mx-auto p-20px">
      <h1 class="sr-only">用户中心</h1>
      <nav aria-label="用户中心" class="w-200px shrink-0 flex flex-col gap-4px p-8px sx-card">
        <button
          v-for="m in MENU"
          :key="m.key"
          type="button"
          :aria-current="active === m.key ? 'page' : undefined"
          :class="[
            'sx-row h-36px px-12px text-13px',
            active === m.key ? 'sx-row-on font-600 text-ink' : 'font-500 text-ink-2',
          ]"
          @click="active = m.key"
        >
          {{ m.label }}
        </button>
      </nav>

      <div class="min-w-0 flex-1 p-24px sx-card">
        <ProfileSection v-if="active === 'profile'" :info="info" :loading="loading" @saved="onSaved" />
        <SecuritySection v-else-if="active === 'security'" />
        <AccountSection v-else-if="active === 'account'" :info="info" :points="userInfo?.availablePoints" />
        <DisplaySection v-else />
      </div>
    </div>
  </div>
</template>
