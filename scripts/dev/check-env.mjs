#!/usr/bin/env node
// Checks the three .env files (backend, frontend, AI service) before a local run.
// The mode comes from the backend NODE_ENV: "development" = run everything on this machine with hot
// reload (scripts/dev/start.ps1); anything else = production, which runs in Docker on the server.
//   node scripts/dev/check-env.mjs [--frontend <dir>] [--ai <dir>] [--quiet]
// Exit code 1 when something would break the local run (FAIL). WARN lines are advice only.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const arg = (name) => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}

/** First folder that exists: the --flag, an env variable, then the usual places next to the backend. */
function findDir(flag, envName, names) {
  const given = arg(flag) ?? process.env[envName]
  if (given) return resolve(given)
  const parent = dirname(backendDir)
  for (const name of names) {
    const candidate = resolve(parent, name)
    if (existsSync(join(candidate, '.env.example')) || existsSync(join(candidate, '.env'))) return candidate
  }
  return resolve(parent, names[0])
}
export const dirs = {
  backend: backendDir,
  frontend: findDir('--frontend', 'JOBAURA_FRONTEND_DIR', ['JobAura', 'Final_Year_Project/Frontend/JobAura', '../Final_Year_Project/Frontend/JobAura']),
  ai: findDir('--ai', 'JOBAURA_AI_DIR', ['AIService', 'Final_Year_Project/AIService', '../Final_Year_Project/AIService']),
}

/** Minimal .env reader: KEY=value, quotes removed, # comments skipped. */
export function readEnv(file) {
  if (!existsSync(file)) return null
  const env = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (!match) continue
    let value = match[2].trim()
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1)
    env[match[1]] = value
  }
  return env
}

const isLocalUrl = (value) => {
  try {
    return ['localhost', '127.0.0.1', '::1'].includes(new URL(value).hostname)
  } catch {
    return false
  }
}
const looksPlaceholder = (value) => !value || /replace-with|your-|changeme|example/i.test(value)

/** All findings: { level: 'OK'|'WARN'|'FAIL', app, message }. */
export function checkAll(d = dirs) {
  const out = []
  const add = (level, app, message) => out.push({ level, app, message })
  const backend = readEnv(join(d.backend, '.env'))
  const frontend = readEnv(join(d.frontend, '.env')) ?? readEnv(join(d.frontend, '.env.local'))
  const ai = readEnv(join(d.ai, '.env'))
  if (!backend) {
    add('FAIL', 'backend', `no .env in ${d.backend} (copy .env.example, or run scripts/dev/setup.ps1)`)
    return { mode: 'unknown', findings: out }
  }
  const mode = backend.NODE_ENV === 'development' ? 'dev' : 'prod'
  if (mode === 'prod') {
    add('WARN', 'backend', `NODE_ENV=${backend.NODE_ENV || '(empty)'}: production mode. Production runs in Docker on the server; set NODE_ENV=development to run locally.`)
    return { mode, findings: out }
  }

  // Backend
  if (!backend.DATABASE_URL) add('FAIL', 'backend', 'DATABASE_URL is empty')
  else if (!isLocalUrl(backend.DATABASE_URL.replace(/^postgres(ql)?:/, 'http:')))
    add('FAIL', 'backend', 'DATABASE_URL points to another machine; local development must use a local database')
  else add('OK', 'backend', 'DATABASE_URL is local')
  if (looksPlaceholder(backend.JWT_SECRET) || (backend.JWT_SECRET ?? '').length < 64)
    add('FAIL', 'backend', 'JWT_SECRET must be a random value of at least 64 characters')
  if (backend.PORT !== '3002') add('WARN', 'backend', `PORT=${backend.PORT}; the frontend expects 3002`)
  if (backend.FRONTEND_URL !== 'http://localhost:3000')
    add('WARN', 'backend', `FRONTEND_URL=${backend.FRONTEND_URL}; locally it should be http://localhost:3000 (CORS, cookies, mail links)`)
  if (backend.GOOGLE_CALLBACK_URL && !backend.GOOGLE_CALLBACK_URL.startsWith('http://localhost:3002/'))
    add('WARN', 'backend', 'GOOGLE_CALLBACK_URL is not the local one; Google sign-in will return to another site')
  if (looksPlaceholder(backend.GOOGLE_CLIENT_ID)) add('WARN', 'backend', 'Google sign-in is off (no GOOGLE_CLIENT_ID); email sign-in still works')
  if (backend.STRIPE_SECRET_KEY?.startsWith('sk_live_')) add('FAIL', 'backend', 'STRIPE_SECRET_KEY is a LIVE key; use an sk_test_ key')
  else if (!backend.STRIPE_SECRET_KEY) add('WARN', 'backend', 'Stripe keys empty: the top-up button is hidden')
  if (!backend.RESEND_API_KEY) add('WARN', 'backend', 'RESEND_API_KEY empty: confirm/reset mails are only logged (new sign-ups cannot confirm)')
  for (const old of ['CLOUDINARY_CLOUD_NAME', 'VNPAY_TMN_CODE'])
    if (old in backend) add('WARN', 'backend', `${old} is no longer used; it can be removed`)
  if (backend.AI_SERVICE_URL && !isLocalUrl(backend.AI_SERVICE_URL))
    add('WARN', 'backend', `AI_SERVICE_URL=${backend.AI_SERVICE_URL} is not local`)

  // Frontend
  if (!frontend) add('FAIL', 'frontend', `no .env in ${d.frontend} (copy .env.example)`)
  else {
    if (frontend.NEXT_PUBLIC_API_BASE_URL !== `http://localhost:${backend.PORT || '3002'}`)
      add('FAIL', 'frontend', `NEXT_PUBLIC_API_BASE_URL=${frontend.NEXT_PUBLIC_API_BASE_URL}; it must be http://localhost:${backend.PORT || '3002'}`)
    if (frontend.NEXT_PUBLIC_USE_SAME_ORIGIN_API !== 'false')
      add('FAIL', 'frontend', 'NEXT_PUBLIC_USE_SAME_ORIGIN_API must be false locally (there is no nginx)')
    if (frontend.BACKEND_API_BASE_URL && !isLocalUrl(frontend.BACKEND_API_BASE_URL))
      add('FAIL', 'frontend', 'BACKEND_API_BASE_URL is not local')
    if (frontend.NODE_ENV === 'production') add('WARN', 'frontend', 'NODE_ENV=production in the frontend .env; remove it (next dev sets it)')
    if (!out.some((f) => f.app === 'frontend' && f.level === 'FAIL')) add('OK', 'frontend', 'API addresses are local')
  }

  // AI service
  if (!ai) add('WARN', 'ai', `no .env in ${d.ai}: AI features answer "not ready", the rest works`)
  else {
    if (!ai.MODEL_PATH || !existsSync(ai.MODEL_PATH) || !statSync(ai.MODEL_PATH).isDirectory())
      add('FAIL', 'ai', `MODEL_PATH ${ai.MODEL_PATH || '(empty)'} is not a folder; copy the encoder model there`)
    if (ai.AI_SERVICE_API_KEY !== backend.AI_SERVICE_API_KEY)
      add('FAIL', 'ai', 'AI_SERVICE_API_KEY differs between the backend and AI .env files')
    if (!(ai.AI_CORS_ORIGINS ?? '').includes('http://localhost:3000'))
      add('WARN', 'ai', 'AI_CORS_ORIGINS does not include http://localhost:3000')
    if (ai.AI_DEVICE === 'cuda') add('WARN', 'ai', 'AI_DEVICE=cuda fails on a machine without an NVIDIA GPU; use auto')
    if (!out.some((f) => f.app === 'ai' && f.level === 'FAIL')) add('OK', 'ai', 'model folder and key are set')
  }
  return { mode, findings: out }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMain) {
  const { mode, findings } = checkAll()
  console.log(`Mode: ${mode === 'dev' ? 'development (local run)' : mode}`)
  console.log(`  backend:  ${dirs.backend}\n  frontend: ${dirs.frontend}\n  ai:       ${dirs.ai}`)
  for (const f of findings) {
    if (args.includes('--quiet') && f.level === 'OK') continue
    console.log(`${f.level.padEnd(4)} ${f.app.padEnd(8)} ${f.message}`)
  }
  const failed = findings.filter((f) => f.level === 'FAIL').length
  console.log(failed ? `${failed} problem(s) to fix before starting.` : 'Ready.')
  // Machine-readable last line for start.ps1.
  console.log(`MODE=${mode}`)
  process.exit(failed ? 1 : 0)
}
