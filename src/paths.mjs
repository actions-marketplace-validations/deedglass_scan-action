// The agent-config paths whose change makes the Action comment (S47 §3.5).
const EXACT = new Set(['.mcp.json', '.cursor/mcp.json', '.vscode/mcp.json', 'package.json', 'pyproject.toml', 'deedglass.yaml']);

export function isAgentPath(p) {
  if (typeof p !== 'string') return false;
  const base = p.split('/').pop();
  if (EXACT.has(p)) return true;
  if (base === 'claude_desktop_config.json' || base === 'mcp_config.json') return true;
  if (base === 'package.json' || base === 'pyproject.toml') return p === base;
  if (/^requirements[^/]*\.txt$/.test(p)) return true;
  if (p.startsWith('policies/')) return true;
  return false;
}

export function touched(files) {
  return files.filter(isAgentPath);
}
