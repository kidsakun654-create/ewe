import { describe, expect, it } from 'vitest';
import { workflowTemplates } from '../src/templates';
import { validateWorkflow } from '../src/validation';

describe('workflow templates', () => {
  it('ship with unique ids and valid workflow graphs', () => {
    const ids = new Set<string>();
    const workflowIds = new Set<string>();

    for (const template of workflowTemplates) {
      expect(ids.has(template.id)).toBe(false);
      expect(workflowIds.has(template.workflow.id)).toBe(false);
      ids.add(template.id);
      workflowIds.add(template.workflow.id);

      expect(template.name.trim()).not.toBe('');
      expect(template.summary.trim()).not.toBe('');
      expect(validateWorkflow(template.workflow)).toBeNull();
    }
  });
});
