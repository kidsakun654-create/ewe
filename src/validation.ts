import { getNodeMetadata } from './nodes/registry';
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0 && value.length <= 120;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,120}$/.test(value);
const credentialMap = (value: unknown) => object(value) && Object.entries(value).every(([key, credentialId]) => /^[\w-]{1,80}$/.test(key) && id(credentialId));

export function validateWorkflow(value: unknown): string | null {
  if (!object(value) || !id(value.id) || !text(value.name) || value.enabled !== false) return 'Invalid workflow identity or enabled flag';
  if (!Array.isArray(value.nodes) || value.nodes.length > 500 || !Array.isArray(value.connections) || value.connections.length > 2000) return 'Invalid graph size';
  if (!object(value.settings)) return 'Invalid settings';
  const viewport = value.settings.viewport;
  if (viewport !== undefined && (!object(viewport) || !finite(viewport.x) || !finite(viewport.y) || !finite(viewport.zoom) || viewport.zoom < 0.18 || viewport.zoom > 2.2)) return 'Invalid viewport';
  const nodes = new Map<string, string>();
  for (const node of value.nodes) {
    if (!object(node) || !id(node.id) || nodes.has(node.id) || !text(node.name) || typeof node.type !== 'string') return 'Invalid or duplicate node';
    const def = getNodeMetadata(node.type);
    if (!def) return 'Unknown node type';
    if (!object(node.position) || !finite(node.position.x) || !finite(node.position.y)) return 'Invalid node position';
    if (!credentialMap(node.credentials)) return 'Invalid credentials reference';
    if (!object(node.parameters)) return 'Invalid parameters';
    const parameters = node.parameters;
    if (Object.keys(parameters).some(key => !def.fields.some(field => field.key === key))) return 'Unknown parameter';
    for (const field of def.fields) {
      const parameter = parameters[field.key];
      // Optional fields or fields with defaults can be undefined at save time.
      if (parameter === undefined && (field.optional || field.default !== undefined)) continue;
      if (typeof parameter === 'string' && parameter.includes('{{') && parameter.length <= 20000) continue;
      if (field.kind === 'number') {
        if (!finite(parameter) || (field.min !== undefined && parameter < field.min) || (field.max !== undefined && parameter > field.max)) return `Invalid ${field.label}`;
      } else if (typeof parameter !== 'string' || parameter.length > 20000 || (field.options && !field.options.includes(parameter))) return `Invalid ${field.label}`;
    }
    nodes.set(node.id, node.type);
  }
  const edges = new Set<string>();
  const pairs = new Set<string>();
  for (const edge of value.connections) {
    if (!object(edge) || !id(edge.id) || edges.has(edge.id) || !id(edge.source) || !id(edge.target) || edge.source === edge.target) return 'Invalid or duplicate connection';
    const source = getNodeMetadata(nodes.get(edge.source) || '');
    const target = getNodeMetadata(nodes.get(edge.target) || '');
    if (!source || !target) return 'Dangling connection';
    const isDynamicOutput = source.type === 'switch';
    const sourcePortOk = isDynamicOutput
      ? (typeof edge.sourcePort === 'string' && edge.sourcePort.length > 0)
      : (typeof edge.sourcePort === 'string' && source.outputs.includes(edge.sourcePort));
    if (!sourcePortOk || typeof edge.targetPort !== 'string' || !target.inputs.includes(edge.targetPort)) return 'Invalid connection port';
    const pair = JSON.stringify([edge.source, edge.sourcePort, edge.target, edge.targetPort]);
    if (pairs.has(pair)) return 'Duplicate connection';
    edges.add(edge.id); pairs.add(pair);
  }
  return null;
}
