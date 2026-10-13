// The PR comment and the job summary (S47 §5), rendered only from a validated result. No HTML but
// the marker; Markdown is escaped; links only to deedglass.com/score and the run.
export const MARKER = '<!-- deedglass-scan -->';
const SAFE_PATH = /^[A-Za-z0-9._/@ -]{1,200}$/;

export function esc(s) {
  return String(s)
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '')
    .replace(/[\\`*_{}[\]()#+!|<>~&]/g, (c) => `\\${c}`)
    .replace(/@/g, '@​')
    .replace(/:\/\//g, ':​//');
}

const path = (p) => (SAFE_PATH.test(p) ? '`' + p.replace(/`/g, '') + '`' : '…');
const side = (s) => (s ? `${s.grade} · ${s.points}` : 'not scanned');

export function render(r, { runUrl = '', comment = true } = {}) {
  const h = r.head;
  const b = r.base;
  const lines = [];
  if (comment) lines.push(MARKER);
  const was = b && b.grade !== h.grade ? ` (was **${b.grade}**)` : '';
  lines.push(`### Deedglass scan · agent blast radius **${h.grade}**${was}`);
  if (r.touched.length) lines.push(`This pull request changes agent config: ${r.touched.slice(0, 5).map(path).join(', ')}${r.touched.length > 5 ? ` and ${r.touched.length - 5} more` : ''}`);
  lines.push('', '| | Before | After |', '|---|---:|---:|');
  lines.push(`| Grade | ${side(b)} | ${side(h)} |`);
  lines.push(`| Write paths with no check | ${b ? b.write_paths : '·'} | ${h.write_paths} |`);
  lines.push(`| High · medium findings | ${b ? `${b.high} · ${b.medium}` : '·'} | ${h.high} · ${h.medium} |`);
  if (r.new_findings.length || r.new_paths.length) {
    lines.push('', '**New in this pull request**');
    for (const f of r.new_findings.slice(0, 10)) lines.push(`- ${f.severity} · ${esc(f.title)} · ${path(f.path)}`);
    for (const p of r.new_paths.slice(0, 10)) lines.push(`- write path with no check · ${path(p)}`);
  }
  if (r.resolved.length) {
    lines.push('', '**Resolved in this pull request**');
    for (const f of r.resolved.slice(0, 10)) lines.push(`- ${f.severity} · ${esc(f.title)}`);
  }
  if (r.fix_first) lines.push('', `**Fix this first:** ${esc(r.fix_first)}.`);
  const run = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/actions\/runs\/[0-9]+$/.test(runUrl) ? ` · [This run](${runUrl})` : '';
  lines.push('', `<sub>deedglass ${esc(r.version)} · formula v1 · read-only, nothing sent to Deedglass · [What the grade means](https://deedglass.com/score)${run}${comment ? ' · this comment is edited on each push' : ''}</sub>`);
  return lines.join('\n');
}
