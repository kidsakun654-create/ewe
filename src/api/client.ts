import type { Workflow } from '../model';
import type { Execution } from '../engine/types';
import type { CredentialSummary, CredentialType, CredentialPayload } from './credentials';

async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(base + path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...init });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || `Request failed (${res.status})`);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
export interface WorkflowSummary { id: string; name: string; }
export interface AuthSession { authenticated: boolean; authRequired: boolean; }
export const api = {
  session: () => request<AuthSession>('/api/auth', '/session'),
  login: (username: string, password: string) => request<AuthSession>('/api/auth', '/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request<AuthSession>('/api/auth', '/logout', { method: 'POST', body: JSON.stringify({}) }),
  import: (workflow: Workflow) => request<Workflow>('/api/workflows', '/import', { method: 'POST', body: JSON.stringify(workflow) }),
  executions: (id: string) => request<Execution[]>('/api/workflows', `/${id}/executions`),
  start: (id: string) => request<Execution>('/api/workflows', `/${id}/executions`, { method: 'POST' }),
  execution: (id: string, executionId: string) => request<Execution>('/api/workflows', `/${id}/executions/${executionId}`),
  cancel: (id: string, executionId: string) => request<Execution>('/api/workflows', `/${id}/executions/${executionId}/cancel`, { method: 'POST' }),
  list: () => request<WorkflowSummary[]>('/api/workflows', ''),
  create: (name: string) => request<Workflow>('/api/workflows', '', { method: 'POST', body: JSON.stringify({ name }) }),
  get: (id: string) => request<Workflow>('/api/workflows', '/' + id),
  save: (workflow: Workflow) => request<Workflow>('/api/workflows', '/' + workflow.id, { method: 'PUT', body: JSON.stringify(workflow) }),
  deleteWorkflow: (id: string) => request<void>('/api/workflows', '/' + id, { method: 'DELETE' }),
  credentials: () => request<CredentialSummary[]>('/api/credentials', ''),
  createCredential: (input: { name: string; type: CredentialType; data: CredentialPayload }) =>
    request<CredentialSummary>('/api/credentials', '', { method: 'POST', body: JSON.stringify(input) }),
  deleteCredential: (id: string) => request<void>('/api/credentials', '/' + id, { method: 'DELETE' }),
};
