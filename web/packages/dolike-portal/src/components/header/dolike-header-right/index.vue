<script setup lang="ts">
// DoLike 顶栏右侧 —— 整合本地账号登录态 + 绑定插件入口 + 退出登录
//
// 未登录：「登录」按钮 → 跳 /auth/login
// 已登录：头像 + 简易下拉（用户名 / 绑定浏览器插件 / 退出登录）
// 头像：优先用已绑定的抖音账号头像（avatarUrl），fallback 到用户名首字符

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useLocalAuthStore } from '@/stores/local-auth'
import { localApi } from '@/api/local'
import LoginModal from '@/components/douyin-login/LoginModal.vue'

const router = useRouter()
const auth = useLocalAuthStore()
const loginModalOpen = ref(false)
const douyinAvatar = ref<string>('')
const avatarBroken = ref(false)

const loggedIn = computed(() => auth.loggedIn)
const username = computed(() => auth.user?.username || '')
const firstChar = computed(() => (username.value ? username.value[0].toUpperCase() : '·'))

const goLogin = () => {
  router.push('/auth/login')
}

const onLogout = async () => {
  try {
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', { type: 'warning' })
  } catch {
    return
  }
  await auth.logout()
  douyinAvatar.value = ''
  ElMessage.success('已退出登录')
  router.replace('/auth/login')
}

const refreshDouyinAvatar = async () => {
  if (!auth.loggedIn) {
    douyinAvatar.value = ''
    return
  }
  try {
    const r = await localApi.douyinAccounts()
    if (r.code === 0 && Array.isArray(r.data) && r.data.length) {
      const valid = r.data.find(a => a.isValid && a.avatarUrl) ?? r.data.find(a => a.avatarUrl)
      douyinAvatar.value = valid?.avatarUrl || ''
      avatarBroken.value = false
    } else {
      douyinAvatar.value = ''
    }
  } catch {
    douyinAvatar.value = ''
  }
}

// 绑定插件成功后给页面发个事件，让 my/index.vue 内的列表刷新；同时本组件自己也要刷新头像
const onBound = () => {
  window.dispatchEvent(new CustomEvent('dolike:account-bound'))
  void refreshDouyinAvatar()
}

const onBoundEvent = () => void refreshDouyinAvatar()

watch(() => auth.loggedIn, () => { void refreshDouyinAvatar() })

onMounted(() => {
  window.addEventListener('dolike:account-bound', onBoundEvent)
  void refreshDouyinAvatar()
})
onBeforeUnmount(() => {
  window.removeEventListener('dolike:account-bound', onBoundEvent)
})

const showAvatarImg = computed(() => !!douyinAvatar.value && !avatarBroken.value)
</script>

<template>
  <div class="dolike-header-right">
    <template v-if="!loggedIn">
      <el-button type="primary" size="default" @click="goLogin">登录</el-button>
    </template>

    <template v-else>
      <el-popover :show-arrow="false" placement="bottom-end" :width="220" trigger="click">
        <template #reference>
          <div class="avatar" :title="username">
            <img
              v-if="showAvatarImg"
              :src="douyinAvatar"
              alt="抖音头像"
              referrerpolicy="no-referrer"
              @error="avatarBroken = true"
            />
            <span v-else>{{ firstChar }}</span>
          </div>
        </template>
        <template #default>
          <div class="menu">
            <p class="menu__user">{{ username }}</p>
            <div class="menu__divider"></div>
            <button class="menu__item" @click="loginModalOpen = true">
              <svg-icon icon="-870" class="menu__icon" />
              <span>绑定浏览器插件</span>
            </button>
            <button class="menu__item danger" @click="onLogout">
              <svg-icon icon="logout" class="menu__icon" />
              <span>退出登录</span>
            </button>
          </div>
        </template>
      </el-popover>
    </template>

    <LoginModal v-model="loginModalOpen" @bound="onBound" />
  </div>
</template>

<style lang="scss" scoped>
.dolike-header-right {
  display: flex;
  align-items: center;
  margin-left: 16px;

  .avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--color-text-t0, #000);
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    user-select: none;
    overflow: hidden;
    transition: transform 0.15s ease;
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    &:hover {
      transform: scale(1.05);
    }
  }
}

.menu {
  padding: 4px 0;

  &__user {
    margin: 4px 12px 8px;
    font-size: 13px;
    font-weight: 500;
    color: var(--color-text-t1, #444);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  &__divider {
    height: 1px;
    background: var(--color-line-l3, #eee);
    margin: 0 4px 4px;
  }
  &__item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 9px 12px;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 13px;
    color: var(--color-text-t1, #333);
    text-align: left;
    border-radius: 6px;
    &:hover {
      background: var(--color-fill-2, #f5f5f5);
    }
    &.danger {
      color: #d24a52;
    }
  }
  &__icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }
}
</style>
