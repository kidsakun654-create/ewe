export interface WorkflowNode {
  id: string;
  type: string;
  name: string;
  position: { x: number; y: number };
  parameters: Record<string, unknown>;
  credentials: Record<string, string>;
}
export interface Connection {
  id: string;
  source: string;
  target: string;
  sourcePort: string;
  targetPort: string;
}
export interface Workflow {
  id: string;
  name: string;
  enabled: false;
  nodes: WorkflowNode[];
  connections: Connection[];
  settings: { viewport?: { x: number; y: number; zoom: number } };
  createdAt: string;
  updatedAt: string;
}
