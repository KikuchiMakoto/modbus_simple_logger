import { describe, expect, it } from "vitest";
import {
	readJsonCookie,
	readJsonStorage,
	writeJsonCookie,
	writeJsonStorage,
} from "./cookies";

// No window/localStorage mock — tests the Node.js (non-browser) path
// where `typeof window === "undefined"`, so `isBrowser` is false

describe("cookies (Node.js — no browser globals)", () => {
	it("readJsonStorage returns null when not in browser", () => {
		expect(readJsonStorage("any")).toBeNull();
	});

	it("writeJsonStorage does nothing when not in browser", () => {
		expect(() => writeJsonStorage("any", "value")).not.toThrow();
	});

	it("readJsonCookie returns null when not in browser", () => {
		expect(readJsonCookie("any")).toBeNull();
	});

	it("writeJsonCookie does nothing when not in browser", () => {
		expect(() => writeJsonCookie("any", "value")).not.toThrow();
	});
});
