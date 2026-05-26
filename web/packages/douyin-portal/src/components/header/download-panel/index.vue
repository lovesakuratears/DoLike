<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { localApi, type DownloadTaskItem } from '@/api/local'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', value: boolean): void }>()

const tasks = ref<DownloadTaskItem[]>([])
const loading = ref(false)
let timer: number | null = null

const refresh = async () => {
  loading.value = true
  try {
    const r = await localApi.downloadTasks()
    if (r.code === 0) tasks.value = r.data.items
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '加载下载任务失败')
  } finally {
    loading.value = false
  }
}

const startPolling = () => {
  if (timer) return
  timer = window.setInterval(() => { void refresh() }, 2000)
}

const stopPolling = () => {
  if (timer) window.clearInterval(timer)
  timer = null
}

watch(() => props.open, v => {
  if (v) {
    void refresh()
    startPolling()
  } else {
    stopPolling()
  }
}, { immediate: true })

onBeforeUnmount(stopPolling)

const pct = (item: DownloadTaskItem) => {
  const done = Number(item.bytesDone || '0')
  const total = Number(item.bytesTotal || '0')
  if (!total || total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)))
}

const humanBytes = (raw: string | null) => {
  const n = Number(raw || '0')
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

interface AggregatedTask {
  contentId: number
  title: string
  authorName: string
  status: string
  bytesDone: number
  bytesTotal: number
  lastError: string | null
  taskIds: number[]
  kinds: string[]
  canResume: boolean
  finishedAt: string | null
}

const groupedTasks = computed<AggregatedTask[]>(() => {
  const map = new Map<number, AggregatedTask>()
  for (const item of tasks.value) {
    const existing = map.get(item.contentId)
    const bytesDone = Number(item.bytesDone || '0')
    const bytesTotal = Number(item.bytesTotal || '0')
    if (!existing) {
      map.set(item.contentId, {
        contentId: item.contentId,
        title: item.title,
        authorName: item.authorName,
        status: item.status,
        bytesDone,
        bytesTotal,
        lastError: item.lastError,
        taskIds: [item.id],
        kinds: [item.kind],
        canResume: ['failed', 'paused'].includes(item.status),
        finishedAt: item.finishedAt
      })
      continue
    }
    existing.taskIds.push(item.id)
    if (!existing.kinds.includes(item.kind)) existing.kinds.push(item.kind)
    existing.bytesDone += bytesDone
    existing.bytesTotal += bytesTotal
    if (existing.status !== 'running' && item.status === 'running') existing.status = 'running'
    else if (existing.status === 'done' && item.status !== 'done') existing.status = item.status
    if (item.lastError) existing.lastError = item.lastError
    if (['failed', 'paused'].includes(item.status)) existing.canResume = true
    if (item.finishedAt && (!existing.finishedAt || item.finishedAt > existing.finishedAt)) {
      existing.finishedAt = item.finishedAt
    }
  }
  return Array.from(map.values()).sort((a, b) => b.contentId - a.contentId)
})

const activeTasks = computed(() => groupedTasks.value.filter(t => ['queued', 'running', 'paused'].includes(t.status)))
const historyTasks = computed(() => groupedTasks.value.filter(t => ['done', 'failed'].includes(t.status)))

const resumeTask = async (item: AggregatedTask) => {
  try {
    for (const id of item.taskIds) {
      await localApi.downloadTaskResume(id)
    }
    ElMessage.success('已加入继续下载')
    await refresh()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '请求失败')
  }
}

const deleteTask = async (item: AggregatedTask) => {
  try {
    for (const id of item.taskIds) {
      await localApi.downloadTaskDelete(id)
    }
    ElMessage.success('已删除任务')
    await refresh()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '请求失败')
  }
}

const pauseAll = async () => {
  await localApi.downloadPause()
  await refresh()
}
const resumeAll = async () => {
  await localApi.downloadResume()
  await refresh()
}

const fmtTime = (iso: string | null) => {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString()
}
</script>

<template>
  <el-dialog
    :model-value="open"
    @update:model-value="emit('update:open', $event)"
    title="下载"
    width="760px"
    :close-on-click-modal="false"
    :append-to-body="true"
  >
    <div class="toolbar">
      <el-button size="small" @click="pauseAll">暂停全部</el-button>
      <el-button size="small" type="primary" plain @click="resumeAll">继续全部</el-button>
      <span class="count">进行中 {{ activeTasks.length }} / 历史 {{ historyTasks.length }}</span>
    </div>

    <section class="section">
      <h4>正在下载</h4>
      <div v-if="loading && tasks.length === 0" class="empty">加载中…</div>
      <div v-else-if="activeTasks.length === 0" class="empty">暂无进行中的下载</div>
      <div v-else class="task-list">
        <div v-for="item in activeTasks" :key="item.contentId" class="task-card">
          <div class="top">
            <div>
              <p class="title">{{ item.title || '未命名内容' }}</p>
              <p class="meta">{{ item.authorName }} · {{ item.kinds.join('+') }} · {{ item.status }}</p>
            </div>
            <div class="ops">
              <el-button v-if="item.canResume" size="small" @click="resumeTask(item)">继续</el-button>
              <el-button size="small" type="danger" plain @click="deleteTask(item)">删除</el-button>
            </div>
          </div>
          <el-progress :percentage="pct(item)" :stroke-width="8" />
          <p class="meta">{{ humanBytes(String(item.bytesDone)) }} / {{ humanBytes(String(item.bytesTotal || 0)) }}</p>
        </div>
      </div>
    </section>

    <section class="section">
      <h4>下载历史</h4>
      <div v-if="historyTasks.length === 0" class="empty">暂无历史任务</div>
      <div v-else class="task-list">
        <div v-for="item in historyTasks" :key="item.contentId" class="task-card">
          <div class="top">
            <div>
              <p class="title">{{ item.title || '未命名内容' }}</p>
              <p class="meta">{{ item.authorName }} · {{ item.kinds.join('+') }} · {{ item.status }}</p>
              <p class="meta">完成时间：{{ fmtTime(item.finishedAt) }}</p>
              <p v-if="item.lastError" class="error">{{ item.lastError }}</p>
            </div>
            <div class="ops">
              <el-button v-if="item.canResume" size="small" @click="resumeTask(item)">继续</el-button>
              <el-button size="small" type="danger" plain @click="deleteTask(item)">删除</el-button>
            </div>
          </div>
        </div>
      </div>
    </section>
  </el-dialog>
</template>

<style lang="scss" scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  .count {
    margin-left: auto;
    color: #888;
    font-size: 12px;
  }
}
.section {
  margin-top: 14px;
  h4 {
    margin: 0 0 10px;
    font-size: 14px;
  }
}
.empty {
  color: #999;
  padding: 18px 0;
}
.task-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.task-card {
  padding: 12px;
  border-radius: 10px;
  background: #f7f7f7;
  .top {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  }
  .title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }
  .meta {
    margin: 4px 0 0;
    font-size: 12px;
    color: #888;
  }
  .error {
    margin: 6px 0 0;
    font-size: 12px;
    color: #d24a52;
  }
  .ops {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }
}
</style>
