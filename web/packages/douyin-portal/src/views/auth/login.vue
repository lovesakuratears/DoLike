<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useLocalAuthStore } from '@/stores/local-auth'

const router = useRouter()
const route = useRoute()
const auth = useLocalAuthStore()

const form = reactive({
  username: '',
  password: '',
  remember: false
})

const submitting = ref(false)

const onSubmit = async () => {
  submitting.value = true
  try {
    const r = await auth.login(form.username.trim(), form.password, form.remember)
    if (r.code === 0) {
      ElMessage.success('登录成功')
      const redirect = (route.query.redirect as string) || '/my'
      router.replace(redirect)
    } else {
      ElMessage.error(r.message || '登录失败')
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
      <h1>登录归档系统</h1>
      <p class="hint">使用本地账号登录，登录信息只保存在你的电脑上。</p>
      <el-form @submit.prevent="onSubmit" label-position="top">
        <el-form-item label="用户名">
          <el-input
            v-model="form.username"
            placeholder="用户名"
            autocomplete="username"
            clearable
          />
        </el-form-item>
        <el-form-item label="密码">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="密码"
            autocomplete="current-password"
            show-password
          />
        </el-form-item>
        <el-form-item>
          <el-checkbox v-model="form.remember">保持 30 天登录</el-checkbox>
        </el-form-item>
        <el-button
          type="primary"
          native-type="submit"
          :loading="submitting"
          style="width: 100%"
          @click="onSubmit"
        >
          登录
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
