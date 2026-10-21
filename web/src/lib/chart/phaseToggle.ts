import { useSyncExternalStore } from 'react';
import { readStored, writeStored } from './storage';

/** The "Phases" toggle on every time chart: one setting, remembered on this device. */
const KEY = 'trim.chart.phases';
const listeners = new Set<() => void>();

function shown(): boolean {
  return readStored(KEY) !== 'off';
}

export function setPhasesShown(on: boolean): void {
  writeStored(KEY, on ? 'on' : 'off');
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function usePhasesShown(): boolean {
  return useSyncExternalStore(subscribe, shown, shown);
}
