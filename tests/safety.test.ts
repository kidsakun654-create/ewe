import { describe, expect, it } from 'vitest';
import type { Workflow } from '../src/model';
import { analyzeWorkflowSafety, hasBlockingSafetyRisk } from '../src/safety';

const base: Workflow = {
  id: 'safe-test',
  name: 'Safety test',
  enabled: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  settings: {},
  nodes: [],
  connections: [],
};

describe('production safety analysis', () => {
  it('flags production side effects and inline secrets as blocking risk', () => {
    const findings = analyzeWorkflowSafety({
      ...base,
      nodes: [
        { id: 'start', type: 'manualTrigger', name: 'Start', position: { x: 0, y: 0 }, credentials: {}, parameters: { note: '' } },
        { id: 'post', type: 'httpRequest', name: 'Write API', position: { x: 200, y: 0 }, credentials: {}, parameters: { method: 'POST', url: 'https://api.example.test/orders', headers: '{}', query: '{}', bodyType: 'json', body: '{}', timeout: 30000 } },
        { id: 'ai', type: 'ai', name: 'AI', position: { x: 400, y: 0 }, credentials: {}, parameters: { baseUrl: 'https://api.openai.com', apiKey: 'secret', model: 'gpt-4o-mini', systemPrompt: '', userPrompt: '', temperature: 0.7, stream: 'no', timeout: 30000 } },
      ],
    });

    expect(findings.map(finding => finding.id)).toContain('post:http-mutating');
    expect(findings.map(finding => finding.id)).toContain('ai:inline-ai-key');
    expect(hasBlockingSafetyRisk(findings)).toBe(true);
  });

  it('keeps local read-only request workflows non-blocking', () => {
    const findings = analyzeWorkflowSafety({
      ...base,
      nodes: [
        { id: 'start', type: 'manualTrigger', name: 'Start', position: { x: 0, y: 0 }, credentials: {}, parameters: { note: '' } },
        { id: 'get', type: 'httpRequest', name: 'Read local', position: { x: 200, y: 0 }, credentials: {}, parameters: { method: 'GET', url: 'http://127.0.0.1:3000/health', headers: '{}', query: '{}', bodyType: 'raw', body: '', timeout: 30000 } },
      ],
    });

    expect(findings).toEqual([]);
    expect(hasBlockingSafetyRisk(findings)).toBe(false);
  });
});
