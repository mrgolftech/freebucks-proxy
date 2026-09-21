#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const cfgPath = path.join(repoRoot, 'scripts', 'official-upstream-watch.json')
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
const upstreamDir = path.resolve(process.argv[2] || process.env.FREEBUFF_REFERENCE_DIR || '')

if (!upstreamDir || !fs.existsSync(path.join(upstreamDir, '.git'))) {
  console.error('usage: node scripts/check-official-drift.mjs <CodebuffAI/freebuff clone>')
  process.exit(2)
}

function git(args) {
  return execFileSync('git', ['-C', upstreamDir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

const baseline = cfg.baselineSha
git(['fetch', '--quiet', '--no-tags', 'origin', baseline])
git(['fetch', '--quiet', '--no-tags', 'origin', 'main'])
const head = git(['rev-parse', 'origin/main'])

const categoryByPath = new Map()
for (const [category, paths] of Object.entries(cfg.categories || {})) {
  for (const p of paths) {
    const set = categoryByPath.get(p) || new Set()
    set.add(category)
    categoryByPath.set(p, set)
  }
}
const watched = [...categoryByPath.keys()].sort()

if (head === baseline) {
  const msg = [
    '# Official Freebuff drift',
    '',
    `No watched drift. Baseline and origin/main are both \`${head}\`.`,
  ].join('\n')
  console.log(msg)
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, msg + '\n')
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=false\nhead=${head}\n`)
  process.exit(0)
}

let diff = ''
try {
  diff = git(['diff', '--name-status', baseline, head, '--', ...watched])
} catch (err) {
  console.error('failed to diff official upstream:', err instanceof Error ? err.message : String(err))
  process.exit(2)
}

const changed = diff
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    const parts = line.split('\t')
    const status = parts[0]
    const file = parts.at(-1)
    return { status, file, categories: [...(categoryByPath.get(file) || [])] }
  })

const grouped = new Map()
for (const row of changed) {
  for (const category of row.categories) {
    const rows = grouped.get(category) || []
    rows.push(row)
    grouped.set(category, rows)
  }
}

const lines = [
  '# Official Freebuff drift',
  '',
  `Source: ${cfg.source}`,
  `Baseline: \`${baseline}\``,
  `Current: \`${head}\``,
  '',
]

if (changed.length === 0) {
  lines.push('No watched protocol/model files changed. Unwatched upstream churn is ignored by design.')
} else {
  lines.push('Watched changes detected. Review official source before changing proxy behavior.')
  for (const category of ['SESSION', 'RUN', 'FINGERPRINT', 'MODEL_PRICE']) {
    const rows = grouped.get(category)
    if (!rows?.length) continue
    lines.push('', `## ${category}`)
    for (const row of rows) lines.push(`- ${row.status} \`${row.file}\``)
  }
  lines.push(
    '',
    'Reference implementation policy:',
    '- CodebuffAI/freebuff is the primary fact source.',
    '- trefeon/freebucks-proxy drift tooling is a design reference, not an authority.',
    '- Do not auto-port semantic changes; inspect official tests and source first.',
  )
}

const summary = lines.join('\n')
console.log(summary)
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n')
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `changed=${changed.length ? 'true' : 'false'}\nhead=${head}\nbaseline=${baseline}\n`,
  )
}

if (changed.length) {
  console.error('\nOfficial watched drift requires review.')
  process.exitCode = 3
}
