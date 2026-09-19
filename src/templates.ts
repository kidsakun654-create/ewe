import type { Workflow } from './model';

export interface WorkflowTemplate {
  id: string;
  name: string;
  summary: string;
  useCase: string;
  workflow: Workflow;
}

const timestamp = '2026-01-01T00:00:00.000Z';

export const workflowTemplates: WorkflowTemplate[] = [
  {
    id: 'landing-page-intake',
    name: 'Landing Page Intake',
    summary: 'Capture a brief, ask AI for structure, then prepare implementation notes.',
    useCase: 'Frontend delivery',
    workflow: {
      id: 'template-landing-page-intake',
      name: 'Template - Landing Page Intake',
      enabled: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      settings: { viewport: { x: 68, y: 48, zoom: 0.82 } },
      nodes: [
        { id: 'brief', type: 'manualTrigger', name: 'Brief received', position: { x: 40, y: 120 }, parameters: { note: 'Paste the client brief before running.' }, credentials: {} },
        { id: 'normalize', type: 'set', name: 'Normalize brief', position: { x: 310, y: 120 }, parameters: { field: 'brief', value: '{{$json}}' }, credentials: {} },
        { id: 'strategy', type: 'ai', name: 'Landing strategy', position: { x: 590, y: 120 }, parameters: {
          baseUrl: 'https://api.openai.com',
          apiKey: '',
          model: 'gpt-4o-mini',
          systemPrompt: 'You are a senior landing page strategist. Return concise sections, motion ideas, and asset direction.',
          userPrompt: 'Create a premium landing page plan from this brief: {{$json.brief}}',
          temperature: 0.6,
          stream: 'no',
          timeout: 30000,
        }, credentials: {} },
        { id: 'handoff', type: 'set', name: 'Build handoff', position: { x: 875, y: 120 }, parameters: { field: 'handoff', value: 'Ready for frontend build: {{$json}}' }, credentials: {} },
      ],
      connections: [
        { id: 'edge-brief-normalize', source: 'brief', target: 'normalize', sourcePort: 'main', targetPort: 'main' },
        { id: 'edge-normalize-strategy', source: 'normalize', target: 'strategy', sourcePort: 'main', targetPort: 'main' },
        { id: 'edge-strategy-handoff', source: 'strategy', target: 'handoff', sourcePort: 'main', targetPort: 'main' },
      ],
    },
  },
  {
    id: 'webhook-content-triage',
    name: 'Webhook Content Triage',
    summary: 'Receive inbound ideas, classify priority, and route publishing work.',
    useCase: 'Content ops',
    workflow: {
      id: 'template-webhook-content-triage',
      name: 'Template - Webhook Content Triage',
      enabled: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      settings: { viewport: { x: 80, y: 70, zoom: 0.78 } },
      nodes: [
        { id: 'incoming', type: 'webhook', name: 'Incoming idea', position: { x: 40, y: 150 }, parameters: { path: '/hooks/content-ideas', secret: '', enabled: 'no' }, credentials: {} },
        { id: 'topic', type: 'set', name: 'Extract topic', position: { x: 310, y: 150 }, parameters: { field: 'topic', value: '{{$json.topic}}' }, credentials: {} },
        { id: 'priority', type: 'switch', name: 'Priority route', position: { x: 585, y: 150 }, parameters: {
          field: 'topic',
          mode: 'first',
          rules: '[{"operator":"contains","value":"launch","port":"alpha"},{"operator":"contains","value":"urgent","port":"beta"}]',
          defaultPort: 'default',
        }, credentials: {} },
        { id: 'hot', type: 'set', name: 'Fast lane', position: { x: 870, y: 40 }, parameters: { field: 'lane', value: 'fast-lane' }, credentials: {} },
        { id: 'normal', type: 'set', name: 'Research lane', position: { x: 870, y: 150 }, parameters: { field: 'lane', value: 'research' }, credentials: {} },
        { id: 'backlog', type: 'set', name: 'Backlog lane', position: { x: 870, y: 260 }, parameters: { field: 'lane', value: 'backlog' }, credentials: {} },
      ],
      connections: [
        { id: 'edge-incoming-topic', source: 'incoming', target: 'topic', sourcePort: 'main', targetPort: 'main' },
        { id: 'edge-topic-priority', source: 'topic', target: 'priority', sourcePort: 'main', targetPort: 'main' },
        { id: 'edge-priority-hot', source: 'priority', target: 'hot', sourcePort: 'alpha', targetPort: 'main' },
        { id: 'edge-priority-normal', source: 'priority', target: 'normal', sourcePort: 'beta', targetPort: 'main' },
        { id: 'edge-priority-backlog', source: 'priority', target: 'backlog', sourcePort: 'default', targetPort: 'main' },
      ],
    },
  },
  {
    id: 'api-health-monitor',
    name: 'API Health Monitor',
    summary: 'Run a schedule, call an endpoint, and produce a small health payload.',
    useCase: 'Ops automation',
    workflow: {
      id: 'template-api-health-monitor',
      name: 'Template - API Health Monitor',
      enabled: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      settings: { viewport: { x: 60, y: 52, zoom: 0.84 } },
      nodes: [
        { id: 'timer', type: 'schedule', name: 'Every 5 minutes', position: { x: 40, y: 120 }, parameters: { cron: '*/5 * * * *', enabled: 'no', runMissed: 'no' }, credentials: {} },
        { id: 'ping', type: 'httpRequest', name: 'Check endpoint', position: { x: 315, y: 120 }, parameters: { method: 'GET', url: 'https://example.com/health', headers: '{}', query: '{}', bodyType: 'raw', body: '', timeout: 15000 }, credentials: {} },
        { id: 'shape', type: 'set', name: 'Health summary', position: { x: 600, y: 120 }, parameters: { field: 'health', value: 'Endpoint responded: {{$json.status}}' }, credentials: {} },
      ],
      connections: [
        { id: 'edge-timer-ping', source: 'timer', target: 'ping', sourcePort: 'main', targetPort: 'main' },
        { id: 'edge-ping-shape', source: 'ping', target: 'shape', sourcePort: 'main', targetPort: 'main' },
      ],
    },
  },
];
