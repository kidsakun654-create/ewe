import type { Workflow } from './model';

export type SafetySeverity = 'high' | 'medium' | 'low';

export interface SafetyFinding {
  id: string;
  severity: SafetySeverity;
  nodeId?: string;
  nodeName?: string;
  title: string;
  detail: string;
}

const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isEnabled(value: unknown) {
  return String(value || 'yes') === 'yes';
}

function add(findings: SafetyFinding[], finding: SafetyFinding) {
  findings.push(finding);
}

export function analyzeWorkflowSafety(workflow: Workflow): SafetyFinding[] {
  const findings: SafetyFinding[] = [];

  for (const node of workflow.nodes) {
    if (node.type === 'httpRequest') {
      const method = text(node.parameters.method).toUpperCase() || 'GET';
      const url = text(node.parameters.url);
      if (mutatingMethods.has(method)) {
        add(findings, {
          id: `${node.id}:http-mutating`,
          severity: 'high',
          nodeId: node.id,
          nodeName: node.name,
          title: `${method} request can change external state`,
          detail: 'Confirm the target URL, payload, and rollback path before running this workflow in production.',
        });
      } else if (url && !url.includes('example.com') && !url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost')) {
        add(findings, {
          id: `${node.id}:http-external`,
          severity: 'medium',
          nodeId: node.id,
          nodeName: node.name,
          title: 'External HTTP call',
          detail: 'This workflow talks to a non-local endpoint. Check rate limits, authentication, and timeout settings.',
        });
      }
      if (url.includes('{{')) {
        add(findings, {
          id: `${node.id}:dynamic-url`,
          severity: 'medium',
          nodeId: node.id,
          nodeName: node.name,
          title: 'Dynamic request URL',
          detail: 'Expression-built URLs can accidentally route to unsafe hosts. Validate upstream input before production runs.',
        });
      }
    }

    if (node.type === 'schedule' && isEnabled(node.parameters.enabled)) {
      add(findings, {
        id: `${node.id}:schedule-enabled`,
        severity: 'high',
        nodeId: node.id,
        nodeName: node.name,
        title: 'Enabled schedule trigger',
        detail: 'This workflow can run without a human click. Confirm cadence, idempotency, and duplicate-run protection.',
      });
    }

    if (node.type === 'webhook' && isEnabled(node.parameters.enabled)) {
      add(findings, {
        id: `${node.id}:webhook-enabled`,
        severity: 'medium',
        nodeId: node.id,
        nodeName: node.name,
        title: 'Enabled inbound webhook',
        detail: 'Inbound data can trigger the workflow. Use a credential-backed webhook secret and validate payload shape.',
      });
    }

    if (node.type === 'hermesAgent') {
      add(findings, {
        id: `${node.id}:hermes-agent`,
        severity: 'high',
        nodeId: node.id,
        nodeName: node.name,
        title: 'Hermes Agent execution',
        detail: 'Agent prompts may operate beyond simple data transforms. Keep commands approval-gated and review outputs.',
      });
    }

    if (node.type === 'code') {
      add(findings, {
        id: `${node.id}:code-node`,
        severity: 'medium',
        nodeId: node.id,
        nodeName: node.name,
        title: 'Custom code node',
        detail: 'Code runs in a sandbox, but production workflows should still have tests for inputs, failures, and timeouts.',
      });
    }

    if (node.type === 'ai' && text(node.parameters.apiKey)) {
      add(findings, {
        id: `${node.id}:inline-ai-key`,
        severity: 'high',
        nodeId: node.id,
        nodeName: node.name,
        title: 'Inline AI API key',
        detail: 'Move API keys into Credentials so exported workflows, screenshots, and edits do not expose secrets.',
      });
    }

    if (node.type === 'webhook' && text(node.parameters.secret)) {
      add(findings, {
        id: `${node.id}:inline-webhook-secret`,
        severity: 'high',
        nodeId: node.id,
        nodeName: node.name,
        title: 'Inline webhook secret',
        detail: 'Use a Webhook Secret credential instead of storing the secret directly on the node.',
      });
    }
  }

  return findings;
}

export function hasBlockingSafetyRisk(findings: SafetyFinding[]) {
  return findings.some(finding => finding.severity === 'high');
}
