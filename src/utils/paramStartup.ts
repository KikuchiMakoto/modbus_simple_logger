// Persisted defaults for the Parameter SharedArrayBuffer.
//
// The user can hand-edit these from the Param Editor Window (Menu → Param
// Editor, "Default" column). They are written to the SAB once at app startup,
// so changes made after that point do NOT propagate until the next launch —
// the live "Present" column is what writes to the SAB in-session.
//
// The split between Present and Default is deliberate: Present edits are part
// of the experiment ("right now I want Param[3] to be 1.5"); Default edits are
// preparation for the next session ("next time I open this rig I want Param[3]
// to start at 1.5"). Conflating them would make either kind of edit hard to
// reason about.

import { readJsonStorage, writeJsonStorage } from './cookies';
import { PARAM_CHANNELS } from '../constants';

const STORAGE_KEY = 'param_startup_values_v1';

/** Always exactly PARAM_CHANNELS numbers. Anything unrecognised fills in 0. */
const normalise = (raw: unknown): number[] => {
  const out: number[] = Array.from({ length: PARAM_CHANNELS }, () => 0);
  if (!Array.isArray(raw)) return out;
  for (let i = 0; i < Math.min(raw.length, out.length); i += 1) {
    const entry = raw[i];
    if (typeof entry === 'number' && Number.isFinite(entry)) out[i] = entry;
  }
  return out;
};

export const loadParamStartupValues = (): number[] => {
  return normalise(readJsonStorage<number[]>(STORAGE_KEY) as unknown);
};

export const saveParamStartupValues = (values: number[]): void => {
  writeJsonStorage(STORAGE_KEY, normalise(values));
};
