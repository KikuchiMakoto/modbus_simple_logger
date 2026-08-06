#!/usr/bin/env bun
// Publish dist/ to the `gh-pages` branch.
//
// GitHub Pages serves this repo from a BRANCH, not from an Actions artifact.
// The build that goes live is the one made here, on a developer's machine, the
// same way the launcher exe is — so what is published is a thing someone ran
// before publishing it, not a thing a runner produced from a green checkmark.
//
//   bun run deploy      # build, then publish
//
// How the commit is made: not by checking out gh-pages (that would swap the
// working tree out from under an editor, and this branch shares no history with
// main), and not by `git init` inside dist/ (which leaves a nested repo behind
// when it fails halfway). Instead the commit is assembled with plumbing against
// a THROWAWAY INDEX: add dist/ to that index, write a tree, commit-tree it with
// no parent, push the resulting object. HEAD, the real index and the working
// tree are never touched — this is safe to run with uncommitted work in
// progress.
//
// Every deploy is a fresh ORPHAN commit force-pushed over the branch, so
// gh-pages is always exactly one commit deep. The 13 MB of Pyodide under dist/
// would otherwise pile up a copy per deploy; unchanged files keep the same blob
// hashes, so a re-push of mostly-identical output costs almost nothing.

import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BRANCH = 'gh-pages';
const REMOTE = 'origin';

const run = (cmd: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): string => {
  const proc = Bun.spawnSync(cmd, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (proc.exitCode !== 0) {
    const stderr = new TextDecoder().decode(proc.stderr).trim();
    throw new Error(`${cmd.join(' ')} failed (${proc.exitCode})\n${stderr}`);
  }
  return new TextDecoder().decode(proc.stdout).trim();
};

const fail = (message: string): never => {
  console.error(`[deploy] ${message}`);
  process.exit(1);
};

const root = run(['git', 'rev-parse', '--show-toplevel']);
const dist = join(root, 'dist');

if (!existsSync(join(dist, 'index.html'))) {
  fail('dist/index.html is missing. Run `bun run build` first (or use `bun run deploy`).');
}

// The version the app will report once it is live comes from package.json at
// BUILD time, injected into sw.js. If those two disagree, dist/ is left over
// from an earlier build and publishing it would quietly ship the old bundle
// under the new version's name — the one failure of a manual deploy that is
// invisible afterwards.
const pkgVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version as string;
const builtVersion = /APP_VERSION\s*=\s*'([^']+)'/.exec(readFileSync(join(dist, 'sw.js'), 'utf8'))?.[1];
if (builtVersion !== pkgVersion) {
  fail(
    `dist/ was built from version ${builtVersion ?? '(unknown)'} but package.json says ${pkgVersion}. ` +
      'Run `bun run build` again.',
  );
}

// Branch-served Pages runs the output through Jekyll unless this file is there,
// which at best costs a minute per deploy and at worst drops paths Jekyll
// considers its own. The artifact-based deployment this replaced never ran
// Jekyll at all, so nothing upstream is thinking about it.
writeFileSync(join(dist, '.nojekyll'), '');

const head = run(['git', 'rev-parse', '--short', 'HEAD']);
const dirty = run(['git', 'status', '--porcelain']) !== '';
const message = `Deploy v${pkgVersion} (${head}${dirty ? '-dirty' : ''})`;

const indexDir = mkdtempSync(join(tmpdir(), 'msl-ghpages-'));
const env = { GIT_INDEX_FILE: join(indexDir, 'index') };
let commit: string;
try {
  // --force because dist/ is gitignored; the pathspec is resolved inside
  // dist/, so the entries land at the root of the tree (index.html, assets/…).
  run(['git', `--git-dir=${join(root, '.git')}`, '--work-tree=.', 'add', '--all', '--force', '.'], {
    cwd: dist,
    env,
  });
  const tree = run(['git', 'write-tree'], { cwd: root, env });
  // No -p: an orphan commit, which is what makes the branch one deep.
  commit = run(['git', 'commit-tree', tree, '-m', message], { cwd: root, env });
} finally {
  rmSync(indexDir, { recursive: true, force: true });
}

const fileCount = run(['git', 'ls-tree', '-r', '--name-only', commit], { cwd: root }).split('\n').length;
console.log(`[deploy] ${message} — ${fileCount} files`);

if (process.argv.includes('--dry-run')) {
  console.log(`[deploy] dry run: built commit ${commit}, not pushing`);
  process.exit(0);
}

run(['git', 'push', '--force', REMOTE, `${commit}:refs/heads/${BRANCH}`], { cwd: root });
console.log(`[deploy] pushed ${commit.slice(0, 7)} to ${REMOTE}/${BRANCH}`);
console.log('[deploy] GitHub rebuilds the site from the branch; it goes live in a minute or two.');
