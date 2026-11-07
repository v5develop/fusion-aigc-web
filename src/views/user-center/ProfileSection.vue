<script setup lang="ts">
/** 基本资料：头像只读预览、昵称 / 邮箱可改、手机号脱敏只读。保存只提交改动过的字段 */
import { computed, reactive, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { updateProfile } from '@/api/auth.ts'
import type { IProfileUpdate } from '@/api/auth.ts'
import { DEFAULT_AVATAR, EMAIL_PATTERN, inputClass, maskPhone, reportRequestError } from './shared.ts'
import type { IUserCenterInfo } from './shared.ts'

const props = defineProps<{ info?: IUserCenterInfo; loading: boolean }>()
const emit = defineEmits<{ saved: [] }>()

const message = useMessage()

const NICKNAME_MAX = 20

const form = reactive({ nickname: '', email: '' })
const errors = reactive({ nickname: '', email: '' })
const saving = ref(false)

watch(
  () => props.info,
  (info) => {
    form.nickname = info?.nickname ?? ''
    form.email = info?.email ?? ''
    errors.nickname = ''
    errors.email = ''
  },
  { immediate: true },
)

const maskedPhone = computed(() => maskPhone(props.info?.phone))

/** 与原值比较后得出的改动字段（均已 trim） */
const changes = computed<IProfileUpdate>(() => {
  const out: IProfileUpdate = {}
  const nickname = form.nickname.trim()
  const email = form.email.trim()
  if (nickname !== (props.info?.nickname ?? '')) out.nickname = nickname
  if (email !== (props.info?.email ?? '')) out.email = email
  return out
})
const dirty = computed(() => Object.keys(changes.value).length > 0)

function validateNickname() {
  const v = form.nickname.trim()
  if (!v) errors.nickname = '请输入昵称'
  else if ([...v].length > NICKNAME_MAX) errors.nickname = `昵称不能超过 ${NICKNAME_MAX} 个字符`
  else errors.nickname = ''
  return !errors.nickname
}

function validateEmail() {
  const v = form.email.trim()
  errors.email = v && !EMAIL_PATTERN.test(v) ? '邮箱格式不正确' : ''
  return !errors.email
}

async function onSubmit() {
  const ok = [validateNickname(), validateEmail()].every(Boolean)
  if (!ok || !dirty.value || saving.value) return
  saving.value = true
  try {
    await updateProfile(changes.value)
    message.success('保存成功')
    emit('saved')
  } catch (err) {
    reportRequestError(err, message.error)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section aria-labelledby="uc-profile-title" class="flex flex-col gap-20px">
    <h2 id="uc-profile-title" class="m-0 sx-title-section">基本资料</h2>

    <div class="flex items-center gap-14px">
      <img
        :src="info?.avatar || DEFAULT_AVATAR"
        alt="头像"
        class="w-64px h-64px rounded-full object-cover border border-solid border-line bg-surface3"
      />
    </div>

    <form class="flex flex-col gap-16px max-w-420px" novalidate @submit.prevent="onSubmit">
      <div class="flex flex-col gap-6px">
        <label for="uc-nickname" class="text-13px font-500 text-ink-2">昵称</label>
        <input
          id="uc-nickname"
          v-model="form.nickname"
          type="text"
          :maxlength="NICKNAME_MAX"
          autocomplete="nickname"
          aria-required="true"
          :aria-invalid="!!errors.nickname"
          :aria-describedby="errors.nickname ? 'uc-nickname-err' : undefined"
          :disabled="loading"
          :class="inputClass(!!errors.nickname)"
          @blur="validateNickname"
        />
        <p v-if="errors.nickname" id="uc-nickname-err" role="alert" class="m-0 text-12px text-danger">
          {{ errors.nickname }}
        </p>
      </div>

      <div class="flex flex-col gap-6px">
        <label for="uc-email" class="text-13px font-500 text-ink-2">邮箱</label>
        <input
          id="uc-email"
          v-model="form.email"
          type="email"
          autocomplete="email"
          :aria-invalid="!!errors.email"
          :aria-describedby="errors.email ? 'uc-email-err' : undefined"
          :disabled="loading"
          :class="inputClass(!!errors.email)"
          @blur="validateEmail"
        />
        <p v-if="errors.email" id="uc-email-err" role="alert" class="m-0 text-12px text-danger">
          {{ errors.email }}
        </p>
      </div>

      <div class="flex flex-col gap-6px">
        <label for="uc-phone" class="text-13px font-500 text-ink-2">手机号</label>
        <input
          id="uc-phone"
          :value="maskedPhone"
          type="text"
          readonly
          disabled
          aria-describedby="uc-phone-hint"
          :class="inputClass(false)"
        />
        <p id="uc-phone-hint" class="m-0 sx-hint">手机号暂不支持修改</p>
      </div>

      <div>
        <button type="submit" class="sx-btn-primary min-w-88px" :disabled="loading || saving || !dirty">保存</button>
      </div>
    </form>
  </section>
</template>
