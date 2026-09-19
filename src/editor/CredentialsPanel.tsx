import { useMemo, useState } from 'react';
import type { CredentialPayload, CredentialSummary, CredentialType } from '../api/credentials';

const TYPE_LABEL: Record<CredentialType, string> = {
  openaiApiKey: 'OpenAI API Key',
  httpHeaderAuth: 'HTTP Header Auth',
  webhookSecret: 'Webhook Secret',
  telegramBotToken: 'Telegram Bot Token',
  githubToken: 'GitHub Token',
  googleAccessToken: 'Google Access Token',
};

export default function CredentialsPanel({ credentials, onCreate, onDelete }: {
  credentials: CredentialSummary[];
  onCreate: (input: { name: string; type: CredentialType; data: CredentialPayload }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<CredentialType>('openaiApiKey');
  const [apiKey, setApiKey] = useState('');
  const [headerName, setHeaderName] = useState('Authorization');
  const [headerValue, setHeaderValue] = useState('');
  const [secret, setSecret] = useState('');
  const [botToken, setBotToken] = useState('');
  const [token, setToken] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [message, setMessage] = useState('');
  const grouped = useMemo(() => credentials.reduce<Record<string, number>>((acc, item) => ({ ...acc, [item.type]: (acc[item.type] || 0) + 1 }), {}), [credentials]);

  const submit = async () => {
    setMessage('');
    const data: CredentialPayload =
      type === 'openaiApiKey' ? { apiKey } :
      type === 'httpHeaderAuth' ? { headerName, headerValue } :
      type === 'webhookSecret' ? { secret } :
      type === 'telegramBotToken' ? { botToken } :
      type === 'githubToken' ? { token } :
      { accessToken };
    try {
      await onCreate({ name, type, data });
      setName(''); setApiKey(''); setHeaderValue(''); setSecret(''); setBotToken(''); setToken(''); setAccessToken(''); setOpen(false);
      setMessage('Credential saved');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return <section className="credentials-panel" aria-label="Credentials">
    <header>
      <div>
        <h2>Credentials</h2>
        <p>{credentials.length} saved · {grouped.openaiApiKey || 0} AI · {grouped.httpHeaderAuth || 0} HTTP · {grouped.telegramBotToken || 0} Telegram · {grouped.githubToken || 0} GitHub · {grouped.googleAccessToken || 0} Google</p>
      </div>
      <button type="button" onClick={() => setOpen(current => !current)}>{open ? 'Close' : '+ Add'}</button>
    </header>

    {open ? <div className="credential-form">
      <label>Name<input data-testid="credential-name" value={name} onChange={event => setName(event.target.value)} placeholder="Production OpenAI" /></label>
      <label>Type<select data-testid="credential-type" value={type} onChange={event => setType(event.target.value as CredentialType)}>
        {Object.entries(TYPE_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      {type === 'openaiApiKey' ? <label>API key<input data-testid="credential-api-key" type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="off" /></label> : null}
      {type === 'httpHeaderAuth' ? <>
        <label>Header name<input data-testid="credential-header-name" value={headerName} onChange={event => setHeaderName(event.target.value)} /></label>
        <label>Header value<input data-testid="credential-header-value" type="password" value={headerValue} onChange={event => setHeaderValue(event.target.value)} autoComplete="off" /></label>
      </> : null}
      {type === 'webhookSecret' ? <label>Secret<input data-testid="credential-secret" type="password" value={secret} onChange={event => setSecret(event.target.value)} autoComplete="off" /></label> : null}
      {type === 'telegramBotToken' ? <label>Bot token<input data-testid="credential-bot-token" type="password" value={botToken} onChange={event => setBotToken(event.target.value)} autoComplete="off" /></label> : null}
      {type === 'githubToken' ? <label>Token<input data-testid="credential-token" type="password" value={token} onChange={event => setToken(event.target.value)} autoComplete="off" /></label> : null}
      {type === 'googleAccessToken' ? <label>Access token<input data-testid="credential-access-token" type="password" value={accessToken} onChange={event => setAccessToken(event.target.value)} autoComplete="off" /></label> : null}
      <button type="button" className="primary" data-testid="save-credential" onClick={submit}>Save credential</button>
    </div> : null}

    {message ? <p className="credential-message">{message}</p> : null}

    <ul className="credential-list" data-testid="credential-list">
      {credentials.length === 0 ? <li className="credential-empty">No credentials yet.</li> : credentials.map(item => <li key={item.id}>
        <span><b>{item.name}</b><small>{TYPE_LABEL[item.type]} · {item.id.slice(0, 8)}</small></span>
        <button type="button" aria-label={`Delete credential ${item.name}`} onClick={() => void onDelete(item.id)}>Delete</button>
      </li>)}
    </ul>
  </section>;
}
