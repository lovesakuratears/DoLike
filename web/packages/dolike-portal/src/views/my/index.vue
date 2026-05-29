<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'
import { useLocalAuthStore } from '@/stores/local-auth'
import VideoGrid from './components/VideoGrid.vue'
import MusicShelf from './components/MusicShelf.vue'
import LocalPlayer from './components/LocalPlayer.vue'
import AccountsPanel from './components/AccountsPanel.vue'
import FolderGrid from './components/FolderGrid.vue'
import { localApi, type VideoListItem, type FolderListItem, type MixListItem, type DouyinAccountDTO } from '@/api/local'
import { useAudioPlayerStore } from '@/stores/audio-player'

const route = useRoute()
const router = useRouter()
const auth = useLocalAuthStore()
const audioPlayer = useAudioPlayerStore()

type Tab = 'videos' | 'music' | 'mixes'
const TABS: { key: Tab; label: string }[] = [
  { key: 'videos', label: '视频' },
  { key: 'music', label: '音频' },
  { key: 'mixes', label: '合集' }
]

type LinkSub = 'POST' | 'LIKE' | 'FAVORITE' | 'WATCH_LATER' | 'FOLDERS'
const LINK_SUBS: { key: LinkSub; label: string }[] = [
  { key: 'POST', label: '作品' },
  { key: 'LIKE', label: '喜欢' },
  { key: 'FAVORITE', label: '收藏' },
  { key: 'WATCH_LATER', label: '稍后再看' },
  { key: 'FOLDERS', label: '收藏夹' }
]

const VALID_LINKS: LinkSub[] = ['POST', 'LIKE', 'FAVORITE', 'WATCH_LATER', 'FOLDERS']

const queryTab = computed<Tab>(() => {
  const t = String(route.query.tab || '')
  if (['music', 'mixes'].includes(t)) return t as Tab
  return 'videos'
})
const activeTab = ref<Tab>(queryTab.value)
const activeLink = ref<LinkSub>(
  VALID_LINKS.includes(route.query.link as LinkSub) ? (route.query.link as LinkSub) : 'LIKE'
)

const selectTab = (t: Tab) => {
  activeTab.value = t
  const q: Record<string, string> = { tab: t }
  if (t === 'videos' && activeLink.value) q.link = activeLink.value
  router.replace({ query: q })
  if (t !== 'videos') activeFolder.value = null
  if (t !== 'mixes') activeMix.value = null
  if (t === 'mixes') void refreshMixes()
}

type Duration = 'short' | 'long'
const duration = ref<Duration | null>(null)
const keyword = ref("")


const accountsRef = ref<InstanceType<typeof AccountsPanel> | null>(null)
const videoGridRef = ref<InstanceType<typeof VideoGrid> | null>(null)
const folderVideoGridRef = ref<InstanceType<typeof VideoGrid> | null>(null)
const folderGridRef = ref<InstanceType<typeof FolderGrid> | null>(null)
const musicShelfRef = ref<InstanceType<typeof MusicShelf> | null>(null)
const playing = ref<VideoListItem | null>(null)

const activeFolder = ref<FolderListItem | null>(null)
const mixes = ref<MixListItem[]>([])
const mixesLoading = ref(false)
const activeMix = ref<MixListItem | null>(null)

// ★ 页面级归档状态
// 标记: PAGE_ARCHIVE_BUTTON
const accounts = ref<DouyinAccountDTO[]>([])
const pageArchiving = ref(false)
const archiveMode = ref<'full' | 'incremental' | null>(null)

const onPlay = (item: VideoListItem) => {
  // 音频类型：使用全局 APlayer，不跳转视频页
  if (item.mediaPath?.toLowerCase().endsWith('.mp3') || activeTab.value === 'music') {
    const shelfItems = musicShelfRef.value?.items || []
    const trackList = (shelfItems.length > 0 ? shelfItems : [item]).map((t: VideoListItem) => ({
      id: t.id,
      title: t.title || '未知音频',
      authorName: t.authorName || '未知作者',
      mediaPath: t.mediaPath || '',
      coverPath: t.coverPath,
      durationSec: t.durationSec || 0,
    }))
    const currentTrack = trackList.find((t) => t.id === item.id) || trackList[0]
    audioPlayer.playTrack(currentTrack, trackList)
    return
  }
  // 视频类型：暂停音频并跳转视频详情页
  audioPlayer.pause()
  router.push({
    name: 'local-video',
    params: { id: String(item.id) },
    query: { fromLink: activeLink.value, fromTab: activeTab.value }
  })
}
const onClosePlayer = () => {
  playing.value = null
}

const onSearch = () => {
  videoGridRef.value?.refresh()
  musicShelfRef.value?.refresh()
}

// 提取音频（视频标签下）
const onExtractAudio = async (ids: number[]) => {
  console.log('[onExtractAudio] called, ids:', ids, 'length:', ids.length)
  if (ids.length === 0) {
    console.warn('[onExtractAudio] empty ids, return')
    return
  }
  ElMessage.info('正在提取音频...')
  let successCount = 0
  let skipCount = 0
  try {
    for (const id of ids) {
      // 从 VideoGrid 实例中查找 item（优先用活跃的 ref，找不到时尝试另一个）
      const item = videoGridRef.value?.items?.find((it: any) => it.id === id)
        ?? folderVideoGridRef.value?.items?.find((it: any) => it.id === id)
      if (!item) {
        console.warn('[onExtractAudio] item not found for id:', id)
        continue
      }

      // 必须有本地视频文件才能提取
      if (!item.mediaPath) {
        console.warn('[extractAudio] skip: no mediaPath', item.awemeId, item.title)
        skipCount++
        continue
      }

      const videoUrl = '/media/' + item.mediaPath
      const reqBody = {
        awemeId: item.awemeId,
        videoUrl,
        title: item.title || '未知视频',
        authorName: item.authorName || '',
        durationSec: item.durationSec || 0,
        sourceCoverPath: item.coverPath || null
      }
      console.log('[extractAudio] request body:', JSON.stringify(reqBody))

      const r = await localApi.extractAudio(reqBody)
      console.log('[extractAudio] response:', r)
      if (r.code === 0) {
        successCount++
      } else {
        console.error('[extractAudio] fail:', r.message)
        ElMessage.warning(`「${item.title}」提取失败：${r.message}`)
      }
    }
    if (successCount > 0) {
      ElMessage.success(`已提取 ${successCount} 个音频，可在"音频"标签查看`)
    }
    if (skipCount > 0) {
      ElMessage.warning(`${skipCount} 个视频尚未下载完成，跳过`)
    }
    if (successCount === 0 && skipCount === 0) {
      ElMessage.error('提取失败，请查看控制台日志')
    }
  } catch (e: any) {
    console.error('[extractAudio] error:', e)
    const backendMsg = e?.response?.data?.message
    ElMessage.error(backendMsg || e?.message || '提取失败，请查看控制台日志')
  }
}

const onDownload = async (ids: number[]) => {
  if (ids.length === 0) return
  let successCount = 0
  for (const id of ids) {
    const item = videoGridRef.value?.items?.find((it: any) => it.id === id)
      ?? folderVideoGridRef.value?.items?.find((it: any) => it.id === id)
    if (!item) continue
    if (!item.mediaPath) {
      ElMessage.warning(`「${item.title}」尚未下载完成，跳过`)
      continue
    }
    try {
      const url = '/media/' + item.mediaPath
      const response = await fetch(url)
      if (!response.ok) throw new Error('下载失败')
      const blob = await response.blob()
      if (blob.size < 1000) throw new Error('文件无效')
      const blobUrl = window.URL.createObjectURL(blob)
      const ext = item.mediaPath.toLowerCase().endsWith('.mp3') ? '.mp3' : '.mp4'
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = (item.title || 'video') + ext
      link.style.display = 'none'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(blobUrl)
      successCount++
    } catch (e: any) {
      ElMessage.error(`「${item.title}」下载失败：${e?.message || ''}`)
    }
  }
  if (successCount > 0) {
    ElMessage.success(`已下载 ${successCount} 个文件`)
  }
}

const onBound = () => {
  accountsRef.value?.refresh()
  videoGridRef.value?.refresh()
  folderGridRef.value?.refresh()
  void loadAccounts()
}

const openFolder = (folder: FolderListItem) => {
  activeFolder.value = folder
}

const closeFolder = () => {
  activeFolder.value = null
}

const openMix = (mix: MixListItem) => {
  router.push({ name: 'mix', params: { id: String(mix.id) } })
}

const closeMix = () => {
  router.back()
}

const onFoldersChanged = () => {
  folderGridRef.value?.refresh()
  videoGridRef.value?.refresh()
}

const refreshMixes = async () => {
  if (activeTab.value !== 'mixes') return
  mixesLoading.value = true
  try {
    const r = await localApi.listMixes()
    if (r.code === 0) mixes.value = r.data
    else ElMessage.error(r.message || '加载合集失败')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '加载合集失败')
  } finally {
    mixesLoading.value = false
  }
}

onMounted(() => {
  window.addEventListener('dolike:account-bound', onBound)
  window.addEventListener('my-local-search', onGlobalSearch as any)
  if (activeTab.value === 'mixes') void refreshMixes()
  void loadAccounts()

})

const onGlobalSearch = (e: any) => {
  keyword.value = e.detail || ''
  onSearch()
}
onBeforeUnmount(() => {
  window.removeEventListener('dolike:account-bound', onBound)
  window.removeEventListener('my-local-search', onGlobalSearch as any)
})

watch(queryTab, (next) => {
  activeTab.value = next
  if (next === 'mixes') void refreshMixes()
})

// 当 activeLink 变化时，同步到 URL（仅视频 tab）
watch(activeLink, (next) => {
  if (activeTab.value === 'videos') {
    router.replace({ query: { ...route.query, tab: activeTab.value, link: next } })
  }
})

// ★ 加载账号列表（用于页面级归档按钮）
// 标记: PAGE_ARCHIVE_LOAD_ACCOUNTS
const loadAccounts = async () => {
  try {
    const r = await localApi.douyinAccounts()
    if (r.code === 0) {
      accounts.value = r.data.filter(a => !a.secUid.startsWith('pending-'))
      if (accounts.value.length > 0) {
        const modeRes = await localApi.archiveMode(accounts.value[0].id)
        if (modeRes.code === 0) {
          archiveMode.value = modeRes.data.mode
        }
      }
    }
  } catch { /* 静默 */ }
}

// ★ 页面级一键归档 —— 对所有有效账号执行
// 标记: PAGE_ARCHIVE_TRIGGER
const pageSmartArchive = async () => {
  if (pageArchiving.value) return
  const validAccounts = accounts.value.filter(a => !a.secUid.startsWith('pending-'))
  if (validAccounts.length === 0) {
    ElMessage.warning('没有可用的抖音账号，请先绑定')
    return
  }
  pageArchiving.value = true
  try {
    let successCount = 0
    for (const acc of validAccounts) {
      try {
        const modeRes = await localApi.archiveMode(acc.id)
        const mode = modeRes.code === 0 ? modeRes.data.mode : 'incremental'
        const apiFn = mode === 'full' ? localApi.archiveFull : localApi.archiveIncremental
        const r = await apiFn(acc.id)
        if (r.code === 0) successCount++
      } catch { /* 单个账号失败继续 */ }
    }
    if (successCount > 0) {
      ElMessage.success(`已启动 ${successCount} 个账号的归档`)
    } else {
      ElMessage.error('所有账号归档启动失败')
    }
    await loadAccounts()
  } finally {
    pageArchiving.value = false
  }
}

document.title = '都喜欢-DoLike'
</script>

<template>
  <div class="my-page">
    <header class="my-header">
      <h1>抖喜欢，我都喜欢</h1>
      <button
        v-if="accounts.length > 0"
        class="page-archive-btn"
        :class="{ 'full-mode': archiveMode === 'full' }"
        :disabled="pageArchiving"
        @click="pageSmartArchive"
      >
        <span v-if="pageArchiving">归档中…</span>
        <span v-else>{{ archiveMode === 'full' ? '全量归档' : '增量归档' }}</span>
      </button>
    </header>

    <section class="accounts-section">
      <AccountsPanel ref="accountsRef" />
    </section>

    <nav class="my-tabs">
      <button
        v-for="t in TABS"
        :key="t.key"
        :class="['my-tabs__item', { active: activeTab === t.key }]"
        @click="selectTab(t.key)"
      >
        {{ t.label }}
      </button>
    </nav>

    <main class="my-content">
      <div v-if="activeTab === 'videos'">
        <div class="videos-toolbar">
          <div class="link-subs">
            <button
              v-for="s in LINK_SUBS"
              :key="s.key"
              :class="['sub', { active: activeLink === s.key }]"
              @click="activeLink = s.key"
            >
              {{ s.label }}
            </button>
          </div>
          <div v-if="activeLink !== 'FOLDERS'" class="duration-filter">
            <div class="filter-group">
              <button
                :class="['filter-btn', { active: duration === 'short' }]"
                type="button"
                @click="duration = duration === 'short' ? null : 'short'"
                title="短视频：时长小于 60 秒"
              >
                短视频
              </button>
              <button
                :class="['filter-btn', { active: duration === 'long' }]"
                type="button"
                @click="duration = duration === 'long' ? null : 'long'"
                title="长视频：时长大于等于 60 秒"
              >
                长视频
              </button>
            </div>
          </div>
        </div>
        <template v-if="activeLink === 'FOLDERS'">
          <div v-if="activeFolder" class="folder-head">
            <el-button size="small" @click="closeFolder">返回收藏夹</el-button>
            <strong>{{ activeFolder.name }}</strong>
          </div>
          <FolderGrid
            v-if="!activeFolder"
            ref="folderGridRef"
            @open="openFolder"
          />
          <VideoGrid
            v-else
            ref="folderVideoGridRef"
            :folder-id="activeFolder.id"
            :keyword="keyword || undefined"
            @play="onPlay"
            @folders-changed="onFoldersChanged"
            @extract-audio="onExtractAudio"
            @download="onDownload"
          />
        </template>
        <VideoGrid
          v-else
          ref="videoGridRef"
          content-kind="VIDEO"
          :link-kind="activeLink"
          :length="duration"
          :keyword="keyword || undefined"
          @play="onPlay"
          @folders-changed="onFoldersChanged"
          @extract-audio="onExtractAudio"
          @download="onDownload"
        />
      </div>
      <div v-else-if="activeTab === 'music'">
        <MusicShelf ref="musicShelfRef" :keyword="keyword" @play="onPlay" />
      </div>
      <div v-else>
        <div v-if="mixesLoading" class="placeholder">
          <p>加载中…</p>
        </div>
        <div v-else-if="mixes.length === 0" class="placeholder">
          <p>还没有已归档合集。</p>
        </div>
        <ul class="mix-list">
          <li v-for="mix in mixes" :key="mix.id" class="mix-card" @click="openMix(mix)">
            <img v-if="mix.coverPath" class="mix-cover" :src="`/media/${mix.coverPath}`" alt="" />
            <div v-else class="mix-cover mix-cover--empty">暂无封面</div>
            <div class="mix-meta">
              <p class="mix-name">{{ mix.name }}</p>
              <p class="mix-sub">
                {{ mix.authorName }} · {{ mix.itemCount }} 条 · {{ mix.kind === 'self' ? '我的合集' : '收藏合集' }}
              </p>
              <p class="mix-enter">点击播放合集</p>
            </div>
          </li>
        </ul>
      </div>
    </main>

    <LocalPlayer :item="playing" @close="onClosePlayer" />

  </div>
</template>

<style lang="scss" scoped>
.my-page {
  padding: 28px 32px 40px;
  // 父级 .right-container 是 overflow:hidden + height:100%（layout/index.vue 全局约定），
  // 这里把自己撑满父亲并打开纵向滚动，避免列表/分页按钮被裁掉。
  height: 100%;
  overflow-y: auto;
  color: var(--color-text-t1);

  &::before {
    content: '';
    position: fixed;
    inset: var(--header-height) 0 0 72px;
    pointer-events: none;
    background:
      radial-gradient(circle at top right, rgba(var(--primary-500), 0.08), transparent 32%),
      radial-gradient(circle at 15% 18%, rgba(var(--blue-500), 0.08), transparent 24%);
    z-index: 0;
  }

  > * {
    position: relative;
    z-index: 1;
  }

  .my-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 20px;
    padding: 26px 28px;
    border: 1px solid var(--color-line-l3, #eee);
    border-radius: 24px;
    background:
      linear-gradient(135deg, rgba(var(--white), 0.96), rgba(var(--white), 0.84)),
      var(--color-bg-b1-white, #fff);
    box-shadow: 0 20px 50px rgba(17, 18, 23, 0.06);
    backdrop-filter: blur(18px);

    h1 {
      font-size: 28px;
      line-height: 1.15;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin: 0;
    }

  }


  .accounts-section {
    margin-bottom: 20px;
    padding: 20px 22px;
    border: 1px solid var(--color-line-l3, #eee);
    border-radius: 22px;
    background:
      linear-gradient(180deg, rgba(var(--white), 0.94), rgba(var(--neutral-50), 0.96));
    box-shadow: 0 16px 40px rgba(17, 18, 23, 0.05);
  }

  .my-tabs {
    display: flex;
    gap: 10px;
    margin-bottom: 18px;
    padding: 8px;
    border: 1px solid var(--color-line-l3, #eee);
    border-radius: 20px;
    background: rgba(var(--white), 0.82);
    box-shadow: inset 0 1px 0 rgba(var(--white), 0.6);
    width: fit-content;
    max-width: 100%;
    overflow-x: auto;

    &__item {
      background: transparent;
      border: none;
      padding: 10px 18px;
      border-radius: 14px;
      font-size: 15px;
      font-weight: 500;
      cursor: pointer;
      color: var(--color-text-t2, #666);
      transition: color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;

      &.active {
        color: var(--color-text-t5, #fff);
        background: linear-gradient(135deg, var(--color-primary), #ff5f7f);
        font-weight: 600;
        box-shadow: 0 10px 24px rgba(var(--primary-500), 0.28);
      }
    }
  }

  .videos-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 16px;
    padding: 14px 16px;
    border: 1px solid var(--color-line-l3, #eee);
    border-radius: 18px;
    background: rgba(var(--white), 0.9);
  }

  .folder-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
    padding: 14px 16px;
    border: 1px solid var(--color-line-l3, #eee);
    border-radius: 18px;
    background: rgba(var(--white), 0.88);

    strong {
      color: var(--color-text-t1);
      font-size: 15px;
    }
  }

  .link-subs {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;

    .sub {
      background: rgba(var(--neutral-100), 0.8);
      border: 1px solid var(--color-line-l3, #ddd);
      padding: 8px 14px;
      border-radius: 999px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      color: var(--color-text-t2, #555);
      transition: all 0.2s ease;

      &.active {
        background: rgba(var(--primary-500), 0.12);
        color: var(--color-primary);
        border-color: rgba(var(--primary-500), 0.18);
        box-shadow: inset 0 0 0 1px rgba(var(--primary-500), 0.06);
      }
    }
  }


  .duration-filter {
    flex-shrink: 0;

    .filter-group {
      display: flex;
      gap: 6px;
    }

    .filter-btn {
      padding: 7px 14px;
      border-radius: 999px;
      border: 1px solid var(--color-line-l3, #ddd);
      background: rgba(var(--neutral-100), 0.8);
      font-size: 13px;
      color: var(--color-text-t2, #555);
      cursor: pointer;
      transition: all 0.2s ease;
      white-space: nowrap;

      &:hover {
        border-color: rgba(var(--primary-500), 0.3);
        color: var(--color-primary);
      }

      &.active {
        background: rgba(var(--primary-500), 0.12);
        color: var(--color-primary);
        border-color: rgba(var(--primary-500), 0.18);
        box-shadow: inset 0 0 0 1px rgba(var(--primary-500), 0.06);
      }
    }
  }

  .mix-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 18px;
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .mix-detail-hero {
    display: flex;
    gap: 18px;
    margin-bottom: 16px;
    padding: 18px;
    border-radius: 22px;
    border: 1px solid rgba(var(--primary-500), 0.16);
    background:
      radial-gradient(circle at top right, rgba(var(--primary-500), 0.14), transparent 34%),
      linear-gradient(135deg, rgba(var(--white), 0.98), rgba(var(--neutral-50), 0.94));
    box-shadow: 0 18px 40px rgba(17, 18, 23, 0.05);
  }

  .mix-detail-cover {
    width: 136px;
    height: 182px;
    border-radius: 18px;
    object-fit: cover;
    background: linear-gradient(135deg, #edf2ff, #dfe9ff);
    flex-shrink: 0;
  }

  .mix-detail-cover--empty {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #7d86a0;
    font-size: 13px;
  }

  .mix-detail-meta {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 8px;
    min-width: 0;

    h2 {
      margin: 0;
      font-size: 28px;
      line-height: 1.1;
    }
  }

  .mix-detail-eyebrow {
    margin: 0;
    color: var(--color-primary, #1664ff);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.18em;
  }

  .mix-detail-author {
    margin: 0;
    color: var(--color-text-t2, #666);
    font-size: 14px;
  }

  .mix-detail-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 4px;

    span {
      border-radius: 999px;
      padding: 6px 10px;
      background: rgba(var(--neutral-100), 0.92);
      color: var(--color-text-t2, #666);
      font-size: 12px;
    }
  }

  .mix-card {
    display: flex;
    gap: 14px;
    padding: 16px;
    border: 1px solid var(--color-line-l3, #eee);
    border-radius: 20px;
    background:
      linear-gradient(180deg, rgba(var(--white), 0.96), rgba(var(--neutral-50), 0.92));
    box-shadow: 0 14px 32px rgba(17, 18, 23, 0.05);
    cursor: pointer;
    transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;

    &:hover {
      transform: translateY(-2px);
      box-shadow: 0 18px 36px rgba(15, 23, 42, 0.08);
      border-color: rgba(var(--primary-500), 0.22);
    }
  }

  .mix-cover {
    width: 96px;
    height: 128px;
    border-radius: 14px;
    object-fit: cover;
    background: var(--color-bg-b2, #f4f4f4);
    flex-shrink: 0;
  }

  .mix-cover--empty {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #888;
    font-size: 12px;
  }

  .mix-meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 8px;
  }

  .mix-name {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--color-text-t1, #222);
  }

  .mix-sub {
    margin: 0;
    line-height: 1.5;
    color: var(--color-text-t3, #777);
    font-size: 13px;
  }

  .mix-enter {
    margin: 0;
    color: var(--color-primary, #1664ff);
    font-size: 13px;
    font-weight: 500;
  }

  .placeholder {
    padding: 56px 20px;
    text-align: center;
    color: var(--color-text-t2, #666);
    border: 1px dashed var(--color-line-l3, #eee);
    border-radius: 22px;
    background: rgba(var(--white), 0.84);
  }

  .page-archive-btn {
    padding: 8px 18px;
    border-radius: 999px;
    border: 1px solid rgba(var(--primary-500), 0.3);
    background: rgba(var(--primary-500), 0.08);
    color: var(--color-primary, #1664ff);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;

    &:hover {
      background: rgba(var(--primary-500), 0.14);
      border-color: rgba(var(--primary-500), 0.5);
    }

    &:disabled { opacity: 0.6; cursor: not-allowed; }

    &.full-mode {
      border-color: rgba(var(--orange-red-500), 0.3);
      background: rgba(var(--orange-red-500), 0.08);
      color: rgba(var(--orange-red-700), 1);
      &:hover {
        background: rgba(var(--orange-red-500), 0.14);
        border-color: rgba(var(--orange-red-500), 0.5);
      }
    }
  }

  @media (max-width: 1239px) {
    &::before {
      inset: var(--header-height) 0 0 0;
    }
  }

  @media (max-width: 768px) {
    padding: 20px 16px 32px;

    .my-header {
      padding: 20px;

      h1 {
        font-size: 24px;
      }
    }

    .accounts-section {
      padding: 16px;
    }

    .videos-toolbar,
    .folder-head {
      padding: 12px;
    }
  }
}
</style>
