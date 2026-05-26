<script setup lang="ts">
// 实时日志面板 —— 通过 /ws/logs 拉服务端 pino 日志
//
// 行为：
//   - 打开时连接 WS；收 log.replay（一次性回放最近 500 条）→ 之后 log.append
//   - 支持暂停 / 清屏 / 过滤等级 / 搜索关键字
//   - 自动滚到底（用户向上拖动后自动暂停 autoScroll）
//   - 关闭面板（v-model:open=false）时断开 WS

import { computed, nextTick, ref, watch } from 'vue'

interface LogRecord {
  level: number
  time: number
  msg?: string
  pid?: number
  hostname?: string
  reqId?: string | number
  [k: string]: unknown
}

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', value: boolean): void }>()

const records = ref<LogRecord[]>([])
const paused = ref(false)
const autoScroll = ref(true)
const keyword = ref('')
const minLevel = ref<number>(10) // 10=trace 20=debug 30=info 40=warn 50=error 60=fatal
const wsState = ref<'idle' | 'connecting' | 'open' | 'closed' | 'error'>('idle')

let ws: WebSocket | null = null
const logBox = ref<HTMLDivElement | null>(null)

const MAX_KEEP = 1000

const closeWs = () => {
  if (ws) {
    try { ws.close() } catch { /* ignore */ }
    ws = null
  }
  wsState.value = 'closed'
}

const openWs = () => {
  closeWs()
  wsState.value = 'connecting'
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/logs`
  ws = new WebSocket(url)
  ws.onopen = () => { wsState.value = 'open' }
  ws.onmessage = ev => {
    if (paused.value) return
    try {
      const data = JSON.parse(ev.data)
      if (data.type === 'log.replay' && Array.isArray(data.records)) {
        records.value = data.records.slice(-MAX_KEEP)
        scrollToBottomSoon()
      } else if (data.type === 'log.append' && data.record) {
        records.value.push(data.record as LogRecord)
        if (records.value.length > MAX_KEEP) {
          records.value.splice(0, records.value.length - MAX_KEEP)
        }
        scrollToBottomSoon()
      } else if (data.type === 'auth.failed') {
        wsState.value = 'error'
      }
    } catch { /* ignore parse error */ }
  }
  ws.onerror = () => { wsState.value = 'error' }
  ws.onclose = () => { if (wsState.value !== 'error') wsState.value = 'closed' }
}

const scrollToBottomSoon = () => {
  if (!autoScroll.value) return
  nextTick(() => {
    const el = logBox.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

const onScroll = () => {
  const el = logBox.value
  if (!el) return
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  autoScroll.value = atBottom
}

const clear = () => { records.value = [] }
const togglePause = () => { paused.value = !paused.value }

const levelLabel = (lv: number): string => {
  if (lv >= 60) return 'FATAL'
  if (lv >= 50) return 'ERROR'
  if (lv >= 40) return 'WARN'
  if (lv >= 30) return 'INFO'
  if (lv >= 20) return 'DEBUG'
  return 'TRACE'
}

const levelClass = (lv: number): string => {
  if (lv >= 50) return 'lv-error'
  if (lv >= 40) return 'lv-warn'
  if (lv >= 30) return 'lv-info'
  return 'lv-debug'
}

const fmtTime = (t: number): string => {
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

const summarize = (rec: LogRecord): string => {
  const { level, time, pid, hostname, msg, err, v, name, ...rest } = rec
  const parts: string[] = []
  if (msg) parts.push(String(msg))
  if (err && typeof err === 'object') {
    const e = err as { type?: string; message?: string; stack?: string }
    if (e.message) parts.push(`→ ${e.type ? e.type + ': ' : ''}${e.message}`)
    if (e.stack) parts.push(e.stack)
  }
  const restKeys = Object.keys(rest)
  if (restKeys.length) {
    try {
      parts.push(JSON.stringify(rest))
    } catch { /* circular */ }
  }
  return parts.join('\n')
}

const visible = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return records.value.filter(r => {
    if (r.level < minLevel.value) return false
    if (!kw) return true
    return summarize(r).toLowerCase().includes(kw)
  })
})

watch(() => props.open, v => {
  if (v) {
    records.value = []
    paused.value = false
    autoScroll.value = true
    openWs()
  } else {
    closeWs()
  }
}, { immediate: true })

const stateText = computed(() => {
  switch (wsState.value) {
    case 'connecting': return '连接中…'
    case 'open': return paused.value ? '已暂停' : '实时'
    case 'closed': return '已断开'
    case 'error': return '连接失败'
    default: return ''
  }
})

const onClose = () => { emit('update:open', false) }
</script>

<template>
  <el-dialog
    :model-value="open"
    @update:model-value="emit('update:open', $event)"
    title="服务端日志"
    width="780px"
    :close-on-click-modal="false"
    :append-to-body="true"
    class="log-panel-dialog"
  >
    <div class="toolbar">
      <el-input v-model="keyword" placeholder="搜索关键字…" size="small" clearable style="width: 220px" />
      <el-select v-model="minLevel" size="small" style="width: 110px">
        <el-option label="全部" :value="10" />
        <el-option label="DEBUG+" :value="20" />
        <el-option label="INFO+" :value="30" />
        <el-option label="WARN+" :value="40" />
        <el-option label="ERROR+" :value="50" />
      </el-select>
      <el-button size="small" @click="togglePause">{{ paused ? '继续' : '暂停' }}</el-button>
      <el-button size="small" @click="clear">清屏</el-button>
      <span class="state" :class="wsState">● {{ stateText }}</span>
      <span class="count">{{ visible.length }} / {{ records.length }}</span>
    </div>

    <div class="log-box" ref="logBox" @scroll="onScroll">
      <div v-for="(rec, i) in visible" :key="i" class="row" :class="levelClass(rec.level)">
        <span class="time">{{ fmtTime(rec.time) }}</span>
        <span class="lv">{{ levelLabel(rec.level) }}</span>
        <span class="msg">{{ summarize(rec) }}</span>
      </div>
      <div v-if="!visible.length" class="empty">暂无匹配的日志</div>
    </div>

    <template #footer>
      <el-button @click="onClose">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style lang="scss" scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
  .state {
    margin-left: 8px;
    font-size: 12px;
    color: #999;
    &.open { color: #67c23a; }
    &.connecting { color: #e6a23c; }
    &.error { color: #f56c6c; }
    &.closed { color: #999; }
  }
  .count {
    margin-left: auto;
    font-size: 12px;
    color: #999;
  }
}

.log-box {
  height: 480px;
  overflow-y: auto;
  background: #1e1e1e;
  color: #ddd;
  font-family: SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  padding: 8px 12px;
  border-radius: 6px;
  .row {
    display: flex;
    gap: 8px;
    padding: 1px 0;
    word-break: break-all;
  }
  .time { color: #888; flex-shrink: 0; }
  .lv {
    flex-shrink: 0;
    width: 50px;
    text-align: center;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.06);
    font-size: 11px;
  }
  .msg { flex: 1; white-space: pre-wrap; }
  .lv-error .lv { background: #d24a52; color: #fff; }
  .lv-error .msg { color: #ff8a8a; }
  .lv-warn  .lv { background: #c98d2e; color: #fff; }
  .lv-warn  .msg { color: #f5cf7d; }
  .lv-info  .lv { background: #3c6e9a; color: #fff; }
  .lv-debug .lv { background: rgba(255,255,255,0.12); color: #aaa; }
  .empty {
    text-align: center;
    color: #777;
    padding: 32px 0;
  }
}
</style>
