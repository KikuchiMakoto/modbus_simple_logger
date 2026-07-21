import { useCallback, useEffect, useMemo, useState } from "react";
import { readJsonCookie, writeJsonCookie } from "../utils/cookies";

type ThemeMode = "light" | "dark";
const THEME_COOKIE_KEY = "theme_preference_v1";

export function useTheme() {
	const savedTheme = useMemo(
		() => readJsonCookie<ThemeMode>(THEME_COOKIE_KEY),
		[],
	);
	const [hasUserPreference, setHasUserPreference] = useState(
		() => savedTheme !== null,
	);
	const [theme, setTheme] = useState<ThemeMode>(
		() => savedTheme ?? getSystemTheme(),
	);

	useEffect(() => {
		const root = document.documentElement;
		root.classList.toggle("dark", theme === "dark");
		root.style.colorScheme = theme;
	}, [theme]);

	useEffect(() => {
		if (!hasUserPreference) return;
		writeJsonCookie(THEME_COOKIE_KEY, theme);
	}, [theme, hasUserPreference]);

	useEffect(() => {
		if (hasUserPreference) return;
		const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
		const handleChange = (event: MediaQueryListEvent) => {
			setTheme(event.matches ? "dark" : "light");
		};
		mediaQuery.addEventListener("change", handleChange);
		return () => mediaQuery.removeEventListener("change", handleChange);
	}, [hasUserPreference]);

	const toggleTheme = useCallback(() => {
		setHasUserPreference(true);
		setTheme((prev) => (prev === "dark" ? "light" : "dark"));
	}, []);

	return { theme, isDarkMode: theme === "dark", toggleTheme };
}

function getSystemTheme(): ThemeMode {
	if (typeof window === "undefined") return "light";
	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}
