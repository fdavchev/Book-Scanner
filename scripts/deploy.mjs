/**
 * Publishes `dist/` to the `gh-pages` branch of this repository, giving the app a normal
 * https:// address that a phone can install from with no laptop involved.
 *
 *   npm run deploy
 *
 * It builds for you, with the right base path: a GitHub Pages project site is served from
 * https://user.github.io/<repo>/, not from the root, so every URL in the app has to be
 * prefixed with /<repo>/. Building by hand and deploying that would produce a blank page.
 *
 * The build is static files, so any host works — this script just automates the free
 * option. It refuses to run on a dirty tree, and never touches the working branch.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const BRANCH = 'gh-pages'

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function fail(message) {
  console.error(`deploy: ${message}`)
  process.exit(1)
}

try {
  git('rev-parse', '--is-inside-work-tree')
} catch {
  fail('this folder is not a git repository')
}

if (git('status', '--porcelain')) {
  fail('the working tree has uncommitted changes — commit or stash them first')
}

let remote
try {
  remote = git('remote', 'get-url', 'origin')
} catch {
  fail(
    'no `origin` remote is configured.\n' +
      '  Create an empty repository on GitHub, then:\n' +
      '    git remote add origin https://github.com/<you>/<repo>.git\n' +
      '    git push -u origin main\n' +
      '  and run this again.',
  )
}

const repoMatch = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(remote)
if (!repoMatch) fail(`could not read a GitHub repository name out of "${remote}"`)
const [, owner, repo] = repoMatch
const base = `/${repo}/`

console.log(`deploy: building for ${base}`)
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, VITE_BASE: base },
})
if (!existsSync(dist)) fail('the build produced no dist/ folder')

console.log(`deploy: publishing dist/ to ${BRANCH} on ${remote}`)

// A temporary worktree keeps the current branch and working tree untouched.
const worktree = join(root, '.deploy-worktree')
try {
  try {
    git('worktree', 'remove', '--force', worktree)
  } catch {
    // Nothing to clean up.
  }
  try {
    git('fetch', 'origin', BRANCH)
    git('worktree', 'add', '-B', BRANCH, worktree, `origin/${BRANCH}`)
  } catch {
    git('worktree', 'add', '--detach', worktree)
    execFileSync('git', ['checkout', '--orphan', BRANCH], { cwd: worktree, stdio: 'inherit' })
  }

  execFileSync('git', ['rm', '-rf', '--ignore-unmatch', '.'], { cwd: worktree, stdio: 'inherit' })
  execFileSync(
    process.platform === 'win32' ? 'xcopy' : 'cp',
    process.platform === 'win32' ? [dist, worktree, '/E', '/I', '/Y', '/Q'] : ['-r', `${dist}/.`, worktree],
    { stdio: 'inherit' },
  )
  // Without this GitHub Pages runs the files through Jekyll, which silently drops
  // anything whose name starts with an underscore.
  writeFileSync(join(worktree, '.nojekyll'), '')
  execFileSync('git', ['add', '-A'], { cwd: worktree, stdio: 'inherit' })
  execFileSync('git', ['commit', '-m', `Deploy ${new Date().toISOString()}`], {
    cwd: worktree,
    stdio: 'inherit',
  })
  execFileSync('git', ['push', 'origin', BRANCH, '--force'], { cwd: worktree, stdio: 'inherit' })

  console.log(`\ndeploy: done. Enable Pages for the ${BRANCH} branch, then open:`)
  console.log(`  https://${owner}.github.io/${repo}/`)
} finally {
  try {
    git('worktree', 'remove', '--force', worktree)
  } catch {
    // Left in place for inspection if removal fails.
  }
}
