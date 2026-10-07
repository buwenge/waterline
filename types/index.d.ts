/** 到线提醒的设置：线为 null = 这条不盯；话为空 = 到线只弹提示不发 */
export type LineConfig = {
  enabled: boolean
  ctxK: number | null
  ctxMsg: string
  fiveH: number | null
  week: number | null
  quotaMsg: string
}

/** 输入框里还没保存的原文 */
export type LineDraft = {
  ctxK: string
  ctxMsg: string
  fiveH: string
  week: string
  quotaMsg: string
}

/** 最近一次读数；没读到的项缺省 */
export type Reading = {
  ctxTokens?: number
  ctxWindow?: number
  fiveH?: number
  week?: number
}

export type LineKey = 'ctx' | 'fiveH' | 'week'

/** 每条线是否"上膛"：上次看到的读数在线下，过线才发 */
export type Armed = { ctx: boolean; fiveH: boolean; week: boolean }

/** 正在跑的主线程这一轮，和插进这一轮但模型还没读到的话 */
export type Flow = {
  turn: { id: string; step: number } | null
  pending: { turnId: string; step: number; text: string } | null
}

export type Note = { text: string; isError: boolean }

declare module 'claude-code' {
  interface PluginState {
    'waterline': {
      isOpen: boolean
      expanded: string
      config: LineConfig
      note: Note
      reading: Reading
      armed: Armed
      flow: Flow
      lastSent: string
      isLive: boolean
      saves: number
      live: { ctxMsg?: string; quotaMsg?: string }
    }
  }
}
