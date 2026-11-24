// Host side of Model Prices. Magpie loads this in the plugin host (Bun),
// so it can read ~/.cache/magpie and write a fresh snapshot beside the
// page. The sandboxed page cannot fetch or call localhost; it may only
// reload its own files. Pattern follows Agent Office's live.js approach.
import { createRequire } from "node:module"
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const matcher = require("./matcher.js")

const here = dirname(fileURLToPath(import.meta.url))
const PAGE = process.env.MAGPIE_MODELS_PRICE_PAGE || join(here, "page")
const LIVE = join(PAGE, "models-live.js")
// Models change rarely. Each scan costs seconds of CPU, and a rewrite inside
// the plugin folder makes Magpie restart this host, so check cheaply and often,
// rescan only when an input file changed.
const EVERY = 10000

let last = ""
let lastInputs = ""
let ticking = null
let busy = false
let lastError = ""

export function snapshotPath() {
  return LIVE
}

// Magpie restarts the plugin host when files in a local plugin's folder
// change, so a fresh host must compare with the file on disk instead of an
// empty cache, or every start rewrites the snapshot and restarts again.
function readLive() {
  try {
    return readFileSync(LIVE, "utf8")
  } catch {
    return ""
  }
}

// Compare what the snapshot shows, not the date line, so a day rollover alone
// does not rewrite the file and restart the host.
function contentOf(body) {
  return body.replace(/^window\.__MAGPIE_MODELS_DATA_AT__ = .*$/m, "")
}

function readLiveContent() {
  const text = readLive()
  if (!text) return ""
  return contentOf(text)
}

// scanAll() parses the whole models.dev catalog (about 3s of CPU), so only
// rerun it when one of the files it reads has changed. settings.json counts
// only through modelPrices, which is the part a price lookup uses.
function inputsSignature() {
  return matcher.SOURCE_PATHS.map((file) => {
    try {
      if (file === matcher.SETTINGS_PATH) return file + ":" + matcher.settingsFingerprint()
      const st = statSync(file)
      return file + ":" + st.mtimeMs + ":" + st.size
    } catch {
      return file + ":missing"
    }
  }).join("|")
}

function build() {
  const report = matcher.scanAll()
  const generatedAt = new Date().toISOString().slice(0, 10)
  const body =
    "window.__MAGPIE_MODELS_DATA__ = " + JSON.stringify(report) + ";\n" +
    "window.__MAGPIE_MODELS_DATA_AT__ = " + JSON.stringify(generatedAt) + ";\n" +
    "window.__MAGPIE_MODELS_DATA_LIVE__ = true;\n"
  return { report, at: generatedAt, body }
}

export function writeSnapshot({ force = false } = {}) {
  try {
    const inputs = force ? "" : inputsSignature()
    if (inputs && inputs === lastInputs) {
      lastError = ""
      return { ok: true, unchanged: true, skipped: true }
    }
    const { report, at, body } = build()
    const current = last ? contentOf(last) : readLiveContent()
    if (body && current === contentOf(body)) {
      last = body
      lastInputs = inputs
      lastError = ""
      return { ok: true, count: report.length, unchanged: true, at }
    }
    mkdirSync(PAGE, { recursive: true })
    const tmp = LIVE + ".tmp"
    writeFileSync(tmp, body, "utf8")
    renameSync(tmp, LIVE)
    last = body
    lastInputs = inputs
    lastError = ""
    return { ok: true, count: report.length, unchanged: false, at }
  } catch (e) {
    lastError = String(e && e.message || e)
    return { ok: false, error: lastError }
  }
}

// Keep the scan off the module-load path so the host finishes starting
// before any scan runs; overlapping ticks are dropped.
function tick() {
  if (busy) return
  busy = true
  setTimeout(() => {
    try {
      writeSnapshot()
    } finally {
      busy = false
    }
  }, 0)
}

export function start() {
  if (ticking) return
  tick()
  ticking = setInterval(tick, EVERY)
  ticking.unref?.()
}

export function stop() {
  if (ticking) clearInterval(ticking)
  ticking = null
}

export function status() {
  return { live: LIVE, lastError, running: !!ticking }
}

// Required by Magpie: gateway hooks must export onRequest.
// Returning undefined leaves the request unchanged. The interval keeps the
// snapshot fresh, so requests never pay for a rescan here.
export async function onRequest(_body, ctx) {
  start()
  ctx.report?.("skipped")
  return undefined
}

// Start watching as soon as the host loads this module (not in tests).
if (!process.env.MAGPIE_MODELS_PRICE_PAGE) {
  start()
}
