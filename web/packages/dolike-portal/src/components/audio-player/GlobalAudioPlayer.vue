<script setup lang="ts">
import { ref, watch, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import APlayer from 'APlayer'
import 'APlayer/dist/APlayer.min.css'
import { useAudioPlayerStore, type AudioTrack } from '@/stores/audio-player'

const store = useAudioPlayerStore()
const aplayerRef = ref<HTMLDivElement | null>(null)
let ap: APlayer | null = null
let apInitialized = false

const currentTrack = computed(() => store.currentTrack)
const coverBroken = ref(false)

const onCoverError = () => {
  coverBroken.value = true
}

const hasCover = computed(() => {
  const c = currentTrack.value?.coverPath
  return c && c.length > 0 && !coverBroken.value
})

/**
 * 一次性初始化 APlayer（仅首次挂载时调用）
 * 之后 playlist 变更走 list.add/list.clear 增量更新
 */
function initAPlayer() {
  if (!aplayerRef.value || apInitialized) return
  apInitialized = true

  try {
    const audioList = store.playlist.map(t => toAPlayerAudio(t))
    console.log('[GlobalAudioPlayer] init, tracks:', audioList.length, 'first url:', audioList[0]?.url)

    ap = new APlayer({
      container: aplayerRef.value,
      audio: audioList,
      mini: false,
      autoplay: false,
      loop: 'all',
      order: 'list',
      preload: 'auto',
      volume: 0.8,
      mutex: true,
      listFolded: true,
      lrcType: 0,
      fixed: false,
    })

    // 强制设置 volume/muted，有的浏览器会忽略 volume: 0.8
    ap.audio.volume = 0.8
    ap.audio.muted = false
    // APlayer 在 hidden container 里可能不会正确触发 preload
    // 显式 load 一次保证 audio 有数据
    ap.audio.load()

    // APlayer 事件 → 同步 store
    ap.on('play', () => { store.isPlaying = true })
    ap.on('pause', () => { store.isPlaying = false })
    ap.on('listswitch', (index: number) => { store.currentIndex = index })
    ap.on('error', (err: unknown) => {
      console.warn('[GlobalAudioPlayer] APlayer error:', err, 'src:', ap?.audio?.src)
    })

    // ★ 首次播放尝试
    // APlayer 初始化后 audio.src 已设置，尝试播放
    // 如果被浏览器 autoplay 策略阻止 → catch → store 改暂停
    doPlayAudio()
  } catch (e) {
    console.warn('[GlobalAudioPlayer] APlayer init failed:', e)
    ap = null
    apInitialized = false
  }
}

function toAPlayerAudio(t: AudioTrack) {
  return {
    name: t.title,
    artist: t.authorName,
    // 用 /media/by-id/:id 替代 /media/[filename]
    // 避免文件名含 # 等特殊字符被浏览器当作 URL fragment 截断
    url: '/media/by-id/' + t.id,
    cover: t.coverPath ? '/media/by-id/' + t.id + '?type=cover' : '',
  }
}

/** 直接操作底层 audio 元素播放 */
function doPlayAudio() {
  if (!ap || !ap.audio) return
  const audioEl = ap.audio as HTMLAudioElement
  console.log('[GlobalAudioPlayer] doPlayAudio, src:', audioEl.src, 'paused:', audioEl.paused, 'readyState:', audioEl.readyState)

  const promise = audioEl.play()
  if (promise !== undefined) {
    promise.then(() => {
      console.log('[GlobalAudioPlayer] play OK')
      store.isPlaying = true
    }).catch((err: Error) => {
      console.warn('[GlobalAudioPlayer] play BLOCKED:', err.name, err.message)
      store.isPlaying = false
    })
  }
}

/** 直接操作底层 audio 元素暂停 */
function doPauseAudio() {
  if (!ap || !ap.audio) return
  ap.audio.pause()
}

/**
 * 增量更新 APlayer 播放列表
 */
function syncPlaylistToAPlayer() {
  if (!ap || !store.playlist.length) return

  try {
    // 清空旧列表
    const listLen = ap.list.list?.length || 0
    for (let i = listLen - 1; i >= 0; i--) {
      ap.list.remove(i)
    }

    // 添加新歌曲
    for (const track of store.playlist) {
      ap.list.add(toAPlayerAudio(track))
    }

    // 切换到当前曲目
    const idx = Math.max(0, Math.min(store.currentIndex, store.playlist.length - 1))
    if (ap.list.index !== idx) {
      ap.list.switch(idx)
    }
    ap.audio.muted = false
    if (ap.audio.volume === 0) ap.audio.volume = 0.8

    console.log('[GlobalAudioPlayer] synced playlist, current src:', ap.audio.src)
  } catch (e) {
    console.warn('[GlobalAudioPlayer] sync failed, reinit:', e)
    apInitialized = false
    try { ap?.destroy() } catch { /* ignore */ }
    ap = null
    nextTick(initAPlayer)
  }
}

watch(() => currentTrack.value?.id, () => {
  coverBroken.value = false
})

// 首次有播放列表时初始化
watch(() => store.hasPlaylist, (has) => {
  if (has && !apInitialized) {
    nextTick(initAPlayer)
  }
})

// 播放列表变更 → 增量同步
watch(
  () => store.playlist.map((track) => `${track.id}:${track.mediaPath}`).join('|'),
  () => {
    if (!apInitialized) return
    nextTick(syncPlaylistToAPlayer)
  },
)

// 当前曲目索引变更 → 切歌
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
      if (store.isPlaying) doPlayAudio()
    } catch (e) {
      console.warn('[GlobalAudioPlayer] switch error:', e)
    }
  }
)

// isPlaying 变更 → 同步播放/暂停
watch(
  () => store.isPlaying,
  (playing) => {
    if (!ap) return
    if (playing) doPlayAudio()
    else doPauseAudio()
  }
)

onMounted(() => {
  if (store.playlist.length > 0) {
    initAPlayer()
  }
})

onBeforeUnmount(() => {
  try { ap?.destroy() } catch { /* ignore */ }
  ap = null
  apInitialized = false
})

/** 用户手势播放/暂停 — handlePlayPause 由 mini-bar 按钮 @click.stop 调用，保留手势上下文 */
function handlePlayPause() {
  if (!ap) {
    if (store.hasPlaylist && !apInitialized) {
      initAPlayer()
      if (ap) doPlayAudio()
    }
    return
  }

  if (store.isPlaying) {
    doPauseAudio()
    // APlayer 的 pause 事件会同步 store
  } else {
    doPlayAudio()
    // 成功后 store.isPlaying = true，失败则保持 false
  }
}

defineExpose({ tryPlay: doPlayAudio })
</script>

<template>
  <div class="global-audio-player" :class="{ expanded: store.isExpanded, visible: store.hasPlaylist }">
    <!-- Mini bar -->
    <div v-show="store.hasPlaylist && !store.isExpanded" class="mini-bar" @click="store.toggleExpanded">
      <div class="mini-cover">
        <img v-if="hasCover" :src="'/media/by-id/' + currentTrack?.id" alt="" @error="onCoverError" />
        <div v-else class="mini-cover-placeholder">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M9 18V5l12-2v13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="1.5"/><circle cx="18" cy="16" r="3" stroke="currentColor" stroke-width="1.5"/></svg>
        </div>
      </div>
      <div class="mini-info">
        <p class="mini-title">{{ currentTrack?.title || '未知音频' }}</p>
        <p class="mini-author">{{ currentTrack?.authorName || '未知作者' }}</p>
      </div>
      <div class="mini-actions">
        <button class="mini-btn" @click.stop="handlePlayPause" :title="store.isPlaying ? '暂停' : '播放'">
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

    <!-- APlayer container -->
    <div ref="aplayerRef" class="aplayer-container" :class="{ visible: store.isExpanded }" />

    <!-- Expanded backdrop -->
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
  left: 72px;   /* .douyin-navigation / .my-page 交界 */
  right: 0;     /* .my-page 右边界 */
  z-index: 900;
  display: none;

  &.visible {
    display: block;
  }

  &.expanded {
    top: 0;
    left: 0;
    right: 0;
    z-index: 1000;
  }
}

// ── Mini bar ──
.mini-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  margin-bottom: 8px;
  background: linear-gradient(135deg, rgba(22, 27, 38, 0.96), rgba(14, 17, 23, 0.96));
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-bottom: none;
  border-radius: 12px 12px 0 0;
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
  position: fixed;
  bottom: 0;
  left: 72px;
  right: 0;
  z-index: 899;
  width: auto;
  height: 1px;  /* 最小高度让浏览器初始化 audio 上下文，0px 会导致 audio.play() 静默失败 */
  overflow: hidden;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.25s ease;

  &.visible {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 1001;
    width: min(720px, 92vw);
    max-height: 80vh;
    overflow-y: auto;
    pointer-events: auto;
    opacity: 1;
    border-radius: 16px;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4);
  }

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
        &:hover { background: rgba(255, 255, 255, 0.04); }
        &.aplayer-list-light { background: rgba(var(--primary-500), 0.1); }
      }
    }

    .aplayer-lrc { display: none; }
    .aplayer-miniswitcher { display: none !important; }
  }
}
</style>
