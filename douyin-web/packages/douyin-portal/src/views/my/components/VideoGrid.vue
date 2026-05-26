<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onMounted, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { localApi, type VideoListItem, type VideoListQuery, type FolderListItem } from '@/api/local'

const props = defineProps<{
  linkKind?: VideoListQuery['linkKind']
  length?: VideoListQuery['length']
  keyword?: string
  folderId?: number | null
}>()

const emit = defineEmits<{
  (e: 'play', item: VideoListItem): void
  (e: 'folders-changed'): void
}>()

const items = ref<VideoListItem[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(20)
const loading = ref(false)
const deleting = ref(false)

const selectedIds = ref<Set<number>>(new Set())

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / size.value)))
const selectedCount = computed(() => selectedIds.value.size)
const allSelectedOnPage = computed(() =>
  items.value.length > 0 && items.value.every((it) => selectedIds.value.has(it.id))
)

const fetchList = async () => {
  loading.value = true
  try {
    const r = props.folderId
      ? await localApi.listFolderVideos(props.folderId, page.value, size.value)
      : await localApi.listVideos({
          linkKind: props.linkKind ?? 'all',
          length: props.length ?? 'all',
          q: props.keyword || undefined,
          page: page.value,
          size: size.value
        })
    if (r.code === 0) {
      items.value = r.data.items
      total.value = r.data.total
    } else {
      ElMessage.error(r.message || '加载失败')
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '请求失败')
  } finally {
    loading.value = false
  }
}

let ws: WebSocket | null = null
let refreshTimer: number | null = null

const openProgressWs = () => {
  if (ws) return
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/progress`
  ws = new WebSocket(url)
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data || '{}')
      if (msg?.type === 'download.done' || msg?.type === 'download.failed') {
        void fetchList()
      }
    } catch {
      // ignore
    }
  }
  ws.onclose = () => { ws = null }
  ws.onerror = () => { ws = null }
}

const closeProgressWs = () => {
  if (!ws) return
  try { ws.close() } catch { /* ignore */ }
  ws = null
}

const startRefreshPolling = () => {
  if (refreshTimer) return
  refreshTimer = window.setInterval(() => {
    void fetchList()
  }, 3000)
}

const stopRefreshPolling = () => {
  if (refreshTimer) window.clearInterval(refreshTimer)
  refreshTimer = null
}

watch(
  () => [props.linkKind, props.length, props.keyword, props.folderId],
  () => {
    page.value = 1
    selectedIds.value = new Set()
    void fetchList()
  },
  { immediate: true }
)

const goPage = (p: number) => {
  page.value = Math.max(1, Math.min(totalPages.value, p))
  void fetchList()
}

const formatDuration = (s: number): string => {
  if (s <= 0) return '0:00'
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

const coverSrc = (it: VideoListItem) => (it.coverPath ? `/media/${it.coverPath}` : '')

const onCardClick = (it: VideoListItem) => {
  emit('play', it)
}

const toggleOne = (id: number) => {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

const selectAllOnPage = () => {
  if (allSelectedOnPage.value) {
    selectedIds.value = new Set()
    return
  }
  selectedIds.value = new Set(items.value.map((it) => it.id))
}

const invertOnPage = () => {
  const next = new Set<number>()
  for (const it of items.value) {
    if (!selectedIds.value.has(it.id)) next.add(it.id)
  }
  selectedIds.value = next
}

const fmtBytes = (n: number): string => {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB'
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

const deleteSelected = async () => {
  if (selectedCount.value === 0) return

  if (props.folderId) {
    try {
      await ElMessageBox.confirm(`从当前收藏夹移除 ${selectedCount.value} 个视频？视频文件本身不会删除。`, '从收藏夹移除', {
        type: 'warning',
        confirmButtonText: '移除',
        confirmButtonClass: 'el-button--danger'
      })
    } catch {
      return
    }
    try {
      const r = await localApi.removeFolderItems(props.folderId, Array.from(selectedIds.value))
      if (r.code === 0) {
        ElMessage.success(`已移除 ${r.data.removed} 个视频`)
        selectedIds.value = new Set()
        emit('folders-changed')
        await fetchList()
      } else {
        ElMessage.error(r.message || '移除失败')
      }
    } catch (e: any) {
      ElMessage.error(e?.response?.data?.message || e?.message || '请求失败')
    }
    return
  }

  try {
    await ElMessageBox.confirm(
      `将从「视频」中移除 ${selectedCount.value} 个并清理本地文件（视频/封面/.part）。\n保留去重记录，下次增量归档不会重新下载。\n确定？`,
      '从视频中移除',
      { type: 'warning', confirmButtonText: '移除', confirmButtonClass: 'el-button--danger' }
    )
  } catch {
    return
  }
  deleting.value = true
  try {
    const ids = Array.from(selectedIds.value)
    const r = await localApi.batchDeleteContents(ids)
    if (r.code === 0) {
      ElMessage.success(`已移除 ${r.data.hidden} 个（跳过 ${r.data.skipped}），释放 ${fmtBytes(r.data.freedBytes)}`)
      selectedIds.value = new Set()
      if (items.value.length === ids.length && page.value > 1) page.value -= 1
      await fetchList()
      emit('folders-changed')
    } else {
      ElMessage.error(r.message || '移除失败')
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '请求失败')
  } finally {
    deleting.value = false
  }
}

const addToFolder = async () => {
  if (selectedCount.value === 0) return
  let folders: FolderListItem[] = []
  try {
    const resp = await localApi.listFolders()
    if (resp.code !== 0) throw new Error(resp.message || '加载收藏夹失败')
    folders = resp.data
  } catch (e: any) {
    ElMessage.error(e?.message || '加载收藏夹失败')
    return
  }
  if (folders.length === 0) {
    ElMessage.warning('请先创建收藏夹')
    return
  }
  try {
    const { value } = await ElMessageBox.prompt(
      `输入要加入的收藏夹 ID：\n${folders.map((folder) => `${folder.id} - ${folder.name}`).join('\n')}`,
      '加入收藏夹',
      {
        inputPattern: /^\d+$/,
        inputErrorMessage: '请输入有效的收藏夹 ID'
      }
    )
    const folderId = Number(value)
    const r = await localApi.addFolderItems(folderId, Array.from(selectedIds.value))
    if (r.code === 0) {
      ElMessage.success(`已加入 ${r.data.added} 条到收藏夹`)
      emit('folders-changed')
    } else {
      ElMessage.error(r.message || '加入收藏夹失败')
    }
  } catch {
    // cancel
  }
}

defineExpose({
  refresh: fetchList
})

onMounted(openProgressWs)
onMounted(startRefreshPolling)
onBeforeUnmount(closeProgressWs)
onBeforeUnmount(stopRefreshPolling)
</script>

<template>
  <div class="video-grid">
    <div class="toolbar">
      <el-button size="small" :disabled="items.length === 0" @click="selectAllOnPage">
        {{ allSelectedOnPage ? '取消全选' : '全选' }}
      </el-button>
      <el-button size="small" :disabled="items.length === 0" @click="invertOnPage">反选</el-button>
      <el-button
        v-if="!folderId"
        size="small"
        :disabled="selectedCount === 0"
        @click="addToFolder"
      >
        添加到收藏夹
      </el-button>
      <el-button
        size="small"
        type="danger"
        :disabled="selectedCount === 0"
        :loading="deleting"
        @click="deleteSelected"
      >
        {{ folderId ? `移除（${selectedCount}）` : `删除（${selectedCount}）` }}
      </el-button>
      <span class="muted small">本页 {{ items.length }} / 全部 {{ total }}，已选 {{ selectedCount }}</span>
    </div>

    <div v-if="loading && items.length === 0" class="state">加载中…</div>
    <div v-else-if="items.length === 0" class="state">
      <p class="muted">这里还没有内容。</p>
    </div>
    <ul v-else class="grid">
      <li
        v-for="it in items"
        :key="it.id"
        class="card"
        :class="{ selected: selectedIds.has(it.id) }"
        @click="onCardClick(it)"
      >
        <button class="pick" @click.stop="toggleOne(it.id)">
          <span class="dot" :class="{ on: selectedIds.has(it.id) }"></span>
        </button>
        <div class="cover">
          <img v-if="it.coverPath" :src="coverSrc(it)" alt="" loading="lazy" />
          <div v-else class="cover-placeholder">暂无封面</div>
          <span class="duration">{{ formatDuration(it.durationSec) }}</span>
          <span v-if="it.status !== 'done'" class="status">{{ it.status }}</span>
        </div>
        <div class="meta">
          <p class="title">{{ it.title }}</p>
          <p class="author">{{ it.authorName }} · {{ it.linkKinds.join('/') }}</p>
        </div>
      </li>
    </ul>

    <div v-if="totalPages > 1" class="pagination">
      <el-button size="small" :disabled="page <= 1" @click="goPage(page - 1)">上一页</el-button>
      <span>{{ page }} / {{ totalPages }}（共 {{ total }}）</span>
      <el-button size="small" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</el-button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.video-grid {
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
    .muted { color: #888; }
    .small { font-size: 12px; }
  }
  .state {
    text-align: center;
    padding: 40px 0;
    .muted { color: #888; }
  }
  .grid {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 16px;
  }
  .card {
    cursor: pointer;
    border-radius: 18px;
    overflow: hidden;
    background: #faf7f1;
    transition: transform 0.15s, box-shadow 0.15s;
    position: relative;
    border: 1px solid rgba(31, 29, 24, 0.08);
    &:hover { transform: translateY(-2px); }
    &.selected {
      box-shadow: 0 0 0 2px rgba(187, 205, 197, 0.92) inset;
    }
    .pick {
      position: absolute;
      top: 8px; left: 8px;
      z-index: 2;
      width: 28px;
      height: 28px;
      padding: 0;
      border: none;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.92);
      display: grid;
      place-items: center;
    }
    .dot {
      width: 14px;
      height: 14px;
      border-radius: 999px;
      border: 1.5px solid rgba(31, 29, 24, 0.35);
      background: transparent;
      &.on {
        background: #BBCDC5;
        border-color: #BBCDC5;
        box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.9) inset;
      }
    }
  }
  .cover {
    position: relative;
    aspect-ratio: 3 / 4;
    background: #000;
    img { width: 100%; height: 100%; object-fit: cover; }
    .cover-placeholder {
      width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center;
      color: #888; background: #222;
    }
    .duration {
      position: absolute; bottom: 8px; right: 8px;
      background: rgba(0,0,0,0.6); color: #fff;
      padding: 2px 6px; border-radius: 999px; font-size: 12px;
    }
    .status {
      position: absolute; top: 8px; right: 8px;
      background: rgba(245,108,108,0.85); color: #fff;
      padding: 2px 6px; border-radius: 999px; font-size: 12px;
    }
  }
  .meta {
    padding: 10px 12px 12px;
    .title {
      margin: 0;
      font-size: 13px;
      line-height: 1.4;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .author {
      margin: 4px 0 0;
      font-size: 12px;
      color: #888;
    }
  }
  .pagination {
    margin-top: 16px;
    display: flex; align-items: center; justify-content: center;
    gap: 12px;
    color: #888; font-size: 13px;
  }
}
</style>
