import { createDocumentFromSpec, type NodeSpec } from './operations';
import type { LayoutKind, MindMapDocument } from './types';

export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  accent: string;
  layout: LayoutKind;
  spec: NodeSpec;
}

export const TEMPLATES: TemplateDefinition[] = [
  {
    id: 'study',
    name: 'Study Notes',
    description: 'Structure a subject from definitions to applications',
    icon: 'book',
    accent: '#4f46e5',
    layout: 'tree',
    spec: {
      title: 'Machine Learning',
      description: 'A structured study map for the core ideas of ML.',
      children: [
        {
          title: 'Definition',
          type: 'subtopic',
          preset: 'definition',
          description: 'Algorithms that improve through data without explicit programming.',
          children: [
            { title: 'Learning from data', type: 'note' },
            { title: 'Generalisation', type: 'note' },
          ],
        },
        {
          title: 'Core Concepts',
          children: [
            { title: 'Features & labels', type: 'subtopic' },
            { title: 'Loss functions', type: 'subtopic' },
            { title: 'Gradient descent', type: 'subtopic', preset: 'important' },
            { title: 'Overfitting', type: 'question', preset: 'warning' },
          ],
        },
        {
          title: 'Supervised Learning',
          children: [
            { title: 'Regression', type: 'example', children: [{ title: 'Linear regression' }] },
            { title: 'Classification', type: 'example', children: [{ title: 'Logistic regression' }, { title: 'SVM' }] },
          ],
        },
        {
          title: 'Unsupervised Learning',
          children: [{ title: 'Clustering' }, { title: 'Dimensionality reduction' }],
        },
        {
          title: 'Reinforcement Learning',
          children: [{ title: 'Agent & environment' }, { title: 'Rewards' }, { title: 'Policy' }],
        },
        {
          title: 'Applications',
          type: 'example',
          children: [{ title: 'Computer vision' }, { title: 'NLP' }, { title: 'Recommendation' }],
        },
        {
          title: 'Common Mistakes',
          type: 'question',
          preset: 'warning',
          children: [{ title: 'Data leakage' }, { title: 'Ignoring baselines' }],
        },
        { title: 'Summary & Revision', type: 'task', preset: 'task' },
      ],
    },
  },
  {
    id: 'brainstorm',
    name: 'Brainstorm',
    description: 'Diverge fast, then group ideas into themes',
    icon: 'bulb',
    accent: '#d97706',
    layout: 'radial',
    spec: {
      title: 'New Product Ideas',
      children: [
        { title: 'Who is it for?', type: 'question', children: [{ title: 'Students' }, { title: 'Teams' }, { title: 'Creators' }] },
        { title: 'What problem?', type: 'question', children: [{ title: 'Scattered notes' }, { title: 'Slow onboarding' }] },
        { title: 'Wild ideas', type: 'example', children: [{ title: 'Voice-first capture' }, { title: 'Auto clustering' }, { title: 'Offline-first' }] },
        { title: 'Constraints', preset: 'warning', children: [{ title: 'Time' }, { title: 'Budget' }, { title: 'Platform' }] },
        { title: 'Quick wins', preset: 'task', children: [{ title: 'Templates' }, { title: 'Keyboard shortcuts' }] },
        { title: 'Next steps', type: 'task', children: [{ title: 'Pick 2 ideas' }, { title: 'Prototype' }] },
      ],
    },
  },
  {
    id: 'project',
    name: 'Project Planning',
    description: 'Goals, scope, tasks, risks and timeline',
    icon: 'grid',
    accent: '#0f8f83',
    layout: 'horizontal',
    spec: {
      title: 'Website Redesign',
      children: [
        { title: 'Goals', children: [{ title: 'Faster onboarding' }, { title: 'Consistent brand' }] },
        { title: 'Requirements', children: [{ title: 'Design system' }, { title: 'CMS migration' }, { title: 'Accessibility AA' }] },
        { title: 'Tasks', type: 'task', children: [{ title: 'Discovery', preset: 'task' }, { title: 'Wireframes', preset: 'task' }, { title: 'Build', preset: 'task' }, { title: 'QA', preset: 'task' }] },
        { title: 'Risks', preset: 'warning', children: [{ title: 'Content delays' }, { title: 'Scope creep' }] },
        { title: 'Timeline', children: [{ title: 'Week 1–2 · Research' }, { title: 'Week 3–5 · Design' }, { title: 'Week 6–9 · Build' }] },
        { title: 'Resources', children: [{ title: 'Design · 1' }, { title: 'Engineering · 2' }] },
      ],
    },
  },
  {
    id: 'decision',
    name: 'Decision Tree',
    description: 'Compare options, trade-offs and consequences',
    icon: 'diamond',
    accent: '#7a5cc4',
    layout: 'horizontal',
    spec: {
      title: 'Which database?',
      children: [
        { title: 'Option A · Postgres', type: 'example', children: [{ title: 'Strong consistency' }, { title: 'Rich queries' }, { title: 'Ops overhead' }] },
        { title: 'Option B · Document store', type: 'example', children: [{ title: 'Flexible schema' }, { title: 'Fast iteration' }, { title: 'Weak joins' }] },
        { title: 'Trade-offs', preset: 'warning', children: [{ title: 'Scale' }, { title: 'Team familiarity' }, { title: 'Cost' }] },
        { title: 'Evidence', children: [{ title: 'Benchmarks' }, { title: 'Prototype results' }] },
        { title: 'Decision', preset: 'decision', children: [{ title: 'Postgres + JSONB' }] },
        { title: 'Action', type: 'task', children: [{ title: 'Migration plan' }, { title: 'Review in 3 months' }] },
      ],
    },
  },
  {
    id: 'research',
    name: 'Research',
    description: 'Questions, sources, findings and open threads',
    icon: 'search',
    accent: '#2b7fc4',
    layout: 'vertical',
    spec: {
      title: 'Research Question',
      children: [
        { title: 'Background', children: [{ title: 'Prior work' }, { title: 'Terminology' }] },
        { title: 'Key Questions', type: 'question', children: [{ title: 'What is known?' }, { title: 'What is missing?' }] },
        { title: 'Sources', type: 'reference', children: [{ title: 'Paper A' }, { title: 'Paper B' }, { title: 'Dataset' }] },
        { title: 'Method', children: [{ title: 'Data collection' }, { title: 'Analysis' }] },
        { title: 'Findings', preset: 'important', children: [{ title: 'Result 1' }, { title: 'Result 2' }] },
        { title: 'Open Threads', type: 'question', children: [{ title: 'Replication' }] },
      ],
    },
  },
  {
    id: 'dsa',
    name: 'DSA & Algorithms',
    description: 'Break down a topic into patterns, complexity and practice',
    icon: 'code',
    accent: '#5a8f36',
    layout: 'tree',
    spec: {
      title: 'Graph Algorithms',
      children: [
        { title: 'Core Ideas', children: [{ title: 'Vertices & edges' }, { title: 'Directed vs undirected' }, { title: 'Weighted graphs' }] },
        { title: 'Representations', preset: 'definition', children: [{ title: 'Adjacency list' }, { title: 'Adjacency matrix' }] },
        { title: 'Traversal', type: 'example', children: [{ title: 'BFS · queue' }, { title: 'DFS · stack' }] },
        { title: 'Shortest Path', children: [{ title: 'Dijkstra' }, { title: 'Bellman-Ford' }, { title: 'Floyd-Warshall' }] },
        { title: 'Complexity', preset: 'warning', children: [{ title: 'O(V + E)' }, { title: 'O(V²) dense' }] },
        { title: 'Common Pitfalls', type: 'question', preset: 'warning', children: [{ title: 'Cycles' }, { title: 'Disconnected components' }] },
        { title: 'Practice', type: 'task', preset: 'task', children: [{ title: 'Topological sort' }, { title: 'Union-Find' }] },
      ],
    },
  },
  {
    id: 'problem',
    name: 'Problem Solving',
    description: 'Root cause → options → decision → action',
    icon: 'target',
    accent: '#c0457e',
    layout: 'tree',
    spec: {
      title: 'Problem',
      children: [
        { title: 'Symptoms', children: [{ title: 'Slow load times' }, { title: 'Drop-off at step 2' }] },
        { title: 'Root Causes', preset: 'warning', children: [{ title: 'Uncached queries' }, { title: 'Large payloads' }] },
        { title: 'Evidence', children: [{ title: 'Traces' }, { title: 'User sessions' }] },
        { title: 'Options', type: 'example', children: [{ title: 'Add caching' }, { title: 'Split payload' }] },
        { title: 'Trade-offs', children: [{ title: 'Complexity' }, { title: 'Freshness' }] },
        { title: 'Decision', preset: 'decision' },
        { title: 'Action', type: 'task', preset: 'task' },
      ],
    },
  },
];

export function buildTemplateDocument(templateId: string, title?: string): MindMapDocument {
  const template = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0];
  const doc = createDocumentFromSpec(title ?? template.name, template.spec, template.layout);
  return doc;
}
