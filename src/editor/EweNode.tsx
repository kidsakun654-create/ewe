import { Handle, Position, type NodeProps } from '@xyflow/react';
import { getNodeMetadata } from '../nodes/registry';
import type { WorkflowNode } from '../model';

export default function EweNode({ data }: NodeProps) {
  const node = data.node as WorkflowNode;
  const def = getNodeMetadata(node.type);
  const status = String(data.status || '');
  const duration = typeof data.duration === 'number' && data.duration > 0 ? `${data.duration} ms` : '';
  const port = typeof data.port === 'string' && data.port ? data.port : '';
  const hasOutgoing = Boolean(data.hasOutgoing);
  const onAddNext = typeof data.onAddNext === 'function' ? data.onAddNext as () => void : undefined;

  return (
    <div className="ewe-node" data-testid="canvas-node" data-status={status} data-node-kind={node.type}>
      {def && def.inputs.map(port => <Handle key={port} id={port} type="target" position={Position.Left} className="ewe-handle-target" title={`Input: ${port}`} />)}
      <div className="ewe-node-topline">
        <div className="ewe-node-icon">{def?.icon ?? '?'}</div>
        <div className="ewe-node-port-count">
          <span>{def?.inputs.length ?? 0} in</span>
          <span>{def?.outputs.length ?? 0} out</span>
        </div>
      </div>
      <div className="ewe-node-body">
        <div className="ewe-node-name" title={node.name}>{node.name}</div>
        <div className="ewe-node-type">{def?.name ?? node.type}</div>
        {status ? (
          <div className="ewe-node-runline">
            <span data-testid="node-status">{status}</span>
            {duration ? <small>{duration}</small> : null}
            {port ? <small>port {port}</small> : null}
          </div>
        ) : (
          <div className="ewe-node-runline is-idle"><span>ready</span></div>
        )}
      </div>
      {def && def.outputs.length > 0 && !hasOutgoing && onAddNext ? (
        <button
          type="button"
          className="ewe-node-add-next nodrag nopan"
          data-testid="node-add-next"
          title={`Add node after ${node.name}`}
          onMouseDown={event => event.stopPropagation()}
          onClick={event => {
            event.stopPropagation();
            onAddNext();
          }}
        >
          +
        </button>
      ) : null}
      {def && def.outputs.map(port => <Handle key={port} id={port} type="source" position={Position.Right} className="ewe-handle-source" title={`Output: ${port}`} />)}
    </div>
  );
}
