<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onMounted, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { localApi, type VideoListItem, type VideoListQuery, type FolderListItem } from '@/api/local'

const props = defineProps<{
  contentKind?: VideoListQuery['contentKind']
  linkKind?: VideoListQuery['linkKind']
  length?: VideoListQuery['length'] | null
  keyword?: string
  folderId?: number | null
  mixId?: number | null
}>()

const emit = defineEmits<{
  (e: 'play', item: VideoListItem): void
  (e: 'folders-changed'): void
  (e: 'extract-audio', ids: number[]): void
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
      : props.mixId
        ? await localApi.listMixVideos(props.mixId, page.value, size.value).then((resp) =>
            resp.code === 0
              ? { ...resp, data: resp.data.videos }
              : { code: resp.code, message: resp.message, data: { total: 0, page: 1, size: 20, items: [] } }
          )
      : await localApi.listVideos({
          contentKind: props.contentKind ?? 'VIDEO',
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
  () => [props.contentKind, props.linkKind, props.length, props.keyword, props.folderId, props.mixId],
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

const extractAudio = async () => {
  console.log('[VideoGrid.extractAudio] clicked, selectedCount:', selectedCount.value, 'selectedIds:', Array.from(selectedIds.value))
  if (selectedCount.value === 0) {
    console.warn('[VideoGrid.extractAudio] no items selected, return')
    return
  }
  const ids = Array.from(selectedIds.value)
  console.log('[VideoGrid.extractAudio] emitting extract-audio with ids:', ids)
  emit('extract-audio', ids)
}

const downloadSelected = async () => {
  if (selectedCount.value === 0) return
  const ids = Array.from(selectedIds.value)
  emit('download', ids)
}

defineExpose({
  refresh: fetchList,
  items: items
})

onMounted(openProgressWs)
onMounted(startRefreshPolling)
onBeforeUnmount(closeProgressWs)
onBeforeUnmount(stopRefreshPolling)
</script>

<template>
  <div class="video-grid">
    <div class="toolbar">
      <button class="tool-btn" :disabled="items.length === 0" @click="selectAllOnPage">
        {{ allSelectedOnPage ? '取消全选' : '全选' }}
      </button>
      <button class="tool-btn" :disabled="items.length === 0" @click="invertOnPage">反选</button>
      <button
        v-if="!folderId"
        class="tool-btn"
        :disabled="selectedCount === 0"
        @click="addToFolder"
      >
        添加到收藏夹
      </button>
      <button
        class="tool-btn"
        :disabled="selectedCount === 0"
        @click="extractAudio"
      >
        提取音频
      </button>
      <button
        class="tool-btn"
        :disabled="selectedCount === 0"
        @click="downloadSelected"
      >
        下载
      </button>
      <button
        class="tool-btn danger"
        :disabled="selectedCount === 0"
        :class="{ loading: deleting }"
        @click="deleteSelected"
      >
        {{ folderId ? '移除' : '删除' }}
      </button>
      <span class="tool-info">本页 {{ items.length }} / 全部 {{ total }}，已选 {{ selectedCount }}</span>
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
    margin-bottom: 16px;
    padding: 14px 16px;
    border: 1px solid var(--color-line-l3, #eee);
    border-radius: 18px;
    background: rgba(var(--white), 0.86);
  }

  .tool-btn {
    padding: 6px 11px;
    border-radius: 999px;
    border: 1px solid var(--color-line-l3, #ddd);
    background: rgba(var(--neutral-100), 0.8);
    font-size: 12px;
    font-weight: 500;
    color: var(--color-text-t2, #555);
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;

    &:hover:not(:disabled) {
      border-color: rgba(var(--primary-500), 0.3);
      color: var(--color-primary);
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    &.danger {
      background: rgba(var(--orange-red-500), 0.08);
      color: rgba(var(--orange-red-600), 1);
      border-color: rgba(var(--orange-red-500), 0.15);

      &:hover:not(:disabled) {
        background: rgba(var(--orange-red-500), 0.14);
        border-color: rgba(var(--orange-red-500), 0.3);
      }
    }

    &.loading {
      opacity: 0.7;
      cursor: wait;
    }
  }

  .tool-info {
    font-size: 12px;
    color: var(--color-text-t3, #888);
    margin-left: auto;
  }

  .state {
    text-align: center;
    padding: 56px 20px;
    border: 1px dashed var(--color-line-l3, #eee);
    border-radius: 22px;
    background: rgba(var(--white), 0.78);

    .muted { color: var(--color-text-t3, #888); }
  }

  .grid {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 18px;
  }

  .card {
    cursor: pointer;
    border-radius: 22px;
    overflow: hidden;
    background:
      linear-gradient(180deg, rgba(var(--white), 0.98), rgba(var(--neutral-50), 0.92));
    transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
    position: relative;
    border: 1px solid var(--color-line-l3, rgba(31, 29, 24, 0.08));
    box-shadow: 0 12px 30px rgba(17, 18, 23, 0.05);

    &:hover {
      transform: translateY(-4px);
      box-shadow: 0 18px 36px rgba(17, 18, 23, 0.08);
    }

    &.selected {
      border-color: rgba(var(--primary-500), 0.24);
      box-shadow:
        0 18px 36px rgba(17, 18, 23, 0.08),
        0 0 0 2px rgba(var(--primary-500), 0.14) inset;
    }

    .pick {
      position: absolute;
      top: 10px;
      left: 10px;
      z-index: 2;
      width: 28px;
      height: 28px;
      padding: 0;
      border: none;
      border-radius: 999px;
      background: rgba(var(--white), 0.94);
      display: grid;
      place-items: center;
      box-shadow: 0 6px 14px rgba(17, 18, 23, 0.12);
    }

    .dot {
      width: 14px;
      height: 14px;
      border-radius: 999px;
      border: 1.5px solid rgba(var(--neutral-500), 0.45);
      background: transparent;

      &.on {
        background: var(--color-primary);
        border-color: var(--color-primary);
        box-shadow: 0 0 0 3px rgba(var(--white), 0.92) inset;
      }
    }
  }

  .cover {
    position: relative;
    aspect-ratio: 3 / 4;
    background: #000;

    &::after {
      content: '';
      position: absolute;
      inset: auto 0 0;
      height: 40%;
      background: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.4));
      pointer-events: none;
    }

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .cover-placeholder {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: rgba(var(--white), 0.72);
      background: linear-gradient(135deg, #222833, #0d1118);
    }

    .duration {
      position: absolute;
      bottom: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.64);
      color: #fff;
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 12px;
      z-index: 1;
    }

    .status {
      position: absolute;
      top: 10px;
      right: 10px;
      background: rgba(var(--orange-red-500), 0.88);
      color: #fff;
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 12px;
      z-index: 1;
    }
  }

  .meta {
    padding: 14px 14px 16px;

    .title {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      line-height: 1.45;
      color: var(--color-text-t1);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .author {
      margin: 6px 0 0;
      font-size: 12px;
      color: var(--color-text-t3, #888);
    }
  }

  .pagination {
    margin-top: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--color-text-t3, #888);
    font-size: 13px;
    padding: 14px 16px;
    border: 1px solid var(--color-line-l3, #eee);
    border-radius: 18px;
    background: rgba(var(--white), 0.82);
  }
}
</style>
