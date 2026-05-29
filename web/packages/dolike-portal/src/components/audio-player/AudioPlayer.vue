<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { VideoListItem } from '@/api/local'

interface PlaylistItem {
  id: number
  title: string
  authorName: string
  mediaPath: string
  coverPath: string | null
  durationSec: number
}

const props = defineProps<{
  playlist: PlaylistItem[]
  currentIndex: number
}>()

const emit = defineEmits<{
  (e: 'update:currentIndex', index: number): void
  (e: 'close'): void
}>()

const audioRef = ref<HTMLAudioElement | null>(null)
const isPlaying = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const volume = ref(0.8)
const showPlaylist = ref(false)
const isShuffle = ref(false)
const repeatMode = ref<'none' | 'one' | 'all'>('none')

const currentItem = computed(() => props.playlist[props.currentIndex] || null)

const coverSrc = computed(() => {
  if (currentItem.value?.coverPath) {
    return '/media/' + currentItem.value.coverPath
  }
  return ''
})

const formatTime = (s: number): string => {
  if (!s || isNaN(s)) return '0:00'
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return m + ':' + String(r).padStart(2, '0')
}

const progressPercent = computed(() => {
  if (!duration.value) return 0
  return (currentTime.value / duration.value) * 100
})

const togglePlay = () => {
  if (!audioRef.value) return
  if (isPlaying.value) {
    audioRef.value.pause()
  } else {
    audioRef.value.play()
  }
}

const playAt = (index: number) => {
  if (index < 0 || index >= props.playlist.length) return
  emit('update:currentIndex', index)
  setTimeout(() => {
    audioRef.value?.play()
  }, 50)
}

const playPrev = () => {
  if (props.playlist.length === 0) return
  if (isShuffle.value) {
    const randomIndex = Math.floor(Math.random() * props.playlist.length)
    playAt(randomIndex)
  } else {
    const prev = props.currentIndex <= 0 ? props.playlist.length - 1 : props.currentIndex - 1
    playAt(prev)
  }
}

const playNext = () => {
  if (props.playlist.length === 0) return
  if (isShuffle.value) {
    const randomIndex = Math.floor(Math.random() * props.playlist.length)
    playAt(randomIndex)
  } else {
    const next = props.currentIndex >= props.playlist.length - 1 ? 0 : props.currentIndex + 1
    playAt(next)
  }
}

const onEnded = () => {
  if (repeatMode.value === 'one') {
    if (audioRef.value) {
      audioRef.value.currentTime = 0
      audioRef.value.play()
    }
  } else if (repeatMode.value === 'all' || props.currentIndex < props.playlist.length - 1) {
    playNext()
  } else {
    isPlaying.value = false
  }
}

const onTimeUpdate = () => {
  if (audioRef.value) {
    currentTime.value = audioRef.value.currentTime
  }
}

const onLoadedMetadata = () => {
  if (audioRef.value) {
    duration.value = audioRef.value.duration || 0
  }
}

const onProgressClick = (e: MouseEvent) => {
  if (!audioRef.value || !duration.value) return
  const bar = e.currentTarget as HTMLElement
  const rect = bar.getBoundingClientRect()
  const x = e.clientX - rect.left
  const pct = Math.max(0, Math.min(1, x / rect.width))
  audioRef.value.currentTime = pct * duration.value
}

const onVolumeChange = () => {
  if (audioRef.value) {
    audioRef.value.volume = volume.value
  }
}

const toggleShuffle = () => {
  isShuffle.value = !isShuffle.value
}

const toggleRepeat = () => {
  const modes: Array<'none' | 'one' | 'all'> = ['none', 'all', 'one']
  const idx = modes.indexOf(repeatMode.value)
  repeatMode.value = modes[(idx + 1) % modes.length]
}

watch(() => props.currentIndex, () => {
  if (audioRef.value) {
    audioRef.value.load()
    audioRef.value.play().catch(() => {})
    isPlaying.value = true
  }
})

watch(volume, () => {
  if (audioRef.value) {
    audioRef.value.volume = volume.value
  }
})

const onKeydown = (e: KeyboardEvent) => {
  switch (e.key) {
    case ' ':
      e.preventDefault()
      togglePlay()
      break
    case 'ArrowLeft':
      playPrev()
      break
    case 'ArrowRight':
      playNext()
      break
    case 'Escape':
      emit('close')
      break
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  if (audioRef.value && currentItem.value) {
    audioRef.value.volume = volume.value
    audioRef.value.play().catch(() => {})
    isPlaying.value = true
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  if (audioRef.value) {
    audioRef.value.pause()
    audioRef.value.src = ''
  }
})
</script>

<template>
  <div class="audio-player-overlay" @click.self="emit('close')">
    <div class="audio-player">
      <!-- Hidden audio element -->
      <audio
        ref="audioRef"
        :src="currentItem ? '/media/' + currentItem.mediaPath : ''"
        preload="auto"
        @play="isPlaying = true"
        @pause="isPlaying = false"
        @ended="onEnded"
        @timeupdate="onTimeUpdate"
        @loadedmetadata="onLoadedMetadata"
      />

      <!-- Header -->
      <header class="ap-header">
        <button class="ap-back" type="button" @click="emit('close')" title="返回">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 19l-7-7 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div class="ap-header-title">
          <p class="ap-label">正在播放</p>
          <p class="ap-count">音频 {{ props.currentIndex + 1 }} / {{ props.playlist.length }}</p>
        </div>
        <button class="ap-playlist-toggle" type="button" :class="{ active: showPlaylist }" @click="showPlaylist = !showPlaylist" title="播放列表">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </header>

      <!-- Main content -->
      <div class="ap-body">
        <!-- Cover art -->
        <div class="ap-cover-section">
          <div class="ap-cover" :class="{ 'is-playing': isPlaying }">
            <img v-if="coverSrc" :src="coverSrc" alt="" />
            <div v-else class="ap-cover-placeholder">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none"><path d="M9 18V5l12-2v13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="1.5"/><circle cx="18" cy="16" r="3" stroke="currentColor" stroke-width="1.5"/></svg>
            </div>
          </div>
        </div>

        <!-- Track info -->
        <div class="ap-track-info">
          <h3 class="ap-track-title">{{ currentItem?.title || '未知音频' }}</h3>
          <p class="ap-track-author">{{ currentItem?.authorName || '未知作者' }}</p>
        </div>

        <!-- Progress bar -->
        <div class="ap-progress" @click="onProgressClick">
          <div class="ap-progress-bar">
            <div class="ap-progress-fill" :style="{ width: progressPercent + '%' }" />
            <div class="ap-progress-thumb" :style="{ left: progressPercent + '%' }" />
          </div>
          <div class="ap-time">
            <span>{{ formatTime(currentTime) }}</span>
            <span>{{ formatTime(duration) }}</span>
          </div>
        </div>

        <!-- Controls -->
        <div class="ap-controls">
          <button class="ap-btn ap-btn--secondary" :class="{ active: isShuffle }" @click="toggleShuffle" title="随机播放">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>

          <button class="ap-btn ap-btn--nav" @click="playPrev" title="上一首">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M19 20L9 12l10-8v16zM7 19V5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>

          <button class="ap-btn ap-btn--play" @click="togglePlay" :title="isPlaying ? '暂停' : '播放'">
            <svg v-if="!isPlaying" width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            <svg v-else width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>
          </button>

          <button class="ap-btn ap-btn--nav" @click="playNext" title="下一首">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M5 4l10 8-10 8V4zM17 5v14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>

          <button class="ap-btn ap-btn--secondary" :class="{ active: repeatMode !== 'none' }" @click="toggleRepeat" :title="repeatMode === 'one' ? '单曲循环' : repeatMode === 'all' ? '列表循环' : '不循环'">
            <svg v-if="repeatMode !== 'one'" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M17 1l4 4-4 4M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 01-4 4H3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span v-else class="ap-repeat-one">1</span>
          </button>
        </div>

        <!-- Volume -->
        <div class="ap-volume">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            v-model.number="volume"
            class="ap-volume-slider"
          />
        </div>
      </div>

      <!-- Playlist panel -->
      <Transition name="slide-up">
        <div v-if="showPlaylist" class="ap-playlist">
          <div class="ap-playlist-header">
            <h4>播放列表</h4>
            <span>{{ props.playlist.length }} 首音频</span>
          </div>
          <ul class="ap-playlist-items">
            <li
              v-for="(item, index) in props.playlist"
              :key="item.id"
              :class="{ active: index === props.currentIndex, playing: index === props.currentIndex && isPlaying }"
              @click="playAt(index)"
            >
              <span class="ap-playlist-index">{{ index + 1 }}</span>
              <div class="ap-playlist-meta">
                <p class="ap-playlist-title">{{ item.title }}</p>
                <p class="ap-playlist-author">{{ item.authorName }}</p>
              </div>
              <span v-if="index === props.currentIndex" class="ap-playing-indicator">
                <span /><span /><span />
              </span>
            </li>
          </ul>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.audio-player-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(4, 6, 12, 0.82);
  backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.audio-player {
  width: min(420px, 92vw);
  max-height: 92vh;
  background: linear-gradient(180deg, #1c2030, #10141c);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 24px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 32px 80px rgba(0, 0, 0, 0.5);
}

.ap-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;

  .ap-back {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8px;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    border-radius: 10px;
    transition: all 0.2s;
    flex-shrink: 0;

    &:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.08);
    }
  }

  .ap-header-title {
    flex: 1;
    min-width: 0;

    .ap-label {
      margin: 0;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.12em;
      color: var(--color-primary, #1664ff);
      text-transform: uppercase;
    }

    .ap-count {
      margin: 2px 0 0;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.4);
    }
  }

  .ap-playlist-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8px;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    border-radius: 10px;
    transition: all 0.2s;
    flex-shrink: 0;

    &:hover, &.active {
      color: #fff;
      background: rgba(255, 255, 255, 0.08);
    }
  }
}

.ap-body {
  padding: 28px 24px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  overflow-y: auto;
}

.ap-cover-section {
  margin-bottom: 24px;
}

.ap-cover {
  width: 220px;
  height: 220px;
  border-radius: 50%;
  overflow: hidden;
  background: linear-gradient(135deg, #2a2f3e, #1a1e28);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
  transition: transform 0.3s ease;
  animation: spin-slow 20s linear infinite paused;

  &.is-playing {
    animation-play-state: running;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .ap-cover-placeholder {
    color: rgba(255, 255, 255, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
  }
}

@keyframes spin-slow {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.ap-track-info {
  text-align: center;
  margin-bottom: 24px;
  width: 100%;

  .ap-track-title {
    margin: 0 0 6px;
    font-size: 18px;
    font-weight: 700;
    color: #fff;
    line-height: 1.35;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ap-track-author {
    margin: 0;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.5);
  }
}

.ap-progress {
  width: 100%;
  margin-bottom: 20px;
  cursor: pointer;

  .ap-progress-bar {
    position: relative;
    height: 4px;
    background: rgba(255, 255, 255, 0.12);
    border-radius: 999px;
    overflow: visible;

    .ap-progress-fill {
      height: 100%;
      background: var(--color-primary, #1664ff);
      border-radius: 999px;
      transition: width 0.1s linear;
    }

    .ap-progress-thumb {
      position: absolute;
      top: 50%;
      width: 12px;
      height: 12px;
      background: #fff;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      opacity: 0;
      transition: opacity 0.15s;
    }
  }

  &:hover .ap-progress-thumb {
    opacity: 1;
  }

  .ap-time {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.35);
  }
}

.ap-controls {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;

  .ap-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    border-radius: 50%;
    transition: all 0.15s;

    &:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.08);
    }

    &--secondary {
      width: 36px;
      height: 36px;

      &.active {
        color: var(--color-primary, #1664ff);
      }
    }

    &--nav {
      width: 44px;
      height: 44px;
    }

    &--play {
      width: 60px;
      height: 60px;
      background: var(--color-primary, #1664ff);
      color: #fff;
      box-shadow: 0 8px 24px rgba(22, 100, 255, 0.35);

      &:hover {
        background: #1458e6;
        color: #fff;
        transform: scale(1.05);
      }
    }
  }

  .ap-repeat-one {
    font-size: 12px;
    font-weight: 700;
    color: var(--color-primary, #1664ff);
  }
}

.ap-volume {
  display: flex;
  align-items: center;
  gap: 10px;
  color: rgba(255, 255, 255, 0.4);
  width: 100%;
  padding: 0 8px;

  .ap-volume-slider {
    flex: 1;
    -webkit-appearance: none;
    appearance: none;
    height: 4px;
    background: rgba(255, 255, 255, 0.12);
    border-radius: 999px;
    outline: none;

    &::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 12px;
      height: 12px;
      background: #fff;
      border-radius: 50%;
      cursor: pointer;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    }

    &::-moz-range-thumb {
      width: 12px;
      height: 12px;
      background: #fff;
      border-radius: 50%;
      cursor: pointer;
      border: none;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    }
  }
}

// Playlist panel
.ap-playlist {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  max-height: 240px;
  overflow-y: auto;
  flex-shrink: 0;

  .ap-playlist-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px 10px;

    h4 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: #fff;
    }

    span {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.35);
    }
  }

  .ap-playlist-items {
    list-style: none;
    padding: 0;
    margin: 0;

    li {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 18px;
      cursor: pointer;
      transition: background 0.15s;

      &:hover {
        background: rgba(255, 255, 255, 0.04);
      }

      &.active {
        background: rgba(var(--primary-500), 0.1);
      }

      .ap-playlist-index {
        width: 20px;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.3);
        text-align: center;
        flex-shrink: 0;
      }

      &.playing .ap-playlist-index {
        display: none;
      }

      .ap-playlist-meta {
        flex: 1;
        min-width: 0;

        .ap-playlist-title {
          margin: 0;
          font-size: 13px;
          color: rgba(255, 255, 255, 0.85);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .ap-playlist-author {
          margin: 2px 0 0;
          font-size: 11px;
          color: rgba(255, 255, 255, 0.35);
        }
      }

      &.active .ap-playlist-title {
        color: var(--color-primary, #1664ff);
      }

      .ap-playing-indicator {
        display: flex;
        align-items: flex-end;
        gap: 2px;
        height: 14px;

        span {
          width: 3px;
          background: var(--color-primary, #1664ff);
          border-radius: 2px;
          animation: sound-bar 0.8s ease-in-out infinite;

          &:nth-child(1) { height: 6px; animation-delay: 0s; }
          &:nth-child(2) { height: 12px; animation-delay: 0.2s; }
          &:nth-child(3) { height: 8px; animation-delay: 0.4s; }
        }
      }
    }
  }
}

@keyframes sound-bar {
  0%, 100% { transform: scaleY(1); }
  50% { transform: scaleY(0.4); }
}

// Transitions
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.25s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(12px);
}
</style>
