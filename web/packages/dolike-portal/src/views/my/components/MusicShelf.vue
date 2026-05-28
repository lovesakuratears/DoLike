<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
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
    const r = await localApi.listVideos({
      contentKind: 'MUSIC',
      linkKind: 'all',
      length: 'all',
      page: page.value,
      size: size.value,
      sort: 'archived',
      q: props.keyword || undefined
    })
    if (r.code === 0) {
      items.value = r.data.items
      total.value = r.data.total
    } else {
      ElMessage.error(r.message || '加载音乐失败')
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '加载音乐失败')
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

watch([page, () => props.keyword], () => {
  page.value = 1
  void fetchList()
}, { immediate: true })

defineExpose({
  refresh: fetchList
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

    <div v-if="loading && items.length === 0" class="state">加载中…</div>
    <div v-else-if="items.length === 0" class="state">还没有已归档音乐。</div>
    <ul v-else class="music-grid">
      <li v-for="item in items" :key="item.id" class="music-card" @click="emit('play', item)">
        <div class="cover-wrap">
          <img v-if="item.coverPath" :src="coverSrc(item)" class="cover" alt="" />
          <div v-else class="cover cover--empty">暂无封面</div>
          <button class="play-pill" type="button">播放</button>
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
    margin: 0 0 8px;
    color: var(--color-primary, #1664ff);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.18em;
  }

  h2 {
    margin: 0 0 6px;
    font-size: 26px;
    line-height: 1.1;
  }

  .summary {
    margin: 0;
    color: var(--color-text-t2, #666);
  }

  .state {
    padding: 56px 20px;
    text-align: center;
    color: var(--color-text-t2, #666);
    border: 1px dashed var(--color-line-l3, #eee);
    border-radius: 22px;
    background: rgba(var(--white), 0.84);
  }

  .music-grid {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 18px;
  }

  .music-card {
    padding: 14px;
    border-radius: 22px;
    border: 1px solid var(--color-line-l3, #ececec);
    background: linear-gradient(180deg, rgba(var(--white), 0.98), rgba(var(--neutral-50), 0.95));
    box-shadow: 0 16px 32px rgba(17, 18, 23, 0.05);
    cursor: pointer;
    transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;

    &:hover {
      transform: translateY(-3px);
      box-shadow: 0 20px 36px rgba(17, 18, 23, 0.08);
      border-color: rgba(var(--primary-500), 0.22);
    }
  }

  .cover-wrap {
    position: relative;
    margin-bottom: 14px;
  }

  .cover {
    width: 100%;
    aspect-ratio: 1 / 1;
    border-radius: 18px;
    object-fit: cover;
    background: linear-gradient(135deg, #edf2ff, #dfe9ff);
  }

  .cover--empty {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #7d86a0;
    font-size: 13px;
  }

  .play-pill {
    position: absolute;
    right: 12px;
    bottom: 12px;
    border: none;
    border-radius: 999px;
    padding: 8px 14px;
    background: rgba(8, 12, 22, 0.82);
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    pointer-events: none;
  }

  .meta {
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
    font-size: 1
3px;
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
}
</style>