<script setup lang="ts">
// 抖音账号列表 + 触发归档 + 暂停/恢复/终止
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { localApi, type DouyinAccountDTO } from '@/api/local'

const accounts = ref<DouyinAccountDTO[]>([])
const loading = ref(false)

// 每个账号当前 archive 状态：idle / running / paused / stopping / finished
type ArchiveStatus = 'idle' | 'running' | 'paused' | 'stopping' | 'finished'
const archiveStatuses = ref<Record<number, ArchiveStatus>>({})

// 下载队列计数
interface QueueState {
  running: number
  concurrency: number
  paused: boolean
}
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
      accounts.value = [...r.data].sort((a, b) => {
        const aPending = a.secUid.startsWith('pending-') || a.secUid === 'self'
        const bPending = b.secUid.startsWith('pending-') || b.secUid === 'self'
        if (aPending !== bPending) return aPending ? 1 : -1
        return a.id - b.id
      })
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
        queued: d.queued || 0,
        running: d.running || 0,
        done: d.done || 0,
        failed: d.failed || 0,
        paused: d.paused || 0
      }
    }
  } catch {
    /* 静默 */
  }
}

const startPolling = () => {
  if (pollTimer) return
  pollTimer = window.setInterval(refreshProgress, 2000)
}

const archivePause = async (id: number) => {
  try {
    const r = await localApi.archivePause(id)
    if (r.code === 0) {
      ElMessage.success('已暂停（含下载队列）')
      refreshProgress()
    } else ElMessage.error(r.message || '暂停失败')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '请求失败')
  }
}

const archiveResume = async (id: number) => {
  try {
    const r = await localApi.archiveResume(id)
    if (r.code === 0) {
      ElMessage.success('已恢复')
      refreshProgress()
    } else ElMessage.error(r.message || '恢复失败')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '请求失败')
  }
}

const archiveStop = async (id: number) => {
  try {
    await ElMessageBox.confirm('终止当前归档？已下载的部分会保留（断点续传），仍可下次接着下', '提示', {
      type: 'warning'
    })
  } catch { return }
  try {
    const r = await localApi.archiveStop(id)
    if (r.code === 0) {
      ElMessage.success('已终止')
      refreshProgress()
    } else ElMessage.error(r.message || '终止失败')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '请求失败')
  }
}

const downloadPause = async () => {
  try {
    const r = await localApi.downloadPause()
    if (r.code === 0) {
      ElMessage.success('下载已暂停')
      refreshProgress()
    } else ElMessage.error(r.message || '暂停失败')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '请求失败')
  }
}

const downloadResume = async () => {
  try {
    const r = await localApi.downloadResume()
    if (r.code === 0) {
      ElMessage.success('下载已恢复')
      refreshProgress()
    } else ElMessage.error(r.message || '恢复失败')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '请求失败')
  }
}

const downloadStop = async () => {
  try {
    await ElMessageBox.confirm('终止所有下载？已下载的部分保留（断点续传），点「恢复下载」可继续', '提示', {
      type: 'warning'
    })
  } catch { return }
  try {
    const r = await localApi.downloadStop()
    if (r.code === 0) {
      ElMessage.success('下载已终止')
      refreshProgress()
    } else ElMessage.error(r.message || '终止失败')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '请求失败')
  }
}

const removeAcc = async (acc: DouyinAccountDTO) => {
  try {
    await ElMessageBox.confirm(`确定删除账号「${acc.nickname}」？已归档的视频不会被删除。`, '提示', {
      type: 'warning'
    })
  } catch { return }
  try {
    const r = await localApi.douyinDelete(acc.id)
    if (r.code === 0) {
      ElMessage.success('已删除')
      refresh()
    } else {
      ElMessage.error(r.message || '删除失败')
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '请求失败')
  }
}

onMounted(() => {
  refresh()
  refreshProgress()
  startPolling()
})
onBeforeUnmount(() => {
  if (pollTimer) window.clearInterval(pollTimer)
  pollTimer = null
})
defineExpose({ refresh })

const statusLabel = (s: ArchiveStatus): string => {
  switch (s) {
    case 'running': return '抓取中'
    case 'paused': return '已暂停'
    case 'stopping': return '终止中…'
    case 'finished': return '已完成'
    default: return ''
  }
}
</script>

<template>
  <div class="accounts-panel">
    <header>
      <h3>抖音账号</h3>
    </header>

    <div v-if="loading && accounts.length === 0" class="muted">加载中…</div>
    <div v-else-if="accounts.length === 0" class="muted">
      还没有桥接账号 —— 请点击右上角头像 →「绑定浏览器插件」开始。
    </div>
    <ul v-else class="list">
      <li v-for="a in accounts" :key="a.id">
        <img class="avatar" :src="a.avatarUrl || '/favicon.ico'" alt="" />
        <div class="info">
          <p class="name">
            {{ a.nickname }}
            <span class="badge">{{ a.cookieSource }}</span>
            <span v-if="a.cookieSource !== 'bridge' && !a.isValid" class="badge danger">cookie 失效</span>
            <span
              v-if="archiveStatuses[a.id] && archiveStatuses[a.id] !== 'idle'"
              class="badge"
              :class="{ running: archiveStatuses[a.id] === 'running', paused: archiveStatuses[a.id] === 'paused' }"
            >
              {{ statusLabel(archiveStatuses[a.id] as ArchiveStatus) }}
            </span>
          </p>
        </div>
        <div class="ops">
          <template v-if="archiveStatuses[a.id] === 'running'">
            <el-button size="small" @click="archivePause(a.id)">暂停</el-button>
            <el-button size="small" type="danger" plain @click="archiveStop(a.id)">终止</el-button>
          </template>
          <template v-else-if="archiveStatuses[a.id] === 'paused'">
            <el-button size="small" type="primary" plain @click="archiveResume(a.id)">继续</el-button>
            <el-button size="small" type="danger" plain @click="archiveStop(a.id)">终止</el-button>
          </template>
          <el-button size="small" type="danger" plain @click="removeAcc(a)">删除</el-button>
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
        <el-button v-if="!queue.paused" size="small" @click="downloadPause">暂停下载</el-button>
        <el-button v-else size="small" type="primary" plain @click="downloadResume">恢复下载</el-button>
        <el-button size="small" type="danger" plain @click="downloadStop">终止全部</el-button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.accounts-panel {
  header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 12px;
    h3 { margin: 0; font-size: 16px; font-weight: 600; }
  }
  .muted { color: #888; padding: 16px 0; }
  .list {
    list-style: none; padding: 0; margin: 0;
    display: flex; flex-direction: column; gap: 8px;
    li {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 12px;
      background: var(--color-fill-1, #fafafa);
      border-radius: 8px;
    }
    .avatar {
      width: 40px; height: 40px; border-radius: 50%;
      background: #eee; object-fit: cover;
    }
    .info { flex: 1; min-width: 0; }
    .name {
      margin: 0; font-size: 14px; font-weight: 500;
      display: flex; align-items: center; gap: 6px;
    }
    .sec-uid {
      margin: 2px 0 0; font-size: 11px; color: #999;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .badge {
      font-size: 11px; padding: 1px 6px; border-radius: 3px;
      background: #e6f1fc; color: #1d72d6;
      &.danger { background: #fdebec; color: #d24a52; }
      &.running { background: #fff5e6; color: #d68b1d; }
      &.paused { background: #f0f0f0; color: #666; }
    }
    .ops {
      display: flex; gap: 6px;
    }
  }
  .queue-bar {
    margin-top: 12px;
    padding: 10px 14px;
    background: var(--color-fill-1, #fafafa);
    border: 1px dashed var(--color-line-l3, #ddd);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;

    .qstat {
      display: flex; flex-wrap: wrap; gap: 14px; font-size: 13px; color: #555;
      .ds-item { display: inline-flex; align-items: center; gap: 5px; }
      .dot {
        display: inline-block; width: 8px; height: 8px; border-radius: 50%;
        &.run { background: #1d72d6; }
        &.q { background: #aaa; }
        &.p { background: #d68b1d; }
        &.d { background: #29a25c; }
        &.f { background: #d24a52; }
      }
    }
    .qops { display: flex; gap: 6px; }
  }
}
</style>
