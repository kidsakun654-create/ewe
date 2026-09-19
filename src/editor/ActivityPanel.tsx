import type { ActivityItem } from './useExecution';

// SPEC §10: realtime execution activity panel. Fed by the ordered execution events
// arriving over SSE (see useExecution), never by polling.
function clock(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : value;
}

export default function ActivityPanel({ items, status }: { items: ActivityItem[]; status?: string }) {
  return <section className="ewe-activity" aria-label="Execution activity">
    <header>
      <h2>Activity</h2>
      {status ? <span className={`exec-status-chip is-${status}`}>{status}</span> : null}
    </header>
    {items.length === 0 ? <p className="activity-empty">No events yet — run the workflow.</p> : (
      <ol data-testid="activity-list">
        {items.map(item => <li key={item.id} data-testid="activity-item" data-kind={item.kind}>
          <time dateTime={item.at}>{clock(item.at)}</time><span>{item.label}</span>{item.detail ? <small>{item.detail}</small> : null}
        </li>)}
      </ol>
    )}
  </section>;
}
