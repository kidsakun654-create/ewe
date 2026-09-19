import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { it, expect } from 'vitest';

it('real API CRUD preserves a graph across a backend process restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ewe-test-'));
  let child: ChildProcess | undefined;
  let base = '';
  async function start() {
    child = spawn(process.execPath, ['--import', 'tsx', 'src/api/server.ts', '--port', '0', '--data', join(dir, 'workflows.json')], { stdio: ['ignore', 'pipe', 'pipe'] });
    base = await new Promise<string>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`Backend startup timeout: ${output}`)), 10000);
      child!.stderr!.on('data', data => { output += data; });
      child!.stdout!.on('data', data => {
        output += data;
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      });
      child!.once('exit', code => { clearTimeout(timer); reject(new Error(`Backend exit ${code}: ${output}`)); });
    });
  }
  async function stop() {
    if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
  }
  const call = (path: string, method = 'GET', body?: unknown) => fetch(base + '/api/workflows' + path, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    await start();
    expect(await (await call('')).json()).toEqual([]);
    const created = await call('', 'POST', { name: 'Persistent graph' });
    expect(created.status).toBe(201);
    const workflow = await created.json();
    workflow.nodes = [
      { id: 'trigger', type: 'manualTrigger', name: 'Start', position: { x: -30, y: 20 }, parameters: { note: 'test' }, credentials: {} },
      { id: 'set', type: 'set', name: 'Assign', position: { x: 300, y: 200 }, parameters: { field: 'hello', value: 'world' }, credentials: {} },
    ];
    workflow.connections = [{ id: 'edge', source: 'trigger', target: 'set', sourcePort: 'main', targetPort: 'main' }];
    workflow.nodes.push({ id: 'http', type: 'httpRequest', name: 'Request', position: { x: 600, y: 20 }, parameters: { method: 'POST', url: 'https://example.com', body: '{}', timeout: 45000 }, credentials: {} });
    workflow.connections.push({ id: 'edge2', source: 'set', target: 'http', sourcePort: 'main', targetPort: 'main' });
    workflow.name = 'Renamed graph';
    expect((await call('/' + workflow.id, 'PUT', workflow)).status).toBe(200);
    const saved = await (await call('/' + workflow.id)).json();
    expect(saved.nodes).toEqual(workflow.nodes);
    expect(saved.connections).toEqual(workflow.connections);
    const invalidGraphs = [
      { ...saved, connections: [{ ...saved.connections[0], target: 'missing' }] },
      { ...saved, nodes: [...saved.nodes, saved.nodes[0]] },
      { ...saved, nodes: [{ ...saved.nodes[0], type: 'unknown' }] },
      { ...saved, connections: [{ ...saved.connections[0], targetPort: 'missing' }] },
      { ...saved, connections: [saved.connections[0], { ...saved.connections[0], id: 'duplicate' }] },
      { ...saved, nodes: [{ ...saved.nodes[0], position: { x: 'bad', y: 0 } }, saved.nodes[1]] },
      { ...saved, nodes: [{ ...saved.nodes[0], parameters: { note: 123 } }, saved.nodes[1]] },
      { ...saved, enabled: true },
      { ...saved, settings: { viewport: { x: 0, y: 0, zoom: 0 } } },
    ];
    for (const invalid of invalidGraphs) {
      const rejected = await call('/' + workflow.id, 'PUT', invalid);
      expect(rejected.status).toBe(400);
      expect(await (await call('/' + workflow.id)).json()).toEqual(saved);
    }
    const firstPid = child!.pid;
    await stop(); await start();
    expect(child!.pid).not.toBe(firstPid);
    expect(await (await call('/' + workflow.id)).json()).toEqual(saved);
    console.log(`Persistence receipt: backend ${firstPid} stopped; backend ${child!.pid} restored identical 3-node / 2-edge graph including parameters and timestamps. Nine invalid graphs rejected without mutation.`);
    // Overlapping PUT + DELETE: the delete must win regardless of interleaving.
    const [putStatus] = await Promise.all([call('/' + workflow.id, 'PUT', saved).then(res => res.status), call('/' + workflow.id, 'DELETE')]);
    expect([200, 404]).toContain(putStatus);
    expect((await call('/' + workflow.id)).status).toBe(404);
    expect(await (await call('')).json()).toEqual([]);
  } finally { await stop(); await rm(dir, { recursive: true, force: true }); }
}, 30000);

it('cookie login protects API routes and logout revokes the session', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ewe-auth-test-'));
  let child: ChildProcess | undefined;
  let base = '';
  async function start() {
    child = spawn(process.execPath, ['--import', 'tsx', 'src/api/server.ts', '--port', '0', '--data', join(dir, 'workflows.json')], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, EWE_BASIC_USER: 'admin', EWE_BASIC_PASS: 'secret' },
    });
    base = await new Promise<string>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`Backend startup timeout: ${output}`)), 10000);
      child!.stderr!.on('data', data => { output += data; });
      child!.stdout!.on('data', data => {
        output += data;
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      });
      child!.once('exit', code => { clearTimeout(timer); reject(new Error(`Backend exit ${code}: ${output}`)); });
    });
  }
  async function stop() {
    if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
  }
  const jsonHeaders = { 'Content-Type': 'application/json' };
  try {
    await start();
    expect((await fetch(base + '/api/workflows')).status).toBe(401);
    expect(await (await fetch(base + '/api/auth/session')).json()).toEqual({ authenticated: false, authRequired: true });
    expect((await fetch(base + '/api/auth/login', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ username: 'admin', password: 'wrong' }) })).status).toBe(401);
    const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ username: 'admin', password: 'secret' }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    expect(await (await fetch(base + '/api/workflows', { headers: { Cookie: cookie } })).json()).toEqual([]);
    const logout = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { ...jsonHeaders, Cookie: cookie }, body: JSON.stringify({}) });
    expect(logout.status).toBe(200);
    expect((await fetch(base + '/api/workflows', { headers: { Cookie: cookie } })).status).toBe(401);
    const basic = Buffer.from('admin:secret').toString('base64');
    expect(await (await fetch(base + '/api/workflows', { headers: { Authorization: `Basic ${basic}` } })).json()).toEqual([]);
  } finally { await stop(); await rm(dir, { recursive: true, force: true }); }
}, 30000);
