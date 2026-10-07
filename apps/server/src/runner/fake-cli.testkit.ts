import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CliBins } from './probe.ts';

export const USAGE_TEXT = `You are currently using your subscription to power your Claude Code usage

Current session: 32% used · resets Oct 7 at 12:20pm (Europe/Warsaw)
Current week (all models): 30% used · resets Oct 10 at 2am (Europe/Warsaw)
Current week (Sonnet): 12% used · resets Oct 10 at 2am (Europe/Warsaw)

What's contributing to your limits usage?
Approximate, based on local sessions on this machine.`;

const CLAUDE = `
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2);
const dir = process.env.CLAUDE_CONFIG_DIR || '';
const mode = process.env.FAKE_MODE || 'in';
const marker = dir && fs.existsSync(path.join(dir, 'logged-in'));
if (args[0] === 'auth' && args[1] === 'status') {
  if (mode === 'hang') return setTimeout(() => {}, 60000);
  if (mode === 'garbage') return console.log('not json');
  if (process.env.ANTHROPIC_API_KEY)
    return console.log(JSON.stringify({ loggedIn: true, authMethod: 'api_key', apiKeySource: 'ANTHROPIC_API_KEY' }));
  if (mode === 'in' || marker)
    return console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'ann@example.com', orgId: 'org-1', orgName: "Ann's Org", subscriptionType: 'pro' }));
  console.log(JSON.stringify({ loggedIn: false, authMethod: 'none' }));
  process.exit(1);
}
if (args[0] === '-p' && args[1] === '/usage') {
  if (mode === 'usage-fail') return console.log('{"result":"nothing here"}');
  return console.log(JSON.stringify({ type: 'result', result: ${JSON.stringify(USAGE_TEXT)}, total_cost_usd: 0 }));
}
if (args[0] === 'auth' && args[1] === 'login') {
  console.log('Opening browser to sign in\\nIf it does not open visit https://claude.ai/oauth/authorize?x=1');
  fs.appendFileSync(path.join(process.env.FAKE_LOG || '/dev/null'), JSON.stringify({ args, dir }) + '\\n');
  setTimeout(() => { if (dir) fs.writeFileSync(path.join(dir, 'logged-in'), '1'); process.exit(0); }, 200);
  return;
}
process.exit(2);
`;

const CODEX = `
const fs = require('node:fs'), path = require('node:path'), readline = require('node:readline');
const args = process.argv.slice(2);
const home = process.env.CODEX_HOME || '';
const auth = () => { try { return JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8')); } catch { return null; } };
if (args[0] === 'login' && args[1] === '--with-api-key') {
  let key = '';
  process.stdin.on('data', (d) => (key += d));
  process.stdin.on('end', () => { fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify({ type: 'apiKey', len: key.trim().length })); console.log('Successfully logged in'); });
  return;
}
if (args[0] === 'login' && args[1] === 'status') {
  if (process.env.FAKE_MODE === 'in' || auth()) { console.log('Logged in using ChatGPT'); return; }
  console.log('Not logged in'); process.exit(1);
}
if (args[0] === 'login') {
  console.log('Open https://auth.openai.com/oauth/authorize?x=1');
  setTimeout(() => { fs.writeFileSync(path.join(home, 'auth.json'), '{"type":"chatgpt"}'); process.exit(0); }, 200);
  return;
}
if (args[0] === 'app-server') {
  if (process.env.FAKE_MODE === 'no-app-server') process.exit(3);
  const send = (m) => console.log(JSON.stringify(m));
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const m = JSON.parse(line);
    if (m.method === 'initialize') send({ id: m.id, result: { userAgent: 'fake', codexHome: home } });
    else if (m.method === 'account/read') {
      const a = auth(), loggedIn = process.env.FAKE_MODE === 'in' || !!a;
      send({ id: m.id, result: { account: !loggedIn ? null : a && a.type === 'apiKey' ? { type: 'apiKey' } : { type: 'chatgpt', email: 'bob@example.com', planType: 'plus' }, requiresOpenaiAuth: true } });
    } else if (m.method === 'account/rateLimits/read')
      send({ id: m.id, result: { ordinaryUsageAllowed: false, rateLimits: { limitId: 'codex', primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1791368863 }, secondary: { usedPercent: 16, windowDurationMins: 10080, resetsAt: 1791955663 }, credits: { hasCredits: false, unlimited: false, balance: '0' }, planType: 'plus', rateLimitReachedType: 'rate_limit_reached' } } });
    else if (m.method === 'account/usage/read')
      send({ id: m.id, result: { summary: { lifetimeTokens: 10 }, dailyUsageBuckets: [{ startDate: '2026-07-09', tokens: 292114 }, { startDate: '2026-07-10', tokens: 5 }] } });
    else if (m.method === 'model/list') {
      if (!process.env.FAKE_MODEL_LIST) return send({ id: m.id, error: { code: -32601, message: 'unknown method' } });
      const pages = JSON.parse(fs.readFileSync(process.env.FAKE_MODEL_LIST, 'utf8'));
      const i = m.params && m.params.cursor ? Number(m.params.cursor) : 0;
      const page = pages[i];
      send({ id: m.id, result: { data: page.data, nextCursor: i + 1 < pages.length ? String(i + 1) : null } });
    } else if (m.method === 'account/login/start') {
      send({ id: m.id, result: { type: 'chatgpt', loginId: 'l1', authUrl: 'https://auth.openai.com/oauth/authorize?native=1' } });
      setTimeout(() => { fs.writeFileSync(path.join(home, 'auth.json'), '{"type":"chatgpt"}'); send({ method: 'account/login/completed', params: { success: true, loginId: 'l1' } }); }, 200);
    } else if (m.id !== undefined) send({ id: m.id, error: { code: -32601, message: 'unknown method' } });
  });
  return;
}
process.exit(2);
`;

/** Only answers --version; Gemini has no login or status command. */
const GEMINI = `
if (process.argv[2] === '--version') {
  if (process.env.FAKE_MODE === 'hang') return setTimeout(() => {}, 60000);
  return console.log('0.63.0');
}
process.exit(2);
`;

export function fakeBins(): CliBins & { dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'fake-cli-'));
  writeFileSync(join(dir, 'claude.cjs'), CLAUDE);
  writeFileSync(join(dir, 'codex.cjs'), CODEX);
  writeFileSync(join(dir, 'gemini.cjs'), GEMINI);
  return {
    dir,
    gemini: { cmd: process.execPath, args: [join(dir, 'gemini.cjs')] },
    claude: { cmd: process.execPath, args: [join(dir, 'claude.cjs')] },
    openai: { cmd: process.execPath, args: [join(dir, 'codex.cjs')] },
  };
}
