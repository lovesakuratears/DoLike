<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { localApi, type FolderListItem } from '@/api/local'

const emit = defineEmits<{
  (e: 'open', folder: FolderListItem): void
}>()

const folders = ref<FolderListItem[]>([])
const loading = ref(false)
const selectedIds = ref<Set<number>>(new Set())
const creating = ref(false)

const selectedCount = computed(() => selectedIds.value.size)
const allSelected = computed(() =>
  folders.value.length > 0 && folders.value.every((folder) => selectedIds.value.has(folder.id))
)

const refresh = async () => {
  loading.value = true
  try {
    const r = await localApi.listFolders()
    if (r.code === 0) folders.value = r.data
    else ElMessage.error(r.message || '加载收藏夹失败')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '请求失败')
  } finally {
    loading.value = false
  }
}

const coverSrc = (folder: FolderListItem) => (folder.coverPath ? `/media/${folder.coverPath}` : '')

const toggleOne = (id: number) => {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

const toggleSelectAll = () => {
  if (allSelected.value) {
    selectedIds.value = new Set()
    return
  }
  selectedIds.value = new Set(folders.value.map((folder) => folder.id))
}

const invertSelected = () => {
  const next = new Set<number>()
  for (const folder of folders.value) {
    if (!selectedIds.value.has(folder.id)) next.add(folder.id)
  }
  selectedIds.value = next
}

const createFolder = async () => {
  let name = ''
  try {
    const { value } = await ElMessageBox.prompt('输入收藏夹名称', '新建收藏夹', {
      inputPattern: /\S+/,
      inputErrorMessage: '收藏夹名称不能为空'
    })
    name = String(value || '').trim()
  } catch {
    return
  }
  if (!name) return
  creating.value = true
  try {
    const r = await localApi.createFolder(name)
    if (r.code === 0) {
      ElMessage.success('已创建收藏夹')
      await refresh()
    } else ElMessage.error(r.message || '创建失败')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '请求失败')
  } finally {
    creating.value = false
  }
}

const renameOne = async (folder: FolderListItem) => {
  try {
    const { value } = await ElMessageBox.prompt('修改收藏夹名称', '编辑收藏夹', {
      inputValue: folder.name,
      inputPattern: /\S+/,
      inputErrorMessage: '收藏夹名称不能为空'
    })
    const name = String(value || '').trim()
    if (!name || name === folder.name) return
    const r = await localApi.renameFolder(folder.id, name)
    if (r.code === 0) {
      ElMessage.success('已更新收藏夹')
      await refresh()
    } else ElMessage.error(r.message || '更新失败')
  } catch {
    // ignore cancel
  }
}

const deleteSelected = async () => {
  if (selectedCount.value === 0) return
  try {
    await ElMessageBox.confirm(`确认删除 ${selectedCount.value} 个收藏夹吗？删除后视频本身不会删除。`, '删除收藏夹', {
      type: 'warning',
      confirmButtonText: '删除',
      confirmButtonClass: 'el-button--danger'
    })
  } catch {
    return
  }
  try {
    const r = await localApi.deleteFolders(Array.from(selectedIds.value))
    if (r.code === 0) {
      ElMessage.success(`已删除 ${r.data.deleted} 个收藏夹`)
      selectedIds.value = new Set()
      await refresh()
    } else ElMessage.error(r.message || '删除失败')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '请求失败')
  }
}

watch(
  () => folders.value.map((folder) => folder.id).join(','),
  () => {
    const valid = new Set(folders.value.map((folder) => folder.id))
    selectedIds.value = new Set(Array.from(selectedIds.value).filter((id) => valid.has(id)))
  }
)

defineExpose({ refresh })
void refresh()
</script>

<template>
  <div class="folder-grid">
    <div class="toolbar">
      <button class="tool-btn" :class="{ loading: creating }" @click="createFolder">新建收藏夹</button>
      <button class="tool-btn" :disabled="folders.length === 0" @click="toggleSelectAll">
        {{ allSelected ? '取消全选' : '全选' }}
      </button>
      <button class="tool-btn" :disabled="folders.length === 0" @click="invertSelected">反选</button>
      <button class="tool-btn danger" :disabled="selectedCount === 0" @click="deleteSelected">
        删除（{{ selectedCount }}）
      </button>
    </div>

    <div v-if="loading && folders.length === 0" class="state">加载中…</div>
    <div v-else-if="folders.length === 0" class="state muted">还没有收藏夹，先新建一个吧。</div>
    <ul v-else class="grid">
      <li
        v-for="folder in folders"
        :key="folder.id"
        class="card"
        :class="{ selected: selectedIds.has(folder.id) }"
        @click="emit('open', folder)"
      >
        <button class="pick" @click.stop="toggleOne(folder.id)">
          <span class="dot" :class="{ on: selectedIds.has(folder.id) }"></span>
        </button>
        <div class="cover">
          <img v-if="folder.coverPath" :src="coverSrc(folder)" alt="" loading="lazy" />
          <div v-else class="placeholder">收藏夹</div>
        </div>
        <div class="meta">
          <p class="name">{{ folder.name }}</p>
          <p class="desc">{{ folder.itemCount }} 个视频</p>
        </div>
        <el-button class="edit" size="small" text @click.stop="renameOne(folder)">重命名</el-button>
      </li>
    </ul>
  </div>
</template>

<style scoped lang="scss">
.folder-grid {
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
    padding: 14px 16px;
    border: 1px solid var(--color-line-l3, #eee);
    border-radius: 18px;
    background: rgba(var(--white), 0.86);
  }

  .tool-btn {
    padding: 6px 11px;
    border-radius: 999px;
    border: 1px solid var(--color-line-l3, #ddd);
    background: rgba(var(--neutral-100), 0.8);
    font-size: 12px;
    font-weight: 500;
    color: var(--color-text-t2, #555);
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;

    &:hover:not(:disabled) {
      border-color: rgba(var(--primary-500), 0.3);
      color: var(--color-primary);
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    &.danger {
      background: rgba(var(--orange-red-500), 0.08);
      color: rgba(var(--orange-red-600), 1);
      border-color: rgba(var(--orange-red-500), 0.15);

      &:hover:not(:disabled) {
        background: rgba(var(--orange-red-500), 0.14);
        border-color: rgba(var(--orange-red-500), 0.3);
      }
    }

    &.loading {
      opacity: 0.7;
      cursor: wait;
    }
  }

  .state {
    padding: 56px 20px;
    text-align: center;
    border: 1px dashed var(--color-line-l3, #eee);
    border-radius: 22px;
    background: rgba(var(--white), 0.78);
  }

  .muted {
    color: var(--color-text-t3, #888);
  }

  .grid {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 18px;
  }

  .card {
    position: relative;
    overflow: hidden;
    border-radius: 22px;
    background:
      linear-gradient(180deg, rgba(var(--white), 0.98), rgba(var(--neutral-50), 0.92));
    border: 1px solid var(--color-line-l3, rgba(31, 29, 24, 0.08));
    cursor: pointer;
    transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
    box-shadow: 0 12px 30px rgba(17, 18, 23, 0.05);

    &:hover {
      transform: translateY(-4px);
      box-shadow: 0 18px 36px rgba(17, 18, 23, 0.08);
    }

    &.selected {
      border-color: rgba(var(--primary-500), 0.24);
      box-shadow:
        0 18px 36px rgba(17, 18, 23, 0.08),
        0 0 0 2px rgba(var(--primary-500), 0.14) inset;
    }
  }

  .pick {
    position: absolute;
    top: 10px;
    left: 10px;
    z-index: 2;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: 999px;
    background: rgba(var(--white), 0.94);
    display: grid;
    place-items: center;
    box-shadow: 0 6px 14px rgba(17, 18, 23, 0.12);
  }

  .dot {
    width: 14px;
    height: 14px;
    border-radius: 999px;
    border: 1.5px solid rgba(var(--neutral-500), 0.45);
    background: transparent;

    &.on {
      background: var(--color-primary);
      border-color: var(--color-primary);
      box-shadow: 0 0 0 3px rgba(var(--white), 0.92) inset;
    }
  }

  .cover {
    aspect-ratio: 4 / 3;
    background:
      radial-gradient(circle at top right, rgba(var(--primary-500), 0.18), transparent 34%),
      linear-gradient(135deg, rgba(var(--neutral-100), 1) 0%, rgba(var(--neutral-200), 1) 100%);

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }
  .placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-t2, #7a6f60);
    font-size: 14px;
    font-weight: 600;
  }

  .meta {
    padding: 14px 14px 16px;
  }

  .name {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text-t1);
  }

  .desc {
    margin: 4px 0 0;
    color: var(--color-text-t3, #7f7769);
    font-size: 12px;
  }

  .edit {
    position: absolute;
    right: 8px;
    top: 8px;
  }
}
</style>
