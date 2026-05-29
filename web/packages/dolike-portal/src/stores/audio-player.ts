import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface AudioTrack {
  id: number
  title: string
  authorName: string
  mediaPath: string
  coverPath: string | null
  durationSec: number
}

export const useAudioPlayerStore = defineStore('audio-player', () => {
  const playlist = ref<AudioTrack[]>([])
  const currentIndex = ref(0)
  const isPlaying = ref(false)
  const isVisible = ref(false)
  const isExpanded = ref(false)

  const currentTrack = computed(() => playlist.value[currentIndex.value] || null)
  const hasPlaylist = computed(() => playlist.value.length > 0)

  function playTrack(track: AudioTrack, list?: AudioTrack[]) {
    if (list && list.length > 0) {
      playlist.value = list
      const idx = list.findIndex((t) => t.id === track.id)
      currentIndex.value = idx >= 0 ? idx : 0
    } else {
      const existingIdx = playlist.value.findIndex((t) => t.id === track.id)
      if (existingIdx >= 0) {
        currentIndex.value = existingIdx
      } else {
        playlist.value = [track]
        currentIndex.value = 0
      }
    }
    isVisible.value = true
    isPlaying.value = true
  }

  function setPlaylist(tracks: AudioTrack[], index = 0) {
    playlist.value = tracks
    currentIndex.value = Math.max(0, Math.min(index, tracks.length - 1))
    isVisible.value = true
  }

  function togglePlay() {
    isPlaying.value = !isPlaying.value
  }

  function pause() {
    isPlaying.value = false
  }

  function resume() {
    if (hasPlaylist.value) {
      isPlaying.value = true
    }
  }

  function playNext() {
    if (playlist.value.length === 0) return
    currentIndex.value = (currentIndex.value + 1) % playlist.value.length
    isPlaying.value = true
  }

  function playPrev() {
    if (playlist.value.length === 0) return
    currentIndex.value = currentIndex.value <= 0 ? playlist.value.length - 1 : currentIndex.value - 1
    isPlaying.value = true
  }

  function playAt(index: number) {
    if (index < 0 || index >= playlist.value.length) return
    currentIndex.value = index
    isPlaying.value = true
  }

  function clearPlaylist() {
    playlist.value = []
    currentIndex.value = 0
    isPlaying.value = false
    isVisible.value = false
    isExpanded.value = false
  }

  function toggleExpanded() {
    isExpanded.value = !isExpanded.value
  }

  return {
    playlist,
    currentIndex,
    isPlaying,
    isVisible,
    isExpanded,
    currentTrack,
    hasPlaylist,
    playTrack,
    setPlaylist,
    togglePlay,
    pause,
    resume,
    playNext,
    playPrev,
    playAt,
    clearPlaylist,
    toggleExpanded,
  }
})
