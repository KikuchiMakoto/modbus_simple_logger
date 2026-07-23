export type RegressionInput = { x: number; y: number };

export type RegressionDegree = 1 | 2;

export type RegressionResult = {
	degree: RegressionDegree;
	a0: number;
	a1: number;
	a2: number;
	r2: number;
	rmse: number;
	n: number;
};

export type RegressionOutcome =
	| { ok: true; value: RegressionResult }
	| { ok: false; error: string };

function sum(values: number[]): number {
	let s = 0;
	for (let i = 0; i < values.length; i++) s += values[i];
	return s;
}

function mean(values: number[]): number {
	return sum(values) / values.length;
}

export function fitRegression(
	points: RegressionInput[],
	degree: RegressionDegree,
): RegressionOutcome {
	if (points.length < degree + 1) {
		return {
			ok: false,
			error: `At least ${degree + 1} points are required for degree ${degree} regression`,
		};
	}

	if (degree === 1) return fitLinear(points);
	return fitQuadratic(points);
}

function fitLinear(points: RegressionInput[]): RegressionOutcome {
	const n = points.length;
	const xs = points.map((p) => p.x);
	const ys = points.map((p) => p.y);

	const xMean = mean(xs);
	const yMean = mean(ys);

	let sxx = 0;
	let sxy = 0;
	for (let i = 0; i < n; i++) {
		const dx = xs[i] - xMean;
		sxx += dx * dx;
		sxy += dx * (ys[i] - yMean);
	}

	if (Math.abs(sxx) < 1e-15) {
		return { ok: false, error: "All x values are identical" };
	}

	const a2 = 0;
	const a1 = sxy / sxx;
	const a0 = yMean - a1 * xMean;

	const ssRes = points.reduce((sum_, p) => {
		const residual = p.y - (a1 * p.x + a0);
		return sum_ + residual * residual;
	}, 0);
	const ssTot = points.reduce((sum_, p) => {
		const dev = p.y - yMean;
		return sum_ + dev * dev;
	}, 0);
	const r2 = Math.abs(ssTot) < 1e-15 ? 1 : 1 - ssRes / ssTot;
	const rmse = Math.sqrt(ssRes / n);

	return {
		ok: true,
		value: { degree: 1, a0, a1, a2, r2, rmse, n },
	};
}

function fitQuadratic(points: RegressionInput[]): RegressionOutcome {
	const n = points.length;
	const xs = points.map((p) => p.x);
	const ys = points.map((p) => p.y);

	const sx = sum(xs);
	const sx2 = sum(xs.map((x) => x * x));
	const sx3 = sum(xs.map((x) => x * x * x));
	const sx4 = sum(xs.map((x) => x * x * x * x));
	const sy = sum(ys);
	const sxy = sum(xs.map((x, i) => x * ys[i]));
	const sx2y = sum(xs.map((x, i) => x * x * ys[i]));

	const det =
		n * (sx2 * sx4 - sx3 * sx3) -
		sx * (sx * sx4 - sx3 * sx2) +
		sx2 * (sx * sx3 - sx2 * sx2);

	if (Math.abs(det) < 1e-15) {
		return {
			ok: false,
			error: "Singular matrix: unable to fit quadratic regression",
		};
	}

	const a2Num =
		n * (sx2 * sx2y - sxy * sx3) -
		sx * (sx * sx2y - sxy * sx2) +
		sy * (sx * sx3 - sx2 * sx2);
	const a1Num =
		n * (sxy * sx4 - sx3 * sx2y) -
		sy * (sx * sx4 - sx3 * sx2) +
		sx2 * (sx * sx2y - sxy * sx2);
	const a0Num =
		sy * (sx2 * sx4 - sx3 * sx3) -
		sx * (sxy * sx4 - sx3 * sx2y) +
		sx2 * (sxy * sx3 - sx2 * sx2y);

	const a2 = a2Num / det;
	const a1 = a1Num / det;
	const a0 = a0Num / det;

	const ssRes = points.reduce((sum_, p) => {
		const residual = p.y - (a2 * p.x * p.x + a1 * p.x + a0);
		return sum_ + residual * residual;
	}, 0);
	const yMean = mean(ys);
	const ssTot = points.reduce((sum_, p) => {
		const dev = p.y - yMean;
		return sum_ + dev * dev;
	}, 0);
	const r2 = Math.abs(ssTot) < 1e-15 ? 1 : 1 - ssRes / ssTot;
	const rmse = Math.sqrt(ssRes / n);

	return {
		ok: true,
		value: { degree: 2, a0, a1, a2, r2, rmse, n },
	};
}
