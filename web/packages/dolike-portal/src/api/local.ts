import axios, { type AxiosInstance } from 'axios'

const http: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 15000,
  withCredentials: true
})

http.interceptors.response.use(
  (resp) => resp,
  (err) => Promise.reject(err)
)

export interface ApiResp<T> {
  code: number
  data: T
  message: string
}

export interface AuthStatus {
  hasUser: boolean
  loggedIn: boolean
  user: { id: number; username: string } | null
}

export interface AuthUser {
  id: number
  username: string
}

export interface DouyinAccountDTO {
  id: number
  secUid: string
  nickname: string
  avatarUrl: string | null
  cookieSource: 'cloak' | 'manual' | 'bridge'
  isValid: boolean
  lastCheckAt: string | null
  createdAt: string
}


export interface CookieValidateResult {
  valid: boolean
  secUid: string
  nickname: string
  avatarUrl: string | null
}

export interface ArchiveModeResult {
  accountId: number
  mode: 'full' | 'incremental'
  contentCount: number
  hasCookie: boolean
  cookieSource: string
}
export interface BridgeIssueResult {
  accountId: number
  token: string
}

export interface VideoListItem {
  id: number
  awemeId: string
  title: string
  authorName: string
  durationSec: number
  publishAt: string
  archivedAt: string
  coverPath: string | null
  mediaPath: string | null
  status: string
  douyinAccountId: number
  linkKinds: string[]
}

export interface MixListItem {
  id: number
  mixId: string
  kind: string
  name: string
  authorName: string
  itemCount: number
  publishAt: string | null
  archivedAt: string
  coverPath: string | null
  douyinAccountId: number
}

export interface MixDetailResult {
  mix: MixListItem
  videos: VideoListResult
}

export interface FolderListItem {
  id: number
  name: string
  itemCount: number
  updatedAt: string
  coverPath: string | null
}

export interface VideoListResult {
  total: number
  page: number
  size: number
  items: VideoListItem[]
}

export interface DownloadTaskItem {
  id: number
  contentId: number
  kind: string
  status: string
  bytesDone: string
  bytesTotal: string | null
  attempts: number
  lastError: string | null
  enqueuedAt: string
  finishedAt: string | null
  title: string
  authorName: string
}

export interface DownloadModeResp {
  mode: 'enhanced' | 'compatible'
  enhancedConfigured: boolean
  parserStatus: 'unknown' | 'available' | 'unreachable' | 'unconfigured'
  parserLastCheckedAt: number | null
  message?: string
}

export interface VideoListQuery {
  contentKind?: 'VIDEO' | 'MUSIC' | 'MIX_VIDEO' | 'all'
  linkKind?: 'POST' | 'LIKE' | 'FAVORITE' | 'WATCH_LATER' | 'all'
  length?: 'long' | 'short' | 'all'
  q?: string
  sort?: 'publish' | 'archived' | 'duration'
  page?: number
  size?: number
  accountId?: number
}

export const localApi = {
  health: () => http.get<ApiResp<{ ok: boolean }>>('/health').then((r) => r.data),

  authStatus: () => http.get<ApiResp<AuthStatus>>('/auth/status').then((r) => r.data),

  setup: (username: string, password: string) =>
    http.post<ApiResp<AuthUser>>('/auth/setup', { username, password }).then((r) => r.data),

  login: (username: string, password: string, remember = false) =>
    http
      .post<ApiResp<AuthUser>>('/auth/login', { username, password, remember })
      .then((r) => r.data),

  logout: () => http.post<ApiResp<{ ok: boolean }>>('/auth/logout').then((r) => r.data),

  changePassword: (oldPassword: string, newPassword: string) =>
    http
      .post<ApiResp<{ ok: boolean }>>('/auth/change-password', { oldPassword, newPassword })
      .then((r) => r.data),

  // -------- 抖音账号 --------
  douyinAccounts: () =>
    http.get<ApiResp<DouyinAccountDTO[]>>('/douyin/accounts').then((r) => r.data),

  douyinManual: (cookie: string) =>
    http.post<ApiResp<DouyinAccountDTO>>('/douyin/accounts/manual', { cookie }).then((r) => r.data),

  douyinCloakStart: () =>
    http
      .post<ApiResp<{ sessionId: string }>>('/douyin/accounts/cloak/start')
      .then((r) => r.data),

  douyinCloakCancel: (sessionId: string) =>
    http
      .post<ApiResp<{ ok: boolean }>>(`/douyin/accounts/cloak/${encodeURIComponent(sessionId)}/cancel`)
      .then((r) => r.data),

  douyinDelete: (id: number) =>
    http.delete<ApiResp<{ ok: boolean }>>(`/douyin/accounts/${id}`).then((r) => r.data),

  // ★ Cookie 校验 —— 测试已绑定账号的 cookie 是否有效
  douyinRefresh: (id: number) =>
    http.post<ApiResp<{ isValid: boolean }>>(`/douyin/accounts/${id}/refresh`).then((r) => r.data),

  douyinBridgeIssue: () =>
    http.post<ApiResp<BridgeIssueResult>>('/douyin/accounts/bridge/issue').then((r) => r.data),

  douyinBridgeRevoke: (id: number) =>
    http
      .post<ApiResp<{ ok: boolean }>>(`/douyin/accounts/${id}/bridge/revoke`)
      .then((r) => r.data),


  // ★ Cookie 校验 —— 测试 cookie 是否有效（不绑定账号）
  // 标记: COOKIE_VALIDATE_API
  cookieValidate: (cookie: string) =>
    http.post<ApiResp<CookieValidateResult>>('/douyin/accounts/cookie-validate', { cookie }).then((r) => r.data),

  // ★ 查询归档模式 —— 自动判断全量/增量
  // 标记: ARCHIVE_MODE_API
  archiveMode: (accountId: number) =>
    http.get<ApiResp<ArchiveModeResult>>(`/douyin/accounts/${accountId}/archive-mode`).then((r) => r.data),

  // -------- 归档 --------
  archiveFull: (accountId: number) =>
    http
      .post<ApiResp<{ accountId: number; queued: boolean }>>('/archive/full', { accountId })
      .then((r) => r.data),

  archiveIncremental: (accountId: number) =>
    http
      .post<ApiResp<{ accountId: number; queued: boolean }>>('/archive/incremental', { accountId })
      .then((r) => r.data),

  archiveProgress: (accountId?: number) =>
    http
      .get<ApiResp<Record<string, unknown>>>('/archive/progress', { params: { accountId } })
      .then((r) => r.data),

  archivePause: (accountId: number) =>
    http
      .post<ApiResp<Record<string, unknown>>>('/archive/pause', { accountId })
      .then((r) => r.data),

  archiveResume: (accountId: number) =>
    http
      .post<ApiResp<Record<string, unknown>>>('/archive/resume', { accountId })
      .then((r) => r.data),

  archiveStop: (accountId: number) =>
    http
      .post<ApiResp<Record<string, unknown>>>('/archive/stop', { accountId })
      .then((r) => r.data),

  downloadPause: () =>
    http.post<ApiResp<Record<string, unknown>>>('/download/pause').then((r) => r.data),

  downloadResume: () =>
    http.post<ApiResp<Record<string, unknown>>>('/download/resume').then((r) => r.data),

  downloadStop: () =>
    http.post<ApiResp<Record<string, unknown>>>('/download/stop').then((r) => r.data),

  downloadTasks: () =>
    http.get<ApiResp<{ items: DownloadTaskItem[]; queue: Record<string, unknown> }>>('/download/tasks').then((r) => r.data),

  downloadTaskResume: (id: number) =>
    http.post<ApiResp<{ ok: boolean }>>(`/download/tasks/${id}/resume`).then((r) => r.data),

  downloadTaskDelete: (id: number) =>
    http.delete<ApiResp<{ ok: boolean }>>(`/download/tasks/${id}`).then((r) => r.data),

  downloadMode: () =>
    http.get<ApiResp<DownloadModeResp>>('/download/mode').then((r) => r.data),

  setDownloadMode: (mode: 'enhanced' | 'compatible') =>
    http.post<ApiResp<DownloadModeResp>>('/download/mode', { mode }).then((r) => r.data),

  // -------- 视频库 --------
  listVideos: (q: VideoListQuery = {}) =>
    http
      .get<ApiResp<VideoListResult>>('/library/videos', { params: q })
      .then((r) => r.data),

  listMixes: (accountId?: number) =>
    http
      .get<ApiResp<MixListItem[]>>('/library/mixes', { params: { accountId } })
      .then((r) => r.data),

  listMixVideos: (mixId: number, page = 1, size = 20) =>
    http
      .get<ApiResp<MixDetailResult>>(`/library/mixes/${mixId}/videos`, { params: { page, size } })
      .then((r) => r.data),

  getContent: (id: number) =>
    http.get<ApiResp<VideoListItem>>(`/library/content/${id}`).then((r) => r.data),

  batchDeleteContents: (ids: number[]) =>
    http
      .post<ApiResp<{ hidden: number; skipped: number; freedBytes: number }>>(
        '/library/content/batch-delete',
        { ids }
      )
      .then((r) => r.data)
  ,

  listFolders: () =>
    http.get<ApiResp<FolderListItem[]>>('/library/folders').then((r) => r.data),

  createFolder: (name: string) =>
    http.post<ApiResp<FolderListItem>>('/library/folders', { name }).then((r) => r.data),

  renameFolder: (folderId: number, name: string) =>
    http.patch<ApiResp<{ ok: boolean }>>(`/library/folders/${folderId}`, { name }).then((r) => r.data),

  deleteFolders: (ids: number[]) =>
    http.post<ApiResp<{ deleted: number }>>('/library/folders/delete', { ids }).then((r) => r.data),

  listFolderVideos: (folderId: number, page = 1, size = 20) =>
    http
      .get<ApiResp<VideoListResult>>(`/library/folders/${folderId}/videos`, { params: { page, size } })
      .then((r) => r.data),

  addFolderItems: (folderId: number, contentIds: number[]) =>
    http.post<ApiResp<{ added: number }>>(`/library/folders/${folderId}/items`, { contentIds }).then((r) => r.data),

  removeFolderItems: (folderId: number, contentIds: number[]) =>
    http.delete<ApiResp<{ removed: number }>>(`/library/folders/${folderId}/items`, { data: { contentIds } }).then((r) => r.data)
}

export default http
