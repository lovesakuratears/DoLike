<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useLocalAuthStore } from '@/stores/local-auth'
import VideoGrid from './components/VideoGrid.vue'
import LocalPlayer from './components/LocalPlayer.vue'
import AccountsPanel from './components/AccountsPanel.vue'
import FolderGrid from './components/FolderGrid.vue'
import type { VideoListItem, FolderListItem } from '@/api/local'

const route = useRoute()
const router = useRouter()
const auth = useLocalAuthStore()

type Tab = 'videos' | 'music' | 'mixes'
const TABS: { key: Tab; label: string }[] = [
  { key: 'videos', label: '视频' },
  { key: 'music', label: '音乐' },
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

const queryTab = computed<Tab>(() => {
  const t = String(route.query.tab || '')
  if (['music', 'mixes'].includes(t)) return t as Tab
  return 'videos'
})
const activeTab = ref<Tab>(queryTab.value)
const activeLink = ref<LinkSub>('LIKE')

const selectTab = (t: Tab) => {
  activeTab.value = t
  router.replace({ query: { ...route.query, tab: t } })
}

type Duration = 'all' | 'short' | 'long'
const duration = ref<Duration>('all')

const accountsRef = ref<InstanceType<typeof AccountsPanel> | null>(null)
const videoGridRef = ref<InstanceType<typeof VideoGrid> | null>(null)
const folderGridRef = ref<InstanceType<typeof FolderGrid> | null>(null)
const playing = ref<VideoListItem | null>(null)
const activeFolder = ref<FolderListItem | null>(null)

const onPlay = (item: VideoListItem) => {
  playing.value = item
}
const onClosePlayer = () => {
  playing.value = null
}

const onBound = () => {
  accountsRef.value?.refresh()
  videoGridRef.value?.refresh()
  folderGridRef.value?.refresh()
}

const openFolder = (folder: FolderListItem) => {
  activeFolder.value = folder
}

const closeFolder = () => {
  activeFolder.value = null
}

const onFoldersChanged = () => {
  folderGridRef.value?.refresh()
  videoGridRef.value?.refresh()
}

onMounted(() => {
  window.addEventListener('dolike:douyin-bound', onBound)
})
onBeforeUnmount(() => {
  window.removeEventListener('dolike:douyin-bound', onBound)
})

document.title = '都喜欢-DoLike'
</script>

<template>
  <div class="my-page">
    <header class="my-header">
      <h1>抖喜欢，我都喜欢</h1>
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
          <el-radio-group v-if="activeLink !== 'FOLDERS'" v-model="duration" size="default" class="duration-filter">
            <el-radio-button value="all">全部</el-radio-button>
            <el-radio-button value="short">短视频 (&lt; 60s)</el-radio-button>
            <el-radio-button value="long">长视频 (≥ 60s)</el-radio-button>
          </el-radio-group>
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
            ref="videoGridRef"
            :folder-id="activeFolder.id"
            @play="onPlay"
            @folders-changed="onFoldersChanged"
          />
        </template>
        <VideoGrid
          v-else
          ref="videoGridRef"
          :link-kind="activeLink"
          :length="duration"
          @play="onPlay"
          @folders-changed="onFoldersChanged"
        />
      </div>
      <div v-else class="placeholder">
        <p>「{{ activeTab === 'music' ? '音乐' : '合集' }}」M4 里程碑接入。</p>
      </div>
    </main>

    <LocalPlayer :item="playing" @close="onClosePlayer" />
  </div>
</template>

<style lang="scss" scoped>
.my-page {
  padding: 24px 32px;
  // 父级 .right-container 是 overflow:hidden + height:100%（layout/index.vue 全局约定），
  // 这里把自己撑满父亲并打开纵向滚动，避免列表/分页按钮被裁掉。
  height: 100%;
  overflow-y: auto;

  .my-header {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 16px;

    h1 {
      font-size: 22px;
      font-weight: 600;
      margin: 0;
    }
    .hint {
      color: var(--color-text-t3, #888);
      font-size: 13px;
    }
  }

  .accounts-section {
    margin-bottom: 24px;
    padding: 16px;
    background: var(--color-fill-2, #f7f7f7);
    border-radius: 12px;
  }

  .my-tabs {
    display: flex;
    gap: 24px;
    border-bottom: 1px solid var(--color-line-l3, #eee);
    margin-bottom: 16px;

    &__item {
      background: transparent;
      border: none;
      padding: 12px 0;
      font-size: 16px;
      cursor: pointer;
      color: var(--color-text-t2, #666);
      border-bottom: 2px solid transparent;
      transition: color 0.2s, border-color 0.2s;

      &.active {
        color: var(--color-text-t0, #000);
        border-bottom-color: var(--color-text-t0, #000);
        font-weight: 600;
      }
    }
  }

  .videos-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 12px;
  }

  .folder-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }

  .link-subs {
    display: flex;
    gap: 8px;
    .sub {
      background: transparent;
      border: 1px solid var(--color-line-l3, #ddd);
      padding: 6px 14px;
      border-radius: 16px;
      cursor: pointer;
      font-size: 13px;
      color: #555;
      &.active {
        background: var(--color-text-t0, #000);
        color: #fff;
        border-color: var(--color-text-t0, #000);
      }
    }
  }

  .duration-filter {
    flex-shrink: 0;
  }

  .placeholder {
    padding: 48px 0;
    text-align: center;
    color: var(--color-text-t2, #666);
  }
}
</style>
