import { test, expect, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';

async function connect(page: Page, source: string, target: string) {
  const from = page.locator(`[data-id="${source}"] .react-flow__handle.source`);
  const to = page.locator(`[data-id="${target}"] .react-flow__handle.target`);
  await from.click();
  await to.click();
}

async function addNode(page: Page, type: string) {
  await page.getByTestId('open-node-picker').click();
  await page.getByTestId(`add-${type}`).click();
}

test('template gallery creates a starter workflow and workspace search finds it', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByTestId('template-gallery')).toHaveCount(0);
  await page.getByTestId('template-toggle').click();
  await expect(page.getByTestId('template-gallery')).toBeVisible();
  await page.getByTestId('template-landing-page-intake').click();
  await expect(page.getByTestId('workflow-name')).toHaveValue('Landing Page Intake');
  await expect(page.getByTestId('canvas-node')).toHaveCount(4);
  await page.getByLabel('Search workflows').fill('landing page');
  await expect(page.getByTestId('workflow-list').getByRole('button', { name: 'Landing Page Intake', exact: true })).toBeVisible();

  const workflows = await (await request.get('/api/workflows')).json();
  const created = workflows.find((item: { name: string }) => item.name === 'Landing Page Intake');
  expect(created.nodes).toHaveLength(4);
  expect(created.connections).toHaveLength(3);
});

test('node context menu can quick-configure, duplicate and delete nodes', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('create-workflow').click();
  await expect(page.locator('.react-flow__minimap')).toBeVisible();
  await page.getByTestId('toggle-minimap').click();
  await expect(page.locator('.react-flow__minimap')).toHaveCount(0);
  await page.getByTestId('toggle-minimap').click();
  await expect(page.locator('.react-flow__minimap')).toBeVisible();
  await addNode(page, 'manualTrigger');
  await expect(page.getByTestId('canvas-node')).toHaveCount(1);
  const firstId = await page.locator('.react-flow__node').first().getAttribute('data-id');
  await page.locator(`[data-id="${firstId}"]`).click({ button: 'right' });
  await expect(page.getByTestId('node-context-menu')).toBeVisible();
  await page.getByRole('menuitem', { name: 'Quick config' }).click();
  await expect(page.getByTestId('quick-config-popover')).toBeVisible();
  const quickConfigBox = (await page.getByTestId('quick-config-popover').boundingBox())!;
  const quickConfigHeaderBox = (await page.getByTestId('quick-config-drag').boundingBox())!;
  await page.mouse.move(quickConfigHeaderBox.x + 120, quickConfigHeaderBox.y + 18);
  await page.mouse.down();
  await page.mouse.move(quickConfigHeaderBox.x + 190, quickConfigHeaderBox.y + 66, { steps: 8 });
  await page.mouse.up();
  const movedQuickConfigBox = (await page.getByTestId('quick-config-popover').boundingBox())!;
  expect(movedQuickConfigBox.x).toBeGreaterThan(quickConfigBox.x + 40);
  expect(movedQuickConfigBox.y).toBeGreaterThan(quickConfigBox.y + 30);
  await page.getByTestId('quick-config-popover').getByLabel('Note').fill('Configured from quick popover');
  await page.getByRole('button', { name: 'Open full config' }).click();
  await expect(page.getByTestId('param-note')).toHaveValue('Configured from quick popover');
  await page.locator(`[data-id="${firstId}"] [data-testid="node-add-next"]`).click();
  await expect(page.getByTestId('node-picker')).toBeVisible();
  await page.getByTestId('add-set').click();
  await expect(page.getByTestId('canvas-node')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  const addedId = await page.locator('.react-flow__node').last().getAttribute('data-id');
  await page.locator(`[data-id="${addedId}"]`).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(page.getByTestId('canvas-node')).toHaveCount(3);
  const duplicateId = await page.locator('.react-flow__node').last().getAttribute('data-id');
  await page.locator(`[data-id="${duplicateId}"]`).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByTestId('canvas-node')).toHaveCount(2);
});

test('edge context menu inserts a node between connected steps', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('create-workflow').click();
  await addNode(page, 'manualTrigger');
  await addNode(page, 'set');
  const ids = await page.locator('.react-flow__node').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-id')!));
  await connect(page, ids[0], ids[1]);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await page.locator('.react-flow__edge').first().click({ button: 'right', force: true });
  await expect(page.getByTestId('node-picker')).toBeVisible();
  await page.getByTestId('add-wait').click();
  await expect(page.getByTestId('canvas-node')).toHaveCount(3);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
});

test('three configured nodes and edges restore identically; deletion leaves no dangling edges', async ({ page, request }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('dialog', async dialog => { console.log('DIALOG', dialog.type(), dialog.message()); await dialog.dismiss(); });
  page.on('response', response => { if (response.url().includes('/api/')) console.log('API', response.status(), response.request().method(), response.url()); });
  await page.goto('/');
  console.log('INITIAL STATUS', await page.getByTestId('status').textContent());
  await expect(page.getByTestId('status')).toHaveText('Ready to edit');
  await page.getByTestId('create-workflow').click();
  const title = `Browser proof ${Date.now()}`;
  await page.getByTestId('workflow-name').fill(title);
  await addNode(page, 'manualTrigger');
  await page.getByTestId('param-note').fill('Manual start configuration');
  await addNode(page, 'set');
  await page.getByTestId('param-field').fill('greeting');
  await page.getByTestId('param-value').fill('Hello eWe');
  await addNode(page, 'httpRequest');
  await page.getByTestId('param-method').selectOption('POST');
  await page.getByTestId('param-url').fill('https://example.com/config-only');
  await page.getByTestId('param-body').fill('{"hello":"world"}');
  await page.getByTestId('param-timeout').fill('45000');
  await expect(page.getByTestId('canvas-node')).toHaveCount(3);
  const ids = await page.locator('.react-flow__node').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-id')!));
  const node = page.locator(`[data-id="${ids[1]}"] .ewe-node-name`);
  const box = (await node.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + 110, { steps: 12 });
  await page.mouse.up();
  await connect(page, ids[0], ids[1]);
  await connect(page, ids[1], ids[2]);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await page.getByTestId('save-workflow').click();
  await expect(page.getByTestId('status')).toHaveText('Saved');
  await expect(page.getByTestId('workflow-list').getByRole('button', { name: title, exact: true })).toBeVisible();
  const workflows = await (await request.get('/api/workflows')).json();
  const saved = workflows.find((workflow: { name: string }) => workflow.name === title);
  expect(saved.nodes).toHaveLength(3);
  expect(saved.connections).toHaveLength(2);
  expect(saved.nodes[1].position.x).toBeGreaterThan(290);
  expect(saved.nodes[1].position.y).toBeGreaterThan(100);
  expect(saved.nodes[1].parameters).toEqual({ field: 'greeting', value: 'Hello eWe' });
  expect(saved.nodes[2].parameters.timeout).toBe(45000);
  writeFileSync(info.outputPath('saved-graph.json'), JSON.stringify(saved, null, 2));
  await info.attach('saved-graph.json', { body: JSON.stringify(saved, null, 2), contentType: 'application/json' });
  // Loading a graph must not manufacture unsaved changes.
  await page.reload();
  await page.getByTestId('workflow-list').getByRole('button', { name: title, exact: true }).click();
  await expect(page.getByTestId('status')).toHaveText('Ready to edit');
  await page.getByTestId('workflow-list').getByRole('button', { name: title, exact: true }).click();
  await expect(page.getByTestId('status')).toHaveText('Ready to edit');
  await page.reload();
  await page.getByTestId('workflow-list').getByRole('button', { name: title, exact: true }).click();
  await expect(page.getByTestId('canvas-node')).toHaveCount(3);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await page.getByTestId('save-workflow').click();
  await expect(page.getByTestId('status')).toHaveText('Saved');
  const restored = await (await request.get('/api/workflows/' + saved.id)).json();
  expect(restored.nodes).toEqual(saved.nodes);
  expect(restored.connections).toEqual(saved.connections);
  expect(restored.settings).toEqual(saved.settings);
  await page.locator(`[data-id="${ids[2]}"]`).click();
  await expect(page.getByTestId('param-method')).toHaveValue('POST');
  await expect(page.getByTestId('param-url')).toHaveValue('https://example.com/config-only');
  await page.screenshot({ path: info.outputPath('restored-editor.png') });
  // The same controlled viewport used for save/load must respond to UI controls.
  const viewport = page.locator('.react-flow__viewport');
  const beforeZoom = await viewport.getAttribute('style');
  await page.getByRole('button', { name: 'Zoom In', exact: true }).click();
  await expect(viewport).not.toHaveAttribute('style', beforeZoom!);
  const beforePan = await viewport.getAttribute('style');
  const canvas = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(canvas.x + 400, canvas.y + 550);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 460, canvas.y + 610, { steps: 10 });
  await page.mouse.up();
  await expect(viewport).not.toHaveAttribute('style', beforePan!);
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  // Disconnect through the keyboard, reconnect, then delete the middle node.
  const edge = page.locator('.react-flow__edge').first();
  await edge.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Delete');
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await connect(page, ids[0], ids[1]);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await page.locator(`[data-id="${ids[1]}"]`).click();
  await expect(page.getByTestId('param-value')).toHaveValue('Hello eWe');
  await page.getByTestId('delete-node').click();
  await expect(page.getByTestId('canvas-node')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await page.getByTestId('save-workflow').click();
  await expect(page.getByTestId('status')).toHaveText('Saved');
  const deleted = await (await request.get('/api/workflows/' + saved.id)).json();
  expect(deleted.connections).toEqual([]);
  expect(deleted.nodes.map((node: { id: string }) => node.id)).not.toContain(ids[1]);
  expect(errors).toEqual([]);
  await info.attach('browser-errors.json', { body: JSON.stringify(errors), contentType: 'application/json' });
});
