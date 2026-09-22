import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const rawArgs = process.argv.slice(2)
const fileArgs = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs

if (fileArgs.length === 0) {
  console.error(
    'Refusing to run every live integration test. Pass one or more exact *.integration.test.* file paths.',
  )
  process.exit(2)
}

for (const file of fileArgs) {
  if (
    file.startsWith('-') ||
    !file.includes('.integration.test.') ||
    !existsSync(path.resolve(file))
  ) {
    console.error(`Refusing unsafe integration-test selector: ${file}`)
    process.exit(2)
  }
}

const vitest = path.resolve(
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vitest.cmd' : 'vitest',
)
const result = spawnSync(
  vitest,
  ['run', '--config', 'vitest.integration.config.ts', ...fileArgs],
  { env: process.env, stdio: 'inherit' },
)

if (result.error) throw result.error
process.exit(result.status ?? 1)
