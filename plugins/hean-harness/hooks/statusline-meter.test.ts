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
