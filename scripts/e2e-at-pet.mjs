#!/usr/bin/env node
// Optional end-to-end check against a running At-Pet instance.
//
// The unit tests in test/ mock the API, so they stay hermetic. This script is the
// counterpart the reviewer asked for: it talks to a real At-Pet 1.3.4+ process,
// uses the real credential store, and exercises the same paths the bridges use.
// It skips (exit 0) when At-Pet or its credential store is unavailable.
//
// Usage:
//   npm run e2e                 # uses %LOCALAPPDATA%\Ni-ShuWu\At-Pet\...
//   AT_PET_URL=http://127.0.0.1:9000 npm run e2e
//   AT_PET_CREDENTIALS=<path> npm run e2e

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGINS = join(ROOT, 'Agent-plugin');
const BASE = (process.env.AT_PET_URL || 'http://127.0.0.1:8765').replace(/\/+$/, '');
const STORE = process.env.AT_PET_CREDENTIALS || (process.platform === 'win32'
  ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Ni-ShuWu', 'At-Pet', 'api-security', 'clients.json')
  : join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'Ni-ShuWu', 'At-Pet', 'api-security', 'clients.json'));

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log((pass ? 'ok   ' : 'FAIL ') + name + (detail ? ' :: ' + detail : ''));
}
function skip(reason) {
  console.log('skip: ' + reason);
  console.log('Start At-Pet 1.3.4+ (so it writes its credential store) and run this again.');
  process.exit(0);
}

if (!existsSync(STORE)) skip('credential store not found at ' + STORE);
const store = JSON.parse(readFileSync(STORE, 'utf8'));
const token = (id) => store.clients.find((client) => client.id === id)?.token;
const admin = token('admin');
if (!admin) skip('credential store has no administrator credential');

let reachable = false;
try {
  const health = await fetch(BASE + '/health');
  reachable = health.ok;
} catch {
  reachable = false;
}
if (!reachable) skip('At-Pet is not answering on ' + BASE);

async function call(path, { method = 'GET', token: bearer, body } = {}) {
  const headers = {};
  if (bearer) headers.Authorization = 'Bearer ' + bearer;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: response.status, json };
}

function runBridge(plugin, args, payload) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(process.execPath, [join(PLUGINS, plugin, 'bridge.mjs'), ...args], {
      env: { ...process.env, AT_PET_URL: BASE },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const timer = setTimeout(() => child.kill(), 20000);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr, durationMs: Date.now() - start });
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

// 1. GET /health is public; everything else needs a bearer token.
let response = await call('/health');
check('GET /health answers without credentials', response.status === 200 && response.json.authenticationRequired === true, JSON.stringify(response.json));
response = await call('/event', { method: 'POST', body: { sessionId: 'e2e-no-token', agentApp: 'zcode', event: 'thinking' } });
check('POST /event without token is rejected with 401', response.status === 401, String(response.status));

// 2. An agent credential may only speak for its own agent.
response = await call('/event', { method: 'POST', token: token('zcode'), body: { sessionId: 'e2e-zcode', agentApp: 'zcode', event: 'thinking' } });
check('own-agent event is accepted', response.status === 200 || response.status === 202, String(response.status));
response = await call('/event', { method: 'POST', token: token('zcode'), body: { sessionId: 'e2e-foreign', agentApp: 'command-code', event: 'thinking' } });
check('foreign agentApp is rejected with 403', response.status === 403, String(response.status) + ' ' + JSON.stringify(response.json));

// 3. Admin-only endpoints.
response = await call('/state', { token: token('zcode') });
check('GET /state with an agent token is rejected with 403', response.status === 403, String(response.status));
response = await call('/state', { token: admin });
check('GET /state with the admin token succeeds', response.status === 200, String(response.status));
response = await call('/say', { method: 'POST', token: admin, body: { text: 'At-Pet e2e' } });
check('POST /say with the admin token is accepted', response.status === 200 || response.status === 202, String(response.status));

// 4. Permission lifecycle, including the 404 boundary for other clients.
response = await call('/permission', { method: 'POST', token: token('openaicodex'), body: { sessionId: 'e2e-permission', agentApp: 'openai-codex', toolName: 'Bash', description: 'echo e2e' } });
const permissionId = response.json?.requestId;
check('POST /permission with the owning credential is accepted', (response.status === 200 || response.status === 202) && typeof permissionId === 'string', String(response.status));
response = await call('/permission/' + permissionId, { token: token('openaicodex') });
check('permission polls as pending', response.status === 200 && response.json.status === 'pending', JSON.stringify(response.json));
response = await call('/permission/' + permissionId, { token: token('zcode') });
check('permission poll with a foreign credential returns 404', response.status === 404, String(response.status));
response = await call('/permission/' + permissionId, { method: 'DELETE', token: token('openaicodex') });
check('permission can be cancelled by its creator', response.status === 200 || response.status === 202, String(response.status));
response = await call('/permission/' + permissionId, { token: token('openaicodex') });
check('cancelled permission polls as 404', response.status === 404, String(response.status));

// 5. Question lifecycle.
response = await call('/question', { method: 'POST', token: token('claudecode'), body: { sessionId: 'e2e-question', agentApp: 'claude-code', question: 'E2E?', choices: ['A', 'B'] } });
const questionId = response.json?.requestId;
check('POST /question with the owning credential is accepted', (response.status === 200 || response.status === 202) && typeof questionId === 'string', String(response.status));
response = await call('/question/' + questionId, { method: 'DELETE', token: token('claudecode') });
check('question can be cancelled by its creator', response.status === 200 || response.status === 202, String(response.status));

// 6. Every bundled bridge sends an authenticated event the app actually records.
const bridges = {
  'claude-code': 'claude-code',
  'command-code': 'command-code',
  'deepseek-harness': 'deepseek-harness',
  'github-copilot': 'github-copilot',
  'openai-codex': 'openai-codex',
  'penguin-harness': 'penguin-harness',
  workbuddy: 'workbuddy',
  zcode: 'zcode',
};
for (const [plugin, agentApp] of Object.entries(bridges)) {
  const sessionId = 'e2e-bridge-' + plugin;
  const result = await runBridge(plugin, [agentApp, 'UserPromptSubmit'], { session_id: sessionId, hook_event_name: 'UserPromptSubmit' });
  check(plugin + ' bridge posts an authenticated event', result.status === 0, 'exit=' + result.status + ' ' + result.durationMs + 'ms' + (result.stderr ? ' stderr=' + result.stderr.slice(0, 120) : ''));
}
await new Promise((resolve) => setTimeout(resolve, 600));
response = await call('/state', { token: admin });
const sources = response.json?.agentSources || [];
const connected = Object.keys(bridges)
  .map((plugin) => plugin.replace(/[^a-z0-9]/gi, '').toLowerCase())
  .filter((key) => sources.some((source) => source.key === key && source.connection?.connected));
check('the app records the bridged agents as connected', connected.length === Object.keys(bridges).length, connected.join(',') + ' of ' + Object.keys(bridges).length);

const failed = results.filter((item) => !item.pass);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
if (failed.length) {
  console.log('failed: ' + failed.map((item) => item.name).join(' | '));
  process.exitCode = 1;
}
