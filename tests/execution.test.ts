import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import http from 'node:http';

async function localServer(handler: http.RequestListener) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address() as { port: number };
  return { url: `http://127.0.0.1:${address.port}`, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
import { afterEach, beforeEach, expect, it } from 'vitest';
import { defaultParameters, getNodeMetadata } from '../src/nodes/registry';
import type { Workflow, WorkflowNode } from '../src/model';

let dir: string, child: ChildProcess, base: string;
async function start() {
  child = spawn(process.execPath, ['--import', 'tsx', 'src/api/server.ts', '--port', '0', '--data', join(dir, 'workflows.json')], { stdio: ['ignore', 'pipe', 'pipe'] });
  base = await new Promise<string>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(output || 'Startup timeout')), 10000);
    child.stderr!.on('data', data => { output += data; });
    child.stdout!.on('data', data => {
      output += data;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Exit ${code}: ${output}`)); });
  });
}
async function stop() {
  if (child?.exitCode === null) { const done = once(child, 'exit'); child.kill('SIGTERM'); await done; }
}
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'ewe-execution-')); await start(); });
afterEach(async () => { await stop(); await rm(dir, { recursive: true, force: true }); });
// A few tests rewrite committed Phase 2 receipts; restore them byte-identically
// afterwards so a test run never leaves evidence drift behind.
const RECEIPTS = ['evidence/phase2/cancel.json', 'evidence/phase2/four-node.json', 'evidence/phase2/restart.json'];
let receiptSnapshot: Map<string, string | null>;
beforeEach(async () => {
  receiptSnapshot = new Map();
  for (const path of RECEIPTS) receiptSnapshot.set(path, await readFile(path, 'utf8').catch(() => null));
});
afterEach(async () => {
  for (const [path, content] of receiptSnapshot) { if (content === null) await rm(path, { force: true }); else await writeFile(path, content); }
});
const call = (path: string, method = 'GET', data?: unknown) => fetch(base + '/api/workflows' + path, {
  method, headers: { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data),
});
function node(id: string, type: string, parameters = {}): WorkflowNode {
  return { id, type, name: id, position: { x: 0, y: 0 }, credentials: {}, parameters: { ...defaultParameters(getNodeMetadata(type)!), ...parameters } };
}
async function save(nodes: WorkflowNode[], links: string[][]) {
  const workflow: Workflow = await (await call('', 'POST', { name: 'Engine proof' })).json();
  workflow.nodes = nodes;
  workflow.connections = links.map(([source, target, port = 'main'], i) => ({ id: `edge${i}`, source, target, sourcePort: port, targetPort: 'main' }));
  const response = await call('/' + workflow.id, 'PUT', workflow);
  expect(response.status, await response.text()).toBe(200);
  return workflow;
}
async function launch(id: string) {
  const response = await call(`/${id}/executions`, 'POST');
  expect(response.status, await response.clone().text()).toBe(202);
  return response.json();
}
async function finished(workflowId: string, executionId: string) {
  let execution: any;
  await expect.poll(async () => {
    execution = await (await call(`/${workflowId}/executions/${executionId}`)).json();
    return execution.status;
  }, { timeout: 10000 }).not.toBe('running');
  return execution;
}

it('passes expression data from a real HTTP response through Set, IF and HTTP parameters', async () => {
  const server = await localServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.method === 'POST' ? { received: JSON.parse(Buffer.concat(chunks).toString()) } : { user: { name: 'Ada', count: 7 } }));
  });
  try {
    const workflow = await save([
      node('start', 'manualTrigger'), node('fetch', 'httpRequest', { url: server.url }),
      node('copy', 'set', { field: 'count', value: '{{$json.body.user.count}}' }),
      node('compare', 'if', { field: 'count', value: '{{$node["fetch"].json.body.user.count}}' }),
      node('send', 'httpRequest', { url: server.url + '/{{$node["fetch"].json.body.user.name}}', method: 'POST', bodyType: 'json', body: '{"count":{{$json.count}}}' }),
    ], [['start', 'fetch'], ['fetch', 'copy'], ['copy', 'compare'], ['compare', 'send', 'true']]);
    const result = await finished(workflow.id, (await launch(workflow.id)).executionId);
    expect(result.nodeExecutions[2].output.count).toBe(7);
    expect(result.nodeExecutions[4].output.body).toEqual({ received: { count: 7 } });
    expect(result.status).toBe('success');
  } finally { await server.close(); }
});

it('imports a graph as a new identity and rejects invalid imports without mutation', async () => {
  const original = await save([node('start', 'manualTrigger'), node('set', 'set', { value: '{{$json}}' })], [['start', 'set']]);
  original.settings = { viewport: { x: 12, y: -10, zoom: 1.2 } };
  const importedResponse = await call('/import', 'POST', original);
  expect(importedResponse.status).toBe(201);
  const imported = await importedResponse.json();
  expect(imported.id).not.toBe(original.id);
  expect(imported).toMatchObject({ nodes: original.nodes, connections: original.connections, settings: original.settings });
  const before = await (await call('')).json();
  for (const invalid of [{}, { ...original, nodes: [...original.nodes, original.nodes[0]] }, { ...original, connections: [{ ...original.connections[0], target: 'missing' }] }]) {
    expect((await call('/import', 'POST', invalid)).status).toBe(400);
    expect(await (await call('')).json()).toEqual(before);
  }
  const exported = await call(`/${imported.id}/export`);
  expect(exported.status).toBe(200);
  expect(await exported.json()).toEqual(imported);
});

it('accepts whole-field typed HTTP expressions and preserves JSON body validation', async () => {
  let received = 0;
  const server = await localServer((req, res) => { received++; req.resume(); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"timeout":1000,"payload":{"ok":true},"headers":{"x-proof":"yes"}}'); });
  try {
    const workflow = await save([node('start', 'manualTrigger'), node('fetch', 'httpRequest', { url: server.url }), node('send', 'httpRequest', { method: 'POST', url: server.url, timeout: '{{$json.body.timeout}}', headers: '{{$json.body.headers}}', bodyType: 'json', body: '{{$json.body.payload}}' })], [['start', 'fetch'], ['fetch', 'send']]);
    const result = await finished(workflow.id, (await launch(workflow.id)).executionId);
    expect(result.status).toBe('success');
    expect(result.nodeExecutions[2].resolvedParameters.body).toEqual({ ok: true });
    expect(received).toBe(2);
    workflow.nodes[2].parameters.body = 'not JSON';
    expect((await call('/' + workflow.id, 'PUT', workflow)).status).toBe(200);
    const failed = await finished(workflow.id, (await launch(workflow.id)).executionId);
    expect(failed.nodeExecutions[2].status).toBe('error');
    expect(received).toBe(3);
  } finally { await server.close(); }
});

it('persists resolved parameters and timestamped lifecycle logs including lookup errors across restart', async () => {
  const workflow = await save([node('start', 'manualTrigger'), node('bad', 'set', { value: '{{$json.missing}}' })], [['start', 'bad']]);
  const result = await finished(workflow.id, (await launch(workflow.id)).executionId);
  expect(result.nodeExecutions[0].resolvedParameters).toEqual({ note: '' });
  expect(result.nodeExecutions[1]).toMatchObject({ status: 'error', input: {}, error: 'Missing own property: missing' });
  expect(result.logs.map((log: any) => log.event)).toEqual(['workflow.started', 'node.started', 'node.success', 'node.started', 'node.error', 'workflow.error']);
  expect(result.logs.every((log: any) => Number.isFinite(Date.parse(log.timestamp)))).toBe(true);
  await stop(); await start();
  expect(await (await call(`/${workflow.id}/executions/${result.executionId}`)).json()).toEqual(result);
});

it('recovers interrupted executions as cancelled without replaying HTTP after a backend crash', async () => {
  let received = 0;
  const server = await localServer(() => { received++; });
  try {
    const workflow = await save([node('start', 'manualTrigger'), node('http', 'httpRequest', { url: server.url }), node('after', 'set')], [['start', 'http'], ['http', 'after']]);
    const run = await launch(workflow.id);
    await expect.poll(() => received).toBe(1);
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    await start();
    const result = await (await call(`/${workflow.id}/executions/${run.executionId}`)).json();
    expect(result.status).toBe('cancelled');
    expect(result.nodeExecutions.map((n: any) => n.status)).toEqual(['success', 'cancelled', 'cancelled']);
    expect(received).toBe(1);
  } finally { await server.close(); }
});

it('cancels an active request, marks remaining nodes cancelled and isolates simultaneous executions', async () => {
  let received = 0;
  const server = await localServer(() => { received++; });
  try {
    const workflow = await save([node('start', 'manualTrigger'), node('http', 'httpRequest', { url: server.url }), node('after', 'set')], [['start', 'http'], ['http', 'after']]);
    const runs = [await launch(workflow.id), await launch(workflow.id)];
    await expect.poll(() => received).toBe(2);
    const path = `/${workflow.id}/executions/${runs[0].executionId}`;
    const running = await (await call(path)).json();
    expect(running.nodeExecutions.map((n: any) => n.status)).toEqual(['success', 'running', 'waiting']);
    expect((await call(path + '/cancel', 'POST')).status).toBe(200);
    const result = await finished(workflow.id, runs[0].executionId);
    expect(result.status).toBe('cancelled');
    expect(result.nodeExecutions.map((n: any) => n.status)).toEqual(['success', 'cancelled', 'cancelled']);
    expect((await (await call(`/${workflow.id}/executions/${runs[1].executionId}`)).json()).status).toBe('running');
    expect(await (await call(path + '/cancel', 'POST')).json()).toEqual(result);
    await call(`/${workflow.id}/executions/${runs[1].executionId}/cancel`, 'POST');
    await writeFile('evidence/phase2/cancel.json', JSON.stringify({ running, result }, null, 2));
  } finally { await server.close(); }
});

it('HTTP failure, timeout and bad configuration become per-node errors with failed execution status', async () => {
  const hanging = await localServer(() => new Promise(() => {}));
  const { url: failing, close } = await localServer((req, res) => { req.resume(); res.writeHead(500); res.end('boom'); });
  try {
    const cases: [string, Record<string, string | number>, (execution: any) => void][] = [
      ['connection refused', { url: 'http://127.0.0.1:9/' }, execution => expect(execution.error).toMatch(/ECONNREFUSED|fetch failed/)],
      ['server 500', { url: failing }, execution => expect(execution.error).toMatch(/500/)],
      ['timeout', { url: hanging.url, timeout: 100 }, execution => expect(execution.error).toMatch(/timed out/i)],
      ['bad URL', { url: 'ftp://example.com' }, execution => expect(execution.error).toMatch(/HTTP or HTTPS/)],
      ['bad headers JSON', { url: 'http://127.0.0.1:9/', headers: '[1]' }, execution => expect(execution.error).toMatch(/objects of strings/i)],
    ];
    for (const [label, parameters, assertError] of cases) {
      const workflow = await save([node('start', 'manualTrigger'), node('http', 'httpRequest', parameters)], [['start', 'http']]);
      const execution = await finished(workflow.id, (await launch(workflow.id)).executionId);
      expect(execution.status, label).toBe('error');
      expect(execution.finishedAt, label).toBeTruthy();
      expect(execution.nodeExecutions.find((n: any) => n.nodeId === 'http'), label).toMatchObject({ status: 'error', startedAt: expect.any(String), finishedAt: expect.any(String) });
      assertError(execution.nodeExecutions.find((n: any) => n.nodeId === 'http'));
    }
  } finally { await hanging.close(); await close(); }
}, 15000);

it('executes a four-node API graph with real HTTP methods, headers, query, JSON/raw bodies and parsing', async () => {
  let requests = 0;
  const server = await localServer(async (req, res) => {
    requests++;
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ method: req.method, url: req.url, header: req.headers['x-proof'], body }));
  });
  try {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      const raw = method === 'PATCH';
      const workflow = await save([node('start', 'manualTrigger'), node('set', 'set', { field: 'answer', value: 'yes' }), node('if', 'if', { field: 'answer', value: 'yes' }), node('http', 'httpRequest', { method, url: server.url, headers: '{"x-proof":"ewe"}', query: '{"q":"a b"}', bodyType: raw ? 'raw' : 'json', body: method === 'GET' ? '' : raw ? 'plain payload' : '{"proof":true}' })], [['start', 'set'], ['set', 'if'], ['if', 'http', 'true']]);
      const before = requests;
      expect((await call('/' + workflow.id)).status).toBe(200);
      expect(requests).toBe(before);
      const result = await finished(workflow.id, (await launch(workflow.id)).executionId);
      expect(result.status).toBe('success');
      expect(result.nodeExecutions[3].input).toEqual({ answer: 'yes' });
      expect(result.nodeExecutions[3].output).toMatchObject({ status: 201, body: { method, url: '/?q=a+b', header: 'ewe', body: method === 'GET' ? '' : raw ? 'plain payload' : '{"proof":true}' } });
      expect(requests).toBe(before + 1);
      await writeFile('evidence/phase2/four-node.json', JSON.stringify({ workflow, result }, null, 2));
    }
  } finally { await server.close(); }
});

it('executes native app connector nodes for Telegram, GitHub and Google Sheets', async () => {
  const requests: Array<{ method?: string; url?: string; headers: http.IncomingHttpHeaders; body: any }> = [];
  const server = await localServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString();
    requests.push({ method: req.method, url: req.url, headers: req.headers, body: text ? JSON.parse(text) : null });
    if (req.url?.includes('/dispatches')) {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, url: req.url }));
  });
  try {
    const base = server.url;
    const workflow = await save([
      node('start', 'manualTrigger'),
      node('message', 'set', { field: 'message', value: 'Connector proof' }),
      node('telegram', 'telegram', { apiBaseUrl: base, botToken: 'bot-secret', chatId: '6892469899', text: '{{$json.message}}' }),
      node('github', 'github', { apiBaseUrl: base, token: 'github-secret', action: 'repositoryDispatch', owner: 'kdbdevs', repo: 'ewe', eventType: 'connector.proof', clientPayload: '{"message":"{{$node["message"].json.message}}"}' }),
      node('sheets', 'googleSheets', { apiBaseUrl: base, accessToken: 'google-secret', spreadsheetId: 'sheet123', range: 'Sheet1!A:Z', values: '["{{$node["message"].json.message}}"]' }),
    ], [['start', 'message'], ['message', 'telegram'], ['telegram', 'github'], ['github', 'sheets']]);
    const result = await finished(workflow.id, (await launch(workflow.id)).executionId);
    expect(result.status).toBe('success');
    expect(requests).toHaveLength(3);
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: '/botbot-secret/sendMessage',
      body: { chat_id: '6892469899', text: 'Connector proof', disable_web_page_preview: false },
    });
    expect(requests[1]).toMatchObject({
      method: 'POST',
      url: '/repos/kdbdevs/ewe/dispatches',
      body: { event_type: 'connector.proof', client_payload: { message: 'Connector proof' } },
    });
    expect(requests[1].headers.authorization).toBe('Bearer github-secret');
    expect(requests[2].method).toBe('POST');
    expect(requests[2].url).toContain('/v4/spreadsheets/sheet123/values/Sheet1!A%3AZ:append');
    expect(requests[2].url).toContain('valueInputOption=USER_ENTERED');
    expect(requests[2].headers.authorization).toBe('Bearer google-secret');
    expect(requests[2].body).toEqual({ values: [['Connector proof']] });
  } finally { await server.close(); }
});

it('IF routes only the matching output and propagates skips through the other branch', async () => {
  for (const value of ['yes', 'no']) {
    const condition = { ...node('condition', 'set'), type: 'if', parameters: { field: 'answer', operator: 'equals', value: 'yes' } };
    const workflow = await save([node('start', 'manualTrigger'), node('set', 'set', { field: 'answer', value }), condition, node('true', 'set'), node('false', 'set'), node('tail', 'set')], [['start', 'set'], ['set', 'condition'], ['condition', 'true', 'true'], ['condition', 'false', 'false'], ['true', 'tail']]);
    const result = await finished(workflow.id, (await launch(workflow.id)).executionId);
    const records = Object.fromEntries(result.nodeExecutions.map((n: any) => [n.nodeId, n]));
    expect(records.condition.output).toEqual({ answer: value });
    expect(records.true.status).toBe(value === 'yes' ? 'success' : 'skipped');
    expect(records.false.status).toBe(value === 'no' ? 'success' : 'skipped');
    expect(records.tail.status).toBe(records.true.status);
  }
});

it('rejects non-executable graphs before creating history', async () => {
  const cases = [
    { nodes: [node('set', 'set')], links: [] },
    { nodes: [node('a', 'manualTrigger'), node('b', 'manualTrigger')], links: [] },
    { nodes: [node('start', 'manualTrigger'), node('a', 'set'), node('b', 'set')], links: [['a', 'b'], ['b', 'a']] },
  ];
  for (const example of cases) {
    const workflow = await save(example.nodes, example.links);
    const response = await call(`/${workflow.id}/executions`, 'POST');
    expect(response.status).toBe(400);
    expect(await (await call(`/${workflow.id}/executions`)).json()).toEqual([]);
  }
});

it('follows connections rather than array order and skips disconnected nodes', async () => {
  const workflow = await save([node('last', 'set', { field: 'message', value: 'changed' }), node('orphan', 'set'), node('start', 'manualTrigger'), node('first', 'set', { field: 'message', value: 'original' })], [['start', 'first'], ['first', 'last']]);
  const result = await finished(workflow.id, (await launch(workflow.id)).executionId);
  expect(result.nodeExecutions[0].input).toEqual({ message: 'original' });
  expect(result.nodeExecutions[0].output).toEqual({ message: 'changed' });
  expect(result.nodeExecutions[1]).toMatchObject({ status: 'skipped', input: null, output: null });
});

it('executes Manual → Set, preserving data and durable history across new backend PID', async () => {
  const workflow = await save([node('start', 'manualTrigger'), node('first', 'set', { field: 'hello', value: 'world' }), node('second', 'set', { field: 'next', value: 'value' })], [['start', 'first'], ['first', 'second']]);
  const run = await launch(workflow.id);
  const result = await finished(workflow.id, run.executionId);
  expect(result.status).toBe('success');
  expect(result.nodeExecutions.map((n: any) => n.status)).toEqual(['success', 'success', 'success']);
  expect(result.nodeExecutions[2].input).toEqual({ hello: 'world' });
  expect(result.nodeExecutions[2].output).toEqual({ hello: 'world', next: 'value' });
  for (const n of result.nodeExecutions) {
    expect(n.duration).toBeGreaterThanOrEqual(0);
    expect(Date.parse(n.finishedAt)).toBeGreaterThanOrEqual(Date.parse(n.startedAt));
  }
  const history = await (await call(`/${workflow.id}/executions`)).json();
  expect(history).toEqual([result]);
  const oldPid = child.pid;
  await stop(); await start();
  expect(child.pid).not.toBe(oldPid);
  expect(await (await call(`/${workflow.id}/executions`)).json()).toEqual(history);
  await mkdir('evidence/phase2', { recursive: true });
  await writeFile('evidence/phase2/restart.json', JSON.stringify({ oldPid, newPid: child.pid, identicalHistory: history }, null, 2));
});
