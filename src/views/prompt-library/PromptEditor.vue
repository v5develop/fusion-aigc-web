<script setup lang="ts">
import { modelLabelOf } from '@/utils/model-label'
/**
 * 新建 / 编辑我的提示词弹窗。
 * 校验口径按契约：title ≤100 字、prompt ≤3000 字、models ≤10（缺省 ["通用"]）、tags ≤10。
 */
import { reactive, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { promptLibCreate, promptLibUpdate } from '@/api/prompt-library.ts'
import type { IPromptLibItem } from '@/api/prompt-library.ts'

const show = defineModel<boolean>('show', { required: true })

const props = defineProps<{
  /** 非 null = 编辑该条；null = 新建 */
  editing: IPromptLibItem | null
  createTitle?: string
  editTitle?: string
  /** 浮层里打开时需高于浮层（6000） */
  zIndex?: number
}>()

const emit = defineEmits<{ saved: [] }>()

const message = useMessage()
const saving = ref(false)

const MODEL_OPTIONS = ['通用', 'GPT', 'Banana', 'Seedream']

/** 我的提示词的分类（后端只认这两个；对应原型的「我的 / 我的收藏」） */
const GROUP_OPTIONS = [
  { label: '我的', value: 'mine' },
  { label: '我的收藏', value: 'favorite' },
]

const form = reactive({
  group: 'favorite' as 'mine' | 'favorite',
  title: '',
  prompt: '',
  models: ['通用'] as string[],
  tagsInput: '',
})

watch(show, (v) => {
  if (!v) return
  if (props.editing) {
    form.group = props.editing.group === 'mine' ? 'mine' : 'favorite'
    form.title = props.editing.title
    form.prompt = props.editing.prompt
    form.models = props.editing.models?.length ? [...props.editing.models] : ['通用']
    form.tagsInput = (props.editing.tags ?? []).join('，')
  } else {
    form.group = 'favorite'
    form.title = ''
    form.prompt = ''
    form.models = ['通用']
    form.tagsInput = ''
  }
})

/** 标签输入：逗号（中英）、空格、顿号分隔 */
function parseTags(input: string): string[] {
  return input
    .split(/[,，、\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

async function save() {
  if (saving.value) return
  const title = form.title.trim()
  const prompt = form.prompt.trim()
  if (!title) return message.warning('请填写标题')
  if (title.length > 100) return message.warning('标题最多 100 字')
  if (!prompt) return message.warning('请填写提示词内容')
  if (prompt.length > 3000) return message.warning('提示词最多 3000 字')
  if (!form.models.length) return message.warning('请至少选择一个适用模型')
  const tags = parseTags(form.tagsInput)
  if (tags.length > 10) return message.warning('标签最多 10 个')

  saving.value = true
  try {
    const payload = { title, prompt, models: form.models, tags, group: form.group }
    if (props.editing) {
      await promptLibUpdate(props.editing.id, payload)
      message.success('已保存')
    } else {
      await promptLibCreate(payload)
      message.success('已创建')
    }
    show.value = false
    emit('saved')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    :title="editing ? (editTitle ?? '编辑提示词') : (createTitle ?? '新建提示词')"
    :z-index="zIndex"
    style="width: 560px; max-width: calc(100vw - 24px)"
  >
    <div>
      <div class="mb-14px">
        <div class="text-13px text-ink mb-6px flex justify-between">
          标题
          <span class="text-12px" :class="form.title.length > 100 ? 'text-danger' : 'text-placeholder'"
            >{{ form.title.length }}/100</span
          >
        </div>
        <n-input v-model:value="form.title" :maxlength="100" placeholder="必填，100 字以内" />
      </div>

      <div class="mb-14px">
        <div class="text-13px text-ink mb-6px flex justify-between">
          提示词内容
          <span class="text-12px" :class="form.prompt.length > 3000 ? 'text-danger' : 'text-placeholder'"
            >{{ form.prompt.length }}/3000</span
          >
        </div>
        <n-input
          v-model:value="form.prompt"
          type="textarea"
          :rows="8"
          :maxlength="3000"
          placeholder="必填，3000 字以内"
        />
      </div>

      <div class="mb-14px">
        <div class="text-13px text-ink mb-6px">分类</div>
        <n-select v-model:value="form.group" :options="GROUP_OPTIONS" :consistent-menu-width="false" />
      </div>

      <div class="mb-14px">
        <div class="text-13px text-ink mb-6px flex justify-between">
          适用模型
          <span class="text-12px text-placeholder">{{ form.models.length }}/10</span>
        </div>
        <n-checkbox-group v-model:value="form.models">
          <n-checkbox v-for="m in MODEL_OPTIONS" :key="m" :value="m" :label="modelLabelOf(m)" />
        </n-checkbox-group>
      </div>

      <div class="mb-14px">
        <div class="text-13px text-ink mb-6px flex justify-between">
          标签
          <span class="text-12px text-placeholder">{{ parseTags(form.tagsInput).length }}/10</span>
        </div>
        <n-input v-model:value="form.tagsInput" placeholder="选填，多个标签用逗号或空格分隔" />
        <div v-if="parseTags(form.tagsInput).length" class="mt-8px flex flex-wrap gap-6px">
          <span v-for="t in parseTags(form.tagsInput)" :key="t" class="ll-tag">{{ t }}</span>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-10px">
        <n-button @click="show = false">取消</n-button>
        <n-button type="primary" :loading="saving" @click="save">保存</n-button>
      </div>
    </template>
  </n-modal>
</template>
