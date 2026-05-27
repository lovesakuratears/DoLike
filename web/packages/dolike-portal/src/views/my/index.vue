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
import { localApi, type VideoListItem, type FolderListItem, type MixListItem } from '@/api/local'

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
  if (t !== 'videos') activeFolder.value = null
  if (t !== 'mixes') activeMix.value = null
  if (t === 'mixes') void refreshMixes()
}

type Duration = 'short' | 'long'
const duration = ref<Duration | null>(null)
const keyword = ref("")

const accountsRef = ref<InstanceType<typeof AccountsPanel> | null>(null)
const videoGridRef = ref<InstanceType<typeof VideoGrid> | null>(null)
const folderGridRef = ref<InstanceType<typeof FolderGrid> | null>(null)
const playing = ref<VideoListItem | null>(null)
const activeFolder = ref<FolderListItem | null>(null)
const mixes = ref<MixListItem[]>([])
const mixesLoading = ref(false)
const activeMix = ref<MixListItem | null>(null)

const onPlay = (item: VideoListItem) => {
  router.push({ name: 'local-video', params: { id: String(item.id) } })
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
  if (activeTab.value === 'mixes') void refreshMixes()
})
onBeforeUnmount(() => {
  window.removeEventListener('dolike:account-bound', onBound)
})

watch(queryTab, (next) => {
  activeTab.value = next
  if (next === 'mixes') void refreshMixes()
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
          <div class="search-input">
            <input
              v-model="keyword"
              type="text"
              placeholder="搜索标题、描述、作者…"
              @keyup.enter="videoGridRef?.refresh()"
            />
            <button v-if="keyword" class="search-clear" type="button" @click="keyword = ''; videoGridRef?.refresh()">x</button>
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
            ref="videoGridRef"
            :folder-id="activeFolder.id"
            :keyword="keyword || undefined"
            @play="onPlay"
            @folders-changed="onFoldersChanged"
          />
        </template>
        <VideoGrid
          v-else
          ref="videoGridRef"
          content-kind="VIDEO"
          :link-kind="activeLink"
          :length="duration"
          @play="onPlay"
          @folders-changed="onFoldersChanged"
        />
      </div>
      <div v-else-if="activeTab === 'music'">
        <MusicShelf @play="onPlay" />
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
    align-items: flex-end;
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

  .search-input {
    position: relative;
    flex: 1;
    min-width: 200px;
    max-width: 360px;

    input {
      width: 100%;
      padding: 8px 32px 8px 14px;
      border-radius: 999px;
      border: 1px solid var(--color-line-l3, #ddd);
      background: rgba(var(--white), 0.8);
      font-size: 13px;
      color: var(--color-text-t1);
      outline: none;
      transition: border-color 0.2s;

      &:focus {
        border-color: rgba(var(--primary-500), 0.4);
        box-shadow: 0 0 0 3px rgba(var(--primary-500), 0.08);
      }
    }

    .search-clear {
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      border: none;
      background: transparent;
      color: var(--color-text-t3, #888);
      cursor: pointer;
      font-size: 14px;
      padding: 2px 4px;
      border-radius: 50%;

      &:hover {
        color: var(--color-text-t1);
        background: rgba(var(--neutral-100), 0.8);
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
