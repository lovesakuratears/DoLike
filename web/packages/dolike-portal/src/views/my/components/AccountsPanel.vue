<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { localApi, type DouyinAccountDTO } from '@/api/local'

// ★ CloakBrowser 扫码 WS 连接管理
// 标记: CLOAK_WS_MANAGER
interface CloakWsHandle {
  sessionId: string
  ws: WebSocket
  accountId: number
}
const cloakWsMap = new Map<number, CloakWsHandle>()

const accounts = ref<DouyinAccountDTO[]>([])
const loading = ref(false)

type ArchiveStatus = 'idle' | 'running' | 'paused' | 'stopping' | 'finished'
const archiveStatuses = ref<Record<number, ArchiveStatus>>({})

interface QueueState { running: number; concurrency: number; paused: boolean }
const queue = ref<QueueState>({ running: 0, concurrency: 0, paused: false })
const counts = ref<{ queued: number; running: number; done: number; failed: number; paused: number }>({
  queued: 0, running: 0, done: 0, failed: 0, paused: 0
})

let pollTimer: number | null = null

const refresh = async () => {
  loading.value = true
  try {
    const r = await localApi.douyinAccounts()
    if (r.code === 0) {
      accounts.value = [...r.data]
        .filter((a) => !a.secUid.startsWith('pending-') && a.secUid !== 'self')
        .sort((a, b) => a.id - b.id)
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

const refreshProgress = async () => {
  try {
    const r = await localApi.archiveProgress()
    if (r.code === 0) {
      const d = r.data as any
      archiveStatuses.value = d.archiveStatuses || {}
      if (d.queue) queue.value = d.queue
      counts.value = {
        queued: d.queued || 0, running: d.running || 0,
        done: d.done || 0, failed: d.failed || 0, paused: d.paused || 0
      }
    }
  } catch { /* 静默 */ }
}

const startPolling = () => {
  if (pollTimer) return
  pollTimer = window.setInterval(refreshProgress, 2000)
}

const archivePause = async (id: number) => {
  try {
    const r = await localApi.archivePause(id)
    if (r.code === 0) { ElMessage.success('已暂停'); refreshProgress() }
    else ElMessage.error(r.message || '暂停失败')
  } catch (e: any) { ElMessage.error(e?.response?.data?.message || e?.message || '请求失败') }
}

const archiveResume = async (id: number) => {
  try {
    const r = await localApi.archiveResume(id)
    if (r.code === 0) { ElMessage.success('已恢复'); refreshProgress() }
    else ElMessage.error(r.message || '恢复失败')
  } catch (e: any) { ElMessage.error(e?.response?.data?.message || e?.message || '请求失败') }
}

const archiveStop = async (id: number) => {
  try {
    await ElMessageBox.confirm('终止当前归档？已下载的部分会保留', '提示', { type: 'warning' })
  } catch { return }
  try {
    const r = await localApi.archiveStop(id)
    if (r.code === 0) { ElMessage.success('已终止'); refreshProgress() }
    else ElMessage.error(r.message || '终止失败')
  } catch (e: any) { ElMessage.error(e?.response?.data?.message || e?.message || '请求失败') }
}

const downloadPause = async () => {
  try {
    const r = await localApi.downloadPause()
    if (r.code === 0) { ElMessage.success('下载已暂停'); refreshProgress() }
    else ElMessage.error(r.message || '暂停失败')
  } catch (e: any) { ElMessage.error(e?.response?.data?.message || e?.message || '请求失败') }
}

const downloadResume = async () => {
  try {
    const r = await localApi.downloadResume()
    if (r.code === 0) { ElMessage.success('下载已恢复'); refreshProgress() }
    else ElMessage.error(r.message || '恢复失败')
  } catch (e: any) { ElMessage.error(e?.response?.data?.message || e?.message || '请求失败') }
}

const downloadStop = async () => {
  try {
    await ElMessageBox.confirm('终止所有下载？已下载的部分保留', '提示', { type: 'warning' })
  } catch { return }
  try {
    const r = await localApi.downloadStop()
    if (r.code === 0) { ElMessage.success('下载已终止'); refreshProgress() }
    else ElMessage.error(r.message || '终止失败')
  } catch (e: any) { ElMessage.error(e?.response?.data?.message || e?.message || '请求失败') }
}

const removeAcc = async (acc: DouyinAccountDTO) => {
  try {
    await ElMessageBox.confirm(`确定删除账号「${acc.nickname}」？已归档的视频不会被删除。`, '提示', { type: 'warning' })
  } catch { return }
  try {
    const r = await localApi.douyinDelete(acc.id)
    if (r.code === 0) { ElMessage.success('已删除'); refresh() }
    else ElMessage.error(r.message || '删除失败')
  } catch (e: any) { ElMessage.error(e?.response?.data?.message || e?.message || '请求失败') }
}

// ★ CloakBrowser 导入 Cookie 扫码 —— 用插件 cookie 启动扫码流程
// 标记: CLOAK_IMPORT_COOKIE_FRONTEND
const cloakImportCookie = async (acc: DouyinAccountDTO) => {
  try {
    const r = await localApi.douyinCloakImportCookie(acc.id)
    if (r.code === 0) {
      const { sessionId, wsPath } = r.data
      ElMessage.success('扫码已启动，请在弹出的浏览器窗口中确认')
      connectCloakWs(sessionId, acc.id)
    } else {
      ElMessage.error(r.message || '启动失败')
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '启动失败')
  }
}

// ★ 连接 CloakBrowser WS —— 监听扫码进度
// 标记: CLOAK_WS_CONNECT
function connectCloakWs(sessionId: string, accountId: number) {
  // 关闭旧连接
  const old = cloakWsMap.get(accountId)
  if (old) { try { old.ws.close() } catch { /* ignore */ } }

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${proto}//${location.host}/ws/douyin/cloak?session=${sessionId}`
  const ws = new WebSocket(wsUrl)

  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data)
      const stage = data.stage
      if (stage === 'waiting_qr') {
        ElMessage.info('请用抖音 App 扫码确认')
      } else if (stage === 'confirmed') {
        ElMessage.success('扫码成功，正在保存账号…')
      } else if (stage === 'success') {
        ElMessage.success(`账号已更新：${data.accountId ? 'Cookie 已刷新' : '完成'}`)
        ws.close()
        cloakWsMap.delete(accountId)
        refresh()
      } else if (stage === 'failed' || stage === 'timeout') {
        ElMessage.error(`扫码${stage === 'timeout' ? '超时' : '失败'}：${data.message || ''}`)
        ws.close()
        cloakWsMap.delete(accountId)
      }
    } catch { /* ignore parse error */ }
  }

  ws.onerror = () => {
    ElMessage.error('扫码连接失败')
    cloakWsMap.delete(accountId)
  }

  cloakWsMap.set(accountId, { sessionId, ws, accountId })
}

onMounted(() => {
  window.addEventListener('dolike:account-bound', onBound)
  startPolling()
  refresh()
})
onBeforeUnmount(() => {
  window.removeEventListener('dolike:account-bound', onBound)
  if (pollTimer) clearInterval(pollTimer)
  // 关闭所有 CloakBrowser WS
  for (const [, h] of cloakWsMap) { try { h.ws.close() } catch { /* ignore */ } }
  cloakWsMap.clear()
})

const onBound = () => { refresh() }

defineExpose({ refresh })
</script>

<template>
  <div class="accounts-panel">
    <header>
      <h3>抖音账号</h3>
    </header>

    <p v-if="loading" class="muted">加载中…</p>
    <p v-else-if="!accounts.length" class="muted">暂无账号，请先在扩展弹窗中绑定。</p>

    <ul v-else class="list">
      <li v-for="a in accounts" :key="a.id">
        <img v-if="a.avatarUrl" :src="a.avatarUrl" class="avatar" />
        <div v-else class="avatar avatar--placeholder">{{ a.nickname?.charAt(0) || '?' }}</div>
        <div class="info">
          <p class="name">
            {{ a.nickname }}
            <span v-if="a.secUid.startsWith('pending-')" class="status-badge danger">待绑定</span>
            <span v-else-if="archiveStatuses[a.id] === 'running'" class="status-badge running">归档中</span>
            <span v-else-if="archiveStatuses[a.id] === 'paused'" class="status-badge paused">已暂停</span>
            <span v-else-if="!a.isValid" class="status-badge danger">未验证</span>
          </p>
          <p class="meta">
            <span class="meta-badge">{{ a.cookieSource === 'bridge' ? '插件' : a.cookieSource === 'manual' ? '手动' : '扫码' }}</span>
          </p>
        </div>
        <div class="ops">
          <!-- 暂停/继续 -->
          <template v-if="archiveStatuses[a.id] === 'running'">
            <button class="op-btn" @click="archivePause(a.id)">暂停</button>
          </template>
          <template v-else-if="archiveStatuses[a.id] === 'paused'">
            <button class="op-btn primary" @click="archiveResume(a.id)">继续</button>
          </template>

          <!-- 终止 -->
          <button
            v-if="archiveStatuses[a.id] === 'running' || archiveStatuses[a.id] === 'paused'"
            class="op-btn danger"
            @click="archiveStop(a.id)"
          >终止</button>

          <!-- 删除 -->
          <button class="op-btn danger" @click="removeAcc(a)">删除</button>

          <!-- ★ 插件 Cookie 操作 -->
          <!-- 标记: PLUGIN_COOKIE_OPS -->
          <button
            v-if="a.cookieEnc"
            class="op-btn"
            @click="cloakImportCookie(a)"
            title="用已有 Cookie 走扫码路线刷新并确认身份"
          >扫码刷新</button>
        </div>
      </li>
    </ul>

    <!-- 下载队列状态条 -->
    <div v-if="counts.queued + counts.running + counts.paused + counts.failed > 0" class="queue-bar">
      <div class="qstat">
        <span class="ds-item"><i class="dot run"></i>下载中 {{ counts.running }} / {{ queue.concurrency }}</span>
        <span class="ds-item"><i class="dot q"></i>待下载 {{ counts.queued }}</span>
        <span class="ds-item" v-if="counts.paused > 0"><i class="dot p"></i>已暂停 {{ counts.paused }}</span>
        <span class="ds-item"><i class="dot d"></i>已完成 {{ counts.done }}</span>
        <span class="ds-item" v-if="counts.failed > 0"><i class="dot f"></i>失败 {{ counts.failed }}</span>
      </div>
      <div class="qops">
        <button v-if="!queue.paused" class="op-btn" @click="downloadPause">暂停下载</button>
        <button v-else class="op-btn primary" @click="downloadResume">恢复下载</button>
        <button class="op-btn danger" @click="downloadStop">终止全部</button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.accounts-panel {
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
    h3 { margin: 0; font-size: 18px; font-weight: 700; color: var(--color-text-t1); }
  }

  .muted { color: var(--color-text-t3, #888); padding: 20px 0; }

  .list {
    list-style: none; padding: 0; margin: 0;
    display: flex; flex-direction: column; gap: 12px;

    li {
      display: flex; align-items: center; gap: 14px;
      padding: 14px 16px;
      border: 1px solid var(--color-line-l3, #eee);
      background: linear-gradient(180deg, rgba(var(--white), 0.98), rgba(var(--neutral-50), 0.92));
      border-radius: 18px;
      box-shadow: 0 8px 24px rgba(17, 18, 23, 0.04);
    }

    .avatar {
      width: 44px; height: 44px; border-radius: 50%;
      object-fit: cover;
      border: 1px solid rgba(var(--white), 0.9);
      box-shadow: 0 4px 14px rgba(17, 18, 23, 0.08);
    }

    .avatar--placeholder {
      display: flex; align-items: center; justify-content: center;
      background: #eee; color: #999; font-size: 18px;
    }

    .info { flex: 1; min-width: 0; }

    .name {
      margin: 0; font-size: 14px; font-weight: 600;
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
      color: var(--color-text-t1);
    }

    .meta { margin: 4px 0 0; display: flex; gap: 6px; flex-wrap: wrap; }

    .status-badge {
      font-size: 11px; line-height: 1; padding: 4px 7px; border-radius: 999px;
      background: rgba(var(--blue-500), 0.12); color: rgba(var(--blue-700), 1);
      &.danger { background: rgba(var(--orange-red-500), 0.12); color: rgba(var(--orange-red-700), 1); }
      &.running { background: rgba(var(--gold-500), 0.16); color: rgba(var(--gold-800), 1); }
      &.paused { background: rgba(var(--neutral-400), 0.14); color: var(--color-text-t2, #666); }
    }

    .meta-badge {
      font-size: 11px; line-height: 1; padding: 4px 7px; border-radius: 999px;
      background: rgba(var(--neutral-100), 0.8); color: var(--color-text-t2, #555);
    }

    .ops { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
  }

  // ★ 操作按钮 —— 统一子标签风格
  .op-btn {
    padding: 5px 10px;
    border-radius: 999px;
    border: 1px solid var(--color-line-l3, #ddd);
    background: rgba(var(--neutral-100), 0.8);
    font-size: 11px;
    font-weight: 500;
    color: var(--color-text-t2, #555);
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;

    &:hover {
      border-color: rgba(var(--primary-500), 0.3);
      color: var(--color-primary);
    }

    &.primary {
      background: rgba(var(--primary-500), 0.12);
      color: var(--color-primary);
      border-color: rgba(var(--primary-500), 0.18);
    }

    &.danger {
      background: rgba(var(--orange-red-500), 0.08);
      color: rgba(var(--orange-red-600), 1);
      border-color: rgba(var(--orange-red-500), 0.15);

      &:hover {
        background: rgba(var(--orange-red-500), 0.14);
        border-color: rgba(var(--orange-red-500), 0.3);
      }
    }
  }

  .queue-bar {
    margin-top: 16px; padding: 14px 16px;
    background: rgba(var(--primary-500), 0.04);
    border: 1px solid rgba(var(--primary-500), 0.1);
    border-radius: 18px;
    display: flex; align-items: center; justify-content: space-between;
    flex-wrap: wrap; gap: 12px;

    .qstat {
      display: flex; flex-wrap: wrap; gap: 14px;
      font-size: 13px; color: var(--color-text-t2, #555);
      .ds-item { display: inline-flex; align-items: center; gap: 5px; }
      .dot {
        display: inline-block; width: 8px; height: 8px; border-radius: 50%;
        &.run { background: rgba(var(--blue-600), 1); }
        &.q { background: rgba(var(--neutral-400), 1); }
        &.p { background: rgba(var(--gold-600), 1); }
        &.d { background: rgba(var(--green-600), 1); }
        &.f { background: rgba(var(--orange-red-600), 1); }
      }
    }
    .qops { display: flex; gap: 6px; flex-wrap: wrap; }
  }

  @media (max-width: 768px) {
    .list li { align-items: flex-start; flex-direction: column; }
    .list .ops { width: 100%; justify-content: flex-start; }
  }
}
</style>
