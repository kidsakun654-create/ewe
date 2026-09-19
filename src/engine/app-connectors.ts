import type { WorkflowNode } from '../model';
import type { NodeResult } from './executors';

function endpoint(base: unknown, path: string) {
  const url = new URL(path, String(base || '').replace(/\/+$/, '') + '/');
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Connector API base URL must use HTTP or HTTPS');
  return url;
}

function timeout(raw: unknown) {
  const ms = Number(raw);
  if (!Number.isInteger(ms) || ms < 1 || ms > 300000) throw new Error('Timeout must be an integer from 1 to 300000 ms');
  return ms;
}

function jsonObject(raw: unknown, label: string): Record<string, unknown> {
  const parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object`);
  return parsed as Record<string, unknown>;
}

async function readJsonOrText(response: Response) {
  const text = await response.text();
  if (!text) return null;
  return response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text;
}

async function postJson(url: URL, body: unknown, headers: Record<string, string>, signal: AbortSignal, ms: number) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(ms)]),
  });
  const parsed = await readJsonOrText(response);
  if (!response.ok) throw new Error(`Connector HTTP ${response.status}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)?.slice(0, 500)}`);
  return { status: response.status, headers: Object.fromEntries(response.headers), body: parsed };
}

export async function telegram(node: WorkflowNode, _input: unknown, signal: AbortSignal): Promise<NodeResult> {
  const p = node.parameters;
  const botToken = String(p.botToken || '').trim();
  if (!botToken) throw new Error('Telegram bot token is required');
  const chatId = String(p.chatId || '').trim();
  if (!chatId) throw new Error('Telegram chat ID is required');
  const url = endpoint(p.apiBaseUrl, `/bot${encodeURIComponent(botToken)}/sendMessage`);
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: String(p.text || ''),
    disable_web_page_preview: p.disableWebPagePreview === 'yes',
  };
  if (p.parseMode && p.parseMode !== 'none') body.parse_mode = p.parseMode;
  return { output: await postJson(url, body, {}, signal, timeout(p.timeout)), port: 'main' };
}

export async function github(node: WorkflowNode, _input: unknown, signal: AbortSignal): Promise<NodeResult> {
  const p = node.parameters;
  const token = String(p.token || '').trim();
  if (!token) throw new Error('GitHub token is required');
  const owner = encodeURIComponent(String(p.owner || '').trim());
  const repo = encodeURIComponent(String(p.repo || '').trim());
  if (!owner || !repo) throw new Error('GitHub owner and repository are required');
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (p.action === 'repositoryDispatch') {
    const url = endpoint(p.apiBaseUrl, `/repos/${owner}/${repo}/dispatches`);
    const payload = jsonObject(p.clientPayload || '{}', 'Dispatch client payload');
    return { output: await postJson(url, { event_type: String(p.eventType || 'ewe.workflow'), client_payload: payload }, headers, signal, timeout(p.timeout)), port: 'main' };
  }
  const url = endpoint(p.apiBaseUrl, `/repos/${owner}/${repo}/issues`);
  return { output: await postJson(url, { title: String(p.title || ''), body: String(p.body || '') }, headers, signal, timeout(p.timeout)), port: 'main' };
}

export async function googleSheets(node: WorkflowNode, _input: unknown, signal: AbortSignal): Promise<NodeResult> {
  const p = node.parameters;
  const accessToken = String(p.accessToken || '').trim();
  if (!accessToken) throw new Error('Google access token is required');
  const spreadsheetId = encodeURIComponent(String(p.spreadsheetId || '').trim());
  const range = encodeURIComponent(String(p.range || '').trim());
  if (!spreadsheetId || !range) throw new Error('Google Sheets spreadsheet ID and range are required');
  const values = typeof p.values === 'string' ? JSON.parse(p.values) : p.values;
  if (!Array.isArray(values)) throw new Error('Values must be a JSON array row or array of rows');
  const rows = values.every(item => Array.isArray(item)) ? values : [values];
  const url = endpoint(p.apiBaseUrl, `/v4/spreadsheets/${spreadsheetId}/values/${range}:append`);
  url.searchParams.set('valueInputOption', String(p.valueInputOption || 'USER_ENTERED'));
  return {
    output: await postJson(url, { values: rows }, { Authorization: `Bearer ${accessToken}` }, signal, timeout(p.timeout)),
    port: 'main',
  };
}
