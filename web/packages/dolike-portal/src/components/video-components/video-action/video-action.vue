<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import { useCount } from '@/hooks/useCount'
import SwiperControlModal from '@/components/swiper/swiper-control-modal.vue'
import MoreActionBox from './more-action-box.vue'
import SharePanel from './share-panel.vue'
import CollectionFolderDialog from './collection-folder-dialog.vue'
import type { IMusic } from '@/api/tyeps/common/music'
import type { IShareInfo } from '@/api/tyeps/common/aweme'
import type { BitRate } from '@/api/tyeps/common/video'
import apis from '@/api/apis'
import { localApi } from '@/api/local'
import { Toast } from '@/components/ui/toast'

const props = defineProps({
  aweme_id: String,
  user_id: String,
  avatar: String,
  digg_count: Number,
  comment_count: Number,
  collect_count: Number,
  share_count: Number,
  user_digged: Number,
  collect_stat: Number,
  follow_status: Number,
  isShowAvatar: {
    type: Boolean,
    default: true
  },
  // 是否显示 swiper 控制按钮
  showSwiperControl: {
    type: Boolean,
    default: false
  },
  // 音乐信息
  music: {
    type: Object as () => IMusic | null,
    default: null
  },
  // 是否禁用缩放
  disableScale: {
    type: Boolean,
    default: false
  },
  // 分享信息
  shareInfo: {
    type: Object as () => IShareInfo | null,
    default: null
  },
  // 视频比特率信息（用于下载）
  bitRates: {
    type: Array as () => BitRate[],
    default: () => []
  },
  // 视频描述（用于下载文件名）
  videoDesc: {
    type: String,
    default: ''
  },
  // 视频下载地址（用于提取音频）
  videoDownloadUrl: {
    type: String,
    default: ''
  },
  // 视频时长（秒）
  videoDuration: {
    type: Number,
    default: 0
  },
  // 作者名
  authorName: {
    type: String,
    default: ''
  }
})

const digg_count = ref(props.digg_count)
const liked = ref(props.user_digged)
// const addDianzan = async () => {
//   try {
//     await applaud(props.id as number)
//     liked.value = !liked.value
//     if (liked.value) {
//       dianzan.value++
//     } else {
//       dianzan.value--
//     }
//   } catch (e) {
//     console.log(e)
//   }
// }
// watchEffect(() => {
//   console.log(liked.value, dianzan.value)
// })
const collect_count = ref(props.collect_count) as any
const isCollect = ref(props.collect_stat) as any

// console.log(isCollect.value)
// const addShoucang = async () => {
//   try {
//     await collection({ video_id: props.id as number })
//     isCollect.value = !isCollect.value
//     if (isCollect.value) {
//       collect_count.value++
//     } else {
//       collect_count.value--
//     }
//   } catch (e) { }
// }

//默认456，如果是关注，就是520
const width = ref(456)
const maXWidth = ref('unset')
//是否关注
const isAttent = ref(props.follow_status)

// console.log(isAttention.value)
//关注
const handleAttention = async () => {
  //调用接口
  try {
    // await attention(props.user_id)
    // if (isAttent.value === 1 || isAttent.value === 3) {
    //   isAttent.value = 2
    // } else {
    //   isAttent.value = 1
    // }
  } catch (e) {
    console.log(e)
  }
}

watchEffect(() => {
  // console.log(isAttent.value)
  if (isAttent.value === 1 || isAttent.value === 3) {
    width.value = 520
    maXWidth.value = 'unset'
  } else {
    width.value = 456
    maXWidth.value = 'unset'
  }
})

//是否显示like-box
const showLikeBox = ref(false)
//是否显示comment-box
const showCommentBox = ref(false)
//是否显示收藏夹面板
const showCollectionPanel = ref(false)
// 新建收藏夹弹框是否打开
const isCreateDialogOpen = ref(false)
//是否显示more-box
const showMoreBox = ref(false)
//是否显示share-box
const showShareBox = ref(false)

// 收藏面板关闭延迟定时器
let collectionPanelTimer: ReturnType<typeof setTimeout> | null = null

// 显示收藏面板
const handleCollectionEnter = () => {
  if (collectionPanelTimer) {
    clearTimeout(collectionPanelTimer)
    collectionPanelTimer = null
  }
  showCollectionPanel.value = true
}

// 延迟关闭收藏面板
const handleCollectionLeave = () => {
  // 如果新建弹框打开，不关闭面板
  if (isCreateDialogOpen.value) return

  collectionPanelTimer = setTimeout(() => {
    showCollectionPanel.value = false
  }, 150)
}

// 处理新建弹框状态变化
const handleDialogOpen = (isOpen: boolean) => {
  isCreateDialogOpen.value = isOpen
}

// 仅收藏视频
const handleCollectOnly = () => {
  showCollectionPanel.value = false
  // TODO: 调用仅收藏视频的接口
  console.log('仅收藏视频')
}

// 收藏夹选择确认
const handleFolderConfirm = (folderIds: string[]) => {
  showCollectionPanel.value = false
  console.log('收藏至收藏夹:', folderIds)
  // TODO: 调用收藏至收藏夹的接口
}

// 搜索框是否有焦点
const isSearchFocused = ref(false)
// 分享面板关闭延迟定时器
let shareBoxTimer: ReturnType<typeof setTimeout> | null = null

// 显示分享面板
const handleShareEnter = () => {
  if (shareBoxTimer) {
    clearTimeout(shareBoxTimer)
    shareBoxTimer = null
  }
  showShareBox.value = true
}

// 延迟关闭分享面板
const handleShareLeave = () => {
  // 如果搜索框有焦点，不关闭面板
  if (isSearchFocused.value) return

  shareBoxTimer = setTimeout(() => {
    showShareBox.value = false
  }, 150)
}

const handleSearchFocus = () => {
  isSearchFocused.value = true
  if (shareBoxTimer) {
    clearTimeout(shareBoxTimer)
    shareBoxTimer = null
  }
}

const handleSearchBlur = () => {
  isSearchFocused.value = false
}

// 提取音频状态
const isExtractingMusic = ref(false)

// 提取视频原声/BGM
const handleExtractMusic = async () => {
  if (isExtractingMusic.value) {
    Toast.info('正在提取中...')
    return
  }

  if (!props.videoDownloadUrl) {
    Toast.warning('暂无可提取的视频源')
    return
  }

  isExtractingMusic.value = true
  Toast.info('正在提取音频...')

  try {
    const r = await localApi.extractAudio({
      awemeId: props.aweme_id || '',
      videoUrl: props.videoDownloadUrl,
      title: props.videoDesc || props.aweme_id || '未知视频',
      authorName: props.authorName || '',
      durationSec: props.videoDuration || 0
    })
    if (r.code !== 0) {
      throw new Error(r.message || '提取失败')
    }
    Toast.success('音频提取成功！可在"收藏-音频"中查看')
  } catch (error: any) {
    console.error('提取音频失败:', error)
    Toast.error(error?.message || '音频提取失败，请重试')
  } finally {
    isExtractingMusic.value = false
  }
}

//根据父容器宽高，计算scale的值
const scale = ref(1)
//监听父容器的宽高变化
const calculateScale = () => {
  const parentElement = document.querySelector('.video-action')?.parentElement
  if (parentElement) {
    const parentHeight = parentElement.clientHeight
    const desiredHeight = 850
    // console.log(parentHeight, desiredHeight)
    if (parentHeight > 0) {
      scale.value = parentHeight / desiredHeight
      // console.log(scale.value)
    }
  }
}

// 创建一个 ResizeObserver 实例来监听父元素尺寸变化
const resizeObserver = new ResizeObserver((entries) => {
  // 当父元素尺寸变化时，重新计算 scale
  calculateScale()
})

onMounted(() => {
  const parentElement = document.querySelector('.video-action')?.parentElement
  if (parentElement) {
    // 开始监听父元素尺寸变化
    resizeObserver.observe(parentElement)
  }
})

onUnmounted(() => {
  // 组件卸载时停止监听
  resizeObserver.disconnect()
})
</script>

<template>
  <div
    class="video-action"
    :style="{
      transform: props.disableScale ? 'none' : `scale(${scale})`,
      transformOrigin: 'right bottom'
    }"
  >
    <div class="video-action-content">
      <slot />
      <!-- Swiper 控制按钮 -->
      <SwiperControlModal v-if="showSwiperControl" />

      <div class="video-action-item" v-if="isShowAvatar">
        <div class="avatar-content">
          <div class="video-action-avatar">
            <dy-avatar size="small" :src="props.avatar" />
          </div>
          <div class="video-action-avatar-follow" @click="handleAttention">
            <svg-icon class="icon" icon="avfollow" v-show="!isAttent" />
          </div>
        </div>
      </div>
      <div
        class="video-action-item"
        @mouseenter="showLikeBox = true"
        @mouseleave="showLikeBox = false"
      >
        <div class="like-box postion swiper" v-if="showLikeBox">
          <svg
            width="4"
            height="17"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            class="like-box-icon postion"
            viewBox="0 0 4 17"
          >
            <path
              d="M0 0a8 8 0 002.168 5.476l1.174 1.25a2 2 0 010 2.738l-1.174 1.25A8 8 0 000 16.19V0z"
              fill="#323442"
            ></path>
          </svg>
          <div class="like-box-title">
            点赞<span class="like-box-text">Z</span>
          </div>
        </div>
        <svg-icon class="icon" :class="{ liked: liked }" icon="dianzan" />
        <span class="num">{{ useCount(digg_count ?? 0) }}</span>
      </div>
      <div
        class="video-action-item"
        @click="$emit('toggleComments')"
        @mouseenter="showCommentBox = true"
        @mouseleave="showCommentBox = false"
      >
        <div class="like-box postion swiper" v-if="showCommentBox">
          <svg
            width="4"
            height="17"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            class="like-box-icon postion"
            viewBox="0 0 4 17"
          >
            <path
              d="M0 0a8 8 0 002.168 5.476l1.174 1.25a2 2 0 010 2.738l-1.174 1.25A8 8 0 000 16.19V0z"
              fill="#323442"
            ></path>
          </svg>
          <div class="like-box-title">
            评论<span class="like-box-text">X</span>
          </div>
        </div>
        <svg-icon class="icon" icon="comment" />
        <span class="num">{{ useCount(props.comment_count ?? 0) }}</span>
      </div>
      <div
        class="video-action-item"
        @mouseenter="handleCollectionEnter"
        @mouseleave="handleCollectionLeave"
      >
        <svg-icon
          class="icon-collect"
          icon="collection"
          :class="{ collect: isCollect }"
        />
        <span class="num">{{ useCount(collect_count) }}</span>

        <!-- 收藏夹选择面板 -->
        <div
          class="collection-panel-wrapper"
          v-if="showCollectionPanel"
          @mouseenter="handleCollectionEnter"
          @mouseleave="handleCollectionLeave"
        >
          <CollectionFolderDialog
            :show="showCollectionPanel"
            @confirm="handleFolderConfirm"
            @collect-only="handleCollectOnly"
            @dialog-open="handleDialogOpen"
          />
        </div>
      </div>
      <div
        class="video-action-item"
        @click="handleExtractMusic"
      >
        <svg class="icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M9 18V5l12-2v13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="6" cy="18" r="3" fill="currentColor"/>
          <circle cx="18" cy="16" r="3" fill="currentColor"/>
        </svg>
        <span class="num">提取音频</span>
      </div>

      <div
        class="video-action-item"
        @mouseenter="handleShareEnter"
        @mouseleave="handleShareLeave"
      >
        <svg-icon class="icon" icon="fenxiang" />
        <span class="num">{{ useCount(props.share_count ?? 0) }}</span>

        <!-- 分享面板 -->
        <div
          class="share-panel-wrapper"
          v-if="showShareBox"
          @mouseenter="handleShareEnter"
          @mouseleave="handleShareLeave"
        >
          <SharePanel
            :show-bottom-actions="true"
            :share-url="props.shareInfo?.share_url || ''"
            :share-title="props.shareInfo?.share_title || ''"
            :aweme-id="props.aweme_id"
            :bit-rates="props.bitRates"
            :video-desc="props.videoDesc"
            @search-focus="handleSearchFocus"
            @search-blur="handleSearchBlur"
          />
        </div>
      </div>

      <div
        class="video-action-item"
        @mouseenter="showMoreBox = true"
        @mouseleave="showMoreBox = false"
      >
        <svg-icon class="icon" icon="more" />
        <MoreActionBox
          v-if="showMoreBox"
          class="more-box-wrapper"
          :style="{ width: `${width}px` }"
          :is-attent="isAttent"
          :aweme-id="props.aweme_id"
          :user-id="props.user_id"
          @cancel-follow="handleAttention"
        />
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.video-action {
  position: absolute;
  bottom: 60px;
  right: 0;
  height: auto;
  padding-right: 12px;
  z-index: 11;
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;

  .video-action-content {
    align-items: center;
    display: flex;
    filter: drop-shadow(0 0 3px rgba(0, 0, 0, 0.3));
    flex-direction: column;
    flex-shrink: 0;
    justify-content: center;
    margin-bottom: 0;
    position: relative;

    .avatar-content {
      margin-bottom: 23px;
      margin-top: 24px;
      position: relative;

      .video-action-avatar {
        height: 40px;
        width: 40px;
        box-sizing: content-box;
        flex-grow: 0;
        flex-shrink: 0;
        border-radius: 50%;
        overflow: hidden;
        border: 1px solid rgba(231, 231, 236, 0.3) !important;
        transition: transform 0.35s cubic-bezier(0.34, 0.69, 0.1, 1);

        &:hover {
          transform: scale(1.1);
        }

        .el-avatar {
          height: 100%;
          width: 100%;
        }
      }

      .video-action-avatar-follow {
        bottom: -12px;
        cursor: pointer;
        height: 24px;
        left: 0px;
        position: absolute;
        right: 0px;
        width: 24px;
        margin: 0px auto;
        display: flex;
        justify-content: center;

        .icon {
          height: 20px;
          width: 20px;
          opacity: 1;
          color: #fff;
        }

        .icon.liked {
          color: red !important;
        }
      }
    }
  }

  .video-action-item {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;

    cursor: pointer;
    position: relative;
    padding-top: 6px;

    .num {
      margin-left: 5px;
    }

    .icon {
      height: 50px;
      width: 50px;
      color: #fff;
      opacity: 1;
    }

    .icon-collect {
      height: 50px;
      width: 50px;
      color: #fff;
      opacity: 1;
      margin-left: 5px;
    }

    .icon.liked {
      color: rgb(254, 44, 85);
    }

    .icon-collect.collect {
      color: rgb(255, 184, 2) !important;
    }
  }
}

.like-box {
  background-color: var(--color-bg-toast);
  border-radius: 6px;
  color: var(--color-const-text-white);
  font-size: 12px;
  font-weight: 400;
  line-height: 40px;
  position: absolute;
  text-align: center;

  &.postion {
    right: calc(100% + 10px);
    top: 50%;
    transform: translateY(-50%);
  }

  &.swiper {
    background-color: var(--color-bg-toast);
    top: 10px !important;
    transform: translateY(0) !important;
  }

  .like-box-icon {
    position: absolute;

    &.postion {
      right: -4px;
      top: 50%;
      transform: translateY(-50%);
    }
  }

  .like-box-title {
    padding: 0 16px;
    white-space: nowrap;

    .like-box-text {
      align-items: center;
      background: #fff;
      border: 1px solid #fff;
      border-radius: 3px;
      color: #323442;
      display: flex;
      display: inline-flex;
      font-size: 13px;
      font-weight: 500;
      height: 18px;
      justify-content: center;
      line-height: 21px;
      margin: 0 5px;
      vertical-align: baseline;
      width: 18px;
    }
  }
}

.more-box-wrapper {
  position: absolute;
  bottom: 0;
  right: 50px;
  z-index: 10;
}

.share-panel-wrapper {
  position: absolute;
  bottom: 0;
  right: 50px;
  z-index: 10;
  width: 340px;
}

.collection-panel-wrapper {
  position: absolute;
  bottom: 0;
  right: 50px;
  z-index: 10;
}
</style>
