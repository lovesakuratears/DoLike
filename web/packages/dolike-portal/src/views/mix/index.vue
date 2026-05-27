<template>
  <div class="mix-page">
    <header class="mix-bar">
      <button class="back-btn" type="button" @click="goBack" title="返回">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 19l-7-7 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="bar-info">
        <h1 class="bar-title">{{ mix?.name || '合集' }}</h1>
        <p class="bar-meta" v-if="mix">{{ mix.authorName }} · {{ allVideos.length }} 个视频</p>
      </div>
    </header>

    <div class="mix-body" v-if="!loading && currentVideo">
      <div class="player-section">
        <div class="player-wrap" v-if="currentVideo.mediaPath">
          <video
            :key="playerKey"
            :src="'/media/' + currentVideo.mediaPath"
            :poster="coverSrc(currentVideo)"
            controls
            autoplay
            class="native-player"
            @ended="onEnded"
          />
        </div>
        <div class="player-missing" v-else>
          <p>视频尚未下载完成（状态：{{ currentVideo.status }}）</p>
          <p class="muted small">下载完成后会自动可播放</p>
        </div>

        <div class="player-overlay-controls">
          <button class="nav-btn prev" :disabled="!hasPrev" @click="goPrev" title="上一个">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M15 19l-7-7 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button class="nav-btn next" :disabled="!hasNext" @click="goNext" title="下一个">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>

      <div class="current-info">
        <h2 class="current-title">{{ currentVideo.title }}</h2>
        <p class="current-meta">
          <span class="idx">{{ currentIndex + 1 }} / {{ allVideos.length }}</span>
          <span class="author">{{ currentVideo.authorName }}</span>
          <span class="duration">{{ formatDuration(currentVideo.durationSec) }}</span>
        </p>
      </div>

      <div class="playlist">
        <h3 class="playlist-title">播放列表</h3>
        <ul class="playlist-items">
          <li
            v-for="(v, idx) in allVideos"
            :key="v.id"
            :class="['playlist-item', { active: idx === currentIndex }]"
            @click="playVideoAtIndex(idx)"
          >
            <span class="item-idx">{{ idx + 1 }}</span>
            <img v-if="v.coverPath" :src="coverSrc(v)" class="item-thumb" alt="" loading="lazy" />
            <div v-else class="item-thumb item-thumb--placeholder"></div>
            <div class="item-info">
              <p class="item-title">{{ v.title }}</p>
              <p class="item-sub">{{ formatDuration(v.durationSec) }}</p>
            </div>
            <span v-if="v.status !== 'done'" class="item-status">{{ v.status }}</span>
          </li>
        </ul>
      </div>
    </div>

    <div class="mix-body mix-body--loading" v-else-if="loading">
      <p class="muted">加载中...</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { localApi, type VideoListItem, type MixListItem } from '@/api/local'
import { playerSettingStore } from '@/stores/player-setting'

const route = useRoute()
const router = useRouter()
const playerSetting = playerSettingStore()

const mixId = computed(() => Number(route.params.id))

const mix = ref<MixListItem | null>(null)
const allVideos = ref<VideoListItem[]>([])
const loading = ref(true)
const currentIndex = ref(0)

const currentVideo = computed(() => allVideos.value[currentIndex.value] || null)
const hasPrev = computed(() => currentIndex.value > 0)
const hasNext = computed(() => currentIndex.value < allVideos.value.length - 1)
const playerKey = ref(0)

const fetchMix = async () => {
  loading.value = true
  try {
    const r = await localApi.listMixVideos(mixId.value, 1, 200)
    if (r.code === 0) {
      mix.value = r.data.mix
      allVideos.value = r.data.videos.items
      currentIndex.value = 0
      playerKey.value++
    } else {
      ElMessage.error(r.message || '加载合集失败')
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '加载合集失败')
  } finally {
    loading.value = false
  }
}

const goPrev = () => {
  if (!hasPrev.value) return
  currentIndex.value--
  playerKey.value++
}

const goNext = () => {
  if (!hasNext.value) return
  currentIndex.value++
  playerKey.value++
}

const onEnded = () => {
  if (playerSetting.isAutoContinuous && hasNext.value) {
    goNext()
  }
}

const playVideoAtIndex = (idx: number) => {
  if (idx < 0 || idx >= allVideos.value.length) return
  currentIndex.value = idx
  playerKey.value++
}

const goBack = () => {
  router.back()
}

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev() }
  if (e.key === 'ArrowRight') { e.preventDefault(); goNext() }
}

watch(() => route.params.id, () => { if (route.params.id) void fetchMix() })

onMounted(() => { void fetchMix(); window.addEventListener('keydown', handleKeydown) })
onBeforeUnmount(() => { window.removeEventListener('keydown', handleKeydown) })

const coverSrc = (it: VideoListItem) => (it.coverPath ? '/media/' + it.coverPath : '')

const formatDuration = (s: number): string => {
  if (s <= 0) return '0:00'
  const m = Math.floor(s / 60)
  const r = s % 60
  return m + ':' + String(r).padStart(2, '0')
}
</script>

<style lang="scss" scoped>
.mix-page {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  padding: 0 24px 40px;
}

.mix-bar {
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

  .bar-info {
    min-width: 0;

    .bar-title {
      margin: 0;
      font-size: 20px;
      font-weight: 700;
      color: var(--color-text-t1);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .bar-meta {
      margin: 4px 0 0;
      font-size: 13px;
      color: var(--color-text-t3, #888);
    }
  }
}

.mix-body {
  flex: 1;
}

.player-section {
  position: relative;
  border-radius: 18px;
  overflow: hidden;
  background: #000;
  margin-bottom: 16px;

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

  .player-overlay-controls {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    pointer-events: none;
    padding: 0 12px;

    .nav-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: none;
      background: rgba(0, 0, 0, 0.45);
      color: #fff;
      cursor: pointer;
      pointer-events: auto;
      transition: background 0.2s, opacity 0.2s;

      &:hover { background: rgba(0, 0, 0, 0.65); }

      &[disabled] {
        opacity: 0.3;
        cursor: not-allowed;
      }

      &.prev { margin-right: auto; }
      &.next { margin-left: auto; }
    }
  }
}

.current-info {
  margin-bottom: 20px;

  .current-title {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--color-text-t1);
  }

  .current-meta {
    display: flex;
    gap: 14px;
    margin: 8px 0 0;
    font-size: 13px;
    color: var(--color-text-t3, #888);

    .idx {
      color: var(--color-primary, #1664ff);
      font-weight: 600;
    }
  }
}

.playlist {
  .playlist-title {
    margin: 0 0 12px;
    font-size: 15px;
    font-weight: 600;
    color: var(--color-text-t1);
  }

  .playlist-items {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 420px;
    overflow-y: auto;
    border: 1px solid var(--color-line-l3, #eee);
    border-radius: 14px;
  }

  .playlist-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    cursor: pointer;
    transition: background 0.15s;

    &:hover { background: rgba(var(--primary-500), 0.06); }

    &.active {
      background: rgba(var(--primary-500), 0.1);

      .item-idx { color: var(--color-primary); font-weight: 700; }
    }

    .item-idx {
      width: 24px;
      text-align: center;
      font-size: 13px;
      color: var(--color-text-t3, #888);
      flex-shrink: 0;
    }

    .item-thumb {
      width: 64px;
      height: 40px;
      border-radius: 8px;
      object-fit: cover;
      background: #f0f0f0;
      flex-shrink: 0;
    }

    .item-thumb--placeholder {
      background: linear-gradient(135deg, #e8e8e8, #d0d0d0);
    }

    .item-info {
      flex: 1;
      min-width: 0;

      .item-title {
        margin: 0;
        font-size: 13px;
        font-weight: 500;
        color: var(--color-text-t1);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .item-sub {
        margin: 3px 0 0;
        font-size: 11px;
        color: var(--color-text-t3, #888);
      }
    }

    .item-status {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 999px;
      background: rgba(var(--orange-red-500), 0.12);
      color: var(--orange-red-500, #ff4d4f);
      flex-shrink: 0;
    }
  }
}

.mix-body--loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  color: var(--color-text-t3, #888);
}
</style>
