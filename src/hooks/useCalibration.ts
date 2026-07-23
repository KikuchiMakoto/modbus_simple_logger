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
	points1port?: CalibrationPoint[];
	points2port?: CalibrationPoint[];
};

export function useCalibration() {
	const [mode, setMode] = useState<CalibrationMode>("1port");
	const [degree, setDegree] = useState<CalibrationDegree>(1);
	const [points, setPoints] = useState<CalibrationPoint[]>([]);
	const [result, setResult] = useState<CalibrationResult | null>(null);
	const [validationError, setValidationError] = useState<string | null>(null);
	const isRestoring = useRef(true);

	const pointsByMode = useRef<Record<CalibrationMode, CalibrationPoint[]>>({
		"1port": [],
		"2port": [],
	});
	const modeRef = useRef<CalibrationMode>("1port");
	const pointsRef = useRef<CalibrationPoint[]>([]);

	useEffect(() => {
		modeRef.current = mode;
	}, [mode]);

	useEffect(() => {
		pointsRef.current = points;
	}, [points]);

	useEffect(() => {
		const saved = readJsonStorage<WorkbenchState>(STORAGE_KEY);
		if (saved) {
			setMode(saved.mode);
			setDegree(saved.degree);
			const p1 =
				saved.points1port ?? (saved.mode === "1port" ? saved.points : []);
			const p2 =
				saved.points2port ?? (saved.mode === "2port" ? saved.points : []);
			pointsByMode.current = { "1port": p1, "2port": p2 };
			setPoints(saved.mode === "1port" ? p1 : p2);
		}
		isRestoring.current = false;
	}, []);

	useEffect(() => {
		if (isRestoring.current) return;
		writeJsonStorage(STORAGE_KEY, {
			mode,
			degree,
			points,
			points1port: pointsByMode.current["1port"],
			points2port: pointsByMode.current["2port"],
		});
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
				a0: outcome.value.a0,
				a1: outcome.value.a1,
				a2: outcome.value.a2,
				r2: outcome.value.r2,
				rmse: outcome.value.rmse,
				n: outcome.value.n,
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
		setPoints((prev) => {
			const newPoints = [...prev, { x, y, timestamp: Date.now() }];
			pointsByMode.current[modeRef.current] = newPoints;
			return newPoints;
		});
	}, []);

	const removePoint = useCallback((index: number) => {
		setPoints((prev) => {
			const newPoints = prev.filter((_, i) => i !== index);
			pointsByMode.current[modeRef.current] = newPoints;
			return newPoints;
		});
	}, []);

	const updatePointY = useCallback((index: number, y: number) => {
		setPoints((prev) => {
			const newPoints = prev.map((p, i) => (i === index ? { ...p, y } : p));
			pointsByMode.current[modeRef.current] = newPoints;
			return newPoints;
		});
	}, []);

	const clearPoints = useCallback(() => {
		setPoints(() => {
			pointsByMode.current[modeRef.current] = [];
			return [];
		});
	}, []);

	const changeMode = useCallback((newMode: CalibrationMode) => {
		pointsByMode.current[modeRef.current] = pointsRef.current;
		modeRef.current = newMode;
		setMode(newMode);
		setPoints(pointsByMode.current[newMode]);
	}, []);

	return {
		result,
		points,
		degree,
		mode,
		validationError,
		pointsByMode,
		setDegree,
		addPoint,
		removePoint,
		updatePointY,
		clearPoints,
		changeMode,
	};
}
