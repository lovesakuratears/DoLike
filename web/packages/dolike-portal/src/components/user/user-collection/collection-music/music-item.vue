<script setup lang="ts">
import { ref, computed, inject, watch, type Ref } from 'vue'
import HoverDropdown from '@/components/common/hover-dropdown/index.vue'
import MusicPlayer from './music-player.vue'
import type { ICollectMusicItem } from '@/api/tyeps/request_response/userCollectMusicRes'
import { Toast } from '@/components/ui/toast'
import type { PlayMode } from './index.vue'

// 注入播放状态管理
const musicPlayer = inject<{
  currentPlayingId: Ref<string | null>
  playMode: Ref<PlayMode>
  togglePlayMode: () => void
  playMusic: (id: string) => void
  stopMusic: () => void
  handleMusicEnded: (id: string) => void
}>('musicPlayer')

// 接收音乐数据
const props = defineProps<{
  music: ICollectMusicItem
  isExtracted?: boolean
}>()

const emit = defineEmits<{
  (e: 'deleteExtracted', musicContentId: number): void
}>()

// 获取封面图片 URL
const coverUrl = computed(() => {
  if (props.isExtracted) {
    // 提取的音频使用默认音乐图标
    return ''
  }
  return (
    props.music.cover_medium?.url_list?.[0] ||
    props.music.cover_thumb?.url_list?.[0] ||
    ''
  )
})

// 获取音频播放 URL
const audioUrl = computed(() => {
  if (props.isExtracted && props.music.play_url?.url_list?.[0]) {
    return props.music.play_url.url_list[0]
  }
  return props.music.play_url?.url_list?.[0] || ''
})

// 播放器引用
const playerRef = ref<InstanceType<typeof MusicPlayer> | null>(null)

// 当前是否正在播放（由父组件控制）
const isPlaying = computed(
  () => musicPlayer?.currentPlayingId.value === props.music.id_str
)

// 当前播放模式
const currentPlayMode = computed(
  () => musicPlayer?.playMode.value || 'sequence'
)

// 监听播放状态变化，控制播放器
watch(isPlaying, (newVal) => {
  if (newVal) {
    playerRef.value?.play()
  } else {
    playerRef.value?.pause()
  }
})

// 监听当前播放ID变化，当其他音乐开始播放时重置本播放器
watch(
  () => musicPlayer?.currentPlayingId.value,
  (newId) => {
    // 如果有新的音乐开始播放，且不是本音乐，则重置本播放器
    if (newId !== null && newId !== props.music.id_str) {
      playerRef.value?.reset()
    }
  }
)

// 下载音频（浏览器保存到本地）
const isDownloading = ref(false)

const handleDownload = async () => {
  if (isDownloading.value) {
    Toast.info('正在下载中...')
    return
  }

  const url = props.music.play_url?.url_list?.[0]
  if (!url) {
    Toast.warning('暂无下载地址')
    return
  }

  isDownloading.value = true
  const fileName = `${props.music.title || 'audio'}.mp3`
  Toast.info('正在下载...')

  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error('下载失败')

    const blob = await response.blob()
    if (blob.size < 1000) throw new Error('文件无效')

    const blobUrl = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = fileName
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(blobUrl)
    Toast.success('下载成功')
  } catch (error: any) {
    Toast.error(error?.message || '下载失败')
  } finally {
    isDownloading.value = false
  }
}

// 删除提取的音频
const handleDelete = () => {
  if (!props.isExtracted || !props.music.musicContentId) return
  emit('deleteExtracted', props.music.musicContentId)
}

// 点击封面播放/暂停
const handleCoverClick = () => {
  if (isPlaying.value) {
    musicPlayer?.stopMusic()
  } else {
    musicPlayer?.playMusic(props.music.id_str)
  }
}

// 播放事件（通知父组件）
const onPlay = () => {
  if (!isPlaying.value) {
    musicPlayer?.playMusic(props.music.id_str)
  }
}

const onPause = () => {
  // 暂停时不需要通知父组件停止，保持当前播放ID
}

const onEnded = () => {
  // 播放结束，通知父组件处理下一首
  musicPlayer?.handleMusicEnded(props.music.id_str)
}

// 切换播放模式
const handleTogglePlayMode = () => {
  musicPlayer?.togglePlayMode()
}
</script>

<template>
  <div class="music-item">
    <div class="music-item-content collect-music-player">
      <!-- 封面区域 -->
      <div class="music-item-cover" @click="handleCoverClick">
        <img class="music-item-cover-img" :src="coverUrl" :alt="music.title" />
        <!-- 播放图标 -->
        <svg
          v-if="!isPlaying"
          width="32"
          height="32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          class="music-play-icon"
          viewBox="2 2 34 34"
        >
          <path
            d="M10 10.693c0-1.7 0-2.549.354-3.013A1.729 1.729 0 0 1 11.64 7c.582-.03 1.284.45 2.687 1.409l9.697 6.63c1.097.75 1.646 1.126 1.843 1.598.172.414.177.878.014 1.296-.187.476-.727.863-1.808 1.638l-9.697 6.945c-1.413 1.013-2.12 1.52-2.71 1.498a1.728 1.728 0 0 1-1.305-.67C10 26.877 10 26.007 10 24.268V10.693z"
            fill="#0A0C20"
          ></path>
        </svg>
        <!-- 暂停图标 -->
        <svg
          v-else
          width="32"
          height="32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          class="music-pause-icon"
          viewBox="2 2 34 34"
        >
          <path
            fill-rule="evenodd"
            clip-rule="evenodd"
            d="M11 10.282C11 9.574 11.514 9 12.149 9h1.596c.634 0 1.149.574 1.149 1.282v15.436c0 .708-.515 1.282-1.15 1.282H12.15C11.514 27 11 26.426 11 25.718V10.282zm11 0C22 9.574 22.514 9 23.149 9h1.596c.634 0 1.149.574 1.149 1.282v15.436c0 .708-.515 1.282-1.15 1.282H23.15C22.514 27 22 26.426 22 25.718V10.282z"
            fill="#0A0C20"
          ></path>
        </svg>
      </div>

      <div class="music-info">
        <div class="music-title-wrapper">
          <span class="music-title" :title="music.title">
            {{ music.title }}
          </span>
          <span class="music-author" :title="music.author">
            {{ music.author }}
          </span>
        </div>
        <div class="music-operate">
          <!-- 音乐播放器组件 -->
          <MusicPlayer
            ref="playerRef"
            :src="audioUrl"
            :duration="music.duration"
            :play-mode="currentPlayMode"
            @play="onPlay"
            @pause="onPause"
            @ended="onEnded"
            @toggle-play-mode="handleTogglePlayMode"
          />
        </div>
      </div>

      <!-- 更多操作 -->
      <div class="music-more">
        <HoverDropdown placement="auto" content-class="more-menu">
          <template #trigger>
            <div class="music-more-btn">
              <svg
                width="18"
                height="18"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
              >
                <path
                  d="M16.5 12a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0zM10.5 12a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0zM5 12a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0z"
                  fill="#fff"
                  fill-opacity=".5"
                ></path>
              </svg>
            </div>
          </template>
          <template #content>
            <div v-if="isExtracted" class="more-menu-item" @click="handleDownload">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
              下载
            </div>
            <div v-if="isExtracted" class="more-menu-item" @click="handleDelete">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
              删除
            </div>
            <template v-else>
              <div class="more-menu-item">去使用</div>
              <div class="more-menu-item">取消收藏</div>
            </template>
          </template>
        </HoverDropdown>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
:root .collect-music-player {
  --color-progress-dot: #919192;
  --color-progress-dot-outline: #cfcfd2;
  --color-progress: #d4d4d8;
  --color-progress-cache: #cacace;
  --color-progress-played: #88898f;
  --color-volume-bar: #cacace;
  --color-volume-dot: #6e6f77;
}

:root[dark] .collect-music-player {
  --color-progress-dot: #fff;
  --color-progress-dot-outline: rgba(255, 255, 255, 0.2);
  --color-progress: rgba(255, 255, 255, 0.34);
  --color-progress-cache: rgba(255, 255, 255, 0.34);
  --color-progress-played: rgba(255, 255, 255, 0.9);
  --color-volume-bar: rgba(255, 255, 255, 0.34);
  --color-volume-dot: #fff;
}

.music-item {
  width: calc(33.33% - 10.8px);
  margin-bottom: 16px;
  margin-right: 16px;
  display: inline-block;

  &:nth-child(3n) {
    margin-right: 0;
  }
}

.music-item-content {
  width: 100%;
  height: 110px;
  background-color: #fff;
  background-color: var(--color-bg-b1-white);
  user-select: none;
  border-radius: 12px;
  padding: 12px;
  position: relative;

  &:hover {
    background-color: var(--color-bg-b2);
  }
}

.music-item-cover {
  float: left;
  height: 86px;
  width: 86px;
  border-radius: 8px;
  margin-right: 12px;
  position: relative;
  overflow: hidden;
  cursor: pointer;

  .music-item-cover-img {
    height: 100%;
    width: 100%;
    object-fit: cover;
    position: absolute;
  }

  .music-play-icon,
  .music-pause-icon {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    opacity: 0.9;
    transition: opacity 0.2s, transform 0.2s;

    path {
      fill: var(--color-const-text-white);
      filter: drop-shadow(0 0 4px rgba(0, 0, 0, 0.3));
    }
  }

  &:hover {
    .music-play-icon,
    .music-pause-icon {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1.1);
    }
  }
}

.music-info {
  height: 86px;
  flex-direction: column;
  display: flex;

  .music-title-wrapper {
    flex-direction: column;
    display: flex;

    .music-title {
      color: var(--color-text-t1);
      font-size: 14px;
      line-height: 22px;
    }

    .music-author {
      color: var(--color-text-t3);
      font-size: 12px;
      line-height: 20px;
    }

    .music-title,
    .music-author {
      width: calc(100% - 46px);
      text-overflow: ellipsis;
      line-clamp: 1;
      -webkit-box-orient: vertical;
      display: -webkit-box;
      overflow: hidden;
      font-weight: 400;
    }
  }

  .music-operate {
    flex: 1 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }
}

.music-more {
  line-height: 0;
  position: absolute;
  top: 12px;
  right: 12px;

  .music-more-btn {
    position: relative;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    transition: background-color 0.2s;

    &:hover {
      background-color: var(--color-bg-b2);
    }
  }
}

:deep(.more-menu) {
  width: auto;
  height: auto;
  padding: 8px;
  border-radius: 12px;

  .more-menu-item {
    width: 96px;
    height: 38px;
    text-align: center;
    cursor: pointer;
    background-color: var(--color-bg-b1);
    color: var(--color-text-t3);
    border-radius: 8px;
    font-size: 14px;
    line-height: 38px;

    &:not(:last-child) {
      margin-bottom: 4px;
    }

    &:hover {
      color: var(--color-text-t0);
      background-color: var(--color-bg-b2);
    }
  }
}
</style>
