import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test, expect, afterEach } from 'vitest';
import { CredentialStore } from '../src/api/credentials';
import { validateWorkflow } from '../src/validation';
import { workflowDocument } from '../src/transfer';
import type { Workflow } from '../src/model';

let dir = '';

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = '';
});

function workflow(credentialId: string): Workflow {
  const now = new Date().toISOString();
  return {
    id: 'wf-credentials',
    name: 'Credential workflow',
    enabled: false,
    settings: {},
    createdAt: now,
    updatedAt: now,
    nodes: [
      {
        id: 'n-ai',
        type: 'ai',
        name: 'AI',
        position: { x: 0, y: 0 },
        credentials: { openaiApiKey: credentialId },
        parameters: {
          baseUrl: 'https://api.openai.com',
          apiKey: '',
          model: 'gpt-4o-mini',
          systemPrompt: 'Test',
          userPrompt: 'Hello',
          temperature: 0.7,
          stream: 'no',
          timeout: 30000,
        },
      },
    ],
    connections: [],
  };
}

test('credentials are encrypted, hydrate workflows, and export without references', async () => {
  dir = await mkdtemp(join(tmpdir(), 'ewe-credentials-'));
  const store = new CredentialStore(join(dir, 'credentials.json'));
  const created = store.create({ name: 'OpenAI prod', type: 'openaiApiKey', data: { apiKey: 'sk-secret-value' } });

  expect(store.list()).toEqual([created]);
  const raw = await readFile(join(dir, 'credentials.json'), 'utf8');
  expect(raw).not.toContain('sk-secret-value');

  const saved = workflow(created.id);
  expect(validateWorkflow(saved)).toBeNull();
  const hydrated = store.hydrateWorkflow(saved);
  expect(hydrated.nodes[0].parameters.apiKey).toBe('sk-secret-value');
  expect(workflowDocument(saved).nodes[0].credentials).toEqual({});
});

test('HTTP header credentials inject encrypted header parameters at runtime', async () => {
  dir = await mkdtemp(join(tmpdir(), 'ewe-credentials-'));
  const store = new CredentialStore(join(dir, 'credentials.json'));
  const created = store.create({ name: 'Bearer token', type: 'httpHeaderAuth', data: { headerName: 'Authorization', headerValue: 'Bearer secret' } });
  const now = new Date().toISOString();
  const saved: Workflow = {
    id: 'wf-http-credential',
    name: 'HTTP credential',
    enabled: false,
    settings: {},
    createdAt: now,
    updatedAt: now,
    nodes: [{
      id: 'n-http',
      type: 'httpRequest',
      name: 'HTTP',
      position: { x: 0, y: 0 },
      credentials: { httpHeaderAuth: created.id },
      parameters: { method: 'GET', url: 'https://example.com', headers: '{"x-base":"yes"}', query: '{}', bodyType: 'raw', body: '', timeout: 30000 },
    }],
    connections: [],
  };

  const hydrated = store.hydrateWorkflow(saved);
  expect(JSON.parse(String(hydrated.nodes[0].parameters.headers))).toEqual({ 'x-base': 'yes', Authorization: 'Bearer secret' });
});

test('app connector credentials hydrate only at runtime', async () => {
  dir = await mkdtemp(join(tmpdir(), 'ewe-credentials-'));
  const store = new CredentialStore(join(dir, 'credentials.json'));
  const telegram = store.create({ name: 'Telegram bot', type: 'telegramBotToken', data: { botToken: '123:telegram' } });
  const github = store.create({ name: 'GitHub automation', type: 'githubToken', data: { token: 'ghp_secret' } });
  const google = store.create({ name: 'Google Sheets', type: 'googleAccessToken', data: { accessToken: 'ya29.secret' } });
  const now = new Date().toISOString();
  const saved: Workflow = {
    id: 'wf-connectors',
    name: 'Connector credentials',
    enabled: false,
    settings: {},
    createdAt: now,
    updatedAt: now,
    nodes: [
      { id: 'tg', type: 'telegram', name: 'Telegram', position: { x: 0, y: 0 }, credentials: { telegramBotToken: telegram.id }, parameters: { apiBaseUrl: 'https://api.telegram.org', botToken: '', chatId: '1', text: 'Hi', parseMode: 'none', disableWebPagePreview: 'no', timeout: 30000 } },
      { id: 'gh', type: 'github', name: 'GitHub', position: { x: 0, y: 0 }, credentials: { githubToken: github.id }, parameters: { apiBaseUrl: 'https://api.github.com', token: '', action: 'createIssue', owner: 'kdbdevs', repo: 'ewe', title: 'Issue', body: '', eventType: 'ewe.workflow', clientPayload: '{}', timeout: 30000 } },
      { id: 'gs', type: 'googleSheets', name: 'Sheets', position: { x: 0, y: 0 }, credentials: { googleAccessToken: google.id }, parameters: { apiBaseUrl: 'https://sheets.googleapis.com', accessToken: '', spreadsheetId: 'sheet', range: 'Sheet1!A:Z', values: '["Hi"]', valueInputOption: 'USER_ENTERED', timeout: 30000 } },
    ],
    connections: [],
  };

  const hydrated = store.hydrateWorkflow(saved);
  expect(hydrated.nodes[0].parameters.botToken).toBe('123:telegram');
  expect(hydrated.nodes[1].parameters.token).toBe('ghp_secret');
  expect(hydrated.nodes[2].parameters.accessToken).toBe('ya29.secret');
  expect(workflowDocument(saved).nodes.map(node => node.credentials)).toEqual([{}, {}, {}]);
});
