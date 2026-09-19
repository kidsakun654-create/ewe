import type { SafetyFinding } from '../safety';

const order: Record<SafetyFinding['severity'], number> = { high: 0, medium: 1, low: 2 };

export default function ProductionSafetyPanel({ findings, onFocusNode }: { findings: SafetyFinding[]; onFocusNode: (nodeId: string) => void }) {
  const sorted = [...findings].sort((a, b) => order[a.severity] - order[b.severity]);
  const high = findings.filter(finding => finding.severity === 'high').length;
  const medium = findings.filter(finding => finding.severity === 'medium').length;

  return <section className={`production-safety ${high ? 'has-high-risk' : findings.length ? 'has-warnings' : 'is-clear'}`} aria-label="Production safety">
    <header>
      <div>
        <span className="section-label">PRODUCTION SAFETY</span>
        <h2>{findings.length ? `${findings.length} review item${findings.length === 1 ? '' : 's'}` : 'Ready for controlled runs'}</h2>
      </div>
      <span className="safety-score">{high ? `${high} high` : medium ? `${medium} medium` : 'clear'}</span>
    </header>
    {findings.length === 0 ? (
      <p className="safety-empty">No production blockers detected. Still review credentials, payloads, and target environment before enabling automations.</p>
    ) : (
      <ul data-testid="safety-findings">
        {sorted.map(finding => {
          const nodeId = finding.nodeId;
          return <li key={finding.id} data-severity={finding.severity}>
            <div>
              <strong>{finding.title}</strong>
              <p>{finding.detail}</p>
              {finding.nodeName ? <small>{finding.nodeName}</small> : null}
            </div>
            {nodeId ? <button type="button" onClick={() => onFocusNode(nodeId)}>Focus</button> : null}
          </li>;
        })}
      </ul>
    )}
  </section>;
}
