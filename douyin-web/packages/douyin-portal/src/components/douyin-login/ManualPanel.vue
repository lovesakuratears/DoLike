<script setup lang="ts">
// 方案 B —— 手动粘贴 cookie
//
// 用户从浏览器 DevTools → Application → Cookies → www.douyin.com 拷贝整段，
// 粘进 textarea 提交。后端 probeProfile 校验 cookie 后入库。

import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { localApi } from '@/api/local'

const emit = defineEmits<{ (e: 'success', accountId: number): void }>()
const cookie = ref('')
const submitting = ref(false)

const submit = async () => {
  const s = cookie.value.trim()
  if (s.length < 20) {
    ElMessage.warning('cookie 过短，至少需 20 字符')
    return
  }
  submitting.value = true
  try {
    const r = await localApi.douyinManual(s)
    if (r.code === 0) {
      ElMessage.success(`已绑定：${r.data.nickname}`)
      cookie.value = ''
      emit('success', r.data.id)
    } else {
      ElMessage.error(r.message || '绑定失败')
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '请求失败')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="manual-panel">
    <p class="muted">
      在浏览器开发者工具中复制 <code>douyin.com</code> 的全部 cookie，
      要求至少包含 <code>sessionid</code>、<code>passport_csrf_token</code>。
    </p>
    <el-input
      v-model="cookie"
      type="textarea"
      :rows="8"
      placeholder="把整段 cookie 粘贴到这里"
      resize="vertical"
    />
    <div class="actions">
      <el-button type="primary" :loading="submitting" @click="submit">绑定账号</el-button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.manual-panel {
  padding: 8px 0;
  .muted { color: #888; font-size: 13px; }
  code {
    background: #f5f5f5;
    padding: 1px 4px;
    border-radius: 3px;
  }
  .actions { margin-top: 12px; text-align: right; }
}
</style>
