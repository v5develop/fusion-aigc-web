<script setup lang="ts">
/** 基本资料：头像可更换（选图 / 拖入 → 裁剪 → 上传）、昵称 / 邮箱可改、手机号脱敏只读。保存只提交改动过的字段 */
import { computed, reactive, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { updateProfile, uploadAvatar } from '@/api/auth.ts'
import { useUserInfoStore } from '@/stores/user-info.ts'
import AvatarCropDialog from './AvatarCropDialog.vue'
import type { IProfileUpdate } from '@/api/auth.ts'
import { DEFAULT_AVATAR, EMAIL_PATTERN, inputClass, maskPhone, profileErrorMessage } from './shared.ts'
import type { IUserCenterInfo } from './shared.ts'

const props = defineProps<{ info?: IUserCenterInfo; loading: boolean }>()
const emit = defineEmits<{ saved: [] }>()

const message = useMessage()
const userStore = useUserInfoStore()

// ---- 头像 ----
const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const AVATAR_MAX_BYTES = 5 * 1024 * 1024

const fileInput = ref<HTMLInputElement>()
const cropShow = ref(false)
const cropFile = ref<File | null>(null)
const avatarBusy = ref(false)
const avatarError = ref('')
const avatarDragging = ref(false)

function pickAvatar() {
  if (props.loading || avatarBusy.value) return
  fileInput.value?.click()
}

function acceptAvatarFile(file: File | undefined) {
  if (!file) return
  if (!AVATAR_TYPES.includes(file.type)) {
    message.error('仅支持 PNG、JPEG、WebP 格式的图片')
    return
  }
  if (file.size > AVATAR_MAX_BYTES) {
    message.error('图片不能超过 5 MB，请压缩后再试')
    return
  }
  avatarError.value = ''
  cropFile.value = file
  cropShow.value = true
}

function onAvatarFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  acceptAvatarFile(input.files?.[0])
  input.value = '' // 允许连续两次选同一张
}

function onAvatarDrop(e: DragEvent) {
  avatarDragging.value = false
  if (props.loading || avatarBusy.value) return
  acceptAvatarFile(e.dataTransfer?.files?.[0])
}

function closeCrop() {
  cropShow.value = false
  cropFile.value = null
  avatarError.value = ''
}

async function onAvatarSave(blob: Blob) {
  if (avatarBusy.value) return
  avatarBusy.value = true
  avatarError.value = ''
  try {
    const res = await uploadAvatar(blob)
    const url = res.data?.avatar
    if (url) userStore.setAvatar(url)
    message.success('头像已更新')
    closeCrop()
    emit('saved') // 父级重新拉用户信息，本页与导航栏同步
  } catch (err) {
    avatarError.value = profileErrorMessage(err, '头像上传失败，请稍后重试')
  } finally {
    avatarBusy.value = false
  }
}

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
    // 审核拒绝等后端原因就地显示在对应字段上（请求层已对本接口静默，不再弹全局 toast）
    const text = profileErrorMessage(err, '保存失败，请稍后重试')
    const mentionsEmail = /邮箱|email/i.test(text)
    if (changes.value.nickname !== undefined && !mentionsEmail) errors.nickname = text
    else if (changes.value.email !== undefined) errors.email = text
    else message.error(text)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section aria-labelledby="uc-profile-title" class="flex flex-col gap-20px">
    <h2 id="uc-profile-title" class="m-0 sx-title-section">基本资料</h2>

    <div class="flex items-center gap-14px">
      <button
        type="button"
        aria-label="更换头像"
        :disabled="loading || avatarBusy"
        class="group relative w-72px h-72px p-0 rounded-full overflow-hidden border border-solid border-line bg-surface3 cursor-pointer sx-focus disabled:cursor-not-allowed"
        :class="avatarDragging ? 'sx-drop' : ''"
        @click="pickAvatar"
        @dragover.prevent="avatarDragging = true"
        @dragleave="avatarDragging = false"
        @drop.prevent="onAvatarDrop"
      >
        <img :src="info?.avatar || DEFAULT_AVATAR" alt="" class="w-full h-full object-cover block" />
        <span
          class="absolute inset-0 flex flex-col items-center justify-center gap-2px bg-black/55 text-white text-11px leading-none opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-mid max-md:opacity-100 max-md:bg-transparent max-md:items-end max-md:justify-end max-md:p-4px"
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 8h3l1.6-2.4h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
            <circle cx="12" cy="13" r="3.4" />
          </svg>
          <span class="max-md:hidden">更换头像</span>
        </span>
      </button>
      <div class="flex flex-col gap-4px">
        <button type="button" class="sx-btn w-fit" :disabled="loading || avatarBusy" @click="pickAvatar">更换头像</button>
        <p class="m-0 sx-hint">支持 PNG / JPEG / WebP，不超过 5 MB；也可把图片拖到头像上</p>
      </div>
      <input
        ref="fileInput"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        class="hidden"
        tabindex="-1"
        aria-hidden="true"
        @change="onAvatarFileChange"
      />
    </div>

    <AvatarCropDialog
      v-model:show="cropShow"
      :file="cropFile"
      :busy="avatarBusy"
      :error="avatarError"
      @save="onAvatarSave"
      @cancel="closeCrop"
    />

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
