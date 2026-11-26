#!/usr/bin/env node
// Lists, searches and checks the "@find" comment tags (full guide: FIND-TAGS.md, kept locally).
//
// Tag format, one line just above the code it names, words from wide to narrow so a VS Code search
// (Ctrl+Shift+F) narrows as you type: "@find hiring-posts" → "@find hiring-posts filters" → "... location".
//   // @find page part thing layer [role] — short note
//   (inside JSX the same text goes in a JSX comment block)
// page:  URL without ids (hiring-posts, hiring-post-detail, my-hiring-posts, wallet, ...); shared; app
// part:  page | hero | search | filters | results | card | pagination | form | dialog | header | ...
// thing: the field or action (location, keyword, apply, sort, ...)
// layer: ui | state | url | api | cache | logic | validation | server | seo | access
// role:  all | guest | signed-in | candidate | recruiter | admin | owner   (several: [candidate,recruiter])
// Example: @find hiring-posts filters location ui [all] — Location group in the filter column
//   node scripts/find-tags.mjs                 → index of every tag, grouped by page
//   node scripts/find-tags.mjs hiring location → tags that contain every word (any order, any case)
//   node scripts/find-tags.mjs --check         → exit 1 if a tag breaks the format
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const SRC = join(root, 'src')
export const ROLES = ['all', 'guest', 'signed-in', 'candidate', 'recruiter', 'admin', 'owner']
export const LAYERS = ['ui', 'state', 'url', 'api', 'cache', 'logic', 'validation', 'server', 'seo', 'access']
const WORD = '[a-z0-9]+(?:-[a-z0-9]+)*'
// page part thing layer [role(,role)] — note
export const TAG = new RegExp(
  `@find (${WORD}) (${WORD}) (${WORD}) (${WORD}) \\[(${WORD}(?:,${WORD})*)\\](?: — (.+?))?\\s*(?:\\*/\\}?)?\\s*$`,
)

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* files(path)
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) yield path
  }
}

/** Every @find line in src: { file, line, text, parts | null, problem }. */
export function collectTags(dir = SRC) {
  const found = []
  for (const file of files(dir)) {
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((source, index) => {
      const at = source.indexOf('@find ')
      if (at < 0) return
      const text = source.slice(at).replace(/\s*\*\/\}?\s*$/, '').trim()
      const match = TAG.exec(source.slice(at))
      let problem = match ? null : 'format: @find page part thing layer [role] — note'
      let parts = null
      if (match) {
        const [, page, part, thing, layer, roles, note] = match
        parts = { roles: roles.split(','), page, part, thing, layer, note: note ?? '' }
        const badRole = parts.roles.find((role) => !ROLES.includes(role))
        if (badRole) problem = `unknown role "${badRole}" (use ${ROLES.join(', ')})`
        else if (!LAYERS.includes(layer)) problem = `unknown layer "${layer}" (use ${LAYERS.join(', ')})`
      }
      found.push({ file: relative(root, file).split(sep).join('/'), line: index + 1, text, parts, problem })
    })
  }
  return found
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const args = process.argv.slice(2)
  const tags = collectTags()
  if (args.includes('--check')) {
    const bad = tags.filter((tag) => tag.problem)
    for (const tag of bad) console.error(`${tag.file}:${tag.line}  ${tag.problem}\n    ${tag.text}`)
    console.log(`${tags.length} tags, ${bad.length} with problems`)
    process.exit(bad.length ? 1 : 0)
  }
  const words = args.map((word) => word.toLowerCase())
  const hits = tags.filter((tag) => words.every((word) => tag.text.toLowerCase().includes(word)))
  const byPage = new Map()
  for (const tag of hits) {
    const page = tag.parts?.page ?? '?'
    if (!byPage.has(page)) byPage.set(page, [])
    byPage.get(page).push(tag)
  }
  for (const [page, list] of [...byPage].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`\n## ${page}`)
    for (const tag of list) console.log(`${tag.file}:${tag.line}  ${tag.text.replace(/^@find /, '')}`)
  }
  console.log(`\n${hits.length} of ${tags.length} tags`)
}
