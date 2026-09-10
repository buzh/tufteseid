import { createStore } from 'jotai';
import { describe, expect, it } from 'vitest';
import { mapToolAtom } from '../../../src/map/overlay/atoms';

describe('mapToolAtom', () => {
  it('defaults to null', () => {
    const store = createStore();
    expect(store.get(mapToolAtom)).toBeNull();
  });

  it('can be set to a tool', () => {
    const store = createStore();
    store.set(mapToolAtom, 'layers');
    expect(store.get(mapToolAtom)).toBe('layers');
  });

  it('can be switched between tools', () => {
    const store = createStore();
    store.set(mapToolAtom, 'layers');
    store.set(mapToolAtom, 'localities');
    expect(store.get(mapToolAtom)).toBe('localities');
  });

  it('can be cleared back to null', () => {
    const store = createStore();
    store.set(mapToolAtom, 'layers');
    store.set(mapToolAtom, null);
    expect(store.get(mapToolAtom)).toBeNull();
  });
});
