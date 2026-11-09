// Host side of Model Prices. Magpie loads this in the plugin host (Bun),
// so it can read ~/.cache/magpie and write a fresh snapshot beside the
// page. The sandboxed page cannot fetch or call localhost; it may only
// reload its own files. Pattern follows Agent Office's live.js approach.
import { createRequire } from "node:module"
import { mkdirSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const matcher = require("./matcher.js")

const here = dirname(fileURLToPath(import.meta.url))
const PAGE = process.env.MAGPIE_MODELS_PRICE_PAGE || join(here, "page")
const LIVE = join(PAGE, "models-live.js")
// models change rarely; keep the file fresh without hammering disk
const EVERY = 5000

let last = ""
let ticking = null
let lastError = ""

export function snapshotPath() {
  return LIVE
}

export function writeSnapshot() {
  try {
    const report = matcher.scanAll()
    const generatedAt = new Date().toISOString().slice(0, 10)
    const body =
      "window.__MAGPIE_MODELS_DATA__ = " + JSON.stringify(report) + ";\n" +
      "window.__MAGPIE_MODELS_DATA_AT__ = " + JSON.stringify(generatedAt) + ";\n" +
      "window.__MAGPIE_MODELS_DATA_LIVE__ = true;\n"
    if (body === last) {
      lastError = ""
      return { ok: true, count: report.length, unchanged: true, at: generatedAt }
    }
    mkdirSync(PAGE, { recursive: true })
    const tmp = LIVE + ".tmp"
    writeFileSync(tmp, body, "utf8")
    renameSync(tmp, LIVE)
    last = body
    lastError = ""
    return { ok: true, count: report.length, unchanged: false, at: generatedAt }
  } catch (e) {
    lastError = String(e && e.message || e)
    return { ok: false, error: lastError }
  }
}

export function start() {
  if (ticking) return
  writeSnapshot()
  ticking = setInterval(writeSnapshot, EVERY)
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
// Returning undefined leaves the request unchanged.
export async function onRequest(_body, ctx) {
  start()
  writeSnapshot()
  ctx.report?.("skipped")
  return undefined
}

// Start watching as soon as the host loads this module (not in tests).
if (!process.env.MAGPIE_MODELS_PRICE_PAGE) {
  start()
}
