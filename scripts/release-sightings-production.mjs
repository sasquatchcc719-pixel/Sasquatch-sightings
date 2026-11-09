import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const project = 'sasquatch-sightings'
const projectId = 'prj_PphEUJgBgH2nIKV1cK3SDvfidck7'
const teamId = 'team_D7ctjr1ny4gEtNdbkm5ksPT1'
const productionUrl = 'https://sightings.sasquatchcarpet.com'
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const argumentsSet = new Set(
  process.argv.slice(2).filter((arg) => arg !== '--'),
)

if (argumentsSet.has('--help')) {
  console.log(`Usage: pnpm release:production -- [--deploy]

Without --deploy, verify that the exact origin/main commit is live.
With --deploy, use an authenticated clean-checkout Vercel deployment when the
Git-triggered deployment is absent, then verify the production alias.`)
  process.exit(0)
}

for (const argument of argumentsSet) {
  if (argument !== '--deploy') throw new Error(`Unknown argument: ${argument}`)
}

const mayDeploy = argumentsSet.has('--deploy')
const commandEnvironment = {
  ...process.env,
  CI: '1',
  NO_UPDATE_NOTIFIER: '1',
}

function execute(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: commandEnvironment,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: options.timeout ?? 15 * 60_000,
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with exit ${result.status}\n${output.trim()}`,
    )
  }
  return { stdout: result.stdout ?? '', output }
}

function deploymentUrlsFor(commit, statuses = 'READY') {
  const urls = new Set()
  for (const metadataKey of ['githubCommitSha', 'gitCommitSha']) {
    const { output } = execute('vercel', [
      'ls',
      project,
      '--environment',
      'production',
      '--status',
      statuses,
      '--meta',
      `${metadataKey}=${commit}`,
      '--yes',
      '--no-color',
    ])
    for (const match of output.matchAll(/https:\/\/[^\s]+\.vercel\.app/g)) {
      urls.add(match[0])
    }
  }
  return urls
}

const pause = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

async function waitForLiveAlias(commit, attempts = 5) {
  let status = deploymentIsLive(commit)
  for (let attempt = 1; !status.matches && attempt < attempts; attempt += 1) {
    await pause(2_000)
    status = deploymentIsLive(commit)
  }
  return status
}

async function waitForGitDeployment(commit, attempts = 7) {
  let deployments = new Set()
  for (
    let attempt = 0;
    deployments.size === 0 && attempt < attempts;
    attempt += 1
  ) {
    deployments = deploymentUrlsFor(commit, 'BUILDING,QUEUED,READY')
    if (deployments.size === 0 && attempt + 1 < attempts) await pause(10_000)
  }
  return deployments
}

function inspect(target, wait = false) {
  const args = ['inspect', target, '--json', '--no-color']
  if (wait) args.push('--wait', '--timeout', '10m')
  const { stdout } = execute('vercel', args)
  return JSON.parse(stdout)
}

function deploymentIsLive(commit) {
  const live = inspect(productionUrl)
  const liveUrl = `https://${live.url}`
  return {
    live,
    matches: deploymentUrlsFor(commit).has(liveUrl),
  }
}

async function smokeTest() {
  const rootResponse = await fetch(productionUrl, { redirect: 'manual' })
  if (rootResponse.status !== 200) {
    throw new Error(`${productionUrl} returned HTTP ${rootResponse.status}`)
  }
  const schedulerResponse = await fetch(
    `${productionUrl}/api/cron/scan-scheduler`,
    { redirect: 'manual' },
  )
  if (schedulerResponse.status !== 401) {
    throw new Error(
      `Unauthenticated scan scheduler returned HTTP ${schedulerResponse.status}; expected 401`,
    )
  }
}

execute('git', ['fetch', 'origin', 'main'])
const commit = execute('git', ['rev-parse', 'origin/main']).stdout.trim()
const subject = execute('git', [
  'show',
  '-s',
  '--format=%s',
  commit,
]).stdout.trim()
let status = deploymentIsLive(commit)
let deployedByFallback = false

if (!status.matches && !mayDeploy) {
  throw new Error(
    `Production does not serve origin/main ${commit.slice(0, 8)}. Run pnpm release:production -- --deploy after the release tests pass.`,
  )
}

if (!status.matches) {
  const pendingGitDeployments = await waitForGitDeployment(commit)
  for (const deploymentUrl of pendingGitDeployments) {
    try {
      const deployment = inspect(deploymentUrl, true)
      if (
        deployment.readyState === 'READY' &&
        deployment.target === 'production'
      ) {
        status = await waitForLiveAlias(commit)
        if (status.matches) break
      }
    } catch (error) {
      console.error(
        `Git deployment ${deploymentUrl} did not become ready; using the clean fallback.`,
        error,
      )
    }
  }
}

if (!status.matches) {
  execute('vercel', ['whoami', '--no-color'])
  const worktree = mkdtempSync(join(tmpdir(), 'sightings-release-'))
  try {
    execute('git', ['worktree', 'add', '--detach', worktree, commit])
    const vercelDirectory = join(worktree, '.vercel')
    mkdirSync(vercelDirectory, { recursive: true })
    writeFileSync(
      join(vercelDirectory, 'project.json'),
      `${JSON.stringify({ projectId, orgId: teamId, projectName: project })}\n`,
      { mode: 0o600 },
    )
    const { output } = execute(
      'vercel',
      ['deploy', '--prod', '--yes', '--no-color'],
      { cwd: worktree },
    )
    const deploymentUrl = output.match(
      /https:\/\/sasquatch-sightings-[^\s]+\.vercel\.app/,
    )?.[0]
    if (!deploymentUrl) {
      throw new Error(
        `Vercel did not return a deployment URL\n${output.trim()}`,
      )
    }
    const deployment = inspect(deploymentUrl, true)
    if (
      deployment.readyState !== 'READY' ||
      deployment.target !== 'production'
    ) {
      throw new Error(
        `${deploymentUrl} ended as ${deployment.readyState ?? 'unknown'} for ${deployment.target ?? 'unknown'} target`,
      )
    }
    deployedByFallback = true
  } finally {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', worktree], {
        cwd: root,
        env: commandEnvironment,
        stdio: 'ignore',
      })
    } finally {
      rmSync(worktree, { recursive: true, force: true })
    }
  }
  status = await waitForLiveAlias(commit)
  if (!status.matches) {
    throw new Error(
      `Deployment completed, but ${productionUrl} is not assigned to ${commit.slice(0, 8)}`,
    )
  }
}

await smokeTest()
console.log(
  JSON.stringify(
    {
      status: 'READY',
      target: 'production',
      commit,
      subject,
      deployment: `https://${status.live.url}`,
      production: productionUrl,
      fallback: deployedByFallback,
      smoke: { root: 200, unauthenticated_scheduler: 401 },
    },
    null,
    2,
  ),
)
