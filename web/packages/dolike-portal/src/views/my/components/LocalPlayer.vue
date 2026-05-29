<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import Player from "xgplayer";
import PlaybackRate from "xgplayer/es/plugins/playbackRate";
import "xgplayer/dist/index.min.css";
import type { VideoListItem } from "@/api/local";
import { useAudioPlayerStore } from "@/stores/audio-player";

const props = defineProps<{ item: VideoListItem | null }>();
const emit = defineEmits<{ (e: "close"): void }>();

const playerEl = ref<HTMLDivElement | null>(null);
let player: Player | null = null;

const mediaUrl = (it: VideoListItem | null): string => {
  if (!it?.mediaPath) return "";
  return `/media/${it.mediaPath}`;
};

const isAudio = (it: VideoListItem | null): boolean => {
  return Boolean(it?.mediaPath?.toLowerCase().endsWith(".mp3"));
};

const isVideo = (it: VideoListItem | null): boolean => !isAudio(it);

const isFullscreen = ref(false);

const toggleFullscreen = () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.();
    isFullscreen.value = true;
  } else {
    document.exitFullscreen?.();
    isFullscreen.value = false;
  }
};

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === "Escape" && isFullscreen.value) {
    document.exitFullscreen?.();
    isFullscreen.value = false;
  }
};

const audioPlayer = useAudioPlayerStore();

const initPlayer = () => {
  if (!playerEl.value || !props.item) return;
  const url = mediaUrl(props.item);
  if (!url) return;
  try {
    player?.destroy();
  } catch {}
  player = new Player({
    el: playerEl.value,
    url,
    width: "100%",
    height: isAudio(props.item) ? "220px" : "100%",
    autoplay: true,
    playbackRate: [0.5, 1, 1.25, 1.5, 2],
    defaultPlaybackRate: 1,
    volume: 0.8,
    closeVideoClick: true,
    poster: props.item.coverPath ? `/media/${props.item.coverPath}` : undefined,
    plugins: [PlaybackRate],
  });
  // Pause global audio player when video starts playing
  player.on("play", () => {
    audioPlayer.pause();
  });
};

watch(
  () => props.item?.id,
  () => initPlayer(),
  { flush: "post", immediate: true }
);

onMounted(() => {
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("fullscreenchange", () => {
    isFullscreen.value = !!document.fullscreenElement;
  });
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown);
  if (document.fullscreenElement) document.exitFullscreen?.();
  try {
    player?.destroy();
  } catch {}
  player = null;
});

const onBackdrop = (e: MouseEvent) => {
  if ((e.target as HTMLElement).classList.contains("local-player-backdrop"))
    emit("close");
};
</script>

<template>
  <div v-if="props.item" class="local-player-backdrop" @click="onBackdrop">
    <div class="local-player" :class="{ 'is-fullscreen': isFullscreen }">
      <header class="bar">
        <button class="back-btn" type="button" @click="emit('close')" title="返回">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 19l-7-7 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <p class="title">{{ props.item.title }}</p>
        <div class="bar-actions">
          <button v-if="isVideo(props.item)" class="fullscreen-btn" type="button" @click="toggleFullscreen" :title="isFullscreen ? '退出全屏 (ESC)' : '全屏'">
            <svg v-if="!isFullscreen" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M8 3H5a2 2 0 00-2 2v3m0 8v3a2 2 0 002 2h3m8-18h3a2 2 0 012 2v3m0 8v3a2 2 0 01-2 2h-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 14h3a1 1 0 011 1v3M20 14h-3a1 1 0 00-1 1v3M4 10h3a1 1 0 011 1v3M20 10h-3a1 1 0 00-1 1v3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <el-button size="small" @click="emit('close')">关闭</el-button>
        </div>
      </header>
      <div v-if="!props.item.mediaPath" class="missing">
        <p>{{ isAudio(props.item) ? '音频' : '视频' }}尚未下载完成（状态：{{ props.item.status }}）。</p>
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
  background:
    radial-gradient(circle at top, rgba(var(--primary-500), 0.12), transparent 24%),
    rgba(4, 6, 12, 0.72);
  backdrop-filter: blur(10px);
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
}

.local-player {
  width: min(900px, 90vw);
  max-height: 90vh;
  background: linear-gradient(180deg, #171b22, #0e1117);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 20px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 28px 64px rgba(0, 0, 0, 0.4);

  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    background: rgba(255, 255, 255, 0.04);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);

    .title {
      margin: 0;
      flex: 1;
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .missing {
    padding: 60px 20px;
    text-align: center;
    color: #ccc;

    .muted { color: rgba(255, 255, 255, 0.52); }
    .small { font-size: 12px; }
  }

  .player-mount {
    flex: 1;
    aspect-ratio: 16 / 9;
    min-height: 360px;
    background: #000;
  }

  :deep(.xgplayer-is-audio) {
    background: linear-gradient(180deg, #1a1f29, #10141c);
  }

  .back-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    border-radius: 8px;
    transition: color 0.2s, background-color 0.2s;
    flex-shrink: 0;

    &:hover {
      color: #fff;
      background-color: rgba(255, 255, 255, 0.08);
    }
  }

  .bar-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .fullscreen-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    border-radius: 8px;
    transition: color 0.2s, background-color 0.2s;

    &:hover {
      color: #fff;
      background-color: rgba(255, 255, 255, 0.08);
    }
  }

  .local-player.is-fullscreen {
    width: 100vw;
    max-width: 100vw;
    height: 100vh;
    max-height: 100vh;
    border-radius: 0;
    border: none;

    .player-mount {
      flex: 1;
      aspect-ratio: auto;
      min-height: 0;
    }
  }
}
</style>