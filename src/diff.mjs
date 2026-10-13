// Compares the head and base scans, writes result.json (the only artifact), the job summary and the
// step outputs. Runs in the pull_request job, which has a read-only token.
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { touched as touchedOf } from './paths.mjs';
import { render } from './render.mjs';
import { parseResult } from './validate.mjs';

const dir = join(process.env.RUNNER_TEMP ?? '/tmp', 'deedglass');
const read = (f) => (existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), 'utf8')) : null);

export function summarise(rep) {
  if (!rep || rep.object !== 'scan_report') return null;
  const n = (s) => (rep.findings ?? []).filter((f) => f.severity === s).length;
  const paths = (rep.score?.deductions ?? []).filter((d) => d.id === 'unchecked_write_path').length;
  return { grade: rep.score.grade, points: rep.score.points, write_paths: paths, high: n('high'), medium: n('medium') };
}

const key = (f) => `${f.id}|${(f.paths ?? [])[0] ?? ''}`;
// entitledPrivate: on a private repo, comments need a Pro licence with action_private, checked
// with the CLI's own licence code (deedglass licence activate, then licence show --json).
export function entitledPrivate(env, bin) {
  if (env.DG_PRIVATE !== 'true') return true;
  if (!env.DG_LICENCE) return false;
  try {
    const opts = { env: { ...env, DEEDGLASS_LICENCE_FILE: join(dir, 'licence.json') }, stdio: ['ignore', 'pipe', 'ignore'] };
    execFileSync(bin, ['licence', 'activate', env.DG_LICENCE], opts);
    const show = JSON.parse(execFileSync(bin, ['--json', 'licence', 'show'], opts).toString());
    return show.active === true && Array.isArray(show.features) && show.features.includes('action_private');
  } catch {
    return false;
  }
}

export function compare(head, base, changed, entitled = true) {
  const flat = (rep) => (rep?.findings ?? []).map((f) => ({ id: f.id, severity: f.severity, title: f.title, path: (f.paths ?? [])[0] ?? '' }));
  const hb = new Set(flat(base).map(key));
  const hh = new Set(flat(head).map(key));
  const pathsOf = (rep) => (rep?.score?.deductions ?? []).filter((d) => d.id === 'unchecked_write_path').map((d) => d.subject);
  const basePaths = new Set(pathsOf(base));
  return {
    v: 1,
    version: String(head.deedglass_version ?? '0.0.0').replace(/^v/, '').split(' ')[0],
    base: summarise(base),
    head: summarise(head),
    new_findings: base ? flat(head).filter((f) => !hb.has(key(f))).slice(0, 50) : [],
    resolved: base ? flat(base).filter((f) => !hh.has(key(f))).slice(0, 50) : [],
    new_paths: base ? pathsOf(head).filter((p) => !basePaths.has(p)).slice(0, 50) : [],
    fix_first: String(head.score?.fix_first ?? '').slice(0, 300),
    touched: touchedOf(changed).slice(0, 50),
    entitled,
  };
}

if (process.argv[1] && process.argv[1].endsWith('diff.mjs')) {
  const head = read('head.json');
  if (!head) {
    console.error('✕ The scan of head produced no report. See the step above.');
    process.exit(1);
  }
  const changed = existsSync(join(dir, 'changed.txt')) ? readFileSync(join(dir, 'changed.txt'), 'utf8').split('\n').filter(Boolean) : [];
  const entitled = entitledPrivate(process.env, join(dir, 'bin', 'deedglass'));
  const result = compare(head, read('base.json'), changed, entitled);
  const text = JSON.stringify(result);
  parseResult(text); // the comment job will refuse anything this wouldn't pass
  writeFileSync(join(dir, 'result.json'), text);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    let md = render(result, { comment: false });
    if (!entitled) {
      md += '\n\nComments on private repos are part of Pro: deedglass.com/pro. The scan and this summary are free.';
    }
    appendFileSync(summary, md + '\n');
  }
  const out = process.env.GITHUB_OUTPUT;
  const sarif = existsSync(join(dir, 'head', 'deedglass-scan.sarif'));
  if (out) appendFileSync(out, `grade=${result.head.grade}\npoints=${result.head.points}\nbase-grade=${result.base?.grade ?? ''}\ntouched=${result.touched.length > 0}\nsarif=${sarif}\n`);
  console.log(`✓ Blast radius ${result.head.grade} · ${result.head.points} of 100${result.base ? ` (base ${result.base.grade})` : ''}`);
}
