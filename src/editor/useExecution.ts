import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Execution, ExecutionEvent } from '../engine/types';

export interface ActivityItem { id: number; at: string; label: string; detail: string; kind: string; }

// SPEC §10: derive the activity stream from the ordered execution events, not from polling.
function activity(execution: Execution | undefined): ActivityItem[] {
  if (!execution?.events) return [];
  const names = new Map(execution.nodeExecutions.map(record => [record.nodeId, record.nodeName || record.nodeId]));
  return execution.events.map(event => ({
    id: event.id,
    at: event.timestamp,
    kind: event.type.includes('.') ? event.type.split('.').at(-1) || event.type : event.type,
    label: event.type.startsWith('workflow.')
      ? `Workflow ${event.type.replace('workflow.', '')}`
      : `${names.get(event.nodeId || '') || event.nodeId || '?'} ${event.type.replace('node.', '')}`,
    detail: event.type === 'workflow.failed' ? execution.nodeExecutions.find(record => record.status === 'error')?.error || ''
      : event.type === 'node.failed' ? execution.nodeExecutions.find(record => record.nodeId === event.nodeId)?.error || ''
      : '',
  }));
}

export function useExecution(workflowId?: string) {
  const [execution, setExecution] = useState<Execution>();
  const [error, setError] = useState('');
  useEffect(() => { setExecution(undefined); setError(''); }, [workflowId]);
  useEffect(() => {
    if (!execution || execution.status !== 'running') return;
    let disposed = false;
    let eventSource: EventSource;
    let fallbackTimer: ReturnType<typeof setTimeout>;
    const connect = () => {
      eventSource = new EventSource(`/api/workflows/${execution.workflowId}/executions/${execution.executionId}/events`);
      // Named SSE event: onmessage only fires for frameless 'message' events.
      const apply = (event: MessageEvent) => {
        if (disposed) return;
        try {
          const snapshot = JSON.parse(event.data);
          if (snapshot.execution) {
            setExecution(snapshot.execution);
            setError('');
            if (snapshot.execution.status !== 'running') eventSource.close();
          }
        } catch { /* ignore malformed */ }
      };
      eventSource.addEventListener('execution.snapshot', apply as EventListener);
      eventSource.onerror = () => {
        if (disposed) return;
        eventSource.close();
        fallbackTimer = setTimeout(connect, 1000);
      };
    };
    connect();
    return () => { disposed = true; clearTimeout(fallbackTimer); eventSource?.close(); };
  }, [execution?.executionId, execution?.status]);
  return {
    execution,
    events: activity(execution),
    error,
    start: async (id: string) => { setError(''); setExecution(await api.start(id)); },
    stop: async () => {
      if (execution) setExecution(await api.cancel(execution.workflowId, execution.executionId));
    },
  };
}
