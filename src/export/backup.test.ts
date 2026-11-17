import { describe, expect, it } from 'vitest';
import { makeDoc } from '../test/fixtures';
import { backupChecksum, BackupError, BACKUP_VERSION, parseBackup, serializeBackup } from './backup';

describe('library backup', () => {
  it('round-trips every map with its nodes intact', () => {
    const first = makeDoc('Alpha map');
    const second = makeDoc('Beta map');
    const text = serializeBackup([first, second], new Date('2026-11-16T00:00:00Z'));
    const parsed = parseBackup(text);

    expect(parsed.map((doc) => doc.title)).toEqual(['Alpha map', 'Beta map']);
    expect(Object.keys(parsed[0].nodes)).toHaveLength(Object.keys(first.nodes).length);
    expect(JSON.parse(text)).toMatchObject({ format: 'atlas-backup', version: BACKUP_VERSION });
    expect(JSON.parse(text).maps[0].integrity).toBe(backupChecksum(first));
  });

  it('round-trips a backup larger than the old 200-map / 40 MB limits', () => {
    const maps = Array.from({ length: 210 }, (_, index) => makeDoc(`Map ${index}`));
    const text = serializeBackup(maps);
    const parsed = parseBackup(text);
    expect(parsed).toHaveLength(210);
    expect(parsed[209].title).toBe('Map 209');
  });

  it('skips a tampered map and reports the integrity failure', () => {
    const good = makeDoc('Good map');
    const bad = makeDoc('Tampered map');
    const file = JSON.parse(serializeBackup([good, bad]));
    file.maps[1].doc.nodes[file.maps[1].doc.rootId].title = 'Changed after backup';
    const parsed = parseBackup(JSON.stringify(file));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe('Good map');
    expect((parsed as typeof parsed & { issues?: string[] }).issues?.[0]).toMatch(/integrity check failed/);
  });

  it('skips a corrupt legacy map without checksums', () => {
    const good = makeDoc('Good map');
    const file = JSON.stringify({
      format: 'atlas-backup',
      version: 1,
      maps: [
        { title: 'Good map', doc: good },
        { title: 'Broken map', doc: { version: 2, nodes: [] } },
      ],
    });
    expect(parseBackup(file).map((doc) => doc.title)).toEqual(['Good map']);
  });

  it('rejects files that are not Atlas backups, are empty or come from the future', () => {
    expect(() => parseBackup('not json')).toThrow(BackupError);
    expect(() => parseBackup(JSON.stringify({ format: 'other', version: 1, maps: [] }))).toThrow(/not an Atlas backup/);
    expect(() => parseBackup(JSON.stringify({ format: 'atlas-backup', version: 1, maps: [] }))).toThrow(/no maps/);
    expect(() => parseBackup(JSON.stringify({ format: 'atlas-backup', version: 99, maps: [{}] }))).toThrow(/newer version/);
  });

  it('refuses a backup with no readable maps and reports why', () => {
    const file = JSON.stringify({ format: 'atlas-backup', version: 1, maps: [{ doc: { nodes: [] } }] });
    expect(() => parseBackup(file)).toThrow(BackupError);
  });
});
