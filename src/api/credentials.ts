import { randomBytes, randomUUID, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, fsyncSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Workflow } from '../model';

export type CredentialType = 'openaiApiKey' | 'httpHeaderAuth' | 'webhookSecret' | 'telegramBotToken' | 'githubToken' | 'googleAccessToken';

export interface CredentialSummary {
  id: string;
  name: string;
  type: CredentialType;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialPayload {
  apiKey?: string;
  headerName?: string;
  headerValue?: string;
  secret?: string;
  botToken?: string;
  token?: string;
  accessToken?: string;
}

interface StoredCredential extends CredentialSummary {
  iv: string;
  tag: string;
  data: string;
}

const VALID_TYPES = new Set<CredentialType>(['openaiApiKey', 'httpHeaderAuth', 'webhookSecret', 'telegramBotToken', 'githubToken', 'googleAccessToken']);

function writeAtomic(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path + '.tmp', 'w', 0o600);
  try { writeFileSync(fd, JSON.stringify(value, null, 2)); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(path + '.tmp', path);
}

function getOrCreateKey(path: string) {
  if (process.env.EWE_CREDENTIALS_KEY) {
    const raw = Buffer.from(process.env.EWE_CREDENTIALS_KEY, 'base64');
    if (raw.length === 32) return raw;
    throw new Error('EWE_CREDENTIALS_KEY must be base64 for exactly 32 bytes');
  }
  if (existsSync(path)) {
    const raw = Buffer.from(readFileSync(path, 'utf8').trim(), 'base64');
    if (raw.length === 32) return raw;
  }
  const key = randomBytes(32);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, key.toString('base64'), { mode: 0o600 });
  return key;
}

function assertPayload(type: CredentialType, payload: CredentialPayload) {
  if (type === 'openaiApiKey' && !String(payload.apiKey || '').trim()) throw new Error('OpenAI API key is required');
  if (type === 'httpHeaderAuth') {
    if (!String(payload.headerName || '').trim()) throw new Error('Header name is required');
    if (!String(payload.headerValue || '').trim()) throw new Error('Header value is required');
  }
  if (type === 'webhookSecret' && !String(payload.secret || '').trim()) throw new Error('Webhook secret is required');
  if (type === 'telegramBotToken' && !String(payload.botToken || '').trim()) throw new Error('Telegram bot token is required');
  if (type === 'githubToken' && !String(payload.token || '').trim()) throw new Error('GitHub token is required');
  if (type === 'googleAccessToken' && !String(payload.accessToken || '').trim()) throw new Error('Google access token is required');
}

export class CredentialStore {
  private readonly key: Buffer;
  constructor(private readonly path: string) {
    this.key = getOrCreateKey(path + '.key');
    this.read();
  }

  private read(): StoredCredential[] {
    if (!existsSync(this.path)) return [];
    const data = JSON.parse(readFileSync(this.path, 'utf8'));
    if (!Array.isArray(data)) throw new Error('Credential storage must contain an array');
    return data;
  }

  private write(data: StoredCredential[]) {
    writeAtomic(this.path, data);
  }

  private encrypt(value: CredentialPayload) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  }

  private decrypt(item: StoredCredential): CredentialPayload {
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(item.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(item.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(item.data, 'base64')), decipher.final()]).toString('utf8'));
  }

  list(): CredentialSummary[] {
    return this.read().map(({ id, name, type, createdAt, updatedAt }) => ({ id, name, type, createdAt, updatedAt }));
  }

  get(id: string) {
    const item = this.read().find(credential => credential.id === id);
    if (!item) return null;
    return { summary: { id: item.id, name: item.name, type: item.type, createdAt: item.createdAt, updatedAt: item.updatedAt }, payload: this.decrypt(item) };
  }

  create(input: { name: string; type: CredentialType; data: CredentialPayload }) {
    if (!VALID_TYPES.has(input.type)) throw new Error('Unsupported credential type');
    const name = input.name.trim();
    if (!name || name.length > 120) throw new Error('Credential name must be 1-120 characters');
    assertPayload(input.type, input.data);
    const now = new Date().toISOString();
    const encrypted = this.encrypt(input.data);
    const credential: StoredCredential = { id: randomUUID(), name, type: input.type, createdAt: now, updatedAt: now, ...encrypted };
    this.write([...this.read(), credential]);
    return { id: credential.id, name: credential.name, type: credential.type, createdAt: credential.createdAt, updatedAt: credential.updatedAt };
  }

  delete(id: string) {
    this.write(this.read().filter(credential => credential.id !== id));
  }

  verify(id: string, value: string) {
    const found = this.get(id);
    if (!found) return false;
    const secret = found.payload.apiKey || found.payload.headerValue || found.payload.secret || found.payload.botToken || found.payload.token || found.payload.accessToken || '';
    const a = Buffer.from(secret);
    const b = Buffer.from(value);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  hydrateWorkflow(workflow: Workflow): Workflow {
    return {
      ...workflow,
      nodes: workflow.nodes.map(node => {
        const parameters = { ...node.parameters };
        if (node.type === 'ai' && node.credentials.openaiApiKey) {
          const credential = this.get(node.credentials.openaiApiKey);
          if (credential?.payload.apiKey) parameters.apiKey = credential.payload.apiKey;
        }
        if (node.type === 'httpRequest' && node.credentials.httpHeaderAuth) {
          const credential = this.get(node.credentials.httpHeaderAuth);
          if (credential?.payload.headerName && credential.payload.headerValue) {
            const current = typeof parameters.headers === 'string' && parameters.headers.trim() ? JSON.parse(parameters.headers) : {};
            parameters.headers = JSON.stringify({ ...current, [credential.payload.headerName]: credential.payload.headerValue });
          }
        }
        if (node.type === 'webhook' && node.credentials.webhookSecret) {
          const credential = this.get(node.credentials.webhookSecret);
          if (credential?.payload.secret) parameters.secret = credential.payload.secret;
        }
        if (node.type === 'telegram' && node.credentials.telegramBotToken) {
          const credential = this.get(node.credentials.telegramBotToken);
          if (credential?.payload.botToken) parameters.botToken = credential.payload.botToken;
        }
        if (node.type === 'github' && node.credentials.githubToken) {
          const credential = this.get(node.credentials.githubToken);
          if (credential?.payload.token) parameters.token = credential.payload.token;
        }
        if (node.type === 'googleSheets' && node.credentials.googleAccessToken) {
          const credential = this.get(node.credentials.googleAccessToken);
          if (credential?.payload.accessToken) parameters.accessToken = credential.payload.accessToken;
        }
        return { ...node, parameters };
      }),
    };
  }
}
