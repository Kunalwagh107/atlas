import { describe, expect, it } from 'vitest';
import { commit, commitApplied, createHistory, redo, undo } from './history';

describe('application history', () => {
  it('commits, undoes and redoes snapshots', () => {
    let state = createHistory<number>(0);
    state = commit(state, 1, { label: 'one' });
    state = commit(state, 2, { label: 'two' });
    expect(state.present).toBe(2);
    expect(state.past).toHaveLength(2);
    const undone = undo(state);
    expect(undone.present).toBe(1);
    expect(undone.future).toHaveLength(1);
    expect(redo(undone).present).toBe(2);
    expect(commit(undo(state), 3, { label: 'three' }).future).toHaveLength(0);
  });

  it('coalesces rapid edits with the same key', () => {
    let state = createHistory<string>('a');
    state = commit(state, 'ab', { label: 'type', coalesceKey: 'title:1' });
    state = commit(state, 'abc', { label: 'type', coalesceKey: 'title:1' });
    expect(state.past).toHaveLength(1);
    expect(undo(state).present).toBe('a');
    const separate = commit(state, 'abcd', { label: 'type', coalesceKey: 'title:2' });
    expect(separate.past).toHaveLength(2);
  });

  it('records an already-applied drag as a single undo step', () => {
    const before = { x: 0 };
    const present = { x: 50 };
    const state = commitApplied({ past: [], present, future: [], lastAction: '' }, before, 'Move nodes');
    expect(state.present).toBe(present);
    expect(undo(state).present).toBe(before);
  });

  it('caps history at 120 entries', () => {
    let state = createHistory<number>(0);
    for (let i = 1; i <= 140; i++) state = commit(state, i, { label: `step ${i}` });
    expect(state.past).toHaveLength(120);
  });
});

describe('coalescing', () => {
  it('keeps a continuous typing run in one undo step beyond the first window', () => {
    let state = createHistory<number>(0);
    const start = Date.now();
    state = commit(state, 1, { label: 'type', coalesceKey: 'title' });
    // Simulate two keystrokes 600 ms apart, i.e. inside a refreshed window but
    // well past the window measured from the first commit.
    const realNow = Date.now;
    try {
      Date.now = () => start + 600;
      state = commit(state, 2, { label: 'type', coalesceKey: 'title' });
      Date.now = () => start + 1200;
      state = commit(state, 3, { label: 'type', coalesceKey: 'title' });
    } finally {
      Date.now = realNow;
    }
    expect(state.present).toBe(3);
    expect(state.past).toHaveLength(1);
  });
});
