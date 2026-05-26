<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { localApi } from '@/api/local'

const emit = defineEmits<{ (e: 'issued', accountId: number): void }>()

const issuing = ref(false)
const issued = ref<{ accountId: number; token: string } | null>(null)

const backendUrl = computed(() => `${location.protocol}//${location.hostname}:7777`)

const issueToken = async () => {
  issuing.value = true
  try {
    const r = await localApi.douyinBridgeIssue()
    if (r.code === 0) {
      issued.value = r.data
      ElMessage.success('Push Token 已生成')
      emit('issued', r.data.accountId)
    } else {
      ElMessage.error(r.message || '生成失败')
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '请求失败')
  } finally {
    issuing.value = false
  }
}

const copyText = async (text: string, label: string) => {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(`${label} 已复制`)
  } catch {
    ElMessage.error(`复制${label}失败`)
  }
}
</script>

<template>
  <div class="bridge-panel">
    <p class="muted">
      推荐路径：在你自己的浏览器里登录抖音，由扩展直接从页面上下文抓列表并推到本地后端。
      这样不依赖 CloakBrowser，也不需要手动粘 Cookie。
    </p>

    <div class="actions">
      <el-button type="primary" :loading="issuing" @click="issueToken">生成 API Key</el-button>
    </div>

    <div v-if="issued" class="token-box">
      <label>后端地址</label>
      <div class="copy-row">
        <code>{{ backendUrl }}</code>
        <el-button size="small" @click="copyText(backendUrl, '后端地址')">复制</el-button>
      </div>

      <label>API Key</label>
      <div class="copy-row">
        <code>{{ issued.token }}</code>
        <el-button size="small" @click="copyText(issued.token, 'API Key')">复制</el-button>
      </div>
    </div>

    <ol class="steps">
      <li>在浏览器打开 `chrome://extensions`，打开“开发者模式”。</li>
      <li>点击“加载已解压的扩展程序”，选择项目里的 `extension/` 目录。</li>
      <li>点扩展图标，填入上面的项目 URL 和 API Key，先点“测试握手”。</li>
      <li>打开你自己的抖音主页 `https://www.douyin.com/user/&lt;你的 sec_uid&gt;`。</li>
      <li>先点“绑定插件”，让插件把真实头像、昵称、secUid 推回 DoLike。</li>
      <li>绑定完成后，再点“推送 作品 / 喜欢 / 收藏 / 稍后再看 / 收藏夹视频”。</li>
      <li>推送完成后，本地 DoLike 会自动入库并排下载队列。</li>
    </ol>
  </div>
</template>

<style lang="scss" scoped>
.bridge-panel {
  padding: 8px 0;
  .muted {
    color: #888;
    font-size: 13px;
    line-height: 1.6;
    margin-bottom: 12px;
  }
  .actions {
    margin-top: 12px;
    text-align: right;
  }
  .token-box {
    margin-top: 16px;
    padding: 12px;
    border-radius: 8px;
    background: #f7f7f7;
    label {
      display: block;
      margin: 8px 0 6px;
      font-size: 12px;
      color: #666;
    }
  }
  .copy-row {
    display: flex;
    align-items: center;
    gap: 8px;
    code {
      flex: 1;
      min-width: 0;
      display: block;
      padding: 8px 10px;
      border-radius: 6px;
      background: #fff;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
  }
  .steps {
    margin: 16px 0 0;
    padding-left: 18px;
    color: #555;
    font-size: 13px;
    line-height: 1.7;
  }
}
</style>
