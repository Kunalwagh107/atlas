import { CURRENT_SCHEMA_VERSION } from './types';

/**
 * Real, chained document migrations. `parseDocument` runs these before validation,
 * so v1 maps remain readable forever. Never change the canonical model without
 * adding a step here.
 *
 * v2 also gained one *optional* field — `style.height`. It needs no migration
 * step because `parseDocument` treats a missing height as "auto"; bumping the
 * schema would only invalidate otherwise valid v2 documents.
 */
export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

type Raw = Record<string, unknown>;
type Migration = (raw: Raw) => Raw;

function obj(value: unknown): Raw {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {};
}
function nodeArray(raw: Raw): Raw[] {
  const nodes = raw.nodes;
  if (Array.isArray(nodes)) return nodes.filter((n) => n && typeof n === 'object') as Raw[];
  if (nodes && typeof nodes === 'object') {
    return Object.entries(nodes as Raw).map(([key, value]) => ({ ...obj(value), id: obj(value).id ?? key }));
  }
  return [];
}
function writeNodes(raw: Raw, nodes: Raw[]): Raw {
  const asObject = raw.nodes && typeof raw.nodes === 'object' && !Array.isArray(raw.nodes);
  return asObject
    ? { ...raw, nodes: Object.fromEntries(nodes.map((node) => [String(node.id), node])) }
    : { ...raw, nodes };
}

const v1ToV2: Migration = (raw) => {
  const nodes = nodeArray(raw).map((node) => {
    const metadata = obj(node.metadata);
    const legacyTags = Array.isArray(node.tags) ? node.tags : [];
    const content = obj(node.content);
    if (legacyTags.length && !Array.isArray(content.tags)) content.tags = legacyTags;
    if (typeof node.markdown === 'string' && typeof content.markdown !== 'string') content.markdown = node.markdown;
    return {
      ...node,
      positionMode: node.positionMode === 'manual' || metadata.manualPosition === true ? 'manual' : 'auto',
      content,
    };
  });
  const settings = obj(raw.settings);
  return {
    ...writeNodes(raw, nodes),
    settings: {
      ...settings,
      autoArrange: typeof settings.autoArrange === 'boolean' ? settings.autoArrange : false,
      presentationOrder: Array.isArray(settings.presentationOrder)
        ? settings.presentationOrder.filter((id): id is string => typeof id === 'string')
        : [],
    },
    version: 2,
  };
};

const MIGRATIONS: Record<number, Migration> = {
  1: v1ToV2,
};

export function readDocumentVersion(input: unknown): number {
  const raw = obj(input);
  const value = typeof raw.version === 'number' && Number.isFinite(raw.version) ? Math.trunc(raw.version) : 1;
  return value < 1 ? 1 : value;
}

export interface MigrationResult {
  raw: Raw;
  fromVersion: number;
  applied: number[];
}

export function migrateRawDocument(input: unknown): MigrationResult {
  let raw = obj(input);
  let version = readDocumentVersion(input);
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new MigrationError(
      `This map uses schema v${version}, newer than this app (v${CURRENT_SCHEMA_VERSION}). Update Atlas to open it.`,
    );
  }
  const applied: number[] = [];
  while (version < CURRENT_SCHEMA_VERSION) {
    const migration = MIGRATIONS[version];
    if (!migration) throw new MigrationError(`No migration path from schema v${version}.`);
    raw = migration(raw);
    applied.push(version);
    const next = readDocumentVersion(raw);
    if (next <= version) throw new MigrationError(`Migration from v${version} did not advance the schema version.`);
    version = next;
  }
  return { raw, fromVersion: readDocumentVersion(input), applied };
}

export function needsMigration(input: unknown): boolean {
  return readDocumentVersion(input) < CURRENT_SCHEMA_VERSION;
}
