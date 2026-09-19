import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ─── Phase 7: Polish coverage ─────────────────────────────────────

test('KeyboardHelp modal markup is valid', () => {
  const html = readFileSync(new URL('../src/editor/KeyboardHelp.tsx', import.meta.url), 'utf8');
  expect(html).toContain('ewe-modal-overlay');
  expect(html).toContain('ewe-kbd-row');
  expect(html).toContain('kbd');
  expect(html).toContain('onClose');
  expect(html).toContain('Escape');
});

test('KeyboardHelp lists Ctrl/⌘ shortcuts', () => {
  const src = readFileSync(new URL('../src/editor/KeyboardHelp.tsx', import.meta.url), 'utf8');
  expect(src).toContain('Ctrl/⌘');
  expect(src).toContain('Save workflow');
  expect(src).toContain('Run workflow');
});

test('App.tsx renders keyboard help toggle', () => {
  const src = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  expect(src).toContain('KeyboardHelp');
  expect(src).toContain('helpOpen');
  expect(src).toContain('ewe-help-btn');
  expect(src).toContain('save()');
  expect(src).toContain('execute()');
});

test('CSS includes Phase 7 polish classes', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  expect(css).toContain('ewe-modal-overlay');
  expect(css).toContain('ewe-kbd-row');
  expect(css).toContain('skeleton');
  expect(css).toContain('shimmer');
  expect(css).toContain('result-success');
  expect(css).toContain('result-error');
  expect(css).toContain('is-error');
  expect(css).toContain('is-result');
});

test('Config panel includes polished field controls', () => {
  const src = readFileSync(new URL('../src/editor/ConfigPanel.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  expect(src).toContain('SECRET_FIELDS');
  expect(src).toContain('Format JSON');
  expect(src).toContain('ewe-config-section');
  expect(src).toContain('ewe-expression-card');
  expect(css).toContain('ewe-field-actions');
  expect(css).toContain('ewe-secret-toggle');
});

test('Phase 6 AI node fields in registry', async () => {
  const { getNodeMetadata } = await import('../src/nodes/registry');
  const meta = getNodeMetadata('ai');
  expect(meta).toBeDefined();
  expect(meta!.type).toBe('ai');
  expect(meta!.fields.length).toBe(8);
});

test('Phase 6 Hermes node fields in registry', async () => {
  const { getNodeMetadata } = await import('../src/nodes/registry');
  const meta = getNodeMetadata('hermesAgent');
  expect(meta).toBeDefined();
  expect(meta!.type).toBe('hermesAgent');
  expect(meta!.fields.length).toBe(4);
});

test('All nodes total count includes native app connectors', async () => {
  const { registry } = await import('../src/nodes/registry');
  expect(registry.length).toBe(16);
  expect(registry.map(def => def.type)).toEqual(expect.arrayContaining(['telegram', 'github', 'googleSheets']));
});
