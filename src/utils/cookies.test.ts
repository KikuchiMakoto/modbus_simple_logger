import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	readJsonCookie,
	readJsonStorage,
	writeJsonCookie,
	writeJsonStorage,
} from "./cookies";

const { clearStorage } = vi.hoisted(() => {
	const storage = new Map<string, string>();
	vi.stubGlobal("window", {});
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, val: string) => {
			storage.set(key, val);
		},
		removeItem: (key: string) => {
			storage.delete(key);
		},
		clear: () => storage.clear(),
		get length() {
			return storage.size;
		},
		key: (index: number) => [...storage.keys()][index] ?? null,
	} satisfies Storage);

	let cookieStr = "";
	Object.defineProperty(globalThis, "document", {
		value: {
			get cookie() {
				return cookieStr;
			},
			set cookie(val: string) {
				cookieStr = val;
			},
		},
		configurable: true,
		writable: true,
	});

	return {
		clearStorage: () => {
			storage.clear();
			cookieStr = "";
		},
	};
});

beforeEach(() => {
	clearStorage();
});

describe("readJsonStorage", () => {
	it("returns null for missing key", () => {
		expect(readJsonStorage("nonexistent")).toBeNull();
	});

	it("reads a stored JSON value", () => {
		localStorage.setItem("modbus_calibrator_count", JSON.stringify(42));
		expect(readJsonStorage("count")).toBe(42);
	});

	it("reads a string value", () => {
		localStorage.setItem("modbus_calibrator_name", JSON.stringify("hello"));
		expect(readJsonStorage("name")).toBe("hello");
	});

	it("returns null for malformed JSON", () => {
		localStorage.setItem("modbus_calibrator_bad", "not-json");
		expect(readJsonStorage("bad")).toBeNull();
	});
});

describe("writeJsonStorage", () => {
	it("handles localStorage.setItem failure gracefully", () => {
		const original = globalThis.localStorage.setItem;
		globalThis.localStorage.setItem = vi.fn(() => {
			throw new Error("Quota exceeded");
		});
		expect(() => writeJsonStorage("fail_key", "value")).not.toThrow();
		globalThis.localStorage.setItem = original;
	});

	it("writes a JSON value", () => {
		writeJsonStorage("key", { a: 1 });
		expect(localStorage.getItem("modbus_calibrator_key")).toBe(
			JSON.stringify({ a: 1 }),
		);
	});

	it("overwrites existing value", () => {
		writeJsonStorage("key", 1);
		writeJsonStorage("key", 2);
		expect(readJsonStorage("key")).toBe(2);
	});

	it("writes null", () => {
		writeJsonStorage("nullable", null);
		expect(readJsonStorage("nullable")).toBeNull();
	});
});

describe("readJsonCookie", () => {
	it("returns null for missing key", () => {
		expect(readJsonCookie("nonexistent")).toBeNull();
	});

	it("reads from localStorage first", () => {
		writeJsonStorage("pref", "from-storage");
		expect(readJsonCookie("pref")).toBe("from-storage");
	});

	it("migrates from cookie to localStorage", () => {
		const key = "migrate_me";
		document.cookie = `${key}=${encodeURIComponent(JSON.stringify("from-cookie"))}`;
		const result = readJsonCookie(key);
		expect(result).toBe("from-cookie");
		expect(readJsonStorage(key)).toBe("from-cookie");
	});

	it("returns null for unparseable cookie", () => {
		const key = "bad_cookie";
		document.cookie = `${key}=not-json`;
		expect(readJsonCookie(key)).toBeNull();
	});
});

describe("writeJsonCookie", () => {
	it("writes to localStorage", () => {
		writeJsonCookie("k", true);
		expect(readJsonStorage("k")).toBe(true);
	});
});
