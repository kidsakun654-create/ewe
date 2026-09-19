import { useMemo, useState } from 'react';
import type { NodeMetadata, ParameterField } from '../nodes/registry';
import type { WorkflowNode } from '../model';
import type { CredentialSummary, CredentialType } from '../api/credentials';

const JSON_OBJECT_FIELDS = new Set(['headers', 'query', 'clientPayload']);
const JSON_ARRAY_FIELDS = new Set(['rules', 'values']);
const SECRET_FIELDS = new Set(['apiKey', 'secret', 'botToken', 'token', 'accessToken']);

const CREDENTIAL_SLOTS: Record<string, Array<{ key: string; type: CredentialType; label: string; hint: string }>> = {
  ai: [{ key: 'openaiApiKey', type: 'openaiApiKey', label: 'OpenAI API key', hint: 'Overrides the API key parameter at run time.' }],
  httpRequest: [{ key: 'httpHeaderAuth', type: 'httpHeaderAuth', label: 'HTTP header auth', hint: 'Injects one encrypted header into this request.' }],
  webhook: [{ key: 'webhookSecret', type: 'webhookSecret', label: 'Webhook secret', hint: 'Validates inbound x-ewe-secret without storing the secret in the workflow.' }],
  telegram: [{ key: 'telegramBotToken', type: 'telegramBotToken', label: 'Telegram bot token', hint: 'Injects the encrypted bot token at run time.' }],
  github: [{ key: 'githubToken', type: 'githubToken', label: 'GitHub token', hint: 'Injects the encrypted GitHub token at run time.' }],
  googleSheets: [{ key: 'googleAccessToken', type: 'googleAccessToken', label: 'Google access token', hint: 'Injects the encrypted OAuth access token at run time.' }],
};

function acceptsExpression(value: string) {
  return value.includes('{{') && value.length <= 20000;
}

function validateJson(value: string, expected: 'object' | 'array' | 'any', label: string) {
  if (!value.trim() || acceptsExpression(value)) return null;
  try {
    const parsed = JSON.parse(value);
    if (expected === 'object' && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) return `${label} must be a JSON object`;
    if (expected === 'array' && !Array.isArray(parsed)) return `${label} must be a JSON array`;
    return null;
  } catch {
    return `${label} must be valid JSON`;
  }
}

function fieldProblem(field: ParameterField, value: string, parameters: Record<string, unknown>): string | null {
  if (value === '') return field.optional ? null : `${field.label} is required`;
  if (field.kind === 'number') {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return `${field.label} must be a number`;
    if ((field.min !== undefined && parsed < field.min) || (field.max !== undefined && parsed > field.max)) return `${field.label} must be between ${field.min} and ${field.max}`;
  } else if (field.options && !field.options.includes(value)) return `${field.label} must be one of: ${field.options.join(', ')}`;

  if (JSON_OBJECT_FIELDS.has(field.key)) return validateJson(value, 'object', field.label);
  if (JSON_ARRAY_FIELDS.has(field.key)) return validateJson(value, 'array', field.label);
  if (field.key === 'body' && parameters.bodyType === 'json' && value.trim()) return validateJson(value, 'any', field.label);
  return null;
}

function fieldHint(field: ParameterField, node: WorkflowNode) {
  if (field.key === 'headers') return 'JSON object of string headers, for example {"x-api-key":"{{$json.token}}"}';
  if (field.key === 'query') return 'JSON object of query params. Values are resolved before the request runs.';
  if (field.key === 'rules') return 'JSON array. Example: [{"operator":"equals","value":"paid","port":"alpha"}]';
  if (field.key === 'values') return 'JSON row or rows. Example: ["Ada", "paid"] or [["Ada"], ["Grace"]].';
  if (field.key === 'clientPayload') return 'JSON object sent with repository_dispatch.';
  if (field.key === 'apiBaseUrl') return 'Default points to the provider API. Override only for tests or private gateways.';
  if (field.key === 'body' && node.parameters.bodyType === 'json') return 'JSON is validated before save hints; expressions are allowed.';
  if (field.key === 'apiKey') return 'Temporary plaintext field. Credentials vault is the next hardening step.';
  if (field.key === 'secret') return 'Used to validate inbound webhooks. Keep this hard to guess.';
  if (field.kind === 'number' && (field.min !== undefined || field.max !== undefined)) return `Allowed range: ${field.min ?? '-∞'} to ${field.max ?? '∞'}.`;
  if (field.options) return `Options: ${field.options.join(', ')}.`;
  return field.kind === 'multiline' ? 'Supports expressions and multi-line values.' : 'Supports expressions where the engine allows string values.';
}

function formatJson(value: string) {
  return JSON.stringify(JSON.parse(value), null, 2);
}

export default function ConfigPanel({ node, def, credentials, onParameterChange, onCredentialChange, onNameChange, onDelete }: {
  node: WorkflowNode;
  def: NodeMetadata;
  credentials: CredentialSummary[];
  onParameterChange: (key: string, value: string | number) => void;
  onCredentialChange: (key: string, credentialId: string) => void;
  onNameChange: (name: string) => void;
  onDelete: () => void;
}) {
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [fieldMessages, setFieldMessages] = useState<Record<string, string>>({});
  const problems = useMemo(() => Object.fromEntries(def.fields.map(field => [field.key, fieldProblem(field, String(node.parameters[field.key] ?? ''), node.parameters)])), [node.parameters, def.fields]);
  const credentialSlots = CREDENTIAL_SLOTS[node.type] || [];

  const markTouched = (key: string) => setTouched(current => ({ ...current, [key]: true }));
  const setFieldMessage = (key: string, value: string) => setFieldMessages(current => ({ ...current, [key]: value }));
  const resetField = (field: ParameterField) => {
    onParameterChange(field.key, field.default);
    markTouched(field.key);
    setFieldMessage(field.key, 'Reset to default');
  };
  const formatField = (field: ParameterField) => {
    try {
      const formatted = formatJson(String(node.parameters[field.key] ?? ''));
      onParameterChange(field.key, formatted);
      markTouched(field.key);
      setFieldMessage(field.key, 'Formatted JSON');
    } catch {
      markTouched(field.key);
      setFieldMessage(field.key, 'Cannot format invalid JSON');
    }
  };

  return (
    <aside className="ewe-config" data-testid="config-panel">
      <header>
        <span className="ewe-config-icon">{def.icon}</span>
        <div>
          <h2>{def.name}</h2>
          <p>{def.description}</p>
          <div className="ewe-config-ports"><span>{def.inputs.length} inputs</span><span>{def.outputs.length} outputs</span></div>
        </div>
      </header>

      <section className="ewe-config-section">
        <div className="ewe-config-section-title"><span>Identity</span></div>
        <label className="ewe-field">
          <span className="ewe-field-label">Node name <em>required</em></span>
          <input data-testid="node-name" value={node.name} onChange={event => onNameChange(event.target.value)} />
        </label>
      </section>

      {credentialSlots.length ? <section className="ewe-config-section">
        <div className="ewe-config-section-title"><span>Credentials</span><small>encrypted</small></div>
        {credentialSlots.map(slot => {
          const options = credentials.filter(item => item.type === slot.type);
          return <div key={slot.key} className="ewe-field credential-slot">
            <div className="ewe-field-label"><span>{slot.label}</span><em>optional</em></div>
            <select
              data-testid={`credential-slot-${slot.key}`}
              value={node.credentials[slot.key] || ''}
              onChange={event => onCredentialChange(slot.key, event.target.value)}
            >
              <option value="">No credential</option>
              {options.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <div className="ewe-field-meta"><span>{options.length ? slot.hint : `Create a ${slot.label} credential first.`}</span></div>
          </div>;
        })}
      </section> : null}

      <section className="ewe-config-section">
        <div className="ewe-config-section-title"><span>Parameters</span><small>{def.fields.length} fields</small></div>
        {def.fields.map(field => {
          const value = String(node.parameters[field.key] ?? '');
          const isJsonField = JSON_OBJECT_FIELDS.has(field.key) || JSON_ARRAY_FIELDS.has(field.key) || (field.key === 'body' && node.parameters.bodyType === 'json');
          const isSecret = SECRET_FIELDS.has(field.key);
          const problem = touched[field.key] ? problems[field.key] : null;

          return (
            <div key={field.key} className={`ewe-field${problem ? ' has-error' : ''}`}>
              <div className="ewe-field-label">
                <span>{field.label}</span>
                <em>{field.optional ? 'optional' : 'required'}</em>
                {acceptsExpression(value) ? <em className="is-expression">expression</em> : null}
              </div>

              <div className="ewe-field-control-row">
                {field.kind === 'select' ? (
                  <select data-testid={`param-${field.key}`} value={value} onChange={event => { markTouched(field.key); onParameterChange(field.key, event.target.value); }}>
                    {field.options!.map(option => <option key={option} value={option}>{option}</option>)}
                  </select>
                ) : field.kind === 'multiline' ? (
                  <textarea
                    data-testid={`param-${field.key}`}
                    rows={field.key === 'source' || field.key === 'prompt' || field.key === 'systemPrompt' || field.key === 'userPrompt' ? 7 : 4}
                    spellCheck={false}
                    value={value}
                    onBlur={() => markTouched(field.key)}
                    onChange={event => { markTouched(field.key); onParameterChange(field.key, event.target.value); }}
                  />
                ) : (
                  <input
                    data-testid={`param-${field.key}`}
                    type={field.kind === 'number' ? 'number' : isSecret && !revealed[field.key] ? 'password' : 'text'}
                    value={value}
                    min={field.min} max={field.max}
                    autoComplete={isSecret ? 'off' : undefined}
                    onBlur={() => markTouched(field.key)}
                    onChange={event => { markTouched(field.key); onParameterChange(field.key, field.kind === 'number' ? Number(event.target.value) : event.target.value); }}
                  />
                )}

                {isSecret ? (
                  <button type="button" className="ewe-secret-toggle" onClick={() => setRevealed(current => ({ ...current, [field.key]: !current[field.key] }))}>
                    {revealed[field.key] ? 'Hide' : 'Show'}
                  </button>
                ) : null}
              </div>

              <div className="ewe-field-meta">
                <span>{fieldHint(field, node)}</span>
                <span className="ewe-field-actions">
                  {isJsonField ? <button type="button" onClick={() => formatField(field)}>Format JSON</button> : null}
                  <button type="button" onClick={() => resetField(field)}>Reset</button>
                </span>
              </div>

              {problem && <span className="ewe-field-error" data-testid={`field-error-${field.key}`}>{problem}</span>}
              {!problem && touched[field.key] && fieldMessages[field.key] ? <span className="ewe-field-ok">{fieldMessages[field.key]}</span> : null}
            </div>
          );
        })}
      </section>

      <section className="ewe-expression-card">
        <h3>Expression shortcuts</h3>
        <code>{'{{$json.field}}'}</code>
        <code>{'{{$node["Node name"].json.field}}'}</code>
        <p>Expressions resolve at execution time from previous node output or named node output.</p>
      </section>

      <footer>
        <button type="button" className="ewe-danger" data-testid="delete-node" onClick={onDelete}>Delete node</button>
      </footer>
    </aside>
  );
}
