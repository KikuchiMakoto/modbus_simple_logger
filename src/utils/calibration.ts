import type { RegressionDegree } from "./regression";

export const HX711_MV_PER_V_SCALE = (1 / 32768 / 128 / 2) * 1000;

export const hx711RawToMvPerV = (raw: number): number =>
	raw * HX711_MV_PER_V_SCALE;

export type LevelStatus = "normal" | "warning" | "danger";

export function getLevelStatus(raw: number): LevelStatus {
	const ratio = Math.abs(raw) / 32767;
	if (ratio >= 0.9) return "danger";
	if (ratio >= 0.8) return "warning";
	return "normal";
}

export type RatedOutputValue = {
	raw: number;
	rawZero: number;
	rawRated: number;
	mVPerV: number;
	extrapolated: boolean;
};

export type RatedOutputResult =
	| { ok: true; value: RatedOutputValue }
	| { ok: false; error: string };

function selectRoot(
	equations: [number, number, number],
	xRange?: { min: number; max: number },
): { root: number } | { error: string } {
	const [a, b, c] = equations;
	const discriminant = b * b - 4 * a * c;
	if (discriminant < 0) {
		return { error: "no real roots — calibration curve does not reach this value" };
	}
	const sqrtDisc = Math.sqrt(discriminant);
	const root1 = (-b + sqrtDisc) / (2 * a);
	const root2 = (-b - sqrtDisc) / (2 * a);

	if (!xRange) return { root: root1 };

	const distToRange = (r: number) => {
		if (r >= xRange.min && r <= xRange.max) return 0;
		return Math.min(Math.abs(r - xRange.min), Math.abs(r - xRange.max));
	};
	const d1 = distToRange(root1);
	const d2 = distToRange(root2);
	return { root: d1 <= d2 ? root1 : root2 };
}

function isExtrapolated(raw: number, xRange?: { min: number; max: number }): boolean {
	if (!xRange) return true;
	return raw < xRange.min || raw > xRange.max;
}

export function calculateRatedOutput(
	a0: number,
	a1: number,
	a2: number,
	degree: RegressionDegree,
	ratedCapacity: number,
	xRange?: { min: number; max: number },
): RatedOutputResult {
	if (ratedCapacity <= 0) {
		return { ok: false, error: "Rated capacity must be positive" };
	}

	if (degree === 1 || Math.abs(a2) < 1e-15) {
		if (Math.abs(a1) < 1e-15) {
			return {
				ok: false,
				error: "a1 is zero, cannot compute rated output",
			};
		}
		const rawSpan = ratedCapacity / a1;
		const rawZero = -a0 / a1;
		const rawRated = (ratedCapacity - a0) / a1;
		const mVPerV = hx711RawToMvPerV(rawSpan);
		const extrapolated =
			isExtrapolated(rawZero, xRange) || isExtrapolated(rawRated, xRange);
		return {
			ok: true,
			value: { raw: rawSpan, rawZero, rawRated, mVPerV, extrapolated },
		};
	}

	// Quadratic: solve raw_zero and raw_rated, compute span
	const zeroResult = selectRoot([a2, a1, a0], xRange);
	if ("error" in zeroResult) {
		return {
			ok: false,
			error: "Calibration curve does not pass through zero — cannot compute rated output span",
		};
	}
	const rawZero = zeroResult.root;

	const ratedResult = selectRoot([a2, a1, a0 - ratedCapacity], xRange);
	if ("error" in ratedResult) {
		return {
			ok: false,
			error: "Rated capacity exceeds the maximum of the calibration curve",
		};
	}
	const rawRated = ratedResult.root;

	const rawSpan = rawRated - rawZero;
	const mVPerV = hx711RawToMvPerV(rawSpan);
	const extrapolated =
		isExtrapolated(rawZero, xRange) || isExtrapolated(rawRated, xRange);

	return {
		ok: true,
		value: { raw: rawSpan, rawZero, rawRated, mVPerV, extrapolated },
	};
}
