import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

import {
  barRuns,
  cellWidth,
  clockText,
  isIgnoredDir,
  parseQuotaFile,
  parseUsageApi,
  composeMessages,
  overflowTail,
  parseNum,
  rearm,
  stepArmed,
} from '../hooks/register'
import type { LineConfig } from '../types'

const CFG: LineConfig = {
  enabled: true,
  ctxK: 100,
  ctxMsg: '收尾',
  fiveH: 90,
  week: null,
  fable: null,
  quotaMsg: '停下',
}

describe('纯函数', () => {
  test('只在从线下走到线上那一刻发一次', () => {
    let a = rearm(CFG, {})
    expect(a).toEqual({ ctx: false, fiveH: false, week: false, fable: false })

    let s = stepArmed(a, CFG, { ctxTokens: 50_000 })
    expect(s.crossed).toEqual([])
    a = s.armed

    s = stepArmed(a, CFG, { ctxTokens: 120_000 })
    expect(s.crossed).toEqual(['ctx'])
    a = s.armed

    s = stepArmed(a, CFG, { ctxTokens: 130_000 })
    expect(s.crossed).toEqual([])
  })

  test('第一次读数就已在线上的不补发', () => {
    const s = stepArmed(rearm(CFG, {}), CFG, { ctxTokens: 500_000, fiveH: 95 })
    expect(s.crossed).toEqual([])
  })

  test('全角数字、带单位都认，乱填报错', () => {
    expect(parseNum('３００', 100000)).toBe(300)
    expect(parseNum('90%', 100)).toBe(90)
    expect(parseNum('', 100)).toBe(null)
    expect(parseNum('abc', 100)).toBe(undefined)
    expect(parseNum('120', 100)).toBe(undefined)
  })

  test('时间按设置的时区算；名字写错退回 UTC 并标出来', () => {
    const at = Date.UTC(2026, 9, 7, 6, 5)
    expect(clockText(at, 'Asia/Shanghai')).toBe('14:05')
    expect(clockText(at, 'UTC')).toBe('06:05')
    expect(clockText(at, 'Not/AZone')).toBe('06:05 UTC')
  })

  test('额度文件：读出 Fable 那条和记下的时间；坏文件、没这条都说清原因', () => {
    expect(
      parseQuotaFile('{"windows":{"seven_day_overage_included":{"utilization":27,"at":1000}}}'),
    ).toEqual({ fable: 27, fableAt: 1_000_000 })
    expect(parseQuotaFile('不是json')).toEqual({ fableNote: '额度文件不是 JSON' })
    expect(parseQuotaFile('{"windows":{"five_hour":{"utilization":3}}}')).toEqual({
      fableNote: '额度文件里还没有 Fable 那条',
    })
  })

  test('官方额度接口：两种写法都认 Fable；没有就说清', () => {
    expect(
      parseUsageApi(
        JSON.stringify({
          five_hour: { utilization: 20 },
          limits: [
            { kind: 'weekly', percent: 60 },
            { kind: 'weekly_scoped', percent: 41, scope: { model: { display_name: 'Fable' } } },
          ],
        }),
      ),
    ).toEqual({ fable: 41 })
    expect(parseUsageApi('{"seven_day_overage_included":{"utilization":33}}')).toEqual({ fable: 33 })
    expect(parseUsageApi('{"five_hour":{"utilization":3}}').fableNote).toContain('没有 Fable 那条')
    expect(parseUsageApi('<html>').fableNote).toBe('额度接口回的不是 JSON')
  })

  test('不生效的目录：目录本身和底下都算，前缀相同的别的目录不算', () => {
    expect(isIgnoredDir('/srv/private', ['/srv/private/'])).toBe(true)
    expect(isIgnoredDir('/srv/private/a/b', ['/srv/private'])).toBe(true)
    expect(isIgnoredDir('/srv/private2', ['/srv/private'])).toBe(false)
    expect(isIgnoredDir('/anything', [''])).toBe(false)
  })

  test('中文算两格；框里露不出来的后半句一个字不漏', () => {
    expect(cellWidth('ab中文')).toBe(6)
    expect(overflowTail('一二三四五', 6)).toBe('四五')
    expect(overflowTail('一二三', 6)).toBe('')
    expect(overflowTail('ab一二', 3)).toBe('一二')
  })

  test('细条：已用亮、没用灰、线的位置一根竖线；没读数全灰、没设线不画竖线', () => {
    const draw = (runs: { text: string; isLit: boolean }[]) =>
      runs.map(run => (run.isLit ? run.text : run.text.toLowerCase())).join('')
    expect(draw(barRuns(30, 80, 100, 10))).toBe('━━━─────┃─')
    expect(barRuns(30, 80, 100, 10).map(run => run.isLit)).toEqual([true, false, true, false])
    expect(draw(barRuns(undefined, null, 100, 4))).toBe('────')
    expect(draw(barRuns(100, 100, 100, 4))).toBe('━━━┃')
  })

  test('话里带上哪条线和现在多少；话空就不发', () => {
    expect(composeMessages(CFG, { ctxTokens: 120_000 }, ['ctx'])).toEqual([
      '【到线提醒】上下文 120k，到了 100k 的线。收尾',
    ])
    expect(composeMessages({ ...CFG, quotaMsg: '' }, { fiveH: 91 }, ['fiveH'])).toEqual([])
  })
})

type World = {
  submits: string[]
  appends: { type: string; text: string }[]
  toasts: string[]
  store: Record<string, unknown>
  clock: MockClock
}

function world(on: On, config: LineConfig): World {
  const w = { submits: [], appends: [], toasts: [], store: { 'line-config': config } } as unknown as World
  on('store.get', ($, e) => ({ value: w.store[e.key] }))
  on('store.set', ($, e) => {
    w.store[e.key] = e.value
    return { value: undefined }
  })
  w.clock = mock.clock(on, { now: Date.UTC(2026, 9, 7, 6, 0) })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('prompt.submit', ($, e) => {
    w.submits.push(e.text)
    return { text: e.text }
  })
  on('session.append', ($, e) => {
    const block = e.message.content[0]
    w.appends.push({ type: e.message.type, text: block && 'text' in block ? String(block.text) : '' })
    return { deny: '测试里不落盘' }
  })

  return w
}

const START = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as const

function measure(tokens: number, fiveH?: number) {
  return {
    context: { tokens, window: 1_000_000 },
    rateLimits: fiveH === undefined ? [] : [{ kind: 'five_hour', percentUsed: fiveH }],
    changed: ['context' as const],
  }
}

test('空闲时过线：直接起一轮，原话发出', async ($, on) => {
  const w = world(on, CFG)
  await $.session.start(START)
  await $.session.measure(measure(50_000))
  await $.session.measure(measure(120_000))

  expect(w.submits).toEqual(['【到线提醒】上下文 120k，到了 100k 的线。收尾'])
  expect(w.appends).toEqual([])
})

for (const [why, start] of [
  ['后台 claude -p（非交互）', { ...START, isInteractive: false }],
  ['设置里"不生效的目录"', { ...START, cwd: '/srv/private/sub' }],
] as const) {
  test(`${why}：过线也不发`, { options: { ignoreDirs: ['/srv/private/'] } }, async ($, on) => {
    const w = world(on, CFG)
    await $.session.start(start)
    await $.session.measure(measure(50_000))
    await $.session.measure(measure(120_000))
    expect(w.submits).toEqual([])
  })
}

test('别的窗口改了设置：这个窗口下次读数就按新的来；保存只盖自己动过的格子', async ($, on) => {
  const w = world(on, CFG)
  await $.session.start(START)
  await $.session.measure(measure(50_000))
  w.store['line-config'] = { ...CFG, ctxK: 200, ctxMsg: '别处改的' }
  await $.session.measure(measure(120_000))
  expect(w.submits).toEqual([])
  await $.session.measure(measure(210_000))
  expect(w.submits).toEqual(['【到线提醒】上下文 210k，到了 200k 的线。别处改的'])

  w.store['line-config'] = { ...CFG, ctxK: 300, ctxMsg: '又改了' }
  const typedAt = { wait: false, origin: { kind: 'composer' } } as const
  await $.prompt.submit({ text: '〔到线提醒·额度那句〕这边只改额度', ...typedAt })
  expect(w.store['line-config']).toMatchObject({ ctxK: 300, ctxMsg: '又改了', quotaMsg: '这边只改额度' })
})

test('开关没开：过线也不发', async ($, on) => {
  const w = world(on, { ...CFG, enabled: false })
  await $.session.start(START)
  await $.session.measure(measure(50_000))
  await $.session.measure(measure(120_000))

  expect(w.submits).toEqual([])
})

// 测试工具里插件自己的 session.append 到不了测试的钩子（报 no implementation），
// 插话成功那条路只能在真的 Claude Code 里验；这里正好测插不进去时退回排队、话不丢
test('干活中途过线：插不进去就改为排队发，不丢', async ($, on) => {
  const w = world(on, CFG)
  await $.session.start(START)
  await $.session.measure(measure(50_000))
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.session.measure(measure(50_000, 95))
  await $.session.measure(measure(120_000, 95))

  expect(w.toasts).toEqual([
    '到线提醒插话没插进去（no implementation for session.append），改为这一轮结束后发',
  ])
  expect(w.submits).toEqual(['【到线提醒】上下文 120k，到了 100k 的线。收尾'])

  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
  })
  expect(w.submits.length).toBe(1)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}：点名字展开、敲字不被重画冲掉、回车保存后格子填回、点圆点开关`, async ($, on) => {
    const w = world(on, { ...CFG, enabled: false, ctxK: null })
    await $.session.start(START)

    const ui = await $.ui.mount({
      plugin: 'waterline',
      surface,
      component: 'Pane',
      requestId: 'waterline',
      props: {
        title: '模组',
        isFocused: true,
        bodyColumns: 40,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 30 },
        view: {},
      },
    })
    expect(await ui.find({ type: 'Input' })).toBeUndefined()

    await ui.press({ key: 'mod-line' })
    expect(await ui.find({ key: 'ctxK~0' })).toBeDefined()

    // 敲了没存时别的原因重画（这里按圆点开关）：交给输入框的 value 不跟着变（变了会盖掉敲的字），
    // 敲的字记着，最后保存时一起存
    await ui.input({ key: 'ctxK~0', text: '３００', kind: 'change' })
    await ui.press({ key: 'toggle' })
    expect((await ui.find({ key: 'ctxK~0' }))?.props.value).toBe('')
    expect(w.store['line-config']).toMatchObject({ enabled: true, ctxK: null })

    // 话敲长了，框下面实时显示全文
    const long = '到线了先收尾，把做完的没做完的下一步都写成交接'
    await ui.input({ key: 'ctxMsg~0', text: long, kind: 'change' })
    expect(await ui.find({ type: 'Text', text: '写成交接' })).toBeDefined()
    expect((await ui.find({ key: 'ctxMsg~0' }))?.props.value).toBe('收尾')

    // 在话的格子里按回车＝保存；存完格子换新，填回存好的内容（不会看着是空的）
    await ui.input({ key: 'ctxMsg~0', text: '到线了停下' })
    expect(await ui.find({ type: 'Text', text: '已存' })).toBeDefined()
    expect(w.store['line-config']).toMatchObject({ ctxK: 300, ctxMsg: '到线了停下', enabled: true })
    expect((await ui.find({ key: 'ctxMsg~1' }))?.props.value).toBe('到线了停下')
    expect(await ui.find({ key: 'ctxMsg~0' })).toBeUndefined()

    await ui.input({ key: 'fiveH~1', text: '200' })
    expect(await ui.find({ type: 'Text', text: '5小时额度要填 1～100' })).toBeDefined()
    expect(w.store['line-config']).toMatchObject({ fiveH: 90 })

    await ui.press({ key: 'toggle' })
    expect(w.store['line-config']).toMatchObject({ enabled: false })
    expect((await ui.find({ key: 'toggle' }))?.text).toBe('○ 关')
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}：收起时输入框上方有入口，点了打开侧栏、入口消失`, async ($, on) => {
    world(on, CFG)
    const opened: string[] = []
    on('ui.open', ($$, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })
    // 引擎自己的这一行：什么都不画
    on('ui.render', { component: 'AbovePrompt' }, ($$, e) => {
      const { Box } = $$.ui.resolve(e)
      return h(Box, {}) as RenderElement
    })
    await $.session.start(START)

    const band = await $.ui.mount({
      plugin: 'waterline',
      surface,
      component: 'AbovePrompt',
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 10,
        bodyColumns: 100,
        scroll: { offset: 0, bodyRows: 10 },
        view: {},
      },
    })
    expect(await band.find({ type: 'Text', text: '●' })).toBeDefined()
    await band.press({ key: 'open' })
    expect(opened).toEqual(['waterline'])
    expect(await band.find({ key: 'open' })).toBeUndefined()
  })
}

test('大框里改：带记号的话存下、拦住不发；不带记号的照常发', async ($, on) => {
  const w = world(on, CFG)
  await $.session.start(START)

  const typedAt = { wait: false, origin: { kind: 'composer' } } as const
  const kept = await $.prompt.submit({ text: '〔到线提醒·上下文那句〕 到线了，写交接停下 ', ...typedAt })
  expect(kept).toMatchObject({ drop: '✓ 已存进到线提醒（上下文那句），没发给 Claude' })
  expect(w.submits).toEqual([])
  expect(w.store['line-config']).toMatchObject({ ctxMsg: '到线了，写交接停下', ctxK: 100 })

  await $.prompt.submit({ text: '随便说一句', ...typedAt })
  expect(w.submits).toEqual(['随便说一句'])
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}：点「大框里改」把那句话连记号填进主输入框；框里有别的字就不动`, async ($, on) => {
    const w = world(on, CFG)
    let box = ''
    const fills: string[] = []
    on('prompt.read', () => ({ value: { text: box, cursor: 0 } }))
    on('prompt.fill', ($$, e) => {
      fills.push(e.text)
      return { isFilled: true }
    })
    await $.session.start(START)
    const ui = await $.ui.mount({
      plugin: 'waterline',
      surface,
      component: 'Pane',
      requestId: 'waterline',
      props: {
        title: '模组',
        isFocused: true,
        bodyColumns: 44,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 30 },
        view: {},
      },
    })
    await ui.press({ key: 'mod-line' })
    await ui.press({ key: 'big-quotaMsg' })
    expect(fills).toEqual(['〔到线提醒·额度那句〕停下'])

    box = '我正写着一半的话'
    await ui.press({ key: 'big-ctxMsg' })
    expect(fills.length).toBe(1)
    expect(w.toasts).toContain('下面大输入框里有没发的字，先发掉或清掉再点')
  })
}

// 实测出过：线在 Claude 收尾那一步过的，插进去后这一轮立刻结束，又补发一遍＝收到两次
for (const hasMoreSteps of [false, true]) {
  test(`过线那一步${hasMoreSteps ? '后面还要调工具：插进这一轮' : '就是收尾：不插，等这一轮结束发一次'}`, async ($, on) => {
    const w = world(on, CFG)
    let tokens = 50_000
    on('session.usage', () => ({
      value: { startedAt: 0, context: { tokens, window: 1_000_000 }, rateLimits: [] },
    }))
    on('turn.step', async function* ($$, e) {
      return {
        turnId: e.turnId,
        index: e.index,
        answer: '',
        toolUses: hasMoreSteps ? [{ id: 'tu1', name: 'Bash', input: {} }] : [],
        stopReason: hasMoreSteps ? 'tool_use' : 'end_turn',
        usage: null,
      } as never
    })
    await $.session.start(START)
    await $.session.measure(measure(50_000))
    await $.turn.start({ text: 'go', turnId: 't1' })
    tokens = 120_000
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 })) {
      // 流里没有内容，只要结果
    }

    expect(w.toasts.some(t => t.startsWith('到线提醒插话没插进去'))).toBe(hasMoreSteps)
    expect(w.submits).toEqual(['【到线提醒】上下文 120k，到了 100k 的线。收尾'])
  })
}

// Fable 周额度 Claude Code 不交给插件，从额度文件读；那条线只发给正在跑 Fable 的窗口
for (const [model, isFable] of [
  ['claude-fable-5-1', true],
  ['claude-opus-5-5', false],
] as const) {
  test(`Fable 线过线：${isFable ? 'Fable 窗口发' : '别的模型窗口不发'}`, { options: { quotaFile: '/q.json' } }, async ($, on) => {
    const w = world(on, { ...CFG, ctxK: null, fiveH: null, fable: 90 })
    let used = 80
    on('fs.read', () => ({
      value: JSON.stringify({ windows: { seven_day_overage_included: { utilization: used, at: 0 } } }),
    }))
    on('session.usage', () => ({
      value: { startedAt: 0, context: { tokens: 1000, window: 1_000_000 }, rateLimits: [] },
    }))
    on('turn.step', async function* ($$, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
    })
    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 't1' })
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model, messageCount: 1 })) {
      // 只要结果
    }
    used = 95
    for await (const _ of $.turn.step({ turnId: 't1', index: 1, model, messageCount: 2 })) {
      // 只要结果
    }

    expect(w.submits).toEqual(isFable ? ['【到线提醒】Fable 周额度 95%（线 90%）。停下'] : [])
  })
}

// 没填额度文件：普通登录问官方额度接口拿 Fable；长期令牌被拒就说清、半天内不再问
function usageWorld(on: On, reply: () => { status: number; text: string; headers?: Record<string, string> }) {
  const calls: string[] = []
  on('session.authorize', () => ({ value: { handle: 'h1', kind: 'bearer' } }))
  on('http.fetch', ($$, e) => {
    calls.push(e.url)
    const { status, text, headers = {} } = reply()
    return { value: { status, ok: status >= 200 && status < 300, headers, text } }
  })
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 1000, window: 1_000_000 }, rateLimits: [] },
  }))
  on('turn.step', async function* ($$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
  return calls
}

async function fableSteps($: Engine, count: number, before: (i: number) => void) {
  await $.turn.start({ text: 'go', turnId: 't1' })
  for (let i = 0; i < count; i++) {
    before(i)
    for await (const _ of $.turn.step({ turnId: 't1', index: i, model: 'claude-fable-5-1', messageCount: i + 1 })) {
      // 只要结果
    }
  }
}

test('普通登录：问官方接口拿 Fable，过线发；5 分钟内不重复问', async ($, on) => {
  const w = world(on, { ...CFG, ctxK: null, fiveH: null, fable: 90 })
  let used = 80
  const calls = usageWorld(on, () => ({
    status: 200,
    text: JSON.stringify({ limits: [{ kind: 'weekly_scoped', percent: used, scope: { model: { display_name: 'Fable' } } }] }),
  }))
  await $.session.start(START)
  await fableSteps($, 1, () => {})
  expect(calls.length).toBe(1)
  used = 95
  await fableSteps($, 1, () => {})
  expect(calls.length).toBe(1)
  expect(w.submits).toEqual([])
  await w.clock.advance(5 * 60_000)
  await fableSteps($, 1, () => {})
  expect(calls.length).toBe(2)
  expect(w.submits).toEqual(['【到线提醒】Fable 周额度 95%（线 90%）。停下'])
})

test('长期令牌：接口回 403，不发、记下原因、半天内不再问', async ($, on) => {
  const w = world(on, { ...CFG, ctxK: null, fiveH: null, fable: 90 })
  const calls = usageWorld(on, () => ({ status: 403, text: '{"error":"forbidden"}' }))
  await $.session.start(START)
  await fableSteps($, 3, () => {})
  expect(calls.length).toBe(1)
  expect(w.submits).toEqual([])
})
