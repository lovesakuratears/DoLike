export type CookieSource = 'cloak' | 'manual' | 'bridge'

export interface DouyinAccountDTO {
  id: number
  secUid: string
  nickname: string
  avatarUrl: string | null
  cookieSource: CookieSource
  isValid: boolean
  lastCheckAt: string | null
  createdAt: string
}

export interface ProfileSelfMin {
  __cookieValidated?: boolean
  secUid: string
  nickname: string
  avatarUrl: string | null
}

export type CloakStage =
  | 'starting'
  | 'waiting_qr'
  | 'scanning'
  | 'confirmed'
  | 'success'
  | 'failed'
  | 'timeout'

export interface CloakEvent {
  sessionId: string
  stage: CloakStage
  qrImage?: string
  message?: string
  accountId?: number
}

export interface BridgeInitPayload {
  secUid: string
  nickname: string
  avatarUrl?: string
  cookie?: string
}
