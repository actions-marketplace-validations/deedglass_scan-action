// The workflow_run half (S47 §3.5): never checks out PR code; reads the artifact as hostile data;
// resolves the PR from trusted event data; re-derives touched paths from the API; upserts one
// sticky comment. Every URL is built from GITHUB_REPOSITORY: it can't reach another repository.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { touched as touchedOf } from './paths.mjs';
import { MARKER, render } from './render.mjs';
import { parseResult } from './validate.mjs';

const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export function api(repo, path) {
  if (!REPO_RE.test(repo)) throw new Error('bad GITHUB_REPOSITORY');
  if (!path.startsWith('/') || path.includes('..') || /^\/\//.test(path)) throw new Error('bad path');
  return `https://api.github.com/repos/${repo}${path}`;
}

export async function run(env, fetchImpl = fetch) {
  const repo = env.GITHUB_REPOSITORY;
  const gh = async (method, path, body) => {
    const r = await fetchImpl(api(repo, path), {
      method,
      headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'deedglass-scan-action' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status}`);
    return r.status === 204 ? null : r.json();
  };
  const file = join(env.RUNNER_TEMP ?? '/tmp', 'dg-artifact', 'result.json');
  if (!existsSync(file)) return { done: 'no-artifact' };
  const result = parseResult(readFileSync(file, 'utf8'));

  // 1. The PR, from trusted data only.
  let pr = null;
  const prs = JSON.parse(env.DG_PRS || '[]');
  if (Array.isArray(prs) && prs.length === 1 && Number.isInteger(prs[0]?.number)) pr = prs[0].number;
  if (pr === null) {
    if (!/^[A-Za-z0-9._-]+$/.test(env.DG_HEAD_OWNER ?? '') || !/^[A-Za-z0-9._\/-]+$/.test(env.DG_HEAD_BRANCH ?? '')) return { done: 'no-pr' };
    const list = await gh('GET', `/pulls?state=open&head=${encodeURIComponent(`${env.DG_HEAD_OWNER}:${env.DG_HEAD_BRANCH}`)}&per_page=10`);
    const match = (list ?? []).filter((p) => p?.head?.sha === env.DG_HEAD_SHA);
    if (match.length !== 1) return { done: 'no-pr' };
    pr = match[0].number;
  }
  // 2. Touched paths, from the API (the artifact's own list is ignored).
  const files = await gh('GET', `/pulls/${pr}/files?per_page=100`);
  const touched = touchedOf((files ?? []).map((f) => f.filename));
  if (!touched.length) return { done: 'untouched', pr };
  // A forged entitled: true on a private repo gets one free comment: an accepted, documented risk.
  if (env.DG_PRIVATE === 'true' && !result.entitled) return { done: 'private-not-entitled', pr };
  // 3. Render and upsert.
  const body = render({ ...result, touched }, { runUrl: `https://github.com/${repo}/actions/runs/${env.DG_RUN_ID}` });
  const comments = await gh('GET', `/issues/${pr}/comments?per_page=100`);
  const mine = (comments ?? []).find((c) => c?.user?.login === 'github-actions[bot]' && typeof c.body === 'string' && c.body.startsWith(MARKER));
  if (mine) {
    await gh('PATCH', `/issues/comments/${mine.id}`, { body });
    return { done: 'edited', pr };
  }
  await gh('POST', `/issues/${pr}/comments`, { body });
  return { done: 'posted', pr };
}

if (process.argv[1] && process.argv[1].endsWith('comment.mjs')) {
  run(process.env).then((r) => console.log(`✓ ${r.done}${r.pr ? ` · #${r.pr}` : ''}`), (e) => { console.error(`✕ ${e.message}`); process.exit(1); });
}
