<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onMounted, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { localApi, type VideoListItem } from '@/api/local'

const props = defineProps<{
  keyword?: string
}>()

const emit = defineEmits<{
  (e: 'play', item: VideoListItem): void
}>()

const items = ref<VideoListItem[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(24)
const loading = ref(false)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / size.value)))

const fetchList = async () => {
  loading.value = true
  try {
    const r = await localApi.listExtractedAudio(page.value, size.value)
    if (r.code === 0) {
      const keyword = (props.keyword || '').trim().toLowerCase()
      const filtered = keyword
        ? r.data.items.filter((item) => {
            const title = (item.title || '').toLowerCase()
            const author = (item.authorName || '').toLowerCase()
            const awemeId = (item.awemeId || '').toLowerCase()
            return title.includes(keyword) || author.includes(keyword) || awemeId.includes(keyword)
          })
        : r.data.items

      items.value = filtered
      total.value = r.data.total
    } else {
      ElMessage.error(r.message || '加载音频失败')
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '加载音频失败')
  } finally {
    loading.value = false
  }
}

let ws: WebSocket | null = null

const openProgressWs = () => {
  if (ws) return
  const url = location.protocol === 'https:' ? 'wss' : 'ws' + '://' + location.host + '/ws/progress'
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

const coverSrc = (item: VideoListItem) => (item.coverPath ? '/media/' + item.coverPath : '')

const formatDuration = (s: number): string => {
  if (s <= 0) return '0:00'
  const m = Math.floor(s / 60)
  const r = s % 60
  return m + ':' + String(r).padStart(2, '0')
}

const formatDate = (iso: string): string => {
  const d = new Date(iso)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

const goPage = (next: number) => {
  page.value = Math.max(1, Math.min(totalPages.value, next))
}

watch(() => props.keyword, () => {
  page.value = 1
  void fetchList()
})

watch(page, () => {
  void fetchList()
}, { immediate: true })

// 下载单个音频到本地
const downloading = ref<Set<number>>(new Set())

const downloadOne = async (item: VideoListItem) => {
  if (downloading.value.has(item.id)) return
  if (!item.mediaPath) {
    ElMessage.warning('音频文件尚未下载完成')
    return
  }
  downloading.value = new Set(downloading.value).add(item.id)
  try {
    const url = '/media/' + item.mediaPath
    const response = await fetch(url)
    if (!response.ok) throw new Error('下载失败')
    const blob = await response.blob()
    if (blob.size < 1000) throw new Error('文件无效')
    const blobUrl = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = (item.title || 'audio') + '.mp3'
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(blobUrl)
    ElMessage.success('下载成功')
  } catch (e: any) {
    ElMessage.error(e?.message || '下载失败')
  } finally {
    const next = new Set(downloading.value)
    next.delete(item.id)
    downloading.value = next
  }
}

// 删除单个音频
const selectedIds = ref<Set<number>>(new Set())

const selectedCount = computed(() => selectedIds.value.size)
const allSelectedOnPage = computed(() =>
  items.value.length > 0 && items.value.every((it) => selectedIds.value.has(it.id))
)

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
    if (!selectedIds.value.has(it.id)) next.add(it)
  }
  selectedIds.value = next
}

const deleting = ref<Set<number>>(new Set())

const deleteOne = async (item: VideoListItem) => {
  if (deleting.value.has(item.id)) return
  try {
    await ElMessageBox.confirm(
      '确定删除「' + item.title + '」？本地文件也将被清理。',
      '删除音频',
      {
        type: 'warning',
        confirmButtonText: '删除',
        confirmButtonClass: 'el-button--danger'
      }
    )
  } catch {
    return
  }
  deleting.value = new Set(deleting.value).add(item.id)
  try {
    const r = await localApi.deleteExtractedAudio(item.id)
    if (r.code === 0) {
      ElMessage.success('已删除')
      await fetchList()
    } else {
      ElMessage.error(r.message || '删除失败')
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '删除失败')
  } finally {
    const next = new Set(deleting.value)
    next.delete(item.id)
    deleting.value = next
  }
}

const downloadSelected = async () => {
  if (selectedCount.value === 0) return
  let successCount = 0
  for (const id of selectedIds.value) {
    const item = items.value.find((it) => it.id === id)
    if (!item) continue
    if (!item.mediaPath) {
      ElMessage.warning(`「${item.title}」尚未下载完成，跳过`)
      continue
    }
    try {
      const url = '/media/' + item.mediaPath
      const response = await fetch(url)
      if (!response.ok) throw new Error('下载失败')
      const blob = await response.blob()
      if (blob.size < 1000) throw new Error('文件无效')
      const blobUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = (item.title || 'audio') + '.mp3'
      link.style.display = 'none'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(blobUrl)
      successCount++
    } catch (e: any) {
      ElMessage.error(`「${item.title}」下载失败：${e?.message || ''}`)
    }
  }
  if (successCount > 0) {
    ElMessage.success(`已下载 ${successCount} 个音频`)
  }
  selectedIds.value = new Set()
}

const deleteSelected = async () => {
  if (selectedCount.value === 0) return
  try {
    await ElMessageBox.confirm(
      `确定删除选中的 ${selectedCount.value} 个音频？本地文件也将被清理。`,
      '删除音频',
      {
        type: 'warning',
        confirmButtonText: '删除',
        confirmButtonClass: 'el-button--danger'
      }
    )
  } catch {
    return
  }
  let successCount = 0
  for (const id of selectedIds.value) {
    const item = items.value.find((it) => it.id === id)
    if (!item) continue
    try {
      const r = await localApi.deleteExtractedAudio(item.id)
      if (r.code === 0) successCount++
      else ElMessage.error(`「${item.title}」删除失败：${r.message}`)
    } catch (e: any) {
      ElMessage.error(`「${item.title}」删除失败：${e?.message || ''}`)
    }
  }
  if (successCount > 0) {
    ElMessage.success(`已删除 ${successCount} 个音频`)
    await fetchList()
  }
  selectedIds.value = new Set()
}

defineExpose({
  refresh: fetchList,
  downloadOne: downloadOne,
  deleteOne: deleteOne,
  downloadSelected: downloadSelected,
  deleteSelected: deleteSelected,
  items: items
})

onMounted(openProgressWs)
onBeforeUnmount(closeProgressWs)
</script>
<template>
  <div class="music-shelf">
    <div class="music-shelf__hero">
      <div>
        <p class="eyebrow">OFFLINE AUDIO</p>
        <h2>本地音频馆</h2>
        <p class="summary">已归档 {{ total }} 个媒体文件，点击任意卡片即可播放。</p>
      </div>
    </div>

    <div v-if="!(loading && items.length === 0) && items.length > 0" class="toolbar">
      <button class="tool-btn" :disabled="items.length === 0" @click="selectAllOnPage">
        {{ allSelectedOnPage ? '取消全选' : '全选' }}
      </button>
      <button class="tool-btn" :disabled="items.length === 0" @click="invertOnPage">反选</button>
      <button
        class="tool-btn"
        :disabled="true"
        title="音频页暂不支持"
      >
        添加到收藏夹
      </button>
      <button
        class="tool-btn"
        :disabled="true"
        title="音频页暂不支持"
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
        @click="deleteSelected"
      >
        删除
      </button>
      <span class="tool-info">本页 {{ items.length }} / 全部 {{ total }}，已选 {{ selectedCount }}</span>
    </div>

    <div v-if="loading && items.length === 0" class="state">加载中…</div>
    <div v-else-if="items.length === 0" class="state">还没有已归档音频。</div>
    <ul v-else class="music-grid">
      <li
        v-for="item in items"
        :key="item.id"
        class="music-card"
        :class="{ selected: selectedIds.has(item.id) }"
        @click="emit('play', item)"
      >
        <button class="pick" @click.stop="toggleOne(item.id)">
          <span class="dot" :class="{ on: selectedIds.has(item.id) }"></span>
        </button>
        <div class="cover-wrap">
          <img v-if="item.coverPath" :src="coverSrc(item)" class="cover" alt="" />
          <div v-else class="cover cover--empty">暂无封面</div>
          <div class="card-actions">
            <button class="play-pill" type="button">播放</button>
            <button class="download-pill" type="button" @click.stop="downloadOne(item)" :disabled="downloading.has(item.id)">
              {{ downloading.has(item.id) ? '下载中...' : '下载' }}
            </button>
            <button class="delete-pill" type="button" @click.stop="deleteOne(item)" :disabled="deleting.has(item.id)">
              删除
            </button>
          </div>
        </div>
        <div class="meta">
          <p class="title">{{ item.title }}</p>
          <p class="author">{{ item.authorName || '未知作者' }}</p>
          <div class="stats">
            <span>{{ formatDuration(item.durationSec) }}</span>
            <span>{{ formatDate(item.archivedAt) }}</span>
            <span :class="['status', item.status]">{{ item.status }}</span>
          </div>
        </div>
      </li>
    </ul>

    <div v-if="totalPages > 1" class="pager">
      <el-button size="small" :disabled="page <= 1" @click="goPage(page - 1)">上一页</el-button>
      <span>{{ page }} / {{ totalPages }}</span>
      <el-button size="small" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</el-button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.music-shelf {
  &__hero {
    margin-bottom: 18px;
    padding: 22px 24px;
    border-radius: 24px;
    border: 1px solid rgba(var(--primary-500), 0.14);
    background:
      radial-gradient(circle at top right, rgba(var(--primary-500), 0.14), transparent 34%),
      linear-gradient(135deg, rgba(var(--white), 0.98), rgba(var(--neutral-50), 0.94));
    box-shadow: 0 18px 40px rgba(17, 18, 23, 0.05);
  }

  .eyebrow {
    margin: 0 0 4px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.22em;
    color: var(--color-primary, #1664ff);
    text-transform: uppercase;
  }

  h2 {
    margin: 0;
    font-size: 22px;
    font-weight: 700;
    line-height: 1.2;
  }

  .summary {
    margin: 6px 0 0;
    font-size: 13px;
    color: var(--color-text-t2, #666);
  }

  .state {
    text-align: center;
    padding: 56px 20px;
    border: 1px dashed var(--color-line-l3, #eee);
    border-radius: 22px;
    background: rgba(var(--white), 0.78);
    color: var(--color-text-t2, #666);
  }

  .music-grid {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 18px;
  }

  .music-card {
    border-radius: 22px;
    overflow: hidden;
    background:
      linear-gradient(180deg, rgba(var(--white), 0.98), rgba(var(--neutral-50), 0.92));
    transition: transform 0.18s ease, box-shadow 0.18s ease;
    cursor: pointer;
    border: 1px solid var(--color-line-l3, rgba(31, 29, 24, 0.08));
    box-shadow: 0 12px 30px rgba(17, 18, 23, 0.05);
    position: relative;

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

  .cover-wrap {
    position: relative;
    aspect-ratio: 1;
    background: #000;

    .cover {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .cover--empty {
      display: flex;
      align-items: center;
      justify-content: center;
      color: rgba(255, 255, 255, 0.72);
      background: linear-gradient(135deg, #222833, #0d1118);
    }
  }

  .meta {
    padding: 14px 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .title {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
    line-height: 1.35;
    color: var(--color-text-t1, #1d2433);
  }

  .author {
    margin: 0;
    font-size: 13px;
    color: var(--color-text-t2, #687083);
  }

  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 2px;

    span {
      border-radius: 999px;
      padding: 4px 9px;
      background: rgba(var(--neutral-100), 0.9);
      color: var(--color-text-t2, #666);
      font-size: 12px;
    }
  }

  .status.done {
    background: rgba(46, 203, 113, 0.14);
    color: #138447;
  }

  .status.pending,
  .status.downloading {
    background: rgba(255, 164, 38, 0.16);
    color: #9a5a00;
  }

  .status.failed {
    background: rgba(245, 63, 63, 0.14);
    color: #b72b2b;
  }

  .pager {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    margin-top: 22px;
  }

  // 工具栏
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
  }

  .tool-info {
    font-size: 12px;
    color: var(--color-text-t3, #888);
    margin-left: auto;
  }

  // 卡片操作按钮组
  .card-actions {
    position: absolute;
    right: 12px;
    bottom: 12px;
    display: flex;
    gap: 6px;
  }

  .play-pill {
    border: none;
    border-radius: 999px;
    padding: 6px 12px;
    background: rgba(8, 12, 22, 0.82);
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      background: rgba(8, 12, 22, 0.95);
    }
  }

  .download-pill {
    border: none;
    border-radius: 999px;
    padding: 6px 12px;
    background: rgba(8, 12, 22, 0.82);
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover:not(:disabled) {
      background: rgba(8, 12, 22, 0.95);
    }

    &:disabled {
      opacity: 0.6;
      cursor: wait;
    }
  }

  .delete-pill {
    border: none;
    border-radius: 999px;
    padding: 6px 12px;
    background: rgba(220, 38, 38, 0.82);
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover:not(:disabled) {
      background: rgba(220, 38, 38, 0.95);
    }

    &:disabled {
      opacity: 0.6;
      cursor: wait;
    }
  }
}
</style>
