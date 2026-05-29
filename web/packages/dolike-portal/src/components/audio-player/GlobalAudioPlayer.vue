<script setup lang="ts">
import { ref, watch, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import APlayer from 'APlayer'
import 'APlayer/dist/APlayer.min.css'
import { useAudioPlayerStore, type AudioTrack } from '@/stores/audio-player'

const store = useAudioPlayerStore()
const aplayerRef = ref<HTMLDivElement | null>(null)
let ap: APlayer | null = null

const currentTrack = computed(() => store.currentTrack)
const coverBroken = ref(false)

const onCoverError = () => {
  coverBroken.value = true
}

// Build APlayer track list from playlist
const aplayerList = computed(() =>
  store.playlist.map((t) => ({
    name: t.title,
    artist: t.authorName,
    url: '/media/' + t.mediaPath,
    cover: t.coverPath ? '/media/' + t.coverPath : '',
  }))
)

// Check if a cover URL is valid and not broken
const hasCover = computed(() => {
  const c = currentTrack.value?.coverPath
  return c && c.length > 0 && !coverBroken.value
})

function initAPlayer() {
  if (!aplayerRef.value) return
  try {
    ap?.destroy()
  } catch { /* ignore */ }

  ap = new APlayer({
    container: aplayerRef.value,
    audio: aplayerList.value,
    mini: false,
    autoplay: false,
    loop: 'all',
    order: 'list',
    preload: 'auto',
    volume: 0.8,
    mutex: true,
    listFolded: true,
    lrcType: 0,
    // 不使用 fixed 模式，我们自己控制定位
    fixed: false,
  })

  try {
    ap.audio.volume = 0.8
    ap.audio.muted = false
  } catch {
    // ignore
  }

  // Bind APlayer events
  ap.on('play', () => {
    store.isPlaying = true
  })
  ap.on('pause', () => {
    store.isPlaying = false
  })
  ap.on('listswitch', (index: number) => {
    store.currentIndex = index
  })

  if (store.isPlaying) {
    ap.play().catch(() => {})
  }
}

// Reset cover broken state when track changes
watch(() => currentTrack.value?.id, () => {
  coverBroken.value = false
})

// Watch for playlist changes → rebuild APlayer
watch(
  () => store.playlist.map((track) => `${track.id}:${track.mediaPath}`).join('|'),
  () => {
    nextTick(() => {
      if (store.playlist.length > 0) {
        initAPlayer()
      }
    })
  },
  { immediate: true }
)

watch(
  () => store.currentIndex,
  (index) => {
    if (!ap || !store.playlist.length) return
    if (typeof index !== 'number' || index < 0 || index >= store.playlist.length) return
    try {
      if (ap.list.index !== index) {
        ap.list.switch(index)
      }
      ap.audio.muted = false
      if (ap.audio.volume === 0) ap.audio.volume = 0.8
      if (store.isPlaying) {
        ap.play().catch(() => {})
      }
    } catch {
      // ignore
    }
  }
)

// Watch for play/pause state changes from outside
watch(
  () => store.isPlaying,
  (playing) => {
    if (!ap) return
    if (playing) {
      ap.play().catch(() => {})
    } else {
      ap.pause()
    }
  }
)

onMounted(() => {
  if (store.playlist.length > 0) {
    nextTick(initAPlayer)
  }
})

onBeforeUnmount(() => {
  try {
    ap?.destroy()
  } catch { /* ignore */ }
  ap = null
})
</script>

<template>
  <div v-if="store.hasPlaylist" class="global-audio-player" :class="{ expanded: store.isExpanded }">
    <!-- Mini bar (collapsed state) -->
    <div v-if="!store.isExpanded" class="mini-bar" @click="store.toggleExpanded">
      <div class="mini-cover">
        <img v-if="hasCover" :src="'/media/' + currentTrack?.coverPath" alt="" @error="onCoverError" />
        <div v-else class="mini-cover-placeholder">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M9 18V5l12-2v13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="1.5"/><circle cx="18" cy="16" r="3" stroke="currentColor" stroke-width="1.5"/></svg>
        </div>
      </div>
      <div class="mini-info">
        <p class="mini-title">{{ currentTrack?.title || '未知音频' }}</p>
        <p class="mini-author">{{ currentTrack?.authorName || '未知作者' }}</p>
      </div>
      <div class="mini-actions">
        <button class="mini-btn" @click.stop="store.togglePlay" :title="store.isPlaying ? '暂停' : '播放'">
          <svg v-if="!store.isPlaying" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>
        </button>
        <button class="mini-btn" @click.stop="store.playNext" title="下一首">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 4l10 8-10 8V4zM17 5v14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="mini-btn close-btn" @click.stop="store.clearPlaylist" title="关闭">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>

    <!-- Expanded APlayer overlay -->
    <div class="aplayer-hidden-host">
      <div ref="aplayerRef" class="aplayer-container" />
    </div>
    <div v-show="store.isExpanded" class="expanded-overlay" @click.self="store.toggleExpanded">
      <div class="expanded-player">
        <div class="expanded-header">
          <button class="collapse-btn" @click="store.toggleExpanded" title="收起">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <span class="expanded-label">正在播放</span>
          <button class="close-expanded-btn" @click="store.clearPlaylist" title="关闭">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.global-audio-player {
  position: fixed;
  bottom: 0;
  left: 72px; // 避开侧边栏
  right: 0;
  z-index: 900;

  &.expanded {
    top: 0;
    left: 0;
    z-index: 1000;
  }
}

.aplayer-hidden-host {
  position: fixed;
  width: 0;
  height: 0;
  overflow: hidden;
  pointer-events: none;
  opacity: 0;
}

// ── Mini bar ──
.mini-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: linear-gradient(135deg, rgba(22, 27, 38, 0.96), rgba(14, 17, 23, 0.96));
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  cursor: pointer;
  transition: background 0.2s;

  &:hover {
    background: linear-gradient(135deg, rgba(28, 34, 46, 0.98), rgba(18, 22, 30, 0.98));
  }
}

.mini-cover {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
  background: linear-gradient(135deg, #2a2f3e, #1a1e28);

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .mini-cover-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.25);
  }
}

.mini-info {
  flex: 1;
  min-width: 0;

  .mini-title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: #fff;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mini-author {
    margin: 2px 0 0;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.4);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.mini-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.mini-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.08);
  }

  &.close-btn:hover {
    color: #ff4d4f;
    background: rgba(255, 77, 79, 0.1);
  }
}

// ── Expanded overlay ──
.expanded-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(4, 6, 12, 0.88);
  backdrop-filter: blur(16px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.expanded-player {
  width: min(720px, 92vw);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.expanded-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 12px 16px 20px;
  flex-shrink: 0;

  .collapse-btn,
  .close-expanded-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: none;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    transition: all 0.15s;

    &:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.12);
    }
  }

  .expanded-label {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.12em;
    color: var(--color-primary, #1664ff);
    text-transform: uppercase;
  }
}

.aplayer-container {
  width: 100%;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4);

  :deep(.aplayer) {
    background: linear-gradient(180deg, #1c2030, #10141c);
    border-radius: 16px;
    margin: 0;

    .aplayer-info {
      background: transparent;
    }

    .aplayer-list {
      background: rgba(16, 20, 28, 0.95);
      border-top: 1px solid rgba(255, 255, 255, 0.06);

      ol li {
        border-bottom: 1px solid rgba(255, 255, 255, 0.04);

        &:hover {
          background: rgba(255, 255, 255, 0.04);
        }

        &.aplayer-list-light {
          background: rgba(var(--primary-500), 0.1);
        }
      }
    }

    .aplayer-lrc {
      display: none;
    }

    // 隐藏 APlayer 自带的迷你模式切换按钮，我们自己控制
    .aplayer-miniswitcher {
      display: none !important;
    }
  }
}
</style>
