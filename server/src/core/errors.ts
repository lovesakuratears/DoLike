// 统一错误码
export const ERR = {
  OK: 0,
  // 1xxx 鉴权
  AUTH_NOT_SETUP: 1001,
  AUTH_ALREADY_SETUP: 1002,
  AUTH_INVALID_CREDENTIALS: 1003,
  AUTH_NOT_LOGGED_IN: 1004,
  AUTH_USERNAME_TAKEN: 1005,
  AUTH_WEAK_PASSWORD: 1006,
  AUTH_INVALID_USERNAME: 1007,
  AUTH_OLD_PASSWORD_WRONG: 1008,
  // 2xxx 抖音
  DOUYIN_COOKIE_INVALID: 2001,
  DOUYIN_COOKIE_INCOMPLETE: 2002,
  DOUYIN_CLOAK_LAUNCH_FAILED: 2003,
  DOUYIN_BRIDGE_TOKEN_INVALID: 2004,
  DOUYIN_ACCOUNT_NOT_FOUND: 2005,
  DOUYIN_BROWSER_UNAVAILABLE: 2006,
  DOUYIN_LIST_NO_DATA: 2007,
  DOUYIN_RISK_CONTROL: 2008,
  // 3xxx 下载
  DOWNLOAD_URL_EXPIRED: 3001,
  DOWNLOAD_WRITE_FAILED: 3002,
  DOWNLOAD_HTTP_FAILED: 3003,
  // 4xxx 通用
  VALIDATION_FAILED: 4001,
  NOT_FOUND: 4004,
  INTERNAL_ERROR: 5000
} as const

export type ErrCode = (typeof ERR)[keyof typeof ERR]

export class AppError extends Error {
  constructor(public readonly code: ErrCode, message: string, public readonly httpStatus = 400) {
    super(message)
    this.name = 'AppError'
  }
}

export interface ApiResponse<T = unknown> {
  code: number
  data: T | null
  message: string
}

export function ok<T>(data: T): ApiResponse<T> {
  return { code: ERR.OK, data, message: '' }
}

export function fail(code: ErrCode, message: string): ApiResponse<null> {
  return { code, data: null, message }
}
