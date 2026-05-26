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
      <el-button size="small" :loading="creating" @click="createFolder">新建收藏夹</el-button>
      <el-button size="small" :disabled="folders.length === 0" @click="toggleSelectAll">
        {{ allSelected ? '取消全选' : '全选' }}
      </el-button>
      <el-button size="small" :disabled="folders.length === 0" @click="invertSelected">反选</el-button>
      <el-button size="small" type="danger" :disabled="selectedCount === 0" @click="deleteSelected">
        删除（{{ selectedCount }}）
      </el-button>
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
    gap: 8px;
    margin-bottom: 12px;
  }
  .state {
    padding: 40px 0;
    text-align: center;
  }
  .muted {
    color: #888;
  }
  .grid {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 16px;
  }
  .card {
    position: relative;
    overflow: hidden;
    border-radius: 18px;
    background: #f7f4ed;
    border: 1px solid rgba(31, 29, 24, 0.08);
    cursor: pointer;
    transition: transform .16s ease, box-shadow .16s ease;
    &:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 24px rgba(31, 29, 24, 0.08);
    }
    &.selected {
      box-shadow: 0 0 0 2px rgba(187, 205, 197, 0.9) inset;
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
    background: rgba(255, 255, 255, 0.92);
    display: grid;
    place-items: center;
  }
  .dot {
    width: 14px;
    height: 14px;
    border-radius: 999px;
    border: 1.5px solid rgba(31, 29, 24, 0.35);
    background: transparent;
    &.on {
      background: #bbcdc5;
      border-color: #bbcdc5;
      box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.9) inset;
    }
  }
  .cover {
    aspect-ratio: 4 / 3;
    background: linear-gradient(135deg, #ebe4d7 0%, #ddd4c5 100%);
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
    color: #7a6f60;
    font-size: 14px;
  }
  .meta {
    padding: 12px 14px 16px;
  }
  .name {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }
  .desc {
    margin: 4px 0 0;
    color: #7f7769;
    font-size: 12px;
  }
  .edit {
    position: absolute;
    right: 10px;
    top: 8px;
  }
}
</style>
