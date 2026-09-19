import http from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync, renameSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { resolve, extname, sep, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { WorkflowStore } from './store';
import { CredentialStore, type CredentialPayload, type CredentialType } from './credentials';
import type { Workflow } from '../model';
import { validateWorkflow } from '../validation';
import { workflowDocument } from '../transfer';
import { ExecutionEngine } from '../engine/engine';
import { ExecutionStore } from '../engine/store';
import { ExecutionValidationError } from '../engine/graph';
import { getNodeMetadata } from '../nodes/registry';

const { values } = parseArgs({ options: { port: { type: 'string', default: '8765' }, data: { type: 'string', default: 'data/workflows.json' } } });
const dataFile = resolve(values.data!);
const store = new WorkflowStore(dataFile);
const credentials = new CredentialStore(dataFile + '.credentials.json');
const engine = new ExecutionEngine(new ExecutionStore(dataFile + '.executions.json'));
const dist = resolve('dist');
const authSessions = new Set<string>();
const cookieName = 'ewe_session';
const json = (res: http.ServerResponse, status: number, value?: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(value === undefined ? undefined : JSON.stringify(value));
};
class RequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
async function body(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new RequestError(415, 'Use application/json');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new RequestError(413, 'Body exceeds 1 MiB');
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw new RequestError(400, 'Expected a JSON object'); }
}
function name(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 120) throw new RequestError(400, 'Name must be 1-120 characters');
  return value.trim();
}
function sendSSE(res: http.ServerResponse, event: string, data: unknown, id?: number) {
  try {
    if (id !== undefined) res.write(`id: ${id}\n`);
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch { /* client disconnected */ }
}

// ─── Webhook registry ───────────────────────────────────────────────
interface WebhookEntry { workflowId: string; nodeId: string; path: string; secret: string; enabled: boolean; }
function getWebhookEntries(workflow: Workflow): WebhookEntry[] {
  return credentials.hydrateWorkflow(workflow).nodes
    .filter(n => n.type === 'webhook')
    .map(n => ({
      workflowId: workflow.id,
      nodeId: n.id,
      path: String(n.parameters.path || '/hooks/incoming'),
      secret: String(n.parameters.secret || ''),
      enabled: (n.parameters.enabled || 'yes') === 'yes',
    }));
}

// ─── Schedule manager ──────────────────────────────────────────────
interface ScheduleState { lastRun: string | null; running: boolean; }
const scheduleStateFile = dataFile + '.schedules.json';
function loadSchedules(): Map<string, ScheduleState> {
  try {
    if (!existsSync(scheduleStateFile)) return new Map();
    const raw = JSON.parse(readFileSync(scheduleStateFile, 'utf8'));
    return new Map(Object.entries(raw));
  } catch { return new Map(); }
}
function saveSchedules(state: Map<string, ScheduleState>) {
  const fd = openSync(scheduleStateFile + '.tmp', 'w', 0o600);
  try { writeFileSync(fd, JSON.stringify(Object.fromEntries(state), null, 2)); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(scheduleStateFile + '.tmp', scheduleStateFile);
}

function matchCron(expr: string, date: Date): boolean {
  // Basic 5-field cron: min hour dom month dow
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return false;
  const [min, hour, dom, month, dow] = parts;
  const match = (p: string, v: number, max: number) => {
    if (p === '*') return true;
    for (const part of p.split(',')) {
      if (part.includes('/')) {
        const [base, step] = part.split('/');
        const s = parseInt(step, 10);
        if (base === '*' && v % s === 0) return true;
      } else if (part.includes('-')) {
        const [a, b] = part.split('-').map(Number);
        if (v >= a && v <= b) return true;
      } else if (parseInt(part, 10) === v) return true;
    }
    return false;
  };
  const d = date.getUTCDate(), m = date.getUTCMonth() + 1, y = date.getUTCDay();
  return match(min, date.getUTCMinutes(), 60) &&
         match(hour, date.getUTCHours(), 24) &&
         match(dom, d, 31) &&
         match(month, m, 12) &&
         match(dow, y, 7);
}

// ─── Open SSE responses ────────────────────────────────────────────
const streams = new Set<http.ServerResponse>();
function closeStream(res: http.ServerResponse) {
  streams.delete(res);
  try { res.end(); } catch { /* already gone */ }
}

// ─── API router ────────────────────────────────────────────────────
async function api(req: http.IncomingMessage, res: http.ServerResponse, path: string) {
  if (path === '/api/auth/session' && req.method === 'GET') {
    return json(res, 200, { authenticated: isAuthorized(req), authRequired: authRequired() });
  }
  if (path === '/api/auth/login' && req.method === 'POST') {
    const input = await body(req);
    if (!authRequired()) return json(res, 200, { authenticated: true });
    if (!matchesCredentials(String(input.username || ''), String(input.password || ''))) {
      return json(res, 401, { error: 'Invalid username or password' });
    }
    const token = randomBytes(32).toString('base64url');
    authSessions.add(token);
    res.setHeader('Set-Cookie', `${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
    return json(res, 200, { authenticated: true });
  }
  if (path === '/api/auth/logout' && req.method === 'POST') {
    const token = cookies(req)[cookieName];
    if (token) authSessions.delete(token);
    res.setHeader('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    return json(res, 200, { authenticated: false });
  }

  const credentialPath = path.match(/^\/api\/credentials(?:\/([\w-]+))?$/);
  if (credentialPath) {
    const credentialId = credentialPath[1];
    if (!credentialId) {
      if (req.method === 'GET') return json(res, 200, credentials.list());
      if (req.method === 'POST') {
        const input = await body(req);
        try {
          return json(res, 201, credentials.create({
            name: name(input.name),
            type: input.type as CredentialType,
            data: (input.data || {}) as CredentialPayload,
          }));
        } catch (error) {
          throw new RequestError(400, (error as Error).message);
        }
      }
    } else if (req.method === 'DELETE') {
      credentials.delete(credentialId);
      return json(res, 204);
    }
    return json(res, 405, { error: 'Method not allowed' });
  }

  // Webhook endpoint: POST /api/hooks/:workflowId
  const hookMatch = path.match(/^\/api\/hooks\/([\w-]+)$/);
  if (hookMatch && req.method === 'POST') {
    const workflowId = hookMatch[1];
    const workflow = store.get(workflowId);
    if (!workflow) return json(res, 404, { error: 'Workflow not found' });
    const entries = getWebhookEntries(workflow).filter(e => e.enabled);
    if (entries.length === 0) return json(res, 404, { error: 'No enabled webhook' });
    const entry = entries[0];
    // Validate secret
    if (entry.secret) {
      const provided = req.headers['x-ewe-secret'] as string || '';
      if (provided !== entry.secret) return json(res, 401, { error: 'Invalid secret' });
    }
    // Dedup: reject if already running (bounded concurrency = 1 per webhook)
    const state = loadSchedules();
    const key = `hook:${workflowId}`;
    if (state.get(key)?.running) return json(res, 429, { error: 'Already running' });
    state.set(key, { lastRun: new Date().toISOString(), running: true });
    saveSchedules(state);
    try {
      const execution = engine.start(credentials.hydrateWorkflow(workflow));
      return json(res, 202, { executionId: execution.executionId, status: 'started' });
    } finally {
      const s = loadSchedules();
      s.set(key, { lastRun: new Date().toISOString(), running: false });
      saveSchedules(s);
    }
  }

  // Schedule trigger: POST /api/schedules/:workflowId/trigger
  const schedMatch = path.match(/^\/api\/schedules\/([\w-]+)\/trigger$/);
  if (schedMatch && req.method === 'POST') {
    const workflowId = schedMatch[1];
    const workflow = store.get(workflowId);
    if (!workflow) return json(res, 404, { error: 'Workflow not found' });
    const hasSchedule = workflow.nodes.some(n => n.type === 'schedule' && (n.parameters.enabled || 'yes') === 'yes');
    if (!hasSchedule) return json(res, 400, { error: 'No enabled schedule' });
    const execution = engine.start(credentials.hydrateWorkflow(workflow));
    return json(res, 202, { executionId: execution.executionId, status: 'started' });
  }

  if (path === '/api/workflows/import' && req.method === 'POST') {
    const input = await body(req);
    let workflow: Workflow;
    try { workflow = workflowDocument(input); }
    catch (error) { throw new RequestError(400, (error as Error).message); }
    const now = new Date().toISOString();
    return json(res, 201, store.put({ ...workflow, id: randomUUID(), createdAt: now, updatedAt: now }));
  }
  const exportPath = path.match(/^\/api\/workflows\/([\w-]+)\/export$/);
  if (exportPath && req.method === 'GET') {
    const workflow = store.get(exportPath[1]);
    if (!workflow) return json(res, 404, { error: 'Workflow not found' });
    return json(res, 200, workflowDocument(workflow));
  }
  const eventsMatch = path.match(/^\/api\/workflows\/([\w-]+)\/executions\/([\w-]+)\/events$/);
  if (eventsMatch && req.method === 'GET') {
    const [, workflowId, executionId] = eventsMatch;
    const execution = engine.history.get(executionId);
    if (!execution || execution.workflowId !== workflowId) return json(res, 404, { error: 'Execution not found' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders?.();
    streams.add(res);
    const cursorRaw = (req.headers['last-event-id'] as string) || '0';
    const cursorNum = parseInt(cursorRaw, 10) || 0;
    const isReplay = cursorNum > 0 && cursorNum <= (execution.sequence || 0);
    sendSSE(res, 'execution.snapshot', { sequence: execution.sequence || 0, execution, replay: isReplay }, execution.sequence || 0);
    let lastSent = execution.sequence || 0;
    const unsubscribe = engine.history.subscribe(executionId, (updated) => {
      if (updated.sequence && updated.sequence > lastSent) {
        lastSent = updated.sequence;
        sendSSE(res, 'execution.snapshot', { sequence: updated.sequence, execution: updated, replay: false }, updated.sequence);
      }
    });
    const tick = setInterval(() => sendSSE(res, 'heartbeat', { ts: Date.now() }, undefined), 15000);
    req.on('close', () => { clearInterval(tick); unsubscribe(); closeStream(res); });
    return;
  }
  const executionPath = path.match(/^\/api\/workflows\/([\w-]+)\/executions(?:\/([\w-]+)(\/cancel)?)?$/);
  if (executionPath) {
    const [, workflowId, executionId] = executionPath;
    if (executionId) {
      const execution = engine.history.get(executionId);
      if (!execution || execution.workflowId !== workflowId) return json(res, 404, { error: 'Execution not found' });
      if (executionPath[3]) {
        if (req.method === 'POST') return json(res, 200, await engine.cancel(executionId));
      } else if (req.method === 'GET') return json(res, 200, execution);
    } else {
      if (req.method === 'GET') return json(res, 200, engine.history.list().filter(item => item.workflowId === workflowId));
      if (req.method === 'POST') {
        const workflow = store.get(workflowId);
        if (!workflow) return json(res, 404, { error: 'Workflow not found' });
        return json(res, 202, engine.start(credentials.hydrateWorkflow(workflow)));
      }
    }
    return json(res, 405, { error: 'Method not allowed' });
  }
  const match = path.match(/^\/api\/workflows(?:\/([\w-]+))?$/);
  if (!match) return json(res, 404, { error: 'Not found' });
  const id = match[1];
  if (!id) {
    if (req.method === 'GET') return json(res, 200, store.list());
    if (req.method === 'POST') {
      const input = await body(req);
      const now = new Date().toISOString();
      const workflow: Workflow = { id: randomUUID(), name: name(input.name), enabled: false, nodes: [], connections: [], settings: {}, createdAt: now, updatedAt: now };
      return json(res, 201, store.put(workflow));
    }
  } else {
    const current = store.get(id);
    if (!current) return json(res, 404, { error: 'Workflow not found' });
    if (req.method === 'GET') return json(res, 200, current);
    if (req.method === 'DELETE') { store.delete(id); return json(res, 204); }
    if (req.method === 'PUT') {
      const input = await body(req);
      if (!store.get(id)) return json(res, 404, { error: 'Workflow not found' });
      const workflow = { ...input, id, name: name(input.name), createdAt: current.createdAt, updatedAt: new Date().toISOString() } as Workflow;
      const invalid = validateWorkflow(workflow);
      if (invalid) return json(res, 400, { error: invalid });
      return json(res, 200, store.put(workflow));
    }
  }
  return json(res, 405, { error: 'Method not allowed' });
}

const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || '';
    if (!/^127\.0\.0\.1:\d+$/.test(host)) return json(res, 403, { error: 'Loopback host required' });
    if (req.headers.origin && !allowedOrigins(req, host).has(String(req.headers.origin))) return json(res, 403, { error: 'Origin not allowed' });
    const path = new URL(req.url!, `http://${host}`).pathname;
    if (path.startsWith('/api/auth/')) return await api(req, res, path);
    if (path.startsWith('/api/') && !path.startsWith('/api/hooks/') && !isAuthorized(req)) return json(res, 401, { error: 'Authentication required' });
    if (path.startsWith('/api/')) return await api(req, res, path);
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
    const file = resolve(dist, '.' + (path === '/' ? '/index.html' : decodeURIComponent(path)));
    if (!file.startsWith(dist + sep) || !existsSync(file) || !statSync(file).isFile()) return json(res, 404, { error: 'Not found. Build the frontend first.' });
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
  } catch (error) {
    if (error instanceof ExecutionValidationError) json(res, 400, { error: error.message });
    else if (error instanceof RequestError) json(res, error.status, { error: error.message });
    else { console.error(error); json(res, 500, { error: 'Storage or server failure' }); }
  }
});

function allowedOrigins(req: http.IncomingMessage, host: string): Set<string> {
  const origins = new Set([`http://${host}`, 'http://127.0.0.1:5173']);
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  if (forwardedHost) {
    origins.add(`https://${forwardedHost}`);
    origins.add(`http://${forwardedHost}`);
  }
  return origins;
}

function authRequired(): boolean {
  const user = process.env.EWE_BASIC_USER || '';
  const pass = process.env.EWE_BASIC_PASS || '';
  return Boolean(user || pass);
}

function cookies(req: http.IncomingMessage): Record<string, string> {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(part => {
    const index = part.indexOf('=');
    if (index === -1) return ['', ''];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function matchesCredentials(user: string, pass: string): boolean {
  const expectedUser = process.env.EWE_BASIC_USER || '';
  const expectedPass = process.env.EWE_BASIC_PASS || '';
  const expected = Buffer.from(`${expectedUser}:${expectedPass}`);
  const received = Buffer.from(`${user}:${pass}`);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function validBasicHeader(req: http.IncomingMessage): boolean {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Basic ')) return false;
  let decoded = '';
  try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'); }
  catch { return false; }
  const [user, ...rest] = decoded.split(':');
  return matchesCredentials(user, rest.join(':'));
}

function isAuthorized(req: http.IncomingMessage): boolean {
  if (!authRequired()) return true;
  const token = cookies(req)[cookieName];
  return Boolean(token && authSessions.has(token)) || validBasicHeader(req);
}
server.listen(Number(values.port), '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address !== 'string') console.log(`eWe http://127.0.0.1:${address.port}`);
});
function shutdown(signal: string) {
  for (const res of [...streams]) closeStream(res);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
