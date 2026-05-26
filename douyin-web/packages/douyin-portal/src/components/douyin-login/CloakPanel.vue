<script setup lang="ts">
// CloakBrowser 扫码登录面板
//
// 流程：
//   1) POST /api/douyin/accounts/cloak/start → sessionId
//   2) 打开 WS /ws/douyin/cloak?session=<sessionId>
//   3) 接收 starting / waiting_qr / scanning / confirmed / success / failed / timeout 事件
//   4) success 时通知父组件刷新账号列表

import { onBeforeUnmount, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { localApi } from '@/api/local'

const emit = defineEmits<{ (e: 'success', accountId: number): void; (e: 'close'): void }>()

const stage = ref<'idle' | 'starting' | 'waiting_qr' | 'scanning' | 'confirmed' | 'success' | 'failed' | 'timeout'>('idle')
const qrImage = ref<string>('')
const message = ref<string>('')
const sessionId = ref<string>('')
let ws: WebSocket | null = null

const closeWs = () => {
  if (ws) {
    try { ws.close() } catch {}
    ws = null
  }
}

const start = async () => {
  try {
    stage.value = 'starting'
    message.value = '正在启动无头浏览器…'
    qrImage.value = ''
    const r = await localApi.douyinCloakStart()
    if (r.code !== 0) {
      stage.value = 'failed'
      message.value = r.message || '启动失败'
      ElMessage.error(r.message || '启动失败')
      return
    }
    sessionId.value = r.data.sessionId
    const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/douyin/cloak?session=${encodeURIComponent(r.data.sessionId)}`
    closeWs()
    ws = new WebSocket(wsUrl)
    ws.onmessage = ev => {
      try {
        const data = JSON.parse(ev.data)
        if (data.stage) {
          stage.value = data.stage
          if (data.message) message.value = data.message
          if (data.qrImage) qrImage.value = data.qrImage
          if (data.stage === 'success') {
            ElMessage.success('扫码登录成功')
            emit('success', data.accountId)
            closeWs()
          } else if (data.stage === 'failed' || data.stage === 'timeout') {
            closeWs()
          }
        }
      } catch {}
    }
    ws.onerror = () => {
      // 服务端发完终态事件后会主动 close，浏览器可能把 close 当作 error 触发 onerror。
      // 已是终态时不要覆盖真实 message。
      if (['success', 'failed', 'timeout'].includes(stage.value)) return
      stage.value = 'failed'
      message.value = 'WebSocket 连接失败'
    }
  } catch (e: any) {
    stage.value = 'failed'
    message.value = e?.response?.data?.message || e?.message || '请求失败'
    ElMessage.error(message.value)
  }
}

const cancel = async () => {
  if (sessionId.value) {
    try { await localApi.douyinCloakCancel(sessionId.value) } catch {}
  }
  closeWs()
  stage.value = 'idle'
}

onBeforeUnmount(() => {
  cancel()
})
</script>

<template>
  <div class="cloak-panel">
    <div v-if="stage === 'idle'" class="empty">
      <p class="muted">使用抖音 App 扫描后端无头浏览器中的二维码。</p>
      <p class="muted small">首次使用会下载 ~200MB Chromium 内核，请耐心等待。</p>
      <el-button type="primary" @click="start">开始扫码</el-button>
    </div>

    <div v-else-if="stage === 'starting'" class="loading">
      <el-icon class="is-loading"><Loading /></el-icon>
      <p>{{ message }}</p>
    </div>

    <div v-else-if="qrImage && (stage === 'waiting_qr' || stage === 'scanning')" class="qr-block">
      <img :src="qrImage" alt="二维码" />
      <p>{{ message || '请用抖音 App 扫码' }}</p>
      <el-button size="small" @click="cancel">取消</el-button>
    </div>

    <div v-else-if="stage === 'waiting_qr' || stage === 'scanning'" class="loading">
      <el-icon class="is-loading"><Loading /></el-icon>
      <p>{{ message || '二维码生成中…' }}</p>
      <el-button size="small" @click="cancel" style="margin-top: 8px">取消</el-button>
    </div>

    <div v-else-if="stage === 'confirmed'" class="loading">
      <el-icon class="is-loading"><Loading /></el-icon>
      <p>{{ message || '扫码成功，正在保存…' }}</p>
    </div>

    <div v-else-if="stage === 'success'" class="success">
      <p>{{ message || '账号已保存' }}</p>
    </div>

    <div v-else class="failed">
      <p>{{ message || '扫码失败' }}</p>
      <el-button size="small" @click="start">重试</el-button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.cloak-panel {
  padding: 16px 0;
  text-align: center;
  min-height: 280px;
  .qr-block img {
    width: 220px;
    height: 220px;
    border: 1px solid #eee;
    border-radius: 8px;
    background: #fff;
  }
  p { margin: 12px 0; }
  .muted { color: #888; }
  .small { font-size: 12px; }
  .loading .el-icon { font-size: 32px; }
  .success { color: #67c23a; }
  .failed { color: #f56c6c; }
}
</style>
