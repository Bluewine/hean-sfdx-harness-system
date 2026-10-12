/**
 * Token meter for the status line: adds up the token counts the API reported
 * for every turn of the session, subagents included, and for each request of
 * the current main turn, and writes them where the status line reads them.
 *
 * A mod, because only a mod receives each turn's and each request's usage. The
 * status line row is no render site a mod can draw in, so the row stays a
 * statusLine command (assets/statusline/statusline-command.mjs) and this file
 * only supplies its numbers.
 *
 * A main turn's usage sums the main loop's responses only, and each subagent
 * run is its own turn.complete, so adding every turn.complete counts each
 * response once.
 *
 * The status line creates the meter folder and prunes it: $.fs can neither
 * create a folder nor delete a file.
 */

const SESSION_ID = /^[A-Za-z0-9._-]+$/

let totals = fresh()
let file = null

function fresh() {
  return { new: 0, cached: 0, turn: { up: 0, down: 0 } }
}

// Claude Code's configuration folder, resolved as scripts/lib/paths.mjs
// resolves it; that module needs Node APIs, which a hooks module does not have.
async function configDir($) {
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || ''
  const override = ((await $.env.get('CLAUDE_CONFIG_DIR')) ?? '').trim()
  if (!override) return `${home}/.claude`
  if (override.startsWith('~')) return `${home}/${override.slice(1).replace(/^[/\\]/, '')}`
  return /^([/\\]|[A-Za-z]:)/.test(override) ? override : `${home}/${override}`
}

async function meterFile($) {
  if (file !== null) return file
  const id = String(await $.session.id())
  file = SESSION_ID.test(id) && !id.startsWith('.') ? `${await configDir($)}/hean-harness/meter/${id}.json` : ''
  return file
}

// Start from the file this session already has, so a resumed session keeps its count.
async function load($) {
  totals = fresh()
  file = null
  try {
    const path = await meterFile($)
    if (!path || !(await $.fs.exists(path))) return
    const saved = JSON.parse(String(await $.fs.read(path)))
    const n = v => (Number.isFinite(v) && v >= 0 ? v : 0)
    totals = { new: n(saved.new), cached: n(saved.cached), turn: { up: n(saved.turn?.up), down: n(saved.turn?.down) } }
  } catch {
    totals = fresh()
  }
}

async function save($) {
  try {
    const path = await meterFile($)
    if (path) await $.fs.write(path, JSON.stringify({ ...totals, updatedAt: Date.now() }))
  } catch {
    // the status line keeps showing the figures it last read
  }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await load($)
    return next(e)
  })

  // /clear and /branch start a new session id; /resume returns to an old one.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await load($)
    return next(e)
  })

  // turn.start fires for the main loop only.
  on('turn.start', async ($, e, next) => {
    totals.turn = { up: 0, down: 0 }
    await save($)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const u = result?.usage
    if (!e.agentId && u) {
      totals.turn.up += u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens
      totals.turn.down += u.output_tokens
      await save($)
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    if (u) {
      totals.new += u.input_tokens + u.cache_creation_input_tokens + u.output_tokens
      totals.cached += u.cache_read_input_tokens
      await save($)
    }
    return next(e)
  })
}
