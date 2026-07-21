import { useCallback, useEffect, useRef, useState } from "react";
import type {
	CalibrationDegree,
	CalibrationMode,
	CalibrationPoint,
	CalibrationResult,
} from "../types";
import { readJsonStorage, writeJsonStorage } from "../utils/cookies";
import { type RegressionOutcome, fitRegression } from "../utils/regression";

const STORAGE_KEY = "workbench_v1";

type WorkbenchState = {
	mode: CalibrationMode;
	degree: CalibrationDegree;
	points: CalibrationPoint[];
};

export function useCalibration() {
	const [mode, setMode] = useState<CalibrationMode>("1port");
	const [degree, setDegree] = useState<CalibrationDegree>(1);
	const [points, setPoints] = useState<CalibrationPoint[]>([]);
	const [result, setResult] = useState<CalibrationResult | null>(null);
	const [validationError, setValidationError] = useState<string | null>(null);
	const isRestoring = useRef(true);

	useEffect(() => {
		const saved = readJsonStorage<WorkbenchState>(STORAGE_KEY);
		if (saved) {
			setMode(saved.mode);
			setDegree(saved.degree);
			setPoints(saved.points);
		}
		isRestoring.current = false;
	}, []);

	useEffect(() => {
		if (isRestoring.current) return;
		writeJsonStorage(STORAGE_KEY, { mode, degree, points });
	}, [mode, degree, points]);

	useEffect(() => {
		if (points.length < degree + 1) {
			setResult(null);
			setValidationError(
				`At least ${degree + 1} points are required for degree ${degree} regression`,
			);
			return;
		}

		const outcome: RegressionOutcome = fitRegression(points, degree);

		if (outcome.ok) {
			setResult({
				ch: 0,
				mode,
				degree: outcome.value.degree,
				a: outcome.value.a,
				b: outcome.value.b,
				c: outcome.value.c,
				r2: outcome.value.r2,
				rmse: outcome.value.rmse,
				points: [...points],
				updatedAt: Date.now(),
			});
			setValidationError(null);
		} else {
			setResult(null);
			setValidationError(outcome.error);
		}
	}, [points, degree, mode]);

	const addPoint = useCallback((x: number, y: number) => {
		setPoints((prev) => [...prev, { x, y, timestamp: Date.now() }]);
	}, []);

	const removePoint = useCallback((index: number) => {
		setPoints((prev) => prev.filter((_, i) => i !== index));
	}, []);

	const updatePointY = useCallback((index: number, y: number) => {
		setPoints((prev) => prev.map((p, i) => (i === index ? { ...p, y } : p)));
	}, []);

	const clearPoints = useCallback(() => {
		setPoints([]);
	}, []);

	const changeMode = useCallback((newMode: CalibrationMode) => {
		setMode(newMode);
		setPoints([]);
	}, []);

	return {
		result,
		points,
		degree,
		mode,
		validationError,
		setDegree,
		addPoint,
		removePoint,
		updatePointY,
		clearPoints,
		changeMode,
	};
}
