import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent } from 'react';
import {
  Background, BackgroundVariant, Controls, MarkerType, MiniMap, Panel, ReactFlow, addEdge,
  useEdgesState, useNodesState, type Connection, type Edge, type Node, type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './style.css';
import { api, type WorkflowSummary } from './api/client';
import type { CredentialPayload, CredentialSummary, CredentialType } from './api/credentials';
import { defaultParameters, getNodeMetadata, registry, type ParameterField } from './nodes/registry';
import type { Workflow, WorkflowNode } from './model';
import { validateWorkflow } from './validation';
import EweNode from './editor/EweNode';
import ConfigPanel from './editor/ConfigPanel';
import ActivityPanel from './editor/ActivityPanel';
import ExecutionInspector from './editor/ExecutionInspector';
import WorkflowTransfer from './editor/WorkflowTransfer';
import CredentialsPanel from './editor/CredentialsPanel';
import { useExecution } from './editor/useExecution';
import KeyboardHelp from './editor/KeyboardHelp';
import { workflowTemplates } from './templates';
import ExecutionSummary from './editor/ExecutionSummary';
import ProductionSafetyPanel from './editor/ProductionSafetyPanel';
import { analyzeWorkflowSafety, hasBlockingSafetyRisk } from './safety';

const nodeTypes = { ewe: EweNode };
type AppNodeData = {
  node: WorkflowNode;
  status?: string;
  duration?: number;
  port?: string;
  hasOutgoing?: boolean;
  onAddNext?: () => void;
};
type AppNode = Node<AppNodeData, 'ewe'>;
type NodePickerContext =
  | { mode: 'free' }
  | { mode: 'after-node'; sourceId: string; sourceHandle?: string }
  | { mode: 'insert-edge'; edgeId: string; sourceId: string; sourceHandle?: string | null; targetId: string; targetHandle?: string | null };
const nodeCategories: Array<{ id: string; label: string; types: string[] }> = [
  { id: 'all', label: 'All', types: registry.map(def => def.type) },
  { id: 'triggers', label: 'Triggers', types: ['manualTrigger', 'webhook', 'schedule'] },
  { id: 'logic', label: 'Logic', types: ['if', 'switch', 'merge', 'loop', 'wait'] },
  { id: 'data', label: 'Data', types: ['set'] },
  { id: 'http', label: 'HTTP', types: ['httpRequest'] },
  { id: 'integrations', label: 'Integrations', types: ['telegram', 'github', 'googleSheets'] },
  { id: 'ai', label: 'AI', types: ['ai', 'hermesAgent'] },
  { id: 'code', label: 'Code', types: ['code'] },
] ;
const categoryByType = new Map(nodeCategories.flatMap(category => category.id === 'all' ? [] : category.types.map(type => [type, category.label])));
const quickConfigKeys: Record<string, string[]> = {
  ai: ['model', 'userPrompt', 'systemPrompt', 'temperature'],
  code: ['source', 'timeout'],
  github: ['action', 'owner', 'repo', 'title'],
  googleSheets: ['spreadsheetId', 'range', 'values', 'valueInputOption'],
  hermesAgent: ['prompt', 'model', 'timeout'],
  httpRequest: ['method', 'url', 'bodyType', 'body'],
  if: ['field', 'operator', 'value'],
  schedule: ['cron', 'enabled', 'runMissed'],
  set: ['field', 'value'],
  switch: ['field', 'mode', 'rules'],
  telegram: ['chatId', 'text', 'parseMode'],
  webhook: ['path', 'enabled', 'secret'],
};
const initialViewport = { x: 30, y: 50, zoom: 0.85 };
const defaultEdgeOptions = {
  markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
  className: 'ewe-edge',
  type: 'straight',
};
const toFlow = (workflow: Workflow) => ({
  nodes: workflow.nodes.map(node => ({ id: node.id, type: 'ewe' as const, position: node.position, data: { node } })),
  edges: workflow.connections.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourcePort, targetHandle: edge.targetPort })),
});
const serialise = (nodes: AppNode[], edges: Edge[], workflow: Workflow, viewport: Viewport): Workflow => ({
  ...workflow,
  settings: { ...workflow.settings, viewport },
  nodes: nodes.map(({ id, position, data }) => ({ ...data.node, id, position })),
  connections: edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, sourcePort: edge.sourceHandle || 'main', targetPort: edge.targetHandle || 'main' })),
});

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const quickConfigMargin = 14;
const quickConfigWidth = 360;
const quickConfigHeight = 620;

export default function App() {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [workflow, setWorkflow] = useState<Workflow>();
  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [viewport, setViewport] = useState<Viewport>(initialViewport);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [message, setMessage] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');
  const [saving, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [workflowQuery, setWorkflowQuery] = useState('');
  const [nodeQuery, setNodeQuery] = useState('');
  const [nodeCategory, setNodeCategory] = useState('all');
  const [helpOpen, setHelpOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [nodeMenu, setNodeMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [quickConfig, setQuickConfig] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [nodePicker, setNodePicker] = useState<NodePickerContext | null>(null);
  const [miniMapOpen, setMiniMapOpen] = useState(true);
  const suppressViewportDirty = useRef(false);
  const quickConfigDrag = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const { execution, events: activityEvents, error: executionError, start, stop } = useExecution(workflow?.id);
  const executing = execution?.status === 'running';
  const busy = saving || executing;
  const filteredWorkflows = useMemo(() => {
    const needle = workflowQuery.trim().toLowerCase();
    if (!needle) return workflows;
    return workflows.filter(item => item.name.toLowerCase().includes(needle));
  }, [workflows, workflowQuery]);
  const executionByNode = useMemo(() => new Map(execution?.nodeExecutions.map(record => [record.nodeId, record]) ?? []), [execution]);
  const displayEdges = useMemo(() => edges.map(edge => {
    const sourceStatus = executionByNode.get(edge.source)?.status;
    const targetStatus = executionByNode.get(edge.target)?.status;
    const status =
      sourceStatus === 'running' || targetStatus === 'running' ? 'running' :
      sourceStatus === 'error' || targetStatus === 'error' || sourceStatus === 'cancelled' || targetStatus === 'cancelled' ? 'error' :
      sourceStatus === 'success' && targetStatus === 'success' ? 'success' :
      targetStatus === 'skipped' ? 'skipped' : 'idle';
    return {
      ...edge,
      animated: false,
      className: `ewe-edge ewe-edge-${status}`,
      markerEnd: status === 'running' ? undefined : { type: MarkerType.ArrowClosed, width: 18, height: 18 },
      type: 'straight',
    };
  }), [edges, executionByNode]);
  const safetySnapshot = useMemo(() => workflow ? serialise(nodes, edges, workflow, viewport) : undefined, [nodes, edges, workflow, viewport]);
  const safetyFindings = useMemo(() => safetySnapshot ? analyzeWorkflowSafety(safetySnapshot) : [], [safetySnapshot]);
  const nodePickerDefinitions = useMemo(() => {
    const category = nodeCategories.find(item => item.id === nodeCategory) || nodeCategories[0];
    const allowed = new Set(category.types);
    const needle = nodeQuery.trim().toLowerCase();
    return registry.filter(def => {
      if (!allowed.has(def.type)) return false;
      if (!needle) return true;
      return `${def.name} ${def.description} ${categoryByType.get(def.type) || ''}`.toLowerCase().includes(needle);
    });
  }, [nodeCategory, nodeQuery]);
  const openNodePicker = useCallback((context: NodePickerContext) => {
    setNodePicker(context);
    setNodeMenu(null);
    setQuickConfig(null);
    setNodeQuery('');
    setNodeCategory('all');
  }, []);
  const displayNodes = useMemo(() => nodes.map(node => {
    const record = executionByNode.get(node.id);
    const hasOutgoing = edges.some(edge => edge.source === node.id);
    return {
      ...node,
      data: {
        ...node.data,
        status: record?.status,
        duration: record?.duration,
        port: record?.port,
        hasOutgoing,
        onAddNext: () => openNodePicker({ mode: 'after-node', sourceId: node.id }),
      },
    };
  }), [nodes, edges, executionByNode, openNodePicker]);

  // ─── Keyboard shortcuts ────────────────────────────────────────
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    // Don't capture when typing in inputs/textareas/selects
    if (target.matches('input, textarea, select')) return;

    const mod = event.ctrlKey || event.metaKey;

    if (mod && event.key === 's') { event.preventDefault(); save(); return; }
    if (mod && event.key === 'Enter') {
      event.preventDefault();
      if (!busy && workflow && nodes.some(n => n.data.node.type === 'manualTrigger')) execute();
      return;
    }
    if (event.key === 'Escape') {
      setNodePicker(null);
      setNodeMenu(null);
      setQuickConfig(null);
      setSelectedNodeId(undefined);
      return;
    }
    if (event.key.toLowerCase() === 'a' && workflow && !busy) {
      event.preventDefault();
      openNodePicker({ mode: 'free' });
      return;
    }
    if (event.key === '?') { setHelpOpen(current => !current); return; }
  }, [busy, workflow, nodes, selectedNodeId, openNodePicker]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const execute = () => {
    if (!workflow) return;
    const snapshot = serialise(nodes, edges, workflow, viewport);
    const invalid = validateWorkflow(snapshot);
    if (invalid) { setMessage(invalid); return; }
    const findings = analyzeWorkflowSafety(snapshot);
    if (hasBlockingSafetyRisk(findings) && !window.confirm(`Production safety review required: ${findings.filter(finding => finding.severity === 'high').length} high-risk item(s). Run once anyway?`)) {
      setMessage('Run cancelled by production safety gate');
      return;
    }
    void run(async () => {
      const saved = await api.save(snapshot);
      setWorkflow(saved); setDirty(false); await refreshList(); await start(saved.id);
    });
  };

  const refreshList = useCallback(async () => setWorkflows(await api.list()), []);
  const refreshCredentials = useCallback(async () => setCredentials(await api.credentials()), []);
  const hydrateApp = useCallback(async () => {
    setLoaded(false);
    await Promise.all([refreshList(), refreshCredentials()]);
    setLoaded(true);
  }, [refreshList, refreshCredentials]);
  useEffect(() => {
    api.session()
      .then(async session => {
        setAuthenticated(session.authenticated);
        setAuthChecked(true);
        if (session.authenticated) await hydrateApp();
      })
      .catch(error => {
        setLoginError(error instanceof Error ? error.message : String(error));
        setAuthChecked(true);
      });
  }, [hydrateApp]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const changed = () => { if (workflow) { setDirty(true); setMessage('Unsaved changes'); } };
  const mayLeave = () => !dirty || window.confirm('Discard unsaved changes?');
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const login = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setLoginError('');
    api.login(loginUser, loginPass)
      .then(async session => {
        setAuthenticated(session.authenticated);
        setLoginPass('');
        await hydrateApp();
      })
      .catch(error => setLoginError(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(false));
  };
  const logout = () => {
    void run(async () => {
      await api.logout();
      setAuthenticated(false);
      setLoaded(false);
      setWorkflow(undefined);
      setNodes([]);
      setEdges([]);
      setCredentials([]);
      setWorkflows([]);
      setSelectedNodeId(undefined);
      setMessage('');
      setDirty(false);
    });
  };
  const load = (next: Workflow) => {
    suppressViewportDirty.current = true;
    setWorkflow(next);
    const flow = toFlow(next);
    setNodes(flow.nodes); setEdges(flow.edges);
    setViewport(next.settings.viewport || initialViewport);
    setSelectedNodeId(undefined); setMessage(''); setDirty(false);
    setNodePicker(null); setNodeMenu(null); setQuickConfig(null);
  };
  const open = (id: string) => {
    if (mayLeave()) void run(async () => load(await api.get(id)));
  };
  const create = () => {
    if (mayLeave()) void run(async () => {
      const created = await api.create(`Workflow ${workflows.length + 1}`);
      await refreshList(); load(created);
    });
  };
  const createFromTemplate = (templateId: string) => {
    if (!mayLeave()) return;
    const template = workflowTemplates.find(item => item.id === templateId);
    if (!template) return;
    void run(async () => {
      const now = new Date().toISOString();
      const imported = await api.import({
        ...structuredClone(template.workflow),
        name: template.workflow.name.replace('Template - ', ''),
        createdAt: now,
        updatedAt: now,
      });
      await refreshList(); load(imported); setMessage(`Created from ${template.name}`);
    });
  };
  const duplicateWorkflow = (id: string) => {
    void run(async () => {
      const source = await api.get(id);
      const now = new Date().toISOString();
      const duplicate = await api.import({ ...source, name: `${source.name} copy`, createdAt: now, updatedAt: now });
      await refreshList(); load(duplicate); setMessage('Duplicated workflow');
    });
  };
  const deleteWorkflow = (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    void run(async () => {
      await api.deleteWorkflow(id);
      await refreshList();
      if (workflow?.id === id) {
        setWorkflow(undefined);
        setNodes([]); setEdges([]);
        setSelectedNodeId(undefined); setDirty(false);
      }
      setMessage('Deleted workflow');
    });
  };
  const save = () => {
    if (!workflow) return;
    const snapshot = serialise(nodes, edges, workflow, viewport);
    const invalid = validateWorkflow(snapshot);
    if (invalid) { setMessage(invalid); return; }
    void run(async () => {
      const saved = await api.save(snapshot);
      setWorkflow(saved); await refreshList(); setDirty(false); setMessage('Saved');
    });
  };
  const addNode = (type: string, context: NodePickerContext = { mode: 'free' }) => {
    if (!workflow) return;
    const def = getNodeMetadata(type)!;
    const source = context.mode !== 'free' ? nodes.find(item => item.id === context.sourceId) : undefined;
    const sourceDef = source ? getNodeMetadata(source.data.node.type) : undefined;
    const target = context.mode === 'insert-edge' ? nodes.find(item => item.id === context.targetId) : undefined;
    const nodePosition =
      source ? { x: source.position.x + 340, y: source.position.y + (context.mode === 'insert-edge' ? 0 : 80) } :
      target ? { x: target.position.x - 280, y: target.position.y } :
      { x: 30 + (nodes.length % 3) * 340, y: 100 + Math.floor(nodes.length / 3) * 170 };
    const node: WorkflowNode = {
      id: uid(), type, name: def.name,
      position: nodePosition,
      parameters: defaultParameters(def), credentials: {},
    };
    setNodes(current => [...current, { id: node.id, type: 'ewe', position: node.position, data: { node } }]);
    if (context.mode === 'after-node' || context.mode === 'insert-edge') {
      const sourceHandle = context.sourceHandle || sourceDef?.outputs[0] || 'main';
      const targetHandle = def.inputs[0] || 'main';
      setEdges(current => {
        const withoutInserted = context.mode === 'insert-edge' ? current.filter(edge => edge.id !== context.edgeId) : current;
        const first: Edge = { id: uid(), source: context.sourceId, target: node.id, sourceHandle, targetHandle };
        if (context.mode !== 'insert-edge') return addEdge(first, withoutInserted);
        const second: Edge = { id: uid(), source: node.id, target: context.targetId, sourceHandle: def.outputs[0] || 'main', targetHandle: context.targetHandle || 'main' };
        return addEdge(second, addEdge(first, withoutInserted));
      });
    }
    setNodePicker(null);
    setSelectedNodeId(node.id); changed();
  };
  const deleteNode = (nodeId: string) => {
    setNodes(current => current.filter(node => node.id !== nodeId));
    setEdges(current => current.filter(edge => edge.source !== nodeId && edge.target !== nodeId));
    if (selectedNodeId === nodeId) setSelectedNodeId(undefined);
    setNodeMenu(null);
    setQuickConfig(null);
    setNodePicker(null);
    changed();
  };
  const duplicateNode = (nodeId: string) => {
    const source = nodes.find(node => node.id === nodeId);
    if (!source) return;
    const copy: WorkflowNode = {
      ...structuredClone(source.data.node),
      id: uid(),
      name: `${source.data.node.name} copy`,
      position: { x: source.position.x + 36, y: source.position.y + 36 },
    };
    setNodes(current => [...current, { id: copy.id, type: 'ewe', position: copy.position, data: { node: copy } }]);
    setSelectedNodeId(copy.id);
    setNodeMenu(null);
    setQuickConfig(null);
    setNodePicker(null);
    changed();
  };
  const deleteSelected = () => {
    if (!selectedNodeId) return;
    deleteNode(selectedNodeId);
  };
  const onConnect = (connection: Connection) => {
    if (connection.source === connection.target) return;
    setEdges(current => addEdge({ ...connection, id: uid() }, current));
    changed();
  };
  const selectedNode = useMemo(() => nodes.find(item => item.id === selectedNodeId)?.data.node, [nodes, selectedNodeId]);
  const quickConfigNode = useMemo(() => nodes.find(item => item.id === quickConfig?.nodeId)?.data.node, [nodes, quickConfig?.nodeId]);
  const quickConfigDef = quickConfigNode ? getNodeMetadata(quickConfigNode.type) : undefined;
  const quickConfigFields = useMemo(() => {
    if (!quickConfigDef || !quickConfigNode) return [];
    const preferred = quickConfigKeys[quickConfigNode.type];
    if (!preferred) return quickConfigDef.fields.slice(0, 4);
    const byKey = new Map(quickConfigDef.fields.map(field => [field.key, field]));
    return preferred.map(key => byKey.get(key)).filter((field): field is ParameterField => Boolean(field));
  }, [quickConfigDef, quickConfigNode]);
  const patchNodeById = (nodeId: string, patch: Partial<WorkflowNode>) => {
    setNodes(current => current.map(node => node.id === nodeId ? { ...node, data: { node: { ...node.data.node, ...patch } } } : node));
    changed();
  };
  const patchNodeParameterById = (nodeId: string, node: WorkflowNode, field: ParameterField, rawValue: string) => {
    patchNodeById(nodeId, {
      parameters: {
        ...node.parameters,
        [field.key]: field.kind === 'number' ? Number(rawValue) : rawValue,
      },
    });
  };
  const openFullConfig = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setQuickConfig(null);
    setNodeMenu(null);
    window.requestAnimationFrame(() => document.querySelector('[data-testid="config-panel"]')?.scrollIntoView({ block: 'nearest' }));
  };
  const clampQuickConfigPosition = useCallback((x: number, y: number) => {
    if (typeof window === 'undefined') return { x, y };
    const width = Math.min(quickConfigWidth, window.innerWidth - quickConfigMargin * 2);
    const height = Math.min(quickConfigHeight, window.innerHeight - quickConfigMargin * 2);
    return {
      x: Math.max(quickConfigMargin, Math.min(x, window.innerWidth - width - quickConfigMargin)),
      y: Math.max(quickConfigMargin, Math.min(y, window.innerHeight - height - quickConfigMargin)),
    };
  }, []);
  const openQuickConfig = useCallback((menu: { nodeId: string; x: number; y: number }) => {
    const position = clampQuickConfigPosition(menu.x, menu.y);
    setQuickConfig({ nodeId: menu.nodeId, ...position });
    setNodeMenu(null);
  }, [clampQuickConfigPosition]);
  const startQuickConfigDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!quickConfig) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, input, select, textarea')) return;
    quickConfigDrag.current = {
      offsetX: event.clientX - quickConfig.x,
      offsetY: event.clientY - quickConfig.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, [quickConfig]);
  const moveQuickConfig = useCallback((event: PointerEvent<HTMLElement>) => {
    const drag = quickConfigDrag.current;
    if (!drag) return;
    const position = clampQuickConfigPosition(event.clientX - drag.offsetX, event.clientY - drag.offsetY);
    setQuickConfig(current => current ? { ...current, ...position } : current);
  }, [clampQuickConfigPosition]);
  const stopQuickConfigDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    quickConfigDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);
  const patchNode = (patch: Partial<WorkflowNode>) => {
    setNodes(current => current.map(node => node.id === selectedNodeId ? { ...node, data: { node: { ...node.data.node, ...patch } } } : node));
    changed();
  };
  const createCredential = async (input: { name: string; type: CredentialType; data: CredentialPayload }) => {
    await api.createCredential(input);
    await refreshCredentials();
  };
  const deleteCredential = async (id: string) => {
    await api.deleteCredential(id);
    await refreshCredentials();
  };

  return (
    <div className="ewe-app" aria-busy={busy}>
      {!authChecked ? (
        <main className="login-screen">
          <section className="login-card">
            <span className="brand-mark">e</span>
            <h1>eWe</h1>
            <p>Checking session…</p>
          </section>
        </main>
      ) : !authenticated ? (
        <main className="login-screen">
          <form className="login-card" onSubmit={login}>
            <span className="brand-mark">e</span>
            <h1>eWe</h1>
            <p>Sign in to manage visual workflows.</p>
            <label>
              <span>Username</span>
              <input autoFocus autoComplete="username" value={loginUser} onChange={event => setLoginUser(event.target.value)} />
            </label>
            <label>
              <span>Password</span>
              <input type="password" autoComplete="current-password" value={loginPass} onChange={event => setLoginPass(event.target.value)} />
            </label>
            {loginError ? <strong role="alert">{loginError}</strong> : null}
            <button className="primary" type="submit" disabled={busy || !loginUser || !loginPass}>{busy ? 'Signing in…' : 'Login'}</button>
          </form>
        </main>
      ) : (
      <>
      <nav className="ewe-sidebar" aria-label="Workflows">
        <h1><span className="brand-mark">e</span> eWe</h1>
        <p className="ewe-tagline">VISUAL WORKFLOW AUTOMATION</p>
        <button type="button" data-testid="create-workflow" disabled={!loaded || busy} onClick={create}>+ New workflow</button>
        <WorkflowTransfer workflow={workflow} disabled={busy}
          mayLeave={mayLeave} onMessage={setMessage} onImported={async next => { await refreshList(); load(next); }} />
        <div className="template-section-head">
          <h2 className="section-label">TEMPLATES</h2>
          <button type="button" data-testid="template-toggle" aria-label={`${templatesOpen ? 'Hide' : 'Show'} templates`} aria-expanded={templatesOpen} aria-controls="template-gallery" onClick={() => setTemplatesOpen(open => !open)}>
            {templatesOpen ? 'Hide' : 'Show'}
          </button>
        </div>
        {templatesOpen ? (
          <div className="template-gallery" id="template-gallery" data-testid="template-gallery">
            {workflowTemplates.map(template => (
              <button key={template.id} type="button" data-testid={`template-${template.id}`} disabled={!loaded || busy}
                onClick={() => createFromTemplate(template.id)} title={template.summary}>
                <span>{template.useCase}</span>
                <strong>{template.name}</strong>
                <small>{template.summary}</small>
              </button>
            ))}
          </div>
        ) : null}
        <div className="workflow-section-head">
          <h2 className="section-label">WORKSPACE</h2>
          <span>{workflows.length}</span>
        </div>
        <input className="workflow-search" aria-label="Search workflows" placeholder="Search workflows…" value={workflowQuery} onChange={event => setWorkflowQuery(event.target.value)} />
        <ul data-testid="workflow-list">
          {filteredWorkflows.map(item => <li key={item.id} className={item.id === workflow?.id ? 'ewe-active' : ''}>
            <button type="button" className="workflow-open" disabled={busy} onClick={() => open(item.id)}>{item.name}</button>
            <div className="workflow-actions" aria-label={`${item.name} actions`}>
              <button type="button" disabled={busy} aria-label="Duplicate workflow" title={`Duplicate ${item.name}`} onClick={() => duplicateWorkflow(item.id)}>⧉</button>
              <button type="button" disabled={busy} aria-label="Delete workflow" title={`Delete ${item.name}`} onClick={() => deleteWorkflow(item.id, item.name)}>×</button>
            </div>
          </li>)}
          {loaded && filteredWorkflows.length === 0 ? <li className="workflow-empty">No workflows found.</li> : null}
        </ul>
        <div className="sidebar-foot">LOCAL WORKSPACE<br /><span>Workflow Lab · Phase 8</span><button type="button" onClick={logout}>Logout</button></div>
      </nav>
      <main className="ewe-main">
        <header className="ewe-toolbar">
          <span className="section-label">EDITOR /</span>
          <input aria-label="Workflow name" maxLength={120} data-testid="workflow-name" disabled={!workflow || busy}
            placeholder="Choose a workflow" value={workflow?.name ?? ''}
            onChange={event => { if (workflow) { setWorkflow({ ...workflow, name: event.target.value }); changed(); } }} />
          <span className={`draft-badge${dirty ? ' is-dirty' : ''}`}>{dirty ? 'UNSAVED' : 'DRAFT'}</span>
          {executing ? <button type="button" className="ewe-stop" data-testid="stop-workflow" onClick={() => void run(stop)}>Stop</button> : null}
          <button type="button" className="run-button" data-testid="run-workflow" disabled={!workflow || busy || !nodes.some(node => node.data.node.type === 'manualTrigger')} onClick={execute}>
            <span className="run-icon" aria-hidden="true" />
            Run
          </button>
          <button className="primary" type="button" data-testid="save-workflow" disabled={!workflow || busy} onClick={save}>{busy ? 'Working…' : 'Save'}</button>
          <button type="button" aria-label="Keyboard shortcuts" className="ewe-help-btn" data-testid="keyboard-help-toggle" onClick={() => setHelpOpen(current => !current)}>?</button>
        </header>
        <div className={`ewe-notice${executionError ? ' is-error' : ''}${execution && execution.status !== 'running' && execution.status !== 'success' ? ' is-result' : ''}`}>
          {executionError ? `Error: ${executionError}` :
           executing ? 'Executing — node status updates as nodes run. Stop cancels the active execution.' :
           execution && execution.status !== 'running' ? `Execution ${execution.status}` :
           message || 'Ready to edit'}
        </div>
        <div className="ewe-workspace" ref={element => { element?.toggleAttribute('inert', busy); }}>
          <div className="ewe-canvas" data-testid="canvas">
            {(!loaded) && (
              <div className="ewe-skeleton" data-testid="canvas-skeleton">
                <div className="skeleton-shelf" />
                <div className="skeleton-list"><div className="skeleton-item" /><div className="skeleton-item" /><div className="skeleton-item" /></div>
              </div>
            )}
            {loaded && workflow && nodes.length === 0 && (
              <div className="empty-state">
                <span className="empty-state-icon">＋</span>
                <h2>Start from a template or trigger.</h2>
                <p>Use the template gallery for a starter flow, or open Add node to build from triggers, logic, AI, HTTP, and code blocks.</p>
              </div>
            )}
            {loaded && !workflow && (
              <div className="empty-state">
                <span className="empty-state-icon">↯</span>
                <h2>Your next workflow starts here.</h2>
                <p>Create a blank workflow, import JSON, or choose a template from the sidebar to open the automation canvas.</p>
              </div>
            )}
            <ReactFlow nodes={displayNodes} edges={displayEdges} nodeTypes={nodeTypes}
              defaultEdgeOptions={defaultEdgeOptions}
              onNodesChange={changes => {
                onNodesChange(changes);
                const removed = new Set(changes.filter(change => change.type === 'remove').map(change => change.id));
                if (removed.size) setEdges(current => current.filter(edge => !removed.has(edge.source) && !removed.has(edge.target)));
                if (changes.some(change => change.type === 'remove' || change.type === 'position')) changed();
              }}
              onEdgesChange={changes => { onEdgesChange(changes); if (changes.some(change => change.type === 'remove')) changed(); }}
              onConnect={onConnect} isValidConnection={connection => connection.source !== connection.target}
              onNodeClick={(_, node) => { setSelectedNodeId(node.id); setNodeMenu(null); setQuickConfig(null); }}
              onNodeContextMenu={(event, node) => {
                event.preventDefault();
                setSelectedNodeId(node.id);
                setNodeMenu({ nodeId: node.id, x: event.clientX, y: event.clientY });
                setQuickConfig(null);
                setNodePicker(null);
              }}
              onEdgeContextMenu={(event, edge) => {
                event.preventDefault();
                openNodePicker({
                  mode: 'insert-edge',
                  edgeId: edge.id,
                  sourceId: edge.source,
                  sourceHandle: edge.sourceHandle,
                  targetId: edge.target,
                  targetHandle: edge.targetHandle,
                });
              }}
              onPaneClick={() => { setSelectedNodeId(undefined); setNodeMenu(null); setQuickConfig(null); setNodePicker(null); }}
              onMoveStart={() => { setNodeMenu(null); setQuickConfig(null); setNodePicker(null); }}
              viewport={viewport} onViewportChange={setViewport} onMoveEnd={event => {
                if (!event) return;
                if (suppressViewportDirty.current) { suppressViewportDirty.current = false; return; }
                changed();
              }}
              minZoom={0.18} maxZoom={2.2} snapToGrid snapGrid={[16, 16]}
              panOnScroll zoomOnPinch zoomOnScroll selectionOnDrag
              deleteKeyCode={['Backspace', 'Delete']} colorMode="dark">
              <Background variant={BackgroundVariant.Dots} gap={22} size={1.25} color="#2d2634" />
              <Controls showInteractive={false} position="bottom-left" />
              {miniMapOpen ? (
                <MiniMap
                  pannable zoomable
                  position="bottom-right"
                  nodeBorderRadius={10}
                  nodeColor={node => executionByNode.get(node.id)?.status === 'running' ? '#ff6d00' : '#3a3342'}
                  nodeStrokeColor={node => executionByNode.get(node.id)?.status === 'error' ? '#ff5a6a' : '#665d72'}
                  maskColor="rgba(12, 9, 16, .72)"
                />
              ) : null}
              <Panel position="top-left" className="canvas-hud">
                <strong>{workflow?.name || 'Workflow'}</strong>
                <span>{nodes.length} nodes</span>
                <span>{edges.length} edges</span>
                {execution?.status ? <em data-state={execution.status}>{execution.status}</em> : null}
              </Panel>
              <Panel position="top-right" className="canvas-actions-panel">
                <button type="button" data-testid="toggle-minimap" aria-pressed={miniMapOpen} onClick={() => setMiniMapOpen(open => !open)}>
                  {miniMapOpen ? 'Hide map' : 'Show map'}
                </button>
                <button type="button" data-testid="open-node-picker" disabled={!workflow} onClick={() => openNodePicker({ mode: 'free' })}>+ Add node</button>
              </Panel>
            </ReactFlow>
          </div>
          <div className="ewe-inspector">
            {workflow && <ProductionSafetyPanel findings={safetyFindings} onFocusNode={setSelectedNodeId} />}
            {workflow && <ExecutionSummary execution={execution} onFocusNode={setSelectedNodeId} />}
            {workflow && <ActivityPanel items={activityEvents} status={execution?.status} />}
            {workflow && <ExecutionInspector workflowId={workflow.id} current={execution} />}
            <CredentialsPanel credentials={credentials} onCreate={createCredential} onDelete={deleteCredential} />
            {selectedNode ? <ConfigPanel node={selectedNode} def={getNodeMetadata(selectedNode.type)!} credentials={credentials}
              onParameterChange={(key, value) => patchNode({ parameters: { ...selectedNode.parameters, [key]: value } })}
              onCredentialChange={(key, credentialId) => patchNode({ credentials: { ...selectedNode.credentials, [key]: credentialId } })}
              onNameChange={name => patchNode({ name })} onDelete={deleteSelected} /> : <p className="config-hint">Select a node to configure it.<br /><br />Add nodes from the floating <kbd>+ Add node</kbd> button or press <kbd>A</kbd>.<br />Right-click a node to add the next step. Right-click an edge to insert a node between steps.</p>}
          </div>
        </div>
        <footer className="ewe-bottom">
          <span>{nodes.length} nodes · {edges.length} connections</span>
          {execution && execution.status !== 'running' ? <span data-testid="execution-result" className={`result-${execution.status}`}>Execution {execution.status}</span> : null}
          <span data-testid="status" role="status">{executionError ? `Error: ${executionError}` : message || 'Ready to edit'}</span>
          <button type="button" className="ewe-kbd-help" onClick={() => setHelpOpen(true)} aria-label="Show keyboard shortcuts"><kbd>?</kbd> Shortcuts</button>
        </footer>
      </main>
      {nodeMenu ? (
        <div className="node-context-menu" role="menu" style={{ left: nodeMenu.x, top: nodeMenu.y }} data-testid="node-context-menu">
          <button type="button" role="menuitem" onClick={() => openQuickConfig(nodeMenu)}>Quick config</button>
          <button type="button" role="menuitem" onClick={() => openNodePicker({ mode: 'after-node', sourceId: nodeMenu.nodeId })}>Add next node</button>
          <button type="button" role="menuitem" onClick={() => duplicateNode(nodeMenu.nodeId)}>Duplicate</button>
          <button type="button" role="menuitem" className="danger" onClick={() => deleteNode(nodeMenu.nodeId)}>Delete</button>
        </div>
      ) : null}
      {quickConfig && quickConfigNode && quickConfigDef ? (
        <section className="quick-config-popover" style={{ left: quickConfig.x, top: quickConfig.y }} data-testid="quick-config-popover">
          <header
            data-testid="quick-config-drag"
            onPointerDown={startQuickConfigDrag}
            onPointerMove={moveQuickConfig}
            onPointerUp={stopQuickConfigDrag}
            onPointerCancel={stopQuickConfigDrag}
          >
            <span className="quick-config-icon">{quickConfigDef.icon}</span>
            <div>
              <strong>Quick config</strong>
              <small>{quickConfigDef.name}</small>
            </div>
            <button type="button" aria-label="Close quick config" onClick={() => setQuickConfig(null)}>×</button>
          </header>
          <label className="quick-config-field">
            <span>Node name</span>
            <input value={quickConfigNode.name} onChange={event => patchNodeById(quickConfigNode.id, { name: event.target.value })} />
          </label>
          {quickConfigFields.map(field => {
            const value = String(quickConfigNode.parameters[field.key] ?? '');
            return (
              <label key={field.key} className="quick-config-field">
                <span>{field.label}</span>
                {field.kind === 'select' ? (
                  <select value={value} onChange={event => patchNodeParameterById(quickConfigNode.id, quickConfigNode, field, event.target.value)}>
                    {field.options!.map(option => <option key={option} value={option}>{option}</option>)}
                  </select>
                ) : field.kind === 'multiline' ? (
                  <textarea rows={field.key === 'source' || field.key.includes('Prompt') || field.key === 'prompt' ? 5 : 3} value={value} onChange={event => patchNodeParameterById(quickConfigNode.id, quickConfigNode, field, event.target.value)} />
                ) : (
                  <input type={field.kind === 'number' ? 'number' : 'text'} min={field.min} max={field.max} value={value} onChange={event => patchNodeParameterById(quickConfigNode.id, quickConfigNode, field, event.target.value)} />
                )}
              </label>
            );
          })}
          <footer>
            <button type="button" onClick={() => openFullConfig(quickConfigNode.id)}>Open full config</button>
          </footer>
        </section>
      ) : null}
      {nodePicker ? (
        <section className="node-picker-backdrop" data-testid="node-picker" onMouseDown={event => {
          if (event.target === event.currentTarget) setNodePicker(null);
        }}>
          <div className="node-picker-dialog" role="dialog" aria-modal="true" aria-label="Add node">
            <header>
              <div>
                <strong>
                  {nodePicker.mode === 'after-node' ? 'Add next node' : nodePicker.mode === 'insert-edge' ? 'Insert node' : 'Add node'}
                </strong>
                <small>
                  {nodePicker.mode === 'after-node' ? 'The new node will be connected after the selected node.' :
                   nodePicker.mode === 'insert-edge' ? 'The selected edge will be replaced with this node in between.' :
                   'Search or pick a category to add a node to the canvas.'}
                </small>
              </div>
              <button type="button" aria-label="Close add node" onClick={() => setNodePicker(null)}>×</button>
            </header>
            <input autoFocus aria-label="Search nodes" placeholder="Search nodes…" value={nodeQuery} onChange={event => setNodeQuery(event.target.value)} />
            <div className="node-picker-categories" role="tablist" aria-label="Node categories">
              {nodeCategories.map(category => (
                <button key={category.id} type="button" role="tab" aria-selected={nodeCategory === category.id} onClick={() => setNodeCategory(category.id)}>
                  {category.label}
                </button>
              ))}
            </div>
            <div className="node-picker-list">
              {nodePickerDefinitions.map(def => (
                <button key={def.type} type="button" data-testid={`add-${def.type}`} onClick={() => addNode(def.type, nodePicker)} title={def.description}>
                  <span>{def.icon}</span>
                  <strong>{def.name}</strong>
                  <small>{categoryByType.get(def.type) || 'Node'}</small>
                  <em>+</em>
                </button>
              ))}
              {nodePickerDefinitions.length === 0 ? <p>No nodes found.</p> : null}
            </div>
          </div>
        </section>
      ) : null}
      <KeyboardHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      </>
      )}
    </div>
  );
}
