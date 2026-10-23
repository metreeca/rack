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
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { cp } from "./cp.js";
import { cli } from "./index.core.js";
import * as tool from "./index.js";
import { ln } from "./ln.js";
import { rm } from "./rm.js";


describe("@metreeca/rack/tool", () => {

	it("should export the tools", async () => {
		expect({ ...tool }).toEqual({ cp, ln, rm }); // spread drops the namespace Symbol.toStringTag key
	});

	it("should expose the command line synopsis of each tool", async () => {
		expect([cp.usage, ln.usage, rm.usage]).toEqual(["<target> <pattern>...", "[<deps>]...", "<pattern>..."]);
	});

});

describe("ush", () => {

	const root = resolve(import.meta.dirname, "../..");

	const { bin }: { bin: Record<string, string> } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

	let links: string; // assigned by the setup hook

	function run(command: string, ...args: readonly string[]) {

		const { status, stdout, stderr } = spawnSync(join(links, command), args, { encoding: "utf8" });

		return { status, stdout, stderr };

	}

	function ush(...args: readonly string[]) {
		return run("ush", ...args);
	}


	beforeAll(async () => { // commands are run through links, as installed in node_modules/.bin

		links = realpathSync(mkdtempSync(join(tmpdir(), "rack-bin-")));

		["ush", "tool"].forEach(command => symlinkSync(join(root, bin.ush), join(links, command)));

	});

	afterAll(async () => {
		rmSync(links, { recursive: true, force: true });
	});


	it("should install the tools under a single command", async () => {
		expect(Object.keys(bin)).toEqual(["ush"]);
	});

	it.each(Object.entries(bin))("should build %s as an executable", async (_, path) => {
		expect(statSync(join(root, path)).mode & 0o111).toBe(0o111);
	});

	describe("commands", () => {

		let folder: string; // assigned by the setup hook for each test

		beforeEach(async () => {
			folder = realpathSync(mkdtempSync(join(tmpdir(), "rack-ush-")));
		});

		afterEach(async () => {
			rmSync(folder, { recursive: true, force: true });
		});


		it("should run the named tool on the following arguments", async () => {

			const path = join(folder, "dist");

			writeFileSync(path, path);

			expect(ush("rm", path).status).toBe(0);
			expect(existsSync(path)).toBe(false);

		});

		it.each([
			["cp", "<target> <pattern>..."],
			["ln", "[<deps>]..."],
			["rm", "<pattern>..."]
		])("should print the usage of %s under the full command", async (command, help) => {
			expect(ush(command, "--help")).toEqual({ status: 0, stdout: `Usage: ush ${command} ${help}\n`, stderr: "" });
		});

		it("should prefix tool errors with the full command", async () => {
			expect(ush("cp")).toEqual({
				status: 1,
				stdout: "",
				stderr: "ush cp: missing target operand\nTry 'ush cp --help' for more information.\n"
			});
		});

	});

	describe("help", () => {

		it.each(["--help", "-h"])("should list the tools for %s", async option => {
			expect(ush(option)).toEqual({
				status: 0,
				stdout: [
					"Usage: ush <command> [<operand>]...",
					"",
					"Commands:",
					"  cp <target> <pattern>...",
					"  ln [<deps>]...",
					"  rm <pattern>...",
					""
				].join("\n"),
				stderr: ""
			});
		});

	});

	describe("errors", () => {

		const hint = "Try 'ush --help' for more information.";

		it("should reject a missing command pointing to the help", async () => {
			expect(ush()).toEqual({ status: 1, stdout: "", stderr: `ush: missing command operand\n${hint}\n` });
		});

		it.each(["mv", "toString"])("should reject the unknown command %s pointing to the help", async command => {
			expect(ush(command)).toEqual({ status: 1, stdout: "", stderr: `ush: unknown command <${command}>\n${hint}\n` });
		});

		it("should reject options before the command pointing to the help", async () => {
			expect(ush("--force", "rm")).toEqual({
				status: 1,
				stdout: "",
				stderr: `ush: unrecognized option <--force>\n${hint}\n`
			});
		});

		it("should name messages after the invoked command", async () => {
			expect(run("tool")).toEqual({
				status: 1,
				stdout: "",
				stderr: "tool: missing command operand\nTry 'tool --help' for more information.\n"
			});
		});

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

		it("should print the description below the usage line", async () => {
			expect(cli(() => {}, "<operand>...", "tool", ["--help"], "Copies things.")).toBe(0);
			expect(printed(stdout)).toBe("Usage: tool <operand>...\n\nCopies things.");
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
