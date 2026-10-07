/** 到线提醒的设置：线为 null = 这条不盯；话为空 = 到线只弹提示不发 */
export type LineConfig = {
  enabled: boolean
  ctxK: number | null
  ctxMsg: string
  fiveH: number | null
  week: number | null
  /** 模型专属周额度（Fable）的线：只发给正在跑 Fable 的窗口 */
  fable: number | null
  quotaMsg: string
}

/** 输入框里还没保存的原文 */
export type LineDraft = {
  ctxK: string
  ctxMsg: string
  fiveH: string
  week: string
  fable: string
  quotaMsg: string
}

/** 最近一次读数；没读到的项缺省 */
export type Reading = {
  ctxTokens?: number
  ctxWindow?: number
  fiveH?: number
  week?: number
  /** Fable 周额度：Claude Code 不交给插件，从设置里的额度文件读 */
  fable?: number
  /** Fable 那个数是什么时候记下的（毫秒）；只有跑 Fable 的窗口会刷新它 */
  fableAt?: number
  /** Fable 读不到的原因 */
  fableNote?: string
  /** 这个窗口当前主线程用的模型 */
  model?: string
}

export type LineKey = 'ctx' | 'fiveH' | 'week' | 'fable'

/** 每条线是否"上膛"：上次看到的读数在线下，过线才发 */
export type Armed = { ctx: boolean; fiveH: boolean; week: boolean; fable: boolean }

/** 正在跑的主线程这一轮，和插进这一轮但模型还没读到的话 */
export type Flow = {
  turn: { id: string; step: number } | null
  pending: { turnId: string; step: number; text: string } | null
}

export type Note = { text: string; isError: boolean }

/** 官方额度接口问来的 Fable 周线，和下次什么时候再问（毫秒） */
export type ApiQuota = { fable?: number; fableAt?: number; fableNote?: string; nextAt: number }

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
      model: string
      apiQuota: ApiQuota
    }
  }
}
