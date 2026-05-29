<template>
  <div class="lv-page">
    <header class="lv-bar">
      <button class="back-btn" type="button" @click="goBack" title="返回">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 19l-7-7 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <h1 class="bar-title">视频详情</h1>
    </header>

    <div class="lv-body" v-if="!loading && video">
      <div class="player-section">
        <div class="player-wrap" v-if="video.mediaPath">
          <video
            :src="'/media/' + video.mediaPath"
            :poster="coverSrc"
            controls
            autoplay
            class="native-player"
          />
        </div>
        <div class="player-missing" v-else>
          <p>视频尚未下载完成（状态：{{ video.status }}）</p>
          <p class="muted small">下载完成后会自动可播放</p>
        </div>
      </div>

      <div class="detail-info">
        <h2 class="detail-title">{{ video.title }}</h2>
        <div class="detail-meta">
          <span class="meta-item author">{{ video.authorName }}</span>
          <span class="meta-item duration">{{ formatDuration(video.durationSec) }}</span>
          <span class="meta-item link-kind">{{ video.linkKinds.join(' / ') }}</span>
        </div>
        <div class="detail-dates">
          <p class="date-line">发布时间：{{ fmtDate(video.publishAt) }}</p>
          <p class="date-line">归档时间：{{ fmtDate(video.archivedAt) }}</p>
        </div>
      </div>
    </div>

    <div class="lv-body lv-body--loading" v-else-if="loading">
      <p class="muted">加载中...</p>
    </div>

    <div class="lv-body lv-body--error" v-else>
      <p>视频不存在或加载失败</p>
      <button class="back-btn-text" type="button" @click="goBack">返回</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { localApi, type VideoListItem } from '@/api/local'

const route = useRoute()
const router = useRouter()

const video = ref<VideoListItem | null>(null)
const loading = ref(true)

const contentId = computed(() => Number(route.params.id))

const coverSrc = computed(() =>
  video.value?.coverPath ? '/media/' + video.value.coverPath : ''
)

const fetchVideo = async () => {
  loading.value = true
  try {
    const r = await localApi.getContent(contentId.value)
    if (r.code === 0) {
      video.value = r.data
    } else {
      ElMessage.error(r.message || '加载失败')
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

const goBack = () => {
  // 如果有来源信息，返回时带回，让 my 页面恢复之前的 tab/link 状态
  const fromLink = route.query.fromLink
  const fromTab = route.query.fromTab
  if (fromLink || fromTab) {
    router.push({
      path: '/my',
      query: {
        ...(fromTab ? { tab: fromTab } : {}),
        ...(fromLink ? { link: fromLink } : {})
      }
    })
  } else {
    router.back()
  }
}

const formatDuration = (s: number): string => {
  if (s <= 0) return '0:00'
  const m = Math.floor(s / 60)
  const r = s % 60
  return m + ':' + String(r).padStart(2, '0')
}

const fmtDate = (s: string) => {
  if (!s) return '-'
  try {
    const d = new Date(s)
    if (isNaN(d.getTime())) return s
    return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return s
  }
}

onMounted(() => { void fetchVideo() })
</script>

<style lang="scss" scoped>
.lv-page {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  padding: 0 24px 40px;
}

.lv-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 0;
  border-bottom: 1px solid var(--color-line-l3, #eee);
  margin-bottom: 20px;

  .back-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8px;
    border: none;
    background: transparent;
    color: var(--color-text-t2, #555);
    cursor: pointer;
    border-radius: 10px;
    transition: color 0.2s, background-color 0.2s;
    flex-shrink: 0;

    &:hover {
      color: var(--color-primary);
      background-color: rgba(var(--primary-500), 0.08);
    }
  }

  .bar-title {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    color: var(--color-text-t1);
  }
}

.lv-body {
  flex: 1;
}

.player-section {
  border-radius: 18px;
  overflow: hidden;
  background: #000;
  margin-bottom: 20px;

  .player-wrap {
    position: relative;
    aspect-ratio: 16 / 9;

    .native-player {
      width: 100%;
      height: 100%;
      display: block;
      background: #000;
    }
  }

  .player-missing {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    aspect-ratio: 16 / 9;
    color: rgba(255, 255, 255, 0.7);
    gap: 8px;

    .muted { color: rgba(255, 255, 255, 0.45); }
    .small { font-size: 12px; }
  }
}

.detail-info {
  padding: 20px;
  border: 1px solid var(--color-line-l3, #eee);
  border-radius: 18px;
  background: rgba(var(--white), 0.92);

  .detail-title {
    margin: 0 0 12px;
    font-size: 20px;
    font-weight: 700;
    color: var(--color-text-t1);
    line-height: 1.4;
  }

  .detail-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 16px;

    .meta-item {
      font-size: 13px;
      color: var(--color-text-t2, #555);
      padding: 5px 12px;
      border-radius: 999px;
      background: rgba(var(--neutral-100), 0.9);

      &.author { font-weight: 600; }
      &.link-kind { color: var(--color-primary, #1664ff); }
    }
  }

  .detail-dates {
    padding-top: 14px;
    border-top: 1px solid var(--color-line-l3, #eee);

    .date-line {
      margin: 6px 0;
      font-size: 13px;
      color: var(--color-text-t3, #888);
    }
  }
}

.lv-body--loading,
.lv-body--error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  color: var(--color-text-t3, #888);
  gap: 16px;
}

.back-btn-text {
  padding: 8px 20px;
  border-radius: 999px;
  border: 1px solid var(--color-line-l3, #ddd);
  background: transparent;
  color: var(--color-text-t2, #555);
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;

  &:hover {
    color: var(--color-primary);
    border-color: rgba(var(--primary-500), 0.3);
  }
}
</style>
