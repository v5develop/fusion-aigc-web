<script setup lang="ts">
/**
 * CustomModelNotice - 自定义模型须知弹窗
 *
 * 使用方式:
 * <CustomModelNotice v-model="visible" />
 *
 * 点击"同意"后会自动保存 customModelNoticeConfirmed 到 localStorage
 */


defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

/** 点击遮罩关闭 */
function onMaskClick() {
  emit('update:modelValue', false)
}

/** 点击同意 */
function onAgree() {
  localStorage.setItem('customModelNoticeConfirmed', 'true')
  emit('update:modelValue', false)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="modelValue" class="modal-mask" @click.self="onMaskClick">
        <div class="modal">
          <!-- Header -->
          <div class="modal-header">
            <span class="modal-title">视频主体功能使用须知</span>
            <i class="icon-close" @click="onMaskClick" />
          </div>

          <!-- Body -->
          <div class="modal-body">
            <p class="intro">
              亲爱的可灵 AI 伙伴，欢迎您使用我们的主体库功能。
              请您知悉，当前服务依托人工智能模型生成。我们强烈建议并要求您：
            </p>

            <div class="clause">
              <p class="clause-title">严禁利用 AI 技术侵犯他人合法权益</p>
              <p class="clause-content">
                请勿利用 AI 技术生成、编辑或传播违反法律法规、侵犯其他用户或第三方合法权益的内容，不得利用 AI
                技术造谣传谣、恶意中伤他人、侵犯他人隐私和肖像权、名誉权及其他合法权益、侵犯他人知识产权、传播违法违规信息。否则一切后果由您本人承担！
              </p>
            </div>

            <div class="clause">
              <p class="clause-title">内容获得权利人合法授权</p>
              <p class="clause-content">
                您应保证对于所上传、提交和输入的内容拥有合法的权利或者已经取得了相关权利人（包括但不限于其他网络平台等，以下统称"授权方"）的完整合法授权，即您应始终确保所上传、提交和输入的内容不包含侵犯任何第三方权益（包括肖像权、名誉权、荣誉权、声音权益、个人信息权益等人格权、著作权及著作邻接权、专利权、商标权、财产权、保密信息等）的信息或者材料。否则我方有权直接下架、删除相关主体及该主体所有的生成内容，且您已支付灵感值不予退还。
              </p>
            </div>
          </div>

          <!-- Footer -->
          <div class="modal-footer">
            <button class="btn-cancel" @click="onMaskClick">取消</button>
            <button class="btn-agree" @click="onAgree">同意</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="less">
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  width: 520px;
  background: #ffffff;
  border-radius: 8px;
  box-shadow:
    0px 9px 28px 8px rgba(0, 0, 0, 0.05),
    0px 6px 16px 0px rgba(0, 0, 0, 0.08),
    0px 3px 6px -4px rgba(0, 0, 0, 0.12);
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 8px;
  height: 56px;
  box-sizing: border-box;
}

.modal-title {
  font-family: 'PingFang SC', sans-serif;
  font-size: 20px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.88);
  line-height: 28px;
}

.icon-close {
  width: 20px;
  height: 20px;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%233A3A3A'%3E%3Cpath d='M16.48 3.52a1.2 1.2 0 0 1 0 1.7L11.7 9.5l4.78 4.78a1.2 1.2 0 0 1-1.7 1.7L10 11.2l-4.78 4.78a1.2 1.2 0 0 1-1.7-1.7L8.3 9.5 3.52 4.72a1.2 1.2 0 0 1 1.7-1.7L10 7.8l4.78-4.78a1.2 1.2 0 0 1 1.7 0z'/%3E%3C/svg%3E")
    no-repeat center / contain;
  cursor: pointer;
  flex-shrink: 0;
}

.modal-body {
  padding: 12px 24px;
  max-height: 360px;
  overflow-y: auto;

  .intro {
    font-size: 14px;
    font-weight: 500;
    color: #3a3a3a;
    line-height: 20px;
    margin: 0 0 12px;
  }

  .clause {
    margin-bottom: 12px;

    .clause-title {
      font-size: 14px;
      font-weight: 500;
      color: #3a3a3a;
      line-height: 20px;
      margin: 0 0 12px;
    }

    .clause-content {
      font-size: 14px;
      font-weight: 400;
      color: #9e9e9e;
      line-height: 22px;
      margin: 0;
    }
  }
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 24px 24px;
}

.btn-cancel,
.btn-agree {
  height: 40px;
  padding: 0 16px;
  border: none;
  border-radius: 999px;
  font-family: 'PingFang SC', sans-serif;
  font-size: 14px;
  line-height: 22px;
  cursor: pointer;
  transition: opacity 0.2s;

  &:hover {
    opacity: 0.85;
  }
}

.btn-cancel {
  background: #f0ebff;
  color: #8e66f9;
}

.btn-agree {
  background: linear-gradient(0deg, #bba2ff 0%, #ccbaff 99%);
  color: #ffffff;
}

/* 过渡动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;

  .modal {
    transition: transform 0.2s ease, opacity 0.2s ease;
  }
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;

  .modal {
    transform: scale(0.95);
    opacity: 0;
  }
}
</style>
