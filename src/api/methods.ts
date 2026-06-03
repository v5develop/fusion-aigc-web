import { post, get } from './index.ts'
import * as types from './types'

export function getSts(data: types.IGetSts) {
  const { subDir = 'uploads', visibility = 'public', ...rest } = data
  return post('/api/v1/storage/direct/sts', {
    subDir,
    visibility,
    ...rest,
  })
}

export function uploadConfirm(data: { objectKey: string }) {
  return post('/api/v1/storage/direct/confirm', data)
}
