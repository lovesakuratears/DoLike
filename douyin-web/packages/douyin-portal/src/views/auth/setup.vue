<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useLocalAuthStore } from '@/stores/local-auth'

const router = useRouter()
const auth = useLocalAuthStore()

const form = reactive({
  username: '',
  password: '',
  confirm: ''
})

const submitting = ref(false)

const onSubmit = async () => {
  if (form.password !== form.confirm) {
    ElMessage.error('两次输入的密码不一致')
    return
  }
  submitting.value = true
  try {
    const r = await auth.setup(form.username.trim(), form.password)
    if (r.code === 0) {
      ElMessage.success('账号创建成功')
      router.replace('/my')
    } else {
      ElMessage.error(r.message || '注册失败')
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '网络错误')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="auth-page">
    <div class="card">
      <h1>初始化本地账号</h1>
      <p class="hint">首次使用请创建一个本地用户名和密码，用于登录归档系统。</p>
      <el-form @submit.prevent="onSubmit" label-position="top">
        <el-form-item label="用户名">
          <el-input
            v-model="form.username"
            placeholder="3-20 位字母 / 数字 / 下划线"
            autocomplete="username"
            clearable
          />
        </el-form-item>
        <el-form-item label="密码">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="至少 8 位"
            autocomplete="new-password"
            show-password
          />
        </el-form-item>
        <el-form-item label="确认密码">
          <el-input
            v-model="form.confirm"
            type="password"
            autocomplete="new-password"
            show-password
          />
        </el-form-item>
        <el-button
          type="primary"
          native-type="submit"
          :loading="submitting"
          style="width: 100%"
          @click="onSubmit"
        >
          创建账号并登录
        </el-button>
      </el-form>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.auth-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: var(--color-bg-base, #f5f5f7);

  .card {
    width: 360px;
    padding: 32px;
    background: var(--color-bg-card, #fff);
    border-radius: 16px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);

    h1 {
      margin: 0 0 8px;
      font-size: 20px;
      font-weight: 600;
    }
    .hint {
      margin: 0 0 24px;
      font-size: 13px;
      color: var(--color-text-t3, #888);
      line-height: 1.5;
    }
  }
}
</style>
