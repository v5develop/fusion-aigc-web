<script setup lang="ts">
/** 账户安全：修改密码。成功后清空表单，不自动登出 */
import { reactive, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { changePassword } from '@/api/auth.ts'
import { inputClass, reportRequestError } from './shared.ts'

const message = useMessage()

const PWD_MIN = 6
const PWD_MAX = 32

type Field = 'oldPassword' | 'newPassword' | 'confirmPassword'

const form = reactive<Record<Field, string>>({ oldPassword: '', newPassword: '', confirmPassword: '' })
const errors = reactive<Record<Field, string>>({ oldPassword: '', newPassword: '', confirmPassword: '' })
const saving = ref(false)

const FIELDS: { key: Field; id: string; label: string; autocomplete: string }[] = [
  { key: 'oldPassword', id: 'uc-old-pwd', label: '旧密码', autocomplete: 'current-password' },
  { key: 'newPassword', id: 'uc-new-pwd', label: '新密码', autocomplete: 'new-password' },
  { key: 'confirmPassword', id: 'uc-confirm-pwd', label: '确认新密码', autocomplete: 'new-password' },
]

function validate(key: Field): boolean {
  const v = form[key]
  if (key === 'oldPassword') {
    errors.oldPassword = v ? '' : '请输入旧密码'
  } else if (key === 'newPassword') {
    if (!v) errors.newPassword = '请输入新密码'
    else if (v.length < PWD_MIN || v.length > PWD_MAX) errors.newPassword = `新密码需为 ${PWD_MIN}–${PWD_MAX} 个字符`
    else errors.newPassword = ''
    // 新密码改了，已填的确认密码随之重校
    if (form.confirmPassword) validate('confirmPassword')
  } else {
    if (!v) errors.confirmPassword = '请再次输入新密码'
    else if (v !== form.newPassword) errors.confirmPassword = '两次输入的新密码不一致'
    else errors.confirmPassword = ''
  }
  return !errors[key]
}

function reset() {
  for (const f of FIELDS) {
    form[f.key] = ''
    errors[f.key] = ''
  }
}

async function onSubmit() {
  const ok = FIELDS.map((f) => validate(f.key)).every(Boolean)
  if (!ok || saving.value) return
  saving.value = true
  try {
    await changePassword({ oldPassword: form.oldPassword, newPassword: form.newPassword })
    reset()
    message.success('修改成功')
  } catch (err) {
    reportRequestError(err, message.error)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section aria-labelledby="uc-security-title" class="flex flex-col gap-20px">
    <h2 id="uc-security-title" class="m-0 sx-title-section">账户安全</h2>

    <form class="flex flex-col gap-16px max-w-420px" novalidate @submit.prevent="onSubmit">
      <div v-for="f in FIELDS" :key="f.key" class="flex flex-col gap-6px">
        <label :for="f.id" class="sx-label">{{ f.label }}</label>
        <input
          :id="f.id"
          v-model="form[f.key]"
          type="password"
          :maxlength="f.key === 'oldPassword' ? undefined : PWD_MAX"
          :autocomplete="f.autocomplete"
          aria-required="true"
          :aria-invalid="!!errors[f.key]"
          :aria-describedby="errors[f.key] ? `${f.id}-err` : undefined"
          :class="inputClass(!!errors[f.key])"
          @blur="validate(f.key)"
        />
        <p v-if="errors[f.key]" :id="`${f.id}-err`" role="alert" class="m-0 text-11px text-danger">
          {{ errors[f.key] }}
        </p>
      </div>

      <div>
        <button type="submit" class="sx-btn-primary min-w-88px" :disabled="saving">保存</button>
      </div>
    </form>
  </section>
</template>
