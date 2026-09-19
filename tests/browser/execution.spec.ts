import { test, expect } from '@playwright/test';
import http from 'node:http';
import { once } from 'node:events';
import { defaultParameters, getNodeMetadata } from '../../src/nodes/registry';

test('Run shows running → success and Stop shows cancelled with no browser errors', async ({ page, request }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('dialog', async dialog => { expect(dialog.message()).toContain('Production safety review required'); await dialog.accept(); });
  const pending: http.ServerResponse[] = [];
  const server = http.createServer((req, res) => { req.resume(); pending.push(res); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const workflow = await (await request.post('/api/workflows', { data: { name: 'UI execution proof' } })).json();
    workflow.nodes = ['manualTrigger', 'set', 'if', 'httpRequest'].map((type, i) => ({ id: `run${i}`, type, name: type, position: { x: 20 + i * 220, y: 100 }, parameters: defaultParameters(getNodeMetadata(type)!), credentials: {} }));
    workflow.nodes[1].parameters.value = 'yes';
    workflow.nodes[2].parameters.value = 'yes';
    workflow.nodes[3].parameters.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    workflow.connections = [0, 1, 2].map(i => ({ id: `link${i}`, source: `run${i}`, target: `run${i + 1}`, sourcePort: i === 2 ? 'true' : 'main', targetPort: 'main' }));
    expect((await request.put('/api/workflows/' + workflow.id, { data: workflow })).ok()).toBeTruthy();
    await page.goto('/');
    await page.getByTestId('workflow-list').getByRole('button', { name: workflow.name }).click();
    await page.getByRole('button', { name: 'Fit View', exact: true }).click();
    await page.getByTestId('run-workflow').click();
    const httpNode = page.locator('[data-id="run3"] [data-testid="node-status"]');
    await expect(httpNode).toHaveText('running');
    await expect(page.getByTestId('execution-progress')).toBeVisible();
    await expect(page.getByTestId('execution-focus-node')).toContainText('httpRequest');
    await expect(page.getByTestId('run-workflow')).toBeDisabled();
    await expect.poll(() => pending.length).toBe(1);
    await page.screenshot({ path: info.outputPath('running.png') });
    pending[0].writeHead(200, { 'Content-Type': 'application/json' }); pending[0].end('{"ok":true}');
    await expect(httpNode).toHaveText('success');
    await expect(page.getByTestId('execution-result')).toContainText('success');
    await expect(page.getByTestId('execution-progress')).toHaveText('100%');
    await page.screenshot({ path: info.outputPath('success.png') });
    await page.getByTestId('run-workflow').click();
    await expect(httpNode).toHaveText('running');
    await page.getByTestId('stop-workflow').click();
    await expect(httpNode).toHaveText('cancelled');
    await expect(page.getByTestId('execution-result')).toContainText('cancelled');
    expect(errors).toEqual([]);
    await info.attach('browser-errors.json', { body: JSON.stringify(errors), contentType: 'application/json' });
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
