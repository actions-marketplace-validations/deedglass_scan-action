// node --test: the diff, the strict artifact reader, the renderer and the comment upsert on a
// recorded GitHub API fake (S47 §6 Action table).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compare } from '../src/diff.mjs';
import { parseResult } from '../src/validate.mjs';
import { render, MARKER, esc } from '../src/render.mjs';
import { run, api } from '../src/comment.mjs';
import { isAgentPath } from '../src/paths.mjs';

const fx = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url)));
const head = fx('head.json');
const base = fx('base.json');
const good = () => compare(head, base, ['.cursor/mcp.json', 'README.md']);

test('compare: new findings, write paths and touched', () => {
  const r = good();
  assert.equal(r.head.grade, 'D');
  assert.equal(r.base.grade, 'A');
  assert.ok(r.new_findings.some((f) => f.id === 'database_url_in_client_args'));
  assert.deepEqual(r.touched, ['.cursor/mcp.json']);
  parseResult(JSON.stringify(r));
});

test('paths: the agent-config list', () => {
  for (const p of ['.mcp.json', '.cursor/mcp.json', '.vscode/mcp.json', 'x/claude_desktop_config.json', 'a/b/mcp_config.json', 'package.json', 'pyproject.toml', 'requirements-dev.txt', 'deedglass.yaml', 'policies/a.yaml']) assert.ok(isAgentPath(p), p);
  for (const p of ['README.md', 'src/index.ts', 'docs/mcp.md']) assert.ok(!isAgentPath(p), p);
});

test('validate: poisoned artifacts are refused', () => {
  const r = good();
  const bad = [
    { ...r, extra: 1 },
    { ...r, head: { ...r.head, grade: 'E' } },
    { ...r, fix_first: 'x'.repeat(301) },
    { ...r, new_findings: [{ id: 'Bad Id', severity: 'high', title: 't', path: 'p' }] },
    { ...r, entitled: 'yes' },
  ];
  for (const b of bad) assert.throws(() => parseResult(JSON.stringify(b)));
  assert.throws(() => parseResult('x'.repeat(300 * 1024)));
});

test('render: escaped, no HTML but the marker, links only to deedglass.com/score and the run', () => {
  const r = good();
  r.fix_first = '](javascript:alert(1)) <img src=x> @everyone';
  r.new_findings = [{ id: 'database_url_in_client_args', severity: 'medium', title: '<img src=x onerror=1>', path: 'a'.repeat(1000) }];
  const md = render(r, { runUrl: 'https://github.com/acme/agents/actions/runs/42' });
  assert.ok(md.startsWith(MARKER));
  assert.ok(!/(^|[^\\])<img/.test(md));
  assert.ok(!/@everyone/.test(md));
  assert.ok(!/\]\(javascript:/.test(md));
  assert.ok(md.includes('· …'));
  const links = [...md.matchAll(/\]\((https?:[^)]+)\)/g)].map((m) => m[1]);
  assert.deepEqual(links, ['https://deedglass.com/score', 'https://github.com/acme/agents/actions/runs/42']);
  assert.ok(md.length < 2000);
  assert.equal(esc('a`b'), 'a\\`b');
});

test('api: every URL targets GITHUB_REPOSITORY', () => {
  assert.equal(api('acme/agents', '/issues/1/comments'), 'https://api.github.com/repos/acme/agents/issues/1/comments');
  assert.throws(() => api('acme/agents/../other', '/x'));
  assert.throws(() => api('acme/agents', '/../../other/repo'));
});

function fakeGitHub({ files = ['.cursor/mcp.json'], comments = [], pulls = [] } = {}) {
  const calls = [];
  const state = { comments: [...comments], next: 100 };
  const f = async (url, init) => {
    calls.push(`${init.method} ${url}`);
    assert.ok(url.startsWith('https://api.github.com/repos/acme/agents/'), url);
    const u = new URL(url);
    const ok = (v) => ({ ok: true, status: 200, json: async () => v });
    if (u.pathname.endsWith('/files')) return ok(files.map((filename) => ({ filename })));
    if (init.method === 'GET' && u.pathname.endsWith('/comments')) return ok(state.comments);
    if (init.method === 'GET' && u.pathname.endsWith('/pulls')) return ok(pulls);
    if (init.method === 'POST') { state.comments.push({ id: state.next++, user: { login: 'github-actions[bot]' }, body: JSON.parse(init.body).body }); return ok({}); }
    if (init.method === 'PATCH') { const id = Number(u.pathname.split('/').pop()); state.comments.find((c) => c.id === id).body = JSON.parse(init.body).body; return ok({}); }
    throw new Error('unexpected ' + url);
  };
  return { f, calls, state };
}

function envWith(result, extra = {}) {
  const d = join(tmpdir(), `dgact-${Math.random()}`);
  mkdirSync(join(d, 'dg-artifact'), { recursive: true });
  writeFileSync(join(d, 'dg-artifact', 'result.json'), typeof result === 'string' ? result : JSON.stringify(result));
  return { GITHUB_REPOSITORY: 'acme/agents', GITHUB_TOKEN: 't', RUNNER_TEMP: d, DG_RUN_ID: '42', DG_PRS: JSON.stringify([{ number: 7 }]), DG_PRIVATE: 'false', ...extra };
}

test('comment: posts once, then edits in place (50 pushes, one comment, at most 3 writes per run)', async () => {
  const gh = fakeGitHub();
  assert.equal((await run(envWith(good()), gh.f)).done, 'posted');
  for (let i = 0; i < 50; i++) {
    const before = gh.calls.length;
    assert.equal((await run(envWith(good()), gh.f)).done, 'edited');
    assert.ok(gh.calls.length - before <= 3);
  }
  assert.equal(gh.state.comments.length, 1);
});

test('comment: a README-only PR gets nothing; the artifact\'s own touched list is ignored', async () => {
  const gh = fakeGitHub({ files: ['README.md'] });
  const forged = { ...good(), touched: ['.mcp.json'] };
  assert.equal((await run(envWith(forged), gh.f)).done, 'untouched');
  assert.equal(gh.state.comments.length, 0);
});

test('comment: a fork PR is resolved by owner, branch and sha', async () => {
  const gh = fakeGitHub({ pulls: [{ number: 9, head: { sha: 'abc' } }, { number: 10, head: { sha: 'zzz' } }] });
  const r = await run(envWith(good(), { DG_PRS: '[]', DG_HEAD_OWNER: 'forker', DG_HEAD_BRANCH: 'patch-1', DG_HEAD_SHA: 'abc' }), gh.f);
  assert.deepEqual(r, { done: 'posted', pr: 9 });
  assert.ok(gh.calls[0].includes('head=forker%3Apatch-1'));
});

test('comment: poisoned artifact is refused before any write', async () => {
  const gh = fakeGitHub();
  await assert.rejects(run(envWith('{"v":1,"pwn":true}'), gh.f));
  assert.equal(gh.calls.length, 0);
});

test('comment: private repo without the licence feature gets no comment', async () => {
  const gh = fakeGitHub();
  const r = await run(envWith({ ...good(), entitled: false }, { DG_PRIVATE: 'true' }), gh.f);
  assert.equal(r.done, 'private-not-entitled');
  assert.equal(gh.state.comments.length, 0);
});
