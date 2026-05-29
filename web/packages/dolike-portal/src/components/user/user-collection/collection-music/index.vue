<script setup lang="ts">
import { ref, onMounted, provide, computed } from 'vue'
import UserError from '../../user-error/index.vue'
import MusicItem from './music-item.vue'
import apis from '@/api/apis'
import { useGridScrollToItem } from '@/hooks'
import { Toast } from '@/components/ui/toast'
import type { ICollectMusicItem } from '@/api/tyeps/request_response/userCollectMusicRes'

// 统一的音乐项接口（支持 Douyin 收藏音乐 + 本地提取音频）
interface UnifiedMusicItem {
  id: string           // 唯一标识（Douyin 用 id_str，本地用 awemeId）
  id_str: string       // 兼容字段
  title: string
  author: string
  duration: number
  cover_medium?: any
  cover_thumb?: any
  play_url?: any
  // 本地提取音频特有字段
  isExtracted?: boolean
  musicContentId?: number
  mediaPath?: string
  status?: string
}

// 播放模式类型
export type PlayMode = 'sequence' | 'loop' | 'shuffle'

// 加载状态
const loading = ref(true)
const isLoadingMore = ref(false)
const hasMore = ref(true)

// 音乐列表（统一）
const musicList = ref<UnifiedMusicItem[]>([])

// 提取的音频列表
const extractedAudioList = ref<UnifiedMusicItem[]>([])
const extractedAudioLoading = ref(false)

// 分页参数
const count = ref(20)
const cursor = ref(0)

// ========== 播放状态管理 ==========
const currentPlayingId = ref<string | null>(null)
const playMode = ref<PlayMode>('sequence')

// 音乐列表容器引用
const musicListRef = ref<HTMLElement | null>(null)

// 使用滚动 Hook，自动滚动到当前播放项
const { scrollToItem } = useGridScrollToItem({
  containerRef: musicListRef,
  currentId: currentPlayingId,
  items: allMusicList,
  idKey: 'id_str',
  block: 'start',
  offsetTop: 178 // 导航栏高度
})

// 切换播放模式
const togglePlayMode = () => {
  const modeOrder: PlayMode[] = ['sequence', 'loop', 'shuffle']
  const currentIndex = modeOrder.indexOf(playMode.value)
  playMode.value = modeOrder[(currentIndex + 1) % modeOrder.length]
}

// 获取下一首歌曲索引
const getNextIndex = (currentIndex: number): number => {
  const listLength = allMusicList.value.length
  if (listLength === 0) return -1

  switch (playMode.value) {
    case 'sequence':
      return currentIndex < listLength - 1 ? currentIndex + 1 : -1
    case 'loop':
      return currentIndex
    case 'shuffle':
      if (listLength === 1) return 0
      let randomIndex = Math.floor(Math.random() * listLength)
      while (randomIndex === currentIndex) {
        randomIndex = Math.floor(Math.random() * listLength)
      }
      return randomIndex
    default:
      return -1
  }
}

// 播放指定歌曲
const playMusic = (musicId: string) => {
  currentPlayingId.value = musicId
}

// 停止播放
const stopMusic = () => {
  currentPlayingId.value = null
}

// 播放结束处理
const handleMusicEnded = async (musicId: string) => {
  const currentIndex = allMusicList.value.findIndex((m) => m.id_str === musicId)

  if (
    currentIndex >= musicList.value.length - 3 &&
    hasMore.value &&
    !isLoadingMore.value
  ) {
    await getMusicList()
  }

  const nextIndex = getNextIndex(currentIndex)

  if (nextIndex >= 0 && nextIndex < musicList.value.length) {
    currentPlayingId.value = musicList.value[nextIndex].id_str
  } else {
    currentPlayingId.value = null
  }
}

// 提供给子组件
provide('musicPlayer', {
  currentPlayingId,
  playMode,
  togglePlayMode,
  playMusic,
  stopMusic,
  handleMusicEnded
})

// 获取收藏音乐列表（Douyin）
const getMusicList = async () => {
  if (!hasMore.value || isLoadingMore.value) return
  isLoadingMore.value = true

  try {
    const res = await apis.getUserCollectMusic(count.value, cursor.value)
    const newMusicList = (res.mc_list || []).map((m: ICollectMusicItem) => ({
      ...m,
      id: m.id_str,
      author: m.author,
      isExtracted: false
    }))
    musicList.value = musicList.value.concat(newMusicList)
    cursor.value = res.cursor
    hasMore.value = !!res.has_more
  } catch (error) {
    console.error('获取收藏音乐列表失败:', error)
    hasMore.value = false
  } finally {
    loading.value = false
    isLoadingMore.value = false
  }
}

// 获取提取的音频列表（本地）
const getExtractedAudio = async () => {
  extractedAudioLoading.value = true
  try {
    const res = await apis.getExtractedAudio(1, 50)
    extractedAudioList.value = (res.items || []).map((item: any) => ({
      id: item.awemeId,
      id_str: item.awemeId,
      title: item.title,
      author: item.authorName,
      duration: item.durationSec,
      isExtracted: true,
      musicContentId: item.id,
      mediaPath: item.mediaPath,
      status: item.status,
      // 本地音频使用 mediaPath 作为播放源
      play_url: item.mediaPath ? { url_list: ['/media/' + item.mediaPath] } : undefined
    }))
  } catch (error) {
    console.error('获取提取音频列表失败:', error)
  } finally {
    extractedAudioLoading.value = false
  }
}

// 合并列表（提取的音频在前）
const allMusicList = computed(() => {
  return [...extractedAudioList.value, ...musicList.value]
})

// 删除提取的音频
const handleDeleteExtracted = async (musicContentId: number) => {
  try {
    await apis.deleteExtractedAudio(musicContentId)
    extractedAudioList.value = extractedAudioList.value.filter(
      (m) => m.musicContentId !== musicContentId
    )
    Toast.success('已删除')
  } catch (error: any) {
    Toast.error(error?.message || '删除失败')
  }
}

onMounted(() => {
  getMusicList()
  getExtractedAudio()
})

// 无限滚动加载
useInfiniteScroll(
  window,
  () => {
    if (!isLoadingMore.value && hasMore.value && !loading.value) {
      getMusicList()
    }
  },
  { distance: 200 }
)
</script>

<template>
  <Loading :show="loading && extractedAudioLoading">
    <div class="collection-music">
      <!-- 空状态 -->
      <user-error
        v-if="!loading && !extractedAudioLoading && allMusicList.length === 0"
        icon="no-show-like"
        title="暂无音乐"
        desc="收藏喜欢的音乐或从视频中提取原声，随时聆听"
        class="no-data"
      />

      <!-- 音乐列表 -->
      <template v-if="allMusicList.length > 0">
        <div ref="musicListRef" class="music-list">
          <MusicItem
            v-for="music in allMusicList"
            :key="music.id_str"
            :music="music"
            :is-extracted="music.isExtracted"
            @delete-extracted="handleDeleteExtracted"
          />
        </div>
        <Loading :show="isLoadingMore" />
        <list-footer v-if="!hasMore" />
      </template>
  </Loading>
</template>
    </div>
  </Loading>
</template>

<style lang="scss" scoped>
.collection-music {
  position: relative;

  .music-list {
    display: flex;
    flex-wrap: wrap;
  }
}
</style>
