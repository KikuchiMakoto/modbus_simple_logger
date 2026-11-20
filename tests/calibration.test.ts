import { describe, expect, test } from 'bun:test';
import { DEFAULT_AI_CALIBRATION, sanitizeAiCalibration } from '../src/utils/calibration';

describe('sanitizeAiCalibration', () => {
  test('keeps finite coefficients as they are', () => {
    const out = sanitizeAiCalibration([{ a: 0.5, b: -2, c: 1e-6 }], 1);
    expect(out).toEqual([{ a: 0.5, b: -2, c: 1e-6 }]);
  });

  test('pads to the channel count with the default', () => {
    const out = sanitizeAiCalibration([{ a: 1, b: 2, c: 3 }], 3);
    expect(out).toHaveLength(3);
    expect(out[1]).toEqual(DEFAULT_AI_CALIBRATION);
    expect(out[2]).toEqual(DEFAULT_AI_CALIBRATION);
  });

  test('replaces each non-finite or non-number field with its own default', () => {
    // null is what JSON makes of ±Infinity; strings come from hand-edited or
    // hostile config files and must never reach the print report as markup.
    const out = sanitizeAiCalibration(
      [{ a: null, b: '<img src=x onerror=alert(1)>', c: 4 }, { a: Infinity, b: NaN, c: -Infinity }],
      2,
    );
    expect(out[0]).toEqual({ a: DEFAULT_AI_CALIBRATION.a, b: DEFAULT_AI_CALIBRATION.b, c: 4 });
    expect(out[1]).toEqual(DEFAULT_AI_CALIBRATION);
  });

  test('treats a non-array or non-object entries as missing', () => {
    expect(sanitizeAiCalibration('nope', 2)).toEqual([DEFAULT_AI_CALIBRATION, DEFAULT_AI_CALIBRATION]);
    expect(sanitizeAiCalibration([42, null], 2)).toEqual([DEFAULT_AI_CALIBRATION, DEFAULT_AI_CALIBRATION]);
  });
});
