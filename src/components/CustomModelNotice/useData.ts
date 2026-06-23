import { ref } from 'vue'

export const modelNoticeObj = ref({
  show: false,
  customModelNoticeConfirmed: !!localStorage.getItem('customModelNoticeConfirmed'),
})
