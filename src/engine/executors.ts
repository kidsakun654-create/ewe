import type { WorkflowNode } from '../model';
import type { Data } from './types';
import { httpRequest } from './http';
import { createCodeExecutor } from './code';
import { aiOpenAI, hermesAgent } from './ai';
import { github, googleSheets, telegram } from './app-connectors';

export interface NodeResult { output: Data; port: string; }
type Executor = (node: WorkflowNode, input: Data, signal: AbortSignal) => Promise<NodeResult>;

const codeExecutor = createCodeExecutor();

export const executors: Record<string, Executor> = {
  httpRequest,
  telegram,
  github,
  googleSheets,
  if: async (node, input) => ({ output: input, port: Object.hasOwn(input, String(node.parameters.field)) && input[String(node.parameters.field)] === node.parameters.value ? 'true' : 'false' }),
  manualTrigger: async () => ({ output: {}, port: 'main' }),
  webhook: async (_node, input) => ({ output: input, port: 'main' }),
  schedule: async (_node, input) => ({ output: input, port: 'main' }),
  set: async (node, input) => ({ output: { ...input, [String(node.parameters.field)]: node.parameters.value }, port: 'main' }),
  switch: async (node, input) => {
    const field = String(node.parameters.field || '');
    const mode = String(node.parameters.mode || 'first');
    let rules: Array<Record<string, string>> = [];
    try {
      const raw = node.parameters.rules;
      rules = typeof raw === 'string' ? JSON.parse(raw) : Array.isArray(raw) ? raw : [];
    } catch { rules = []; }
    const value = field ? input[field] : undefined;
    const matches: string[] = [];
    for (const rule of rules) {
      const output = rule.port;
      if (!output) continue;
      const operator = rule.operator ?? (rule.equals !== undefined ? 'equals' : Object.keys(rule).find(k => k !== 'port'));
      const ruleValue = rule.value ?? rule.equals;
      if (!operator) continue;
      let hit = false;
      switch (operator) {
        case 'equals': hit = value === ruleValue; break;
        case 'notEquals': hit = value !== ruleValue; break;
        case 'contains': hit = String(value ?? '').includes(String(ruleValue)); break;
        case 'startsWith': hit = String(value ?? '').startsWith(String(ruleValue)); break;
        case 'endsWith': hit = String(value ?? '').endsWith(String(ruleValue)); break;
        case 'regex': try { hit = new RegExp(String(ruleValue)).test(String(value ?? '')); } catch { hit = false; } break;
        case 'isEmpty': hit = value === '' || value === null || value === undefined; break;
        case 'isNotEmpty': hit = value !== '' && value !== null && value !== undefined; break;
        default: hit = value === ruleValue; break;
      }
      if (hit) matches.push(output);
    }
    const defaultPort = String(node.parameters.defaultPort || 'default');
    const port = mode === 'all' ? (matches.length > 0 ? matches.join(',') : defaultPort) : (matches[0] || defaultPort);
    return { output: input, port };
  },
  merge: async (_node, input) => {
    const fanIn = input._fanInArray as Data[] || [];
    const mode = _node.parameters?.mode || 'append';
    const merged: unknown[] = [];
    for (const item of fanIn) {
      if (Array.isArray(item)) {
        for (const el of item) merged.push(el);
      } else if (item && typeof item === 'object' && !Array.isArray(item)) {
        for (const v of Object.values(item)) {
          if (Array.isArray(v)) for (const el of v) merged.push(el);
          else merged.push(v);
        }
      } else {
        merged.push(item);
      }
    }
    return { output: { merged }, port: 'main' };
  },
  loop: async (node, input) => {
    const sourceField = String(node.parameters.sourceField || 'items');
    const items: unknown[] = [];
    const fanIn = input._fanInArray as Data[] || [];
    for (const src of fanIn) {
      if (src && typeof src === 'object' && !Array.isArray(src)) {
        const val = (src as Record<string, unknown>)[sourceField];
        if (Array.isArray(val)) items.push(...val);
        else if (val !== undefined && val !== null) items.push(val);
      } else if (Array.isArray(src)) {
        items.push(...src);
      }
    }
    const max = Math.min(items.length, Number(node.parameters.maxIterations || 100));
    return { output: { items: items.slice(0), count: items.length, looped: max }, port: 'main' };
  },
  wait: async (node, input, signal) => {
    const ms = Math.min(Math.max(Number(node.parameters.duration) || 1000, 1), 300000);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); });
    });
    return { output: input, port: 'main' };
  },
  code: codeExecutor,
  ai: aiOpenAI,
  hermesAgent,
};
