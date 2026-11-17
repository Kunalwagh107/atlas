import { useMemo } from 'react';
import { NODE_TYPES, type NodeType } from '../../core/mindmap/types';
import type { SearchField } from '../../core/mindmap/search';
import { actions } from '../../state/actions';
import { useDerived } from '../../state/derived';
import { useAppStore } from '../../state/store';
import { Icon } from '../common/Icon';

const FIELDS: { value: SearchField; label: string }[] = [
  { value: 'title', label: 'Title' },
  { value: 'description', label: 'Notes' },
  { value: 'content', label: 'Content' },
  { value: 'tags', label: 'Tags' },
  { value: 'type', label: 'Type' },
];

/** Ranked results + filter controls, anchored under the toolbar search field. */
export function SearchPanel() {
  const derived = useDerived();
  const doc = derived.doc;
  const search = useAppStore((s) => s.search);
  const { filters, results, activeIndex } = search;

  const allTags = useMemo(() => {
    if (!doc) return [];
    const tags = new Set<string>();
    for (const node of Object.values(doc.nodes)) (node.content?.tags ?? []).forEach((tag) => tags.add(tag));
    return [...tags].sort().slice(0, 40);
  }, [doc]);

  const toggleType = (type: NodeType) => {
    const next = filters.types.includes(type)
      ? filters.types.filter((value) => value !== type)
      : [...filters.types, type];
    actions.setSearchFilters({ types: next });
  };

  return (
    <div className="search-panel" role="region" aria-label="Search results and filters">
      <div className="search-panel__filters">
        <span className="field-label">Search in</span>
        <div className="filter-chips">
          {FIELDS.map((field) => (
            <button
              key={field.value}
              type="button"
              className={`filter-chip ${filters.fields.includes(field.value) ? 'is-active' : ''}`}
              aria-pressed={filters.fields.includes(field.value)}
              onClick={() => actions.toggleSearchField(field.value)}
            >
              {field.label}
            </button>
          ))}
        </div>
        <div className="search-panel__switches">
          <label className="switch">
            <input type="checkbox" checked={filters.fuzzy} onChange={(event) => actions.setSearchFilters({ fuzzy: event.target.checked })} />
            <span className="switch-track" /><span>Fuzzy</span>
          </label>
          <label className="switch">
            <input type="checkbox" checked={filters.exact} onChange={(event) => actions.setSearchFilters({ exact: event.target.checked })} />
            <span className="switch-track" /><span>Exact only</span>
          </label>
        </div>
        {allTags.length > 0 && (
          <select
            className="input input-sm"
            aria-label="Filter by tag"
            value={filters.tags[0] ?? ''}
            onChange={(event) => actions.setSearchFilters({ tags: event.target.value ? [event.target.value] : [] })}
          >
            <option value="">All tags</option>
            {allTags.map((tag) => <option key={tag} value={tag}>#{tag}</option>)}
          </select>
        )}
        <div className="filter-chips">
          {NODE_TYPES.slice(0, 6).map((type) => (
            <button
              key={type.value}
              type="button"
              className={`filter-chip ${filters.types.includes(type.value) ? 'is-active' : ''}`}
              aria-pressed={filters.types.includes(type.value)}
              onClick={() => toggleType(type.value)}
            >
              {type.label}
            </button>
          ))}
        </div>
      </div>

      <div className="search-panel__results">
        <div className="search-panel__head">
          <Icon name="search" size={13} />
          <strong>{search.query ? `${results.length} result${results.length === 1 ? '' : 's'}` : 'Type to search'}</strong>
        </div>
        {results.length === 0 && search.query && (
          <div className="list-empty"><Icon name="search" size={20} /><span>No matching nodes. Try fewer filters or enable fuzzy matching.</span></div>
        )}
        <ul className="search-results">
          {results.slice(0, 40).map((hit, index) => {
            const node = doc?.nodes[hit.id];
            if (!node) return null;
            return (
              <li key={hit.id} className={index === activeIndex ? 'is-active' : ''}>
                <button type="button" onClick={() => actions.focusNode(hit.id, 1)}>
                  <span className="search-results__title">{node.title}</span>
                  <span className="search-results__score">{hit.score}</span>
                  {hit.snippet && <span className="search-results__snippet">{hit.snippet}</span>}
                  <span className="search-results__fields">
                    {hit.matchedIn.map((field) => <span key={field} className="chip">{field}</span>)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {results.length > 40 && <p className="panel-note">Showing the first 40 of {results.length} results.</p>}
      </div>
    </div>
  );
}
