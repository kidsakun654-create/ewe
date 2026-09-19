export interface ParameterField {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'select' | 'multiline';
  default: string | number;
  optional?: boolean;
  options?: string[];
  min?: number;
  max?: number;
}
export interface NodeMetadata {
  type: string;
  name: string;
  icon: string;
  description: string;
  inputs: string[];
  outputs: string[];
  fields: ParameterField[];
}

export const registry: NodeMetadata[] = [
  { type: 'manualTrigger', name: 'Manual Trigger', icon: '▷',
    description: 'Start the workflow by hand with the Run button.',
    inputs: [], outputs: ['main'], fields: [
      { key: 'note', label: 'Note', kind: 'text', default: '' },
    ] },
  { type: 'webhook', name: 'Webhook', icon: '⚡',
    description: 'Receive data from an external HTTP POST. Local-only, requires enable.',
    inputs: [], outputs: ['main'], fields: [
      { key: 'path', label: 'URL path (e.g. /hooks/new-order)', kind: 'text', default: '/hooks/incoming' },
      { key: 'secret', label: 'Secret (validated, optional)', kind: 'text', default: '', optional: true },
      { key: 'enabled', label: 'Enabled', kind: 'select', default: 'yes', options: ['yes', 'no'] },
    ] },
  { type: 'schedule', name: 'Schedule', icon: '⏰',
    description: 'Run on a cron schedule. Durable across restarts, local-only.',
    inputs: [], outputs: ['main'], fields: [
      { key: 'cron', label: 'Cron expression (e.g. */5 * * * *)', kind: 'text', default: '*/5 * * * *' },
      { key: 'enabled', label: 'Enabled', kind: 'select', default: 'yes', options: ['yes', 'no'] },
      { key: 'runMissed', label: 'Run missed on startup', kind: 'select', default: 'no', options: ['yes', 'no'] },
    ] },
  { type: 'set', name: 'Set', icon: '◇',
    description: 'Create or modify one field on the passing data.',
    inputs: ['main'], outputs: ['main'], fields: [
      { key: 'field', label: 'Field name', kind: 'text', default: 'message' },
      { key: 'value', label: 'Value', kind: 'multiline', default: '' },
    ] },
  { type: 'if', name: 'IF', icon: '?',
    description: 'Compare a top-level input field to a literal value and route true/false.',
    inputs: ['main'], outputs: ['true', 'false'], fields: [
      { key: 'field', label: 'Field name', kind: 'text', default: 'message' },
      { key: 'operator', label: 'Operator', kind: 'select', default: 'equals', options: ['equals'] },
      { key: 'value', label: 'Compare value', kind: 'text', default: '' },
    ] },
  { type: 'switch', name: 'Switch', icon: '⑂',
    description: 'Route data into multiple branches based on field conditions.',
    inputs: ['main'], outputs: ['alpha', 'beta', 'default'], fields: [
      { key: 'field', label: 'Field name', kind: 'text', default: 'status' },
      { key: 'mode', label: 'Mode', kind: 'select', default: 'first', options: ['first', 'all'] },
      { key: 'rules', label: 'Rules (JSON array of {operator, value, port})', kind: 'multiline', default: '[]' },
      { key: 'defaultPort', label: 'Default port (no match)', kind: 'text', default: 'default' },
    ] },
  { type: 'merge', name: 'Merge', icon: '⊕',
    description: 'Combine data from multiple branches into one.',
    inputs: ['main'], outputs: ['main'], fields: [
      { key: 'mode', label: 'Merge mode', kind: 'select', default: 'append', options: ['append', 'merge'] },
    ] },
  { type: 'loop', name: 'Loop', icon: '↻',
    description: 'Process multiple items from input. Fan-in supported.',
    inputs: ['main'], outputs: ['main'], fields: [
      { key: 'sourceField', label: 'Source field', kind: 'text', default: 'items' },
      { key: 'maxIterations', label: 'Max iterations', kind: 'number', default: 100, min: 1, max: 10000 },
    ] },
  { type: 'code', name: 'Code', icon: '{ }',
    description: 'Run custom JS in an isolated sandbox (QuickJS). No Node.js access, 5s timeout.',
    inputs: ['main'], outputs: ['main', 'error'], fields: [
      { key: 'source', label: 'JavaScript code', kind: 'multiline', default: 'return input;' },
      { key: 'timeout', label: 'Timeout (ms)', kind: 'number', default: 5000, min: 100, max: 30000 },
    ] },
  { type: 'wait', name: 'Wait', icon: '⏸',
    description: 'Pause execution for a duration. Cancellable.',
    inputs: ['main'], outputs: ['main'], fields: [
      { key: 'duration', label: 'Duration (ms)', kind: 'number', default: 1000, min: 1, max: 300000 },
    ] },
  { type: 'httpRequest', name: 'HTTP Request', icon: '↗',
    description: 'Send a real HTTP request when the workflow runs.',
    inputs: ['main'], outputs: ['main'], fields: [
      { key: 'method', label: 'Method', kind: 'select', default: 'GET', options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
      { key: 'url', label: 'URL', kind: 'text', default: 'https://example.com' },
      { key: 'headers', label: 'Headers (JSON object)', kind: 'multiline', default: '{}', optional: true },
      { key: 'query', label: 'Query (JSON object)', kind: 'multiline', default: '{}', optional: true },
      { key: 'bodyType', label: 'Body type', kind: 'select', default: 'raw', options: ['raw', 'json'], optional: true },
      { key: 'body', label: 'Body', kind: 'multiline', default: '' },
      { key: 'timeout', label: 'Timeout (ms)', kind: 'number', default: 30000, min: 1, max: 300000 },
    ] },
  { type: 'telegram', name: 'Telegram', icon: '✈',
    description: 'Send Telegram bot messages using a bot token credential.',
    inputs: ['main'], outputs: ['main'], fields: [
      { key: 'apiBaseUrl', label: 'API Base URL', kind: 'text', default: 'https://api.telegram.org' },
      { key: 'botToken', label: 'Bot token (or credential)', kind: 'text', default: '', optional: true },
      { key: 'chatId', label: 'Chat ID', kind: 'text', default: '' },
      { key: 'text', label: 'Message text', kind: 'multiline', default: '{{$json.message}}' },
      { key: 'parseMode', label: 'Parse mode', kind: 'select', default: 'none', options: ['none', 'MarkdownV2', 'HTML'] },
      { key: 'disableWebPagePreview', label: 'Disable link preview', kind: 'select', default: 'no', options: ['yes', 'no'] },
      { key: 'timeout', label: 'Timeout (ms)', kind: 'number', default: 30000, min: 1, max: 300000 },
    ] },
  { type: 'github', name: 'GitHub', icon: 'GH',
    description: 'Create issues or dispatch repository events with a GitHub token.',
    inputs: ['main'], outputs: ['main'], fields: [
      { key: 'apiBaseUrl', label: 'API Base URL', kind: 'text', default: 'https://api.github.com' },
      { key: 'token', label: 'GitHub token (or credential)', kind: 'text', default: '', optional: true },
      { key: 'action', label: 'Action', kind: 'select', default: 'createIssue', options: ['createIssue', 'repositoryDispatch'] },
      { key: 'owner', label: 'Owner', kind: 'text', default: '' },
      { key: 'repo', label: 'Repository', kind: 'text', default: '' },
      { key: 'title', label: 'Issue title', kind: 'text', default: 'New eWe issue' },
      { key: 'body', label: 'Issue body', kind: 'multiline', default: '{{$json}}', optional: true },
      { key: 'eventType', label: 'Dispatch event type', kind: 'text', default: 'ewe.workflow', optional: true },
      { key: 'clientPayload', label: 'Dispatch client payload (JSON object)', kind: 'multiline', default: '{}', optional: true },
      { key: 'timeout', label: 'Timeout (ms)', kind: 'number', default: 30000, min: 1, max: 300000 },
    ] },
  { type: 'googleSheets', name: 'Google Sheets', icon: '▦',
    description: 'Append rows to a Google Sheet with an OAuth access token.',
    inputs: ['main'], outputs: ['main'], fields: [
      { key: 'apiBaseUrl', label: 'API Base URL', kind: 'text', default: 'https://sheets.googleapis.com' },
      { key: 'accessToken', label: 'Access token (or credential)', kind: 'text', default: '', optional: true },
      { key: 'spreadsheetId', label: 'Spreadsheet ID', kind: 'text', default: '' },
      { key: 'range', label: 'Range', kind: 'text', default: 'Sheet1!A:Z' },
      { key: 'values', label: 'Values (JSON row or rows)', kind: 'multiline', default: '["{{$json.message}}"]' },
      { key: 'valueInputOption', label: 'Value input option', kind: 'select', default: 'USER_ENTERED', options: ['USER_ENTERED', 'RAW'] },
      { key: 'timeout', label: 'Timeout (ms)', kind: 'number', default: 30000, min: 1, max: 300000 },
    ] },
  { type: 'ai', name: 'AI', icon: '✦',
    description: 'Call OpenAI-compatible API (streaming supported).',
    inputs: ['main'], outputs: ['main'], fields: [
      { key: 'baseUrl', label: 'Base URL', kind: 'text', default: 'https://api.openai.com' },
      { key: 'apiKey', label: 'API Key (or set OPENAI_API_KEY env)', kind: 'text', default: '' },
      { key: 'model', label: 'Model', kind: 'text', default: 'gpt-4o-mini' },
      { key: 'systemPrompt', label: 'System Prompt', kind: 'multiline', default: 'You are a helpful assistant.' },
      { key: 'userPrompt', label: 'User Prompt', kind: 'multiline', default: '{{$json}}' },
      { key: 'temperature', label: 'Temperature', kind: 'number', default: 0.7, min: 0, max: 2 },
      { key: 'stream', label: 'Stream', kind: 'select', default: 'no', options: ['yes', 'no'] },
      { key: 'timeout', label: 'Timeout (ms)', kind: 'number', default: 30000, min: 1000, max: 120000 },
    ] },
  { type: 'hermesAgent', name: 'Hermes Agent', icon: '☤',
    description: 'Run a prompt via local Hermes CLI (hermes chat -q).',
    inputs: ['main'], outputs: ['main'], fields: [
      { key: 'prompt', label: 'Prompt', kind: 'multiline', default: '' },
      { key: 'model', label: 'Model override', kind: 'text', default: '' },
      { key: 'sessionId', label: 'Session ID (resume)', kind: 'text', default: '' },
      { key: 'timeout', label: 'Timeout (ms)', kind: 'number', default: 60000, min: 1000, max: 300000 },
    ] },
];
export function getNodeMetadata(type: string): NodeMetadata | undefined {
  return registry.find(def => def.type === type);
}
export function defaultParameters(def: NodeMetadata): Record<string, string | number> {
  return Object.fromEntries(def.fields.map(field => [field.key, field.default]));
}
