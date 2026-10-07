import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  Register,
  SessionContextUsage,
  SessionRateLimit,
} from 'claude-code'

import type { Armed, LineConfig, LineDraft, LineKey, Reading } from '../types'

const PANE = 'waterline'
const STORE_KEY = 'line-config'

/** 模组清单：只显示名字，点名字展开。以后加模组往这里加一行。 */
const MODS = [{ id: 'line', name: '水位线' }] as const

const DEFAULT_CONFIG: LineConfig = {
  enabled: false,
  ctxK: null,
  ctxMsg: '上下文到线了，写好交接就停下等我。',
  fiveH: null,
  week: null,
  quotaMsg: '额度到线了，写好交接就停下等我。',
}

const isOpen = atom({ plugin: 'waterline', key: 'isOpen' } as const, false)
const expanded = atom({ plugin: 'waterline', key: 'expanded' } as const, '')
const config = atom({ plugin: 'waterline', key: 'config' } as const, DEFAULT_CONFIG)
const note = atom({ plugin: 'waterline', key: 'note' } as const, { text: '', isError: false })
const reading = atom({ plugin: 'waterline', key: 'reading' } as const, {})
const armed = atom({ plugin: 'waterline', key: 'armed' } as const, {
  ctx: false,
  fiveH: false,
  week: false,
})
const flow = atom({ plugin: 'waterline', key: 'flow' } as const, { turn: null, pending: null })
const lastSent = atom({ plugin: 'waterline', key: 'lastSent' } as const, '')
/**
 * 这个窗口要不要盯线：只盯人亲手开的交互窗口。窗口里另起的 `claude -p` 会继承
 * CLAUDE_CODE_PLUGIN_DIRS 一起加载本插件，那种不能被塞话；设置里列的"不生效的目录"也一律不管。
 */
const isLive = atom({ plugin: 'waterline', key: 'isLive' } as const, false)
/**
 * 每存一次加一，拼进输入框的 key 让它们换新：输入框按回车后会自己清空，
 * 之后再画同样的 value 也不会填回去（实测），看着像没存上。
 */
const saves = atom({ plugin: 'waterline', key: 'saves' } as const, 0)

const KEYS: readonly LineKey[] = ['ctx', 'fiveH', 'week']

/**
 * 输入框里敲着还没保存的字，按保存时用。输入框的 value 一直给"存着的值"、不跟着敲的字变：
 * value 不变时重画不会动框里的字（实测）；value 跟着变的话，重画拿着稍旧的值
 * 会盖掉刚敲的字（实测，输入法一次上屏一串时会丢）。热重载会清空，无妨。
 */
let typed: Partial<LineDraft> | undefined

/** 两句话正在敲的全文：输入框只显示开头一行，框下面用它实时显示整句 */
const live = atom({ plugin: 'waterline', key: 'live' } as const, {})

// ---------- 纯函数（测试直接覆盖） ----------

function numText(n: number | null): string {
  return n === null ? '' : String(n)
}

export function toDraft(c: LineConfig): LineDraft {
  return {
    ctxK: numText(c.ctxK),
    ctxMsg: c.ctxMsg,
    fiveH: numText(c.fiveH),
    week: numText(c.week),
    quotaMsg: c.quotaMsg,
  }
}

/** '' → null（不盯）；不是范围内的数 → undefined（填错了）。搜狗全角数字也认。 */
export function parseNum(text: string, max: number): number | null | undefined {
  const t = text
    .trim()
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/．/g, '.')
    .replace(/\s*[kK%％]$/, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n > 0 && n <= max ? n : undefined
}

export function parseDraft(
  d: LineDraft,
  enabled: boolean,
): { config: LineConfig } | { error: string } {
  const ctxK = parseNum(d.ctxK, 100000)
  if (ctxK === undefined) return { error: '上下文要填正数（单位 k），不盯就留空' }
  const fiveH = parseNum(d.fiveH, 100)
  if (fiveH === undefined) return { error: '5小时额度要填 1～100，不盯就留空' }
  const week = parseNum(d.week, 100)
  if (week === undefined) return { error: '周额度要填 1～100，不盯就留空' }

  return {
    config: {
      enabled,
      ctxK,
      ctxMsg: d.ctxMsg.trim(),
      fiveH,
      week,
      quotaMsg: d.quotaMsg.trim(),
    },
  }
}

/** 存档里读出来的东西不一定是当前形状（旧版本、手改过），逐项兜底 */
export function normalizeConfig(raw: unknown): LineConfig {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_CONFIG
  const v = raw as Record<string, unknown>
  const num = (x: unknown) => (typeof x === 'number' && x > 0 ? x : null)
  const str = (x: unknown, dflt: string) => (typeof x === 'string' ? x : dflt)

  return {
    enabled: v.enabled === true,
    ctxK: num(v.ctxK),
    ctxMsg: str(v.ctxMsg, DEFAULT_CONFIG.ctxMsg),
    fiveH: num(v.fiveH),
    week: num(v.week),
    quotaMsg: str(v.quotaMsg, DEFAULT_CONFIG.quotaMsg),
  }
}

export function readingOf(context: SessionContextUsage, limits: SessionRateLimit[]): Reading {
  const pct = (kind: string) => limits.find(limit => limit.kind === kind)?.percentUsed

  return {
    ctxTokens: context.tokens,
    ctxWindow: context.window,
    fiveH: pct('five_hour'),
    week: pct('seven_day'),
  }
}

/** 上下文按 k 比，额度按 % 比 */
function valueOf(r: Reading, key: LineKey): number | undefined {
  if (key === 'ctx') return r.ctxTokens === undefined ? undefined : r.ctxTokens / 1000
  return key === 'fiveH' ? r.fiveH : r.week
}

function lineOf(c: LineConfig, key: LineKey): number | null {
  return key === 'ctx' ? c.ctxK : key === 'fiveH' ? c.fiveH : c.week
}

export function isOver(c: LineConfig, r: Reading, key: LineKey): boolean {
  const v = valueOf(r, key)
  const line = lineOf(c, key)
  return v !== undefined && line !== null && v >= line
}

/**
 * 只在"看到读数从线下走到线上"那一刻发一次：
 * 打开开关/改线时已经在线上的不补发（免得一保存就把正在干的活打断），
 * 降回线下（/clear、压缩、额度刷新）再过线会再发。
 */
export function stepArmed(
  a: Armed,
  c: LineConfig,
  r: Reading,
): { armed: Armed; crossed: LineKey[] } {
  const next = { ...a }
  const crossed: LineKey[] = []
  for (const key of KEYS) {
    const v = valueOf(r, key)
    const line = lineOf(c, key)
    if (v === undefined || line === null) continue
    if (v < line) next[key] = true
    else if (next[key]) {
      next[key] = false
      crossed.push(key)
    }
  }

  return { armed: next, crossed }
}

export function rearm(c: LineConfig, r: Reading): Armed {
  const isBelow = (key: LineKey) => {
    const v = valueOf(r, key)
    const line = lineOf(c, key)
    return v !== undefined && line !== null && v < line
  }

  return { ctx: isBelow('ctx'), fiveH: isBelow('fiveH'), week: isBelow('week') }
}

/** 终端里占几格：中日韩和全角符号算两格 */
export function cellWidth(text: string): number {
  let cells = 0
  for (const ch of text) cells += /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch) ? 2 : 1
  return cells
}

/**
 * 输入框一行装不下时，框里只露开头；返回框里露不出来的后半句。
 * 按"正在敲字时"算（那时框尾要让几格给回车提示），宁可和框里重几个字，也别漏字。
 */
export function overflowTail(text: string, cells: number): string {
  let used = 0
  let cut = 0
  for (const ch of text) {
    used += cellWidth(ch)
    if (used > cells) break
    cut += ch.length
  }
  return text.slice(cut)
}

/**
 * 一根细条：━ 已用（亮）、─ 没用（灰）、┃ 线的位置（亮）。按段返回，画的时候亮的一段一段拼。
 * 没读数就全灰；没设线就不画竖线。
 */
export function barRuns(
  value: number | undefined,
  line: number | null,
  max: number,
  cells: number,
): { text: string; isLit: boolean }[] {
  const filled = value === undefined || max <= 0 ? 0 : Math.min(cells, Math.round((value / max) * cells))
  const mark =
    line === null || max <= 0 ? -1 : Math.min(cells - 1, Math.max(0, Math.round((line / max) * cells)))
  const runs: { text: string; isLit: boolean }[] = []
  for (let i = 0; i < cells; i++) {
    const ch = i === mark ? '┃' : i < filled ? '━' : '─'
    const isLit = i === mark || i < filled
    const last = runs[runs.length - 1]
    if (last !== undefined && last.isLit === isLit) last.text += ch
    else runs.push({ text: ch, isLit })
  }
  return runs
}

function k(tokens: number | undefined): string {
  return tokens === undefined ? '?' : String(Math.round(tokens / 1000))
}

/** 发出去的话：前面带一句哪条线、现在多少，后面是用户自己写的话 */
export function composeMessages(c: LineConfig, r: Reading, crossed: LineKey[]): string[] {
  const out: string[] = []
  if (crossed.includes('ctx') && c.ctxMsg !== '') {
    out.push(`【到线提醒】上下文 ${k(r.ctxTokens)}k，到了 ${c.ctxK}k 的线。${c.ctxMsg}`)
  }
  const quota = crossed
    .filter(key => key !== 'ctx')
    .map(key =>
      key === 'fiveH' ? `5小时额度 ${r.fiveH}%（线 ${c.fiveH}%）` : `周额度 ${r.week}%（线 ${c.week}%）`,
    )
  if (quota.length > 0 && c.quotaMsg !== '') {
    out.push(`【到线提醒】${quota.join('、')}。${c.quotaMsg}`)
  }

  return out
}

/**
 * 时:分。插件环境的时区是机器的（服务器上常是 UTC），不一定是人的，
 * 所以按设置里的时区（IANA 名，如 Asia/Shanghai）算；没设就用机器的；名字写错了退回 UTC 并标出来。
 */
export function clockText(ms: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      ...(timeZone === '' ? {} : { timeZone }),
    }).format(new Date(ms))
  } catch {
    return `${new Date(ms).toISOString().slice(11, 16)} UTC`
  }
}

/** 插件设置（plugin.json 的 userConfig），register 时填进来 */
let settings: { timeZone: string; ignoreDirs: readonly string[] } = { timeZone: '', ignoreDirs: [] }

function hhmm(ms: number): string {
  return clockText(ms, settings.timeZone)
}

/** 当前目录落在"不生效的目录"里（目录本身或它底下） */
export function isIgnoredDir(cwd: string, dirs: readonly string[]): boolean {
  return dirs.some(dir => {
    const base = dir.replace(/\/+$/, '')
    return base !== '' && (cwd === base || cwd.startsWith(`${base}/`))
  })
}

// ---------- 动作 ----------

/**
 * 几个窗口共用一份设置（插件存档）：用之前从存档重读，别的窗口改过就换上、按当前读数重新上膛，
 * 免得拿这个窗口手里的旧设置把别处刚改的盖回去。
 */
async function syncConfig($: EngineInterface): Promise<LineConfig> {
  const fresh = normalizeConfig(await $.store.get(STORE_KEY))
  const held = await read($, config)
  if (JSON.stringify(fresh) !== JSON.stringify(held)) {
    await update($, config, () => fresh)
    const r = await read($, reading)
    await update($, armed, () => rearm(fresh, r))
  }
  return fresh
}

async function openPane($: EngineInterface) {
  await syncConfig($)
  await update($, isOpen, () => true)
  const opened = await $.ui.open({ id: PANE, title: '模组', columns: 46, rows: 22 })
  if (!opened.isPlaced) $.ui.toast(`模组栏没摆出来：${opened.reason}`)
}

/** 自己关的不经过本插件的 ui.close 钩子（实测），开关状态要自己记 */
async function closePane($: EngineInterface) {
  await update($, isOpen, () => false)
  await $.ui.close({ id: PANE })
}

async function commit($: EngineInterface, next: LineConfig) {
  await $.store.set(STORE_KEY, next)
  await update($, config, () => next)
  const r = await read($, reading)
  await update($, armed, () => rearm(next, r))
}

/** 存全部格子；填错了返回原因（不存），存好返回 null */
async function save($: EngineInterface): Promise<string | null> {
  const c = await syncConfig($)
  // 只拿这个窗口动过的格子盖上去，没动的用存档里最新的
  const parsed = parseDraft({ ...toDraft(c), ...typed }, c.enabled)
  if ('error' in parsed) {
    await update($, note, () => ({ text: parsed.error, isError: true }))
    return parsed.error
  }
  await commit($, parsed.config)
  typed = undefined
  await update($, live, () => ({}))
  await update($, saves, count => count + 1)
  const at = hhmm(await $.clock.now())
  await update($, note, () => ({ text: `✓ 已存 ${at}`, isError: false }))
  return null
}

// ---------- 在大框里改：侧栏格子只露一行、光标看不准，长句借底下的主输入框改 ----------

type MessageKey = 'ctxMsg' | 'quotaMsg'

const MARKS: Record<MessageKey, string> = {
  ctxMsg: '〔到线提醒·上下文那句〕',
  quotaMsg: '〔到线提醒·额度那句〕',
}

/** 主输入框里交上来的话带着记号，就是在大框里改好的那句 */
export function parseMarked(text: string): { key: MessageKey; value: string } | null {
  const t = text.trimStart()
  for (const key of ['ctxMsg', 'quotaMsg'] as const) {
    if (t.startsWith(MARKS[key])) return { key, value: t.slice(MARKS[key].length).trim() }
  }
  return null
}

async function editInPrompt($: EngineInterface, key: MessageKey) {
  const box = await $.prompt.read()
  if (box.text.trim() !== '' && parseMarked(box.text) === null) {
    $.ui.toast('下面大输入框里有没发的字，先发掉或清掉再点')
    return
  }
  const c = await read($, config)
  const current = typed?.[key] ?? c[key]
  const filled = await $.prompt.fill({ text: MARKS[key] + current })
  if (!filled.isFilled) {
    $.ui.toast(`没放进大输入框：${filled.refusal ?? '被别的插件拦了'}`)
    return
  }
  $.ui.toast('放进下面大输入框了：点一下它（或按 Esc）就能改，回车就存，不会发给 Claude', {
    timeoutMs: 8000,
  })
}

async function toggle($: EngineInterface) {
  const c = await syncConfig($)
  await commit($, { ...c, enabled: !c.enabled })
}

/**
 * 空闲时直接起一轮；正在干活时插进这一轮（模型下一步就读到），
 * 插完这一轮却没再发请求就结束了的，由 turn.complete 补发一轮。
 * canInsert=false：过线那一步就是收尾（没再调工具），插进去也读不到，
 * 直接排队等这一轮结束发一次——不然插一次、补发一次，模型收到两遍（实测出过）。
 */
async function deliver($: EngineInterface, text: string, canInsert: boolean) {
  const { turn } = await read($, flow)
  if (turn === null || !canInsert) {
    void $.prompt.submit({ text, asUser: true })
    return '已发出'
  }

  // 插不进去（被拦、出错）就退回排队，等这一轮结束再发，话不丢
  let refused: string | undefined
  try {
    const appended = await $.session.append({
      message: { type: 'user', content: [{ type: 'text', text }] },
    })
    refused = appended.deny
  } catch (err) {
    refused = err instanceof Error ? err.message : String(err)
  }
  if (refused !== undefined) {
    void $.prompt.submit({ text, asUser: true })
    return `插话没插进去（${refused}），改为这一轮结束后发`
  }
  await $.session.append({
    message: { type: 'system', content: [{ type: 'text', text: `到线提醒插进了正在跑的这一轮：${text}` }] },
  })

  let isStillRunning = false
  await update($, flow, f => {
    isStillRunning = f.turn !== null && f.turn.id === turn.id
    return isStillRunning ? { ...f, pending: { turnId: turn.id, step: f.turn!.step, text } } : f
  })
  if (!isStillRunning) void $.prompt.submit({ text, asUser: true })

  return '已插进当前这一轮'
}

async function observe($: EngineInterface, r: Reading, canInsert = true) {
  await update($, reading, () => r)
  if (!(await read($, isLive))) return
  const c = await syncConfig($)
  if (!c.enabled) return

  let crossed: LineKey[] = []
  await update($, armed, a => {
    const stepped = stepArmed(a, c, r)
    crossed = stepped.crossed
    return stepped.armed
  })
  if (crossed.length === 0) return

  const now = hhmm(await $.clock.now())
  const messages = composeMessages(c, r, crossed)
  if (messages.length === 0) {
    $.ui.toast('到线了（话是空的，没发）')
    await update($, lastSent, () => `${now} 到线了，话是空的没发`)
    return
  }
  for (const text of messages) {
    try {
      const how = await deliver($, text, canInsert)
      $.ui.toast(`到线提醒${how}`)
      await update($, lastSent, () => `${now} ${how}：${text.slice(0, 40)}`)
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      $.ui.toast(`到线提醒没发出去：${why}`)
      await update($, lastSent, () => `${now} 没发出去：${why}`)
    }
  }
}

// ---------- 画 ----------

export const register: Register = (on, options) => {
  settings = {
    timeZone: typeof options.timeZone === 'string' ? options.timeZone.trim() : '',
    ignoreDirs: Array.isArray(options.ignoreDirs) ? options.ignoreDirs : [],
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'mods', description: '展开/收起右边的模组栏' })
    await update($, isLive, () => e.isInteractive && !isIgnoredDir(e.cwd, settings.ignoreDirs))
    await syncConfig($)
    const isUp = (await $.ui.panes()).some(pane => pane.id === PANE)
    await update($, isOpen, () => isUp)

    return next(e)
  })

  on('command.run', { command: 'mods' }, async $ => {
    if (await read($, isOpen)) {
      await closePane($)
      return { text: '模组栏收起了。' }
    }
    await openPane($)
    return { text: '模组栏打开了。' }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    await update($, isOpen, () => false)
    return closed
  })

  on('prompt.submit', async ($, e, next) => {
    const marked = e.origin?.kind === 'plugin' ? null : parseMarked(e.text)
    if (marked === null) return next(e)

    typed = { ...typed, [marked.key]: marked.value }
    const error = await save($)
    const which = marked.key === 'ctxMsg' ? '上下文' : '额度'
    return {
      drop:
        error === null
          ? `✓ 已存进到线提醒（${which}那句），没发给 Claude`
          : `没存上：${error}（这句没发给 Claude，侧栏里改好再存）`,
    }
  }).catch(($, e, next) =>
    next.called
      ? next(e)
      : parseMarked(e.text) !== null
        ? { drop: '到线提醒出错了，这句没存上，也没发给 Claude' }
        : next(e),
  )

  on('session.measure', async ($, e, next) => {
    await observe($, readingOf(e.context, e.rateLimits))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await update($, flow, f => ({ ...f, turn: { id: e.turnId, step: -1 } }))
    return next(e)
  })

  // 主线程每发一次请求：记步数、销掉已被读到的插话；请求回来后读一次数（干活中途也能到线就发）
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)

    await update($, flow, f => {
      const turn = f.turn !== null && f.turn.id === e.turnId ? { ...f.turn, step: e.index } : f.turn
      const isSeen = f.pending !== null && f.pending.turnId === e.turnId && e.index > f.pending.step
      return { turn, pending: isSeen ? null : f.pending }
    })
    const result = yield* next(e)
    try {
      const usage = await $.session.usage()
      await observe($, readingOf(usage.context, usage.rateLimits), result.toolUses.length > 0)
    } catch (err) {
      $.ui.toast(`到线提醒读数失败：${err instanceof Error ? err.message : String(err)}`)
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result

    let missed: string | null = null
    await update($, flow, f => {
      missed = f.pending !== null && f.pending.turnId === e.turnId ? f.pending.text : null
      return { turn: null, pending: null }
    })
    if (missed !== null) {
      if (e.isAborted) $.ui.toast('到线提醒插进去后这一轮被打断了，模型下次说话时会看到')
      else void $.prompt.submit({ text: missed, asUser: true })
    }

    return result
  })

  // 收起时：输入框上面一行右端一个小入口，点开就是右边的模组栏
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isOpen))) return next(e)
    const c = await read($, config)
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box justifyContent="flex-end">
        <Box key="tab">
          {c.enabled && <Text>● </Text>}
          <Button
            key="open"
            plain
            dimColor
            label="◂ 模组"
            hover={{ dimColor: false, bold: true }}
            onPress={() => openPane($)}
          />
        </Box>
      </Box>
    )
  })

  // 黑白灰：亮＝要紧的（标题、开着、已用、你填的），灰＝说明和没用的；不用彩色
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    const [open, c, r, n, sent, gen, typing] = await Promise.all([
      read($, expanded),
      read($, config),
      read($, reading),
      read($, note),
      read($, lastSent),
      read($, saves),
      read($, live),
    ])
    const width = Math.max(24, e.props.bodyColumns)
    const blank = <Text> </Text>
    const head = (title: string, right: string) => (
      <Box justifyContent="space-between">
        <Text bold>{title}</Text>
        <Text dimColor>{right}</Text>
      </Box>
    )
    const meter = (value: number | undefined, line: number | null, max: number, cells: number) => (
      <Text>
        {barRuns(value, line, max, cells).map(run => (
          <Text dimColor={!run.isLit}>{run.text}</Text>
        ))}
      </Text>
    )

    const rows = [
      <Box justifyContent="space-between">
        <Text bold>模组</Text>
        <Button key="collapse" plain dimColor label="收起 ›" onPress={() => closePane($)} />
      </Box>,
      <Text dimColor>{'─'.repeat(width)}</Text>,
    ]

    for (const mod of MODS) {
      const isExpanded = open === mod.id
      // 名字一行：左边点名字展开，右边开关（开着亮、关着灰；不展开也能开关）
      rows.push(
        <Box justifyContent="space-between">
          <Button
            key={`mod-${mod.id}`}
            plain
            label={`${isExpanded ? '▾' : '▸'} ${mod.name}`}
            onPress={() => update($, expanded, cur => (cur === mod.id ? '' : mod.id))}
          />
          <Box>
            {isExpanded && n.text !== '' && !n.isError && <Text dimColor>{n.text}  </Text>}
            {isExpanded && <Button key="save" label="保存" onPress={() => save($)} />}
            <Text> </Text>
            <Button
              key="toggle"
              plain
              dimColor={!c.enabled}
              label={c.enabled ? '● 开' : '○ 关'}
              onPress={() => toggle($)}
            />
          </Box>
        </Box>,
      )
      if (!isExpanded) continue
      if (n.isError) rows.push(<Text inverse> ! {n.text} </Text>)

      const saved = toDraft(c)
      const pct = (v: number | undefined) => (v === undefined ? '?' : `${v}%`)
      const ctxNow = r.ctxTokens === undefined ? '还没读数' : `${k(r.ctxTokens)}k / ${k(r.ctxWindow)}k`
      const overNote = (isPast: boolean) => (c.enabled && isPast ? '已过线 · ' : '')
      const hasLine = c.ctxK !== null || c.fiveH !== null || c.week !== null

      if (!('Input' in els)) {
        rows.push(
          <Box flexDirection="column" paddingLeft={2}>
            <Text dimColor>上下文 现在 {ctxNow}</Text>
            <Text dimColor>
              额度 现在 5小时 {pct(r.fiveH)} · 周 {pct(r.week)}
            </Text>
            <Text dimColor>这个界面不能填，回终端里改。</Text>
          </Box>,
        )
        continue
      }

      const { Input } = els
      const inner = width - 2
      const field = (key: keyof LineDraft, placeholder: string) => (
        <Input
          key={`${key}~${gen}`}
          placeholder={placeholder}
          value={saved[key]}
          submitLabel="存"
          onInput={value => {
            typed = { ...typed, [key]: value }
            if (key === 'ctxMsg' || key === 'quotaMsg') void update($, live, cur => ({ ...cur, [key]: value }))
          }}
          onSubmit={async value => {
            typed = { ...typed, [key]: value }
            await save($)
          }}
        />
      )
      // 要发的话：灰色圆角框里是输入框；一行装不下时，框里露不出来的后半句完整接着写在框下面（跟着敲的字实时变）。
      // 整句要随时看得到（试过平时只留一行，看不全不好用），所以不截；保存按钮因此挪到最上面那行
      const message = (key: MessageKey) => {
        const tail = overflowTail(typing[key] ?? c[key], inner - 10)
        return (
          <Box flexDirection="column">
            <Box borderStyle="round" borderDimColor width={inner}>
              {field(key, '留空＝只弹提示，不发')}
            </Box>
            {tail !== '' && (
              <Box paddingX={1}>
                <Text dimColor wrap="wrap">
                  …{tail}
                </Text>
              </Box>
            )}
          </Box>
        )
      }
      // 数字：灰色方括号圈出能填的地方
      const numberRow = (lead: string, key: keyof LineDraft, unit: string, leadWidth = 9) => (
        <Box>
          <Box width={leadWidth}>
            <Text>{lead}</Text>
          </Box>
          <Text dimColor>[ </Text>
          <Box width={10}>{field(key, '不盯')}</Box>
          <Text dimColor> ]</Text>
          <Text>{unit}</Text>
        </Box>
      )
      const bigButton = (key: MessageKey) => (
        <Button key={`big-${key}`} plain dimColor label="✎ 大框里改" onPress={() => editInPrompt($, key)} />
      )
      // 额度一根条：名字、条、现在多少
      const quotaMeter = (label: string, value: number | undefined, line: number | null) => (
        <Box>
          <Box width={6}>
            <Text dimColor>{label}</Text>
          </Box>
          {meter(value, line, 100, inner - 11)}
          <Box width={5} justifyContent="flex-end">
            <Text dimColor>{pct(value)}</Text>
          </Box>
        </Box>
      )

      rows.push(
        <Box flexDirection="column" paddingLeft={2}>
          {head('上下文', `${overNote(isOver(c, r, 'ctx'))}${ctxNow}`)}
          {r.ctxWindow !== undefined && meter(r.ctxTokens === undefined ? undefined : r.ctxTokens / 1000, c.ctxK, r.ctxWindow / 1000, inner)}
          <Box justifyContent="space-between">
            {numberRow('到', 'ctxK', ' k 时，发：', 3)}
            {bigButton('ctxMsg')}
          </Box>
          {message('ctxMsg')}
          {blank}
          <Box justifyContent="space-between">
            <Text>
              <Text bold>额度</Text>
              <Text dimColor>
                {'  '}
                {overNote(isOver(c, r, 'fiveH') || isOver(c, r, 'week'))}任一条到线就发
              </Text>
            </Text>
            {bigButton('quotaMsg')}
          </Box>
          {quotaMeter('5小时', r.fiveH, c.fiveH)}
          {quotaMeter('周', r.week, c.week)}
          {numberRow('5小时到', 'fiveH', ' %')}
          {numberRow('周额度到', 'week', ' %')}
          {message('quotaMsg')}
          {c.enabled && !hasLine && <Text dimColor>还没填线，开着也不会发</Text>}
          {sent !== '' && (
            <Text dimColor wrap="truncate-end">
              上次 · {sent}
            </Text>
          )}
        </Box>,
      )
    }

    return <Box flexDirection="column">{rows}</Box>
  })
}
