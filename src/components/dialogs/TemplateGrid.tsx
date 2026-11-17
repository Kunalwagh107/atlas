import { TEMPLATES } from '../../core/mindmap/templates';
import { Icon } from '../common/Icon';

export interface TemplateGridProps {
  onSelect: (templateId: string | 'blank') => void;
  compact?: boolean;
}

function countNodes(spec: { children?: { children?: unknown[] }[] }): number {
  let count = 1;
  for (const child of spec.children ?? []) {
    count += 1 + (child.children?.length ?? 0);
  }
  return count;
}

export function TemplateGrid({ onSelect, compact = false }: TemplateGridProps) {
  return (
    <div className={`template-grid ${compact ? 'is-compact' : ''}`}>
      <button type="button" className="template-card template-card--blank" onClick={() => onSelect('blank')}>
        <span className="template-card__icon"><Icon name="file-plus" size={19} /></span>
        <strong>Blank map</strong>
        <span>Start with just a central topic and grow from there.</span>
        <span className="template-card__meta">1 node</span>
      </button>
      {TEMPLATES.map((template) => (
        <button key={template.id} type="button" className="template-card" onClick={() => onSelect(template.id)}>
          <span className="template-card__icon" style={{ color: template.accent, background: `${template.accent}18` }}>
            <Icon name={template.icon} size={19} />
          </span>
          <strong>{template.name}</strong>
          <span>{template.description}</span>
          <span className="template-card__meta"><Icon name="layers" size={11} /> {countNodes(template.spec)} nodes</span>
        </button>
      ))}
    </div>
  );
}
