import { expect, mock, test } from 'claude-code/testing'

const FILE = '/home/u/.claude/hean-harness/meter/sess-1.json'
const usage = (input: number, write: number, read: number, output: number) => ({
  input_tokens: input, cache_creation_input_tokens: write, cache_read_input_tokens: read, output_tokens: output,
  model: 'claude-test'
})

// Answers every call the mod makes; returns the files it wrote, by path.
function stub(on: any, { env = { HOME: '/home/u' }, files = new Map<string, string>(), stepUsage = null as any } = {}) {
  mock.env(on, env)
  on('session.id', () => ({ value: 'sess-1' }))
  on('fs.exists', ($: any, e: any) => ({ value: files.has(e.path) }))
  on('fs.read', ($: any, e: any) => ({ value: files.get(e.path) ?? '' }))
  on('fs.write', ($: any, e: any) => { files.set(e.path, e.text); return { value: undefined } })
  on('session.start', () => ({ cwd: '/work' }))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* ($: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: stepUsage }
  })
  return files
}

async function step($: any, extra: object = {}) {
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-test', messageCount: 1, ...extra })
  let s = await stream.next()
  while (s.done !== true) s = await stream.next()
  return s.value
}

const read = (files: Map<string, string>, path = FILE) => JSON.parse(files.get(path) ?? '{}')

test('each request of the main turn adds to up and down, and a new turn starts at 0', async ($, on) => {
  const files = stub(on, { stepUsage: usage(10, 100, 1000, 50) })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await step($)
  await step($, { index: 1 })
  expect(read(files).turn).toEqual({ up: 2220, down: 100 })
  await $.turn.start({ text: 'again', turnId: 't2' })
  expect(read(files).turn).toEqual({ up: 0, down: 0 })
})

test('a subagent request leaves the main turn alone', async ($, on) => {
  const files = stub(on, { stepUsage: usage(10, 100, 1000, 50) })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await step($)
  await step($, { index: 1, agentId: 'a1' })
  expect(read(files).turn).toEqual({ up: 1110, down: 50 })
})

test('every turn, main and subagent, adds to new and cached; a turn with no usage adds nothing', async ($, on) => {
  const files = stub(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, usage: usage(2, 300, 4000, 50) })
  await $.turn.complete({ turnId: 's1', answer: '', durationMs: 1, isAborted: false, agentId: 'a1', usage: usage(1, 100, 1000, 20) })
  await $.turn.complete({ turnId: 't2', answer: '', durationMs: 1, isAborted: true, usage: null })
  const m = read(files)
  expect(m.new).toBe(473)
  expect(m.cached).toBe(5000)
})

test('a resumed session continues from the meter file it already has', async ($, on) => {
  const files = new Map([[FILE, JSON.stringify({ new: 1000, cached: 9000, turn: { up: 5, down: 6 }, updatedAt: 1 })]])
  stub(on, { files })
  on('classic.SessionStart', () => ({}))
  await $.classic.SessionStart({ source: 'resume' })
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, usage: usage(0, 0, 1000, 10) })
  const m = read(files)
  expect(m.new).toBe(1010)
  expect(m.cached).toBe(10000)
})

test('CLAUDE_CONFIG_DIR moves the meter file as it moves the status line\'s', async ($, on) => {
  const files = stub(on, { env: { HOME: '/home/u', CLAUDE_CONFIG_DIR: '~/alt' } })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, usage: usage(1, 1, 1, 1) })
  expect(files.has('/home/u/alt/hean-harness/meter/sess-1.json')).toBe(true)
})

test('without HOME, USERPROFILE locates the meter file', async ($, on) => {
  const files = stub(on, { env: { USERPROFILE: 'C:/Users/u' } })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, usage: usage(1, 1, 1, 1) })
  // The test file system resolves a drive-letter path against the plugin folder, so match the end.
  const written = [...files.keys()]
  expect(written.length).toBe(1)
  expect(written[0].endsWith('C:/Users/u/.claude/hean-harness/meter/sess-1.json')).toBe(true)
})

// ── The org strip above the prompt ───────────────────────────────────────────

const ORGS = '/home/u/.claude/hean-harness/meter/sess-1.orgs.json'
const BAND = {
  plugin: 'hean-harness',
  surface: 'terminal' as const,
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} }
}
const LIST = JSON.stringify({ orgs: ['🛠️ dev:d🔓[work-A]', '🧪 qa:q🔒[integration]', '🔭 research:r🔒'], more: 2, updatedAt: 1 })

// The engine draws nothing of its own in the band; the test's hook stands for that, or for a mod after ours.
function beneath(on: any, text: string | null = null) {
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => {
    const { Box, Text } = $.ui.resolve(e)
    return text === null ? Box({ children: [] }) : Text({ children: [text] })
  })
}

const rowsOf = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((t: any) => t.text).filter((t: string) => t.includes(':'))

test('closed, the strip is one button with the count of other connected orgs', async ($, on) => {
  stub(on, { files: new Map([[ORGS, LIST]]) })
  beneath(on)
  const ui = await $.ui.mount(BAND)
  const button = await ui.find({ key: 'hean-orgs' })
  expect(button?.props.label).toBe('[9] orgs (+2)')
  expect(button?.props.hotkey).toBe('9')
  expect(await rowsOf(ui)).toEqual([])
  await ui.unmount()
})

test('the strip sits at the right end of the band, closed and open', async ($, on) => {
  stub(on, { files: new Map([[ORGS, LIST]]) })
  beneath(on)
  const ui = await $.ui.mount(BAND)
  const strip = async () => await ui.find({ type: 'Box', key: 'hean-orgs-strip' })
  expect((await strip())?.props.alignItems).toBe('flex-end')
  expect((await strip())?.props.flexDirection).toBe('column')
  await ui.press({ key: 'hean-orgs' })
  expect((await strip())?.props.alignItems).toBe('flex-end')
  expect(await rowsOf(ui)).toHaveLength(3)
  await ui.unmount()
})

test('the strip box is as wide as the band, closed and open', async ($, on) => {
  stub(on, { files: new Map([[ORGS, LIST]]) })
  beneath(on)
  const ui = await $.ui.mount(BAND)
  const band = async () => await ui.find({ type: 'Box', key: 'hean-orgs-band' })
  expect((await band())?.props.width).toBe(100)
  await ui.press({ key: 'hean-orgs' })
  expect((await band())?.props.width).toBe(100)
  await ui.unmount()
})

test('without a usable bodyColumns the band box takes the full width', async ($, on) => {
  stub(on, { files: new Map([[ORGS, LIST]]) })
  beneath(on)
  for (const bodyColumns of [undefined, 0, -3, 'x']) {
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns } })
    expect((await ui.find({ type: 'Box', key: 'hean-orgs-band' }))?.props.width).toBe('100%')
    await ui.press({ key: 'hean-orgs' })
    expect((await ui.find({ type: 'Box', key: 'hean-orgs-band' }))?.props.width).toBe('100%')
    await ui.unmount()
  }
})

test('what another mod draws sits outside the strip box', async ($, on) => {
  stub(on, { files: new Map([[ORGS, LIST]]) })
  beneath(on, 'from another mod')
  const ui = await $.ui.mount(BAND)
  const strip = await ui.find({ type: 'Box', key: 'hean-orgs-strip' })
  expect(strip?.text).toContain('[9] orgs')
  expect(strip?.text).not.toContain('from another mod')
  expect(await ui.find({ type: 'Text', text: 'from another mod' })).toBeDefined()
  await ui.unmount()
})

test('pressing the button lists every saved org, and pressing it again closes the list', async ($, on) => {
  stub(on, { files: new Map([[ORGS, LIST]]) })
  beneath(on)
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'hean-orgs' })
  expect(await rowsOf(ui)).toEqual(['🛠️ dev:d🔓[work-A]', '🧪 qa:q🔒[integration]', '🔭 research:r🔒'])
  expect((await ui.find({ key: 'hean-orgs' }))?.props.label).toBe('[9] hide orgs')
  await ui.press({ key: 'hean-orgs' })
  expect(await rowsOf(ui)).toEqual([])
  expect((await ui.find({ key: 'hean-orgs' }))?.props.label).toBe('[9] orgs (+2)')
  await ui.unmount()
})

test('the strip reads the file again when it redraws', async ($, on) => {
  const files = stub(on, { files: new Map([[ORGS, LIST]]) })
  beneath(on)
  const ui = await $.ui.mount(BAND)
  files.set(ORGS, JSON.stringify({ orgs: ['🛠️ dev:d🔓'], more: 1 }))
  await ui.redraw()
  expect((await ui.find({ key: 'hean-orgs' }))?.props.label).toBe('[9] orgs (+1)')
  await ui.unmount()
})

const unreadable: [string, Map<string, string>][] = [
  ['half written', new Map([[ORGS, '{"orgs": [']])],
  ['not the expected shape', new Map([[ORGS, '{"orgs": "x", "more": 1}']])]
]
for (const [what, files] of unreadable) {
  test(`an org list that is ${what} shows only the button, with an unknown count`, async ($, on) => {
    stub(on, { files })
    beneath(on)
    const ui = await $.ui.mount(BAND)
    expect((await ui.find({ key: 'hean-orgs' }))?.props.label).toBe('[9] orgs (+?)')
    await ui.press({ key: 'hean-orgs' })
    expect(await rowsOf(ui)).toEqual([])
    expect((await ui.find({ key: 'hean-orgs' }))?.props.label).toBe('[9] orgs (+?)')
    await ui.unmount()
  })
}

test('a missing org list draws nothing', async ($, on) => {
  stub(on, { files: new Map() })
  beneath(on)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'hean-orgs' })).toBeUndefined()
  await ui.unmount()
})

test('a new session starts with the strip closed', async ($, on) => {
  stub(on, { files: new Map([[ORGS, LIST]]) })
  beneath(on)
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'hean-orgs' })
  expect((await ui.find({ key: 'hean-orgs' }))?.props.label).toBe('[9] hide orgs')
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await ui.redraw()
  expect((await ui.find({ key: 'hean-orgs' }))?.props.label).toBe('[9] orgs (+2)')
  await ui.unmount()
})

test('a session with no saved org roles draws nothing', async ($, on) => {
  stub(on, { files: new Map([[ORGS, JSON.stringify({ orgs: [], more: 0 })]]) })
  beneath(on)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'hean-orgs' })).toBeUndefined()
  await ui.unmount()
})

test('what another mod draws in the band stays, beside the strip', async ($, on) => {
  stub(on, { files: new Map([[ORGS, LIST]]) })
  beneath(on, 'from another mod')
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: 'from another mod' })).toBeDefined()
  expect((await ui.find({ key: 'hean-orgs' }))?.props.label).toBe('[9] orgs (+2)')
  await ui.unmount()
})

test('a survey in the band is left alone', async ($, on) => {
  stub(on, { files: new Map([[ORGS, LIST]]) })
  beneath(on)
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true } })
  expect(await ui.find({ key: 'hean-orgs' })).toBeUndefined()
  await ui.unmount()
})
