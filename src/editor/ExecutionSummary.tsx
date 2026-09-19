import type { Execution, NodeExecution } from '../engine/types';

const terminal = new Set(['success', 'error', 'skipped', 'cancelled']);

function ms(value: number) {
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} s`;
}

function elapsed(execution: Execution) {
  const end = execution.finishedAt ? Date.parse(execution.finishedAt) : Date.now();
  return ms(Math.max(0, end - Date.parse(execution.startedAt)));
}

function activeRecord(records: NodeExecution[]) {
  return records.find(record => record.status === 'running')
    ?? records.find(record => record.status === 'error')
    ?? [...records].reverse().find(record => record.status !== 'waiting' && record.status !== 'skipped');
}

export default function ExecutionSummary({ execution, onFocusNode }: { execution?: Execution; onFocusNode: (nodeId: string) => void }) {
  if (!execution) {
    return <section className="execution-summary is-idle" aria-label="Execution summary">
      <div>
        <span className="section-label">RUN MONITOR</span>
        <h2>No active execution</h2>
        <p>Run the workflow to watch progress, timing, and node status here.</p>
      </div>
    </section>;
  }

  const counts = execution.nodeExecutions.reduce<Record<string, number>>((acc, record) => {
    acc[record.status] = (acc[record.status] ?? 0) + 1;
    return acc;
  }, {});
  const done = execution.nodeExecutions.filter(record => terminal.has(record.status)).length;
  const total = execution.nodeExecutions.length || 1;
  const progress = Math.round((done / total) * 100);
  const focus = activeRecord(execution.nodeExecutions);

  return <section className={`execution-summary is-${execution.status}`} aria-label="Execution summary">
    <header>
      <div>
        <span className="section-label">RUN MONITOR</span>
        <h2>{execution.status === 'running' ? 'Execution running' : `Execution ${execution.status}`}</h2>
      </div>
      <strong data-testid="execution-progress">{progress}%</strong>
    </header>
    <div className="execution-progress-bar" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
    <div className="execution-summary-grid">
      {(['waiting', 'running', 'success', 'error', 'skipped', 'cancelled'] as const).map(status => (
        <span key={status} data-state={status}><b>{counts[status] ?? 0}</b>{status}</span>
      ))}
    </div>
    <footer>
      <span>Elapsed <b>{elapsed(execution)}</b></span>
      {focus ? <button type="button" data-testid="execution-focus-node" onClick={() => onFocusNode(focus.nodeId)}>
        Focus {focus.nodeName || focus.nodeId}
      </button> : null}
    </footer>
  </section>;
}
