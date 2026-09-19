import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Execution } from '../engine/types';

interface InspectorProps { workflowId: string; current?: Execution; }

const STATUS_CLASS: Record<string, string> = {
  success: 'is-success', completed: 'is-success',
  error: 'is-error', failed: 'is-error',
  cancelled: 'is-cancelled',
  running: 'is-running',
};

function sortExecutions(items: Execution[]) {
  return [...items].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

function preferredNode(execution?: Execution) {
  return execution?.nodeExecutions.find(item => item.status === 'running')?.nodeId
    ?? execution?.nodeExecutions.find(item => item.status === 'error')?.nodeId
    ?? '';
}

function JsonBlock({ data, testId }: { data: unknown; testId: string }) {
  const text = data === undefined ? 'Not recorded by this engine version' : JSON.stringify(data, null, 2);
  return <pre data-testid={testId}>{text}</pre>;
}

export default function ExecutionInspector({ workflowId, current }: InspectorProps) {
  const [history, setHistory] = useState<Execution[]>([]);
  const [selected, setSelected] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;
    setHistory([]); setSelected(''); setNodeId(''); setError('');
    api.executions(workflowId).then(items => {
      if (disposed) return;
      const merged = sortExecutions(current ? [current, ...items.filter(item => item.executionId !== current.executionId)] : items);
      setHistory(merged);
      setSelected(merged[0]?.executionId ?? '');
      setNodeId(preferredNode(merged[0]));
    }).catch(err => { if (!disposed) setError(String(err)); });
    return () => { disposed = true; };
  }, [workflowId]);

  useEffect(() => {
    if (!current) return;
    setHistory(items => sortExecutions([current, ...items.filter(item => item.executionId !== current.executionId)]));
    setSelected(current.executionId);
    setNodeId(existing => existing || preferredNode(current));
  }, [current?.executionId, current?.status, current?.sequence]);

  const execution = history.find(item => item.executionId === selected);
  const record = execution?.nodeExecutions.find(item => item.nodeId === nodeId);
  const statusClass = STATUS_CLASS[execution?.status ?? ''] ?? '';
  const totalDuration = execution
    ? Math.max(0, Date.parse(execution.finishedAt ?? new Date().toISOString()) - Date.parse(execution.startedAt))
    : 0;

  return (
    <section className="execution-inspector" aria-label="Execution inspector">
      <h2>Execution inspector</h2>
      {error && <p role="alert" style={{ color: 'var(--err)' }}>{error}</p>}
      <label>Execution
        <select data-testid="execution-select" value={selected} onChange={event => { setSelected(event.target.value); setNodeId(''); }}>
          <option value="">Select a saved execution</option>
          {history.map(item => <option key={item.executionId} value={item.executionId}>{item.startedAt} · {item.status} · {item.executionId}</option>)}
        </select>
      </label>

      {!execution && !error && history.length === 0 && (
        <p className="exec-empty">No saved executions yet.<br />Run the workflow to inspect its data and logs.</p>
      )}

      {execution && (
        <>
          <div className="exec-meta exec-run-card">
            <span className={`exec-status-chip ${statusClass}`}>{execution.status}</span>
            <span>Run ID <b>{execution.executionId}</b></span>
            <span>Started <b>{execution.startedAt}</b></span>
            <span>Elapsed <b>{totalDuration} ms</b></span>
          </div>

          <label>Node
            <select data-testid="inspect-node" value={nodeId} onChange={event => setNodeId(event.target.value)}>
              <option value="">Select a node</option>
              {execution.nodeExecutions.map(item => <option key={item.nodeId} value={item.nodeId}>{item.nodeName || item.nodeId} · {item.status}</option>)}
            </select>
          </label>

          {record ? (
            <div>
              <div className="exec-meta">
                <span className={`exec-status-chip ${STATUS_CLASS[record.status] ?? ''}`}>{record.status}</span>
                <span>Duration: <b><span data-testid="inspect-duration">{record.duration} ms</span></b></span>
                <span>Started: <b>{record.startedAt || 'Not started'}</b></span>
                <span>Finished: <b>{record.finishedAt || 'Not finished'}</b></span>
              </div>
              <p data-testid="inspect-error">{record.error || 'No error'}</p>
              <h3>Input</h3>
              <JsonBlock data={record.input} testId="inspect-input" />
              <h3>Resolved parameters</h3>
              <JsonBlock data={record.resolvedParameters} testId="inspect-parameters" />
              <h3>Output</h3>
              <JsonBlock data={record.output} testId="inspect-output" />
            </div>
          ) : (
            nodeId ? null : <p className="exec-empty">Select a node to inspect its input, output and logs.</p>
          )}

          <h3>Execution logs</h3>
          <pre data-testid="execution-logs">{execution.logs
            ? execution.logs.map(log => `${log.timestamp} ${log.event} ${log.nodeId || ''} ${log.message || ''}`).join('\n')
            : 'Logs not recorded by this engine version'}</pre>
        </>
      )}
    </section>
  );
}
