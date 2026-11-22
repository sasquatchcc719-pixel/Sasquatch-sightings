import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const canonicalRepository =
  'https://github.com/sasquatchcc719-pixel/Sasquatch-sightings.git'

export function verifyProductionSource(env, remoteMain) {
  const expected = /^([a-f0-9]{40})\s+refs\/heads\/main$/.exec(
    remoteMain.trim(),
  )?.[1]
  if (!expected)
    throw new Error('Could not verify the current Sightings main commit.')
  const source = env.VERCEL_GIT_COMMIT_SHA || env.SIGHTINGS_RELEASE_SHA
  if (
    !source ||
    source !== expected ||
    (env.SIGHTINGS_RELEASE_SHA && env.SIGHTINGS_RELEASE_SHA !== expected)
  ) {
    throw new Error(
      'Production requires the current origin/main commit. Merge the tested changes into main and use pnpm release:production -- --deploy.',
    )
  }
  return expected
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const remoteMain = execFileSync(
    'git',
    [
      'ls-remote',
      '--exit-code',
      '--refs',
      canonicalRepository,
      'refs/heads/main',
    ],
    {
      encoding: 'utf8',
      timeout: 20000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    },
  )
  console.log(
    'Verified production source',
    verifyProductionSource(process.env, remoteMain),
  )
}
