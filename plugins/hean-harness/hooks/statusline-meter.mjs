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
 *
 * This module also draws the org strip in the band above the prompt. Row 2 of
 * the status line shows only the deploy-target orgs; the strip opens the full
 * list on its [9] button. The list comes from <session>.orgs.json, which the
 * status line writes beside the meter file: the mod has no Node APIs to read
 * the org roles or the sf CLI's logins itself.
 */

const SESSION_ID = /^[A-Za-z0-9._-]+$/

let totals = fresh()
let file = null
let stripOpen = false

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

// The org list the status line last wrote. A missing file is an empty list, so
// the strip draws nothing; null means the file exists but cannot be read or parsed.
async function readOrgList($) {
  try {
    const meter = await meterFile($)
    if (!meter) return null
    const path = meter.replace(/\.json$/, '.orgs.json')
    if (!(await $.fs.exists(path))) return { orgs: [], more: 0 }
    const saved = JSON.parse(String(await $.fs.read(path)))
    const ok = Array.isArray(saved?.orgs) && saved.orgs.every(o => typeof o === 'string') &&
      Number.isInteger(saved.more) && saved.more >= 0
    return ok ? { orgs: saved.orgs, more: saved.more } : null
  } catch {
    return null
  }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    stripOpen = false
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

  // The org strip. A digit hotkey on a band button also fires when 9 is typed
  // alone into an empty prompt, so [9] opens and closes it without focusing the band.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props?.hasSurvey) return next(e)
    const list = await readOrgList($)
    if (list && list.orgs.length === 0) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const open = stripOpen && list !== null
    const label = list === null ? '[9] orgs (+?)' : open ? '[9] hide orgs' : `[9] orgs (+${list.more})`
    const toggle = Button({
      key: 'hean-orgs',
      label,
      hotkey: '9',
      // With no list to show, a press only reads the file again.
      onPress: () => {
        stripOpen = list === null ? false : !stripOpen
        $.ui.invalidate('ui.render')
      },
    })
    // What the mods after this one draw in the band stays, under the strip.
    const theirs = await next(e)
    const rows = open ? list.orgs.map(org => Text({ children: [org] })) : []
    // The strip's own box is right-aligned; the other mods' content keeps the band's left edge.
    const strip = Box({ key: 'hean-orgs-strip', flexDirection: 'column', alignItems: 'flex-end', children: [...rows, toggle] })
    // alignItems reaches the band's right edge only if this box is as wide as the band.
    const cols = e.props?.bodyColumns
    const width = typeof cols === 'number' && cols > 0 ? cols : '100%'
    return Box({ key: 'hean-orgs-band', flexDirection: 'column', width, children: [strip, ...(theirs ? [theirs] : [])] })
  })
}
