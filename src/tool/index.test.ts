/*
 * Copyright © 2026 Metreeca srl
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { cp } from "./cp.js";
import { cli } from "./index.core.js";
import * as tool from "./index.js";
import { ln } from "./ln.js";
import { rm } from "./rm.js";


describe("@metreeca/rack/tool", () => {

	it("should export the tools", async () => {
		expect({ ...tool }).toEqual({ cp, ln, rm }); // spread drops the namespace Symbol.toStringTag key
	});

});

describe("commands", () => {

	const root = resolve(import.meta.dirname, "../..");

	const { bin }: { bin: Record<string, string> } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

	it("should install the tools as commands", async () => {
		expect(Object.keys(bin)).toEqual(["cp", "ln", "rm"]);
	});

	it.each(Object.entries(bin))("should build %s as an executable", async (_, path) => {
		expect(statSync(join(root, path)).mode & 0o111).toBe(0o111);
	});

	it.each([
		["cp", "<target> <pattern>..."],
		["ln", "[<deps>]..."],
		["rm", "<pattern>..."]
	])("should run %s from the build", async (name, help) => {

		const { status, stdout } = spawnSync(join(root, bin[name]), ["--help"], { encoding: "utf8" });

		expect({ status, stdout }).toEqual({ status: 0, stdout: `Usage: ${name} ${help}\n` });

	});

});

describe("cli()", () => {

	let stdout: MockInstance; // assigned by the setup hook for each test
	let stderr: MockInstance;

	const printed = (stream: MockInstance) => stream.mock.calls.map(args => args.join(" ")).join("\n");

	function run(args: readonly string[], tool: (...args: string[]) => void = () => {}) {
		return cli(tool, "<operand>...", "tool", args);
	}


	beforeEach(async () => {
		stdout = vi.spyOn(console, "log").mockImplementation(() => {});
		stderr = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(async () => {
		vi.restoreAllMocks();
	});


	describe("operands", () => {

		it("should pass operands to the tool and succeed", async () => {
			const tool = vi.fn();
			expect(run(["a", "b"], tool)).toBe(0);
			expect(tool).toHaveBeenCalledWith("a", "b");
		});

		it("should pass operands starting with a dash after the terminator", async () => {
			const tool = vi.fn();
			expect(run(["a", "--", "-b"], tool)).toBe(0);
			expect(tool).toHaveBeenCalledWith("a", "-b");
		});

		it("should read the command line of the process by default", async () => {

			const argv = process.argv;
			const tool = vi.fn();

			try { // process.argv is swapped for the duration of the call only
				process.argv = ["node", "tool", "a"];
				expect(cli(tool, "<operand>...", "tool")).toBe(0);
			} finally {
				process.argv = argv;
			}

			expect(tool).toHaveBeenCalledWith("a");

		});

	});

	describe("name", () => {

		it.each([
			"/project/node_modules/.bin/tool",
			"/project/dist/tool.js"
		])("should default to the name of the script at %s", async script => {

			const argv = process.argv;

			try { // process.argv is swapped for the duration of the call only
				process.argv = ["node", script, "--force"];
				expect(cli(() => {}, "<operand>...")).toBe(1);
			} finally {
				process.argv = argv;
			}

			expect(printed(stderr)).toMatch(/^tool: /);

		});

		it("should fall back to the tool function name without a script path", async () => {

			const argv = process.argv;

			try { // process.argv is swapped for the duration of the call only
				process.argv = ["node"];
				expect(cli(function probe() {}, "<operand>...", undefined, ["--force"])).toBe(1);
			} finally {
				process.argv = argv;
			}

			expect(printed(stderr)).toMatch(/^probe: /);

		});

	});

	describe("help", () => {

		it.each(["--help", "-h"])("should print the usage for %s and skip the tool", async option => {
			const tool = vi.fn();
			expect(run([option, "a"], tool)).toBe(0);
			expect(printed(stdout)).toBe("Usage: tool <operand>...");
			expect(tool).not.toHaveBeenCalled();
		});

	});

	describe("errors", () => {

		const hint = "Try 'tool --help' for more information.";

		it("should reject unrecognized options pointing to the help", async () => {
			const tool = vi.fn();
			expect(run(["--force", "a"], tool)).toBe(1);
			expect(printed(stderr)).toBe(`tool: unrecognized option <--force>\n${hint}`);
			expect(tool).not.toHaveBeenCalled();
		});

		it("should report usage errors pointing to the help", async () => {
			expect(run([], () => { throw new TypeError("missing operand"); })).toBe(1);
			expect(printed(stderr)).toBe(`tool: missing operand\n${hint}`);
		});

		it("should report other errors without pointing to the help", async () => {
			expect(run(["a"], () => { throw new Error("failed operation"); })).toBe(1);
			expect(printed(stderr)).toBe("tool: failed operation");
		});

	});

});
