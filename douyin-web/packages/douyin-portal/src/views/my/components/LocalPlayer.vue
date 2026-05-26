<script setup lang="ts">
// 本地 xgplayer 包装
//
// - 支持本地 mp4（默认 native HLS / FLV 不需要）
// - 暂停 / 拖动 / 倍速由 xgplayer 自带（PlaybackRate 插件）

import { onBeforeUnmount, ref, watch } from 'vue'
import Player from 'xgplayer'
import PlaybackRate from 'xgplayer/es/plugins/playbackRate'
import 'xgplayer/dist/index.min.css'
import type { VideoListItem } from '@/api/local'

const props = defineProps<{ item: VideoListItem | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const playerEl = ref<HTMLDivElement | null>(null)
let player: Player | null = null

const mediaUrl = (it: VideoListItem | null): string => {
  if (!it?.mediaPath) return ''
  return `/media/${it.mediaPath}`
}

const initPlayer = () => {
  if (!playerEl.value || !props.item) return
  const url = mediaUrl(props.item)
  if (!url) return
  try {
    player?.destroy()
  } catch {}
  player = new Player({
    el: playerEl.value,
    url,
    width: '100%',
    height: '100%',
    autoplay: true,
    playbackRate: [0.5, 1, 1.25, 1.5, 2],
    defaultPlaybackRate: 1,
    volume: 0.8,
    closeVideoClick: true,
    plugins: [PlaybackRate]
  })
}

// flush:'post' 关键：item 由 null→object 时，watch 默认在 DOM 更新前触发，
// 那一刻 playerEl 仍然是 null（v-if 还没把 <div ref="playerEl"> 挂上），initPlayer 会空跑。
// 切到 post 让 watch 在 DOM patch 之后跑；immediate 取代 onMounted。
watch(
  () => props.item?.id,
  () => initPlayer(),
  { flush: 'post', immediate: true }
)
onBeforeUnmount(() => {
  try {
    player?.destroy()
  } catch {}
  player = null
})

const onBackdrop = (e: MouseEvent) => {
  if ((e.target as HTMLElement).classList.contains('local-player-backdrop')) emit('close')
}
</script>

<template>
  <div v-if="props.item" class="local-player-backdrop" @click="onBackdrop">
    <div class="local-player">
      <header class="bar">
        <p class="title">{{ props.item.title }}</p>
        <el-button size="small" @click="emit('close')">关闭</el-button>
      </header>
      <div v-if="!props.item.mediaPath" class="missing">
        <p>视频尚未下载完成（状态：{{ props.item.status }}）。</p>
        <p class="muted small">下载完成后会自动可播放。</p>
      </div>
      <div v-else ref="playerEl" class="player-mount" />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.local-player-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
}
.local-player {
  width: min(900px, 90vw);
  max-height: 90vh;
  background: #111;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;

  .bar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 14px;
    background: #222;
    .title {
      margin: 0; flex: 1;
      color: #fff; font-size: 14px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
  }
  .missing {
    padding: 60px 20px;
    text-align: center;
    color: #ccc;
    .muted { color: #888; }
    .small { font-size: 12px; }
  }
  .player-mount {
    flex: 1;
    aspect-ratio: 16 / 9;
    min-height: 360px;
    background: #000;
  }
}
</style>
