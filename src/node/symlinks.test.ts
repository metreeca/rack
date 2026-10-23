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

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import type { ResolveHookContext } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { customConditions, symlinks } from "./symlinks.js";


describe("symlinks()", () => {

	const root = realpathSync(mkdtempSync(join(tmpdir(), "rack-node-")));

	const project = join(root, "project");
	const checkout = join(root, "checkout");
	const bound = join(root, "bound");
	const installed = join(project, "node_modules", "installed");

	let resolve: ReturnType<typeof symlinks>["resolve"]; // created once by the setup hook, after the links exist


	function file(path: string, content: string) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);
	}

	function pkg(path: string, name: string, peerDependencies = {}) {

		file(join(path, "package.json"), JSON.stringify({
			name,
			type: "module",
			exports: {
				".": { source: "./src/index.ts", default: "./dist/index.js" },
				"./sub": { source: "./src/sub.ts", default: "./dist/sub.js" },
				"./hidden": null
			},
			peerDependencies
		}));

		file(join(path, "src/index.ts"), `
			import { sub } from "./sub.js";
			import { peer } from "peer";
			export const where: string = import.meta.url;
			export { sub, peer };
		`);

		file(join(path, "src/sub.ts"), `export const sub: string = import.meta.url;\n`);

		["dist/index.js", "dist/sub.js", "dist/hidden.js"].forEach(built =>
			file(join(path, built), "export {};\n")
		);

	}

	function dep(path: string, name: string) {
		file(join(path, "package.json"), JSON.stringify({ name, type: "module", exports: "./index.js" }));
		file(join(path, "index.js"), `export const ${name}: string = import.meta.url;\n`.replace(": string", ""));
	}

	function url(path: string) {
		return pathToFileURL(path).href;
	}

	/**
	 * Mimics the default resolver: builtins resolve to themselves, relative specifiers against the importer, bare
	 * specifiers from the `node_modules` of the importer's package up to the project's; missing files fail.
	 */
	function next(specifier: string, context?: Partial<ResolveHookContext>) {

		const parent = context?.parentURL === undefined ? join(project, "index.js") : fileURLToPath(context.parentURL);
		const packages = [checkout, bound, project].filter(path => parent.startsWith(path));

		const candidates = specifier.startsWith("node:") ? []
			: specifier.startsWith(".") ? [join(dirname(parent), specifier)]
				: [...packages, project].map(path => join(path, "node_modules", specifier, "index.js"));

		const found = candidates.find(existsSyncSafe);

		if ( specifier.startsWith("node:") ) {
			return { url: specifier, shortCircuit: true };
		} else if ( found !== undefined ) {
			return { url: url(found), shortCircuit: true };
		} else {
			throw Object.assign(new Error(`Cannot find module '${specifier}'`), { code: "ERR_MODULE_NOT_FOUND" });
		}

	}

	function existsSyncSafe(path: string) {
		try { return realpathSync(path) !== undefined; } catch { return false; }
	}

	function resolved(specifier: string, parent: string = join(project, "index.js"), context: Partial<ResolveHookContext> = {}) {

		const chained = vi.fn((specifier: string, context?: Partial<ResolveHookContext>) =>
			next(specifier, { parentURL: url(parent), ...context })
		);

		const result = resolve(
			specifier,
			{ conditions: ["node", "import"], importAttributes: {}, parentURL: url(parent), ...context },
			chained
		);

		return { url: result.url, calls: chained.mock.calls };

	}


	beforeAll(async () => {

		file(join(project, "package.json"), JSON.stringify({ name: "project", type: "module" }));

		pkg(checkout, "linked");
		pkg(bound, "bound", { peer: "*", optional: "*" });

		dep(installed, "installed");
		dep(join(project, "node_modules", "peer"), "peer");
		dep(join(bound, "node_modules", "peer"), "peer");
		dep(join(bound, "node_modules", "optional"), "optional");
		dep(join(bound, "node_modules", "private"), "private");
		dep(join(bound, "node_modules", "linked"), "linked"); // a registry copy of a package the project links

		symlinkSync(checkout, join(project, "node_modules", "linked"), "dir");
		symlinkSync(bound, join(project, "node_modules", "bound"), "dir");

		resolve = symlinks({ conditions: "source", root: project }).resolve;

	});

	afterAll(async () => {
		rmSync(root, { recursive: true, force: true });
	});


	describe("linked packages", () => {

		it("should resolve the root export to source", async () => {
			expect(resolved("linked").url).toBe(url(join(checkout, "src/index.ts")));
		});

		it("should resolve subpath exports to source", async () => {
			expect(resolved("linked/sub").url).toBe(url(join(checkout, "src/sub.ts")));
		});

		it("should leave subpaths excluded by a null target to the default resolution", async () => {
			expect(() => resolved("linked/hidden")).toThrow();
		});

		it("should leave subpaths not exported to the default resolution", async () => {
			expect(() => resolved("linked/missing")).toThrow();
		});

	});

	describe("dependencies of linked packages", () => {

		const importer = join(bound, "src/index.ts");

		it("should resolve peers from the project", async () => {
			expect(resolved("peer", importer).url).toBe(url(join(project, "node_modules/peer/index.js")));
		});

		it("should resolve peers missing from the project from their checkout", async () => {
			expect(resolved("optional", importer).url).toBe(url(join(bound, "node_modules/optional/index.js")));
		});

		it("should resolve linked packages installed in the checkout from the project links", async () => {
			expect(resolved("linked", importer).url).toBe(url(join(checkout, "src/index.ts")));
		});

		it("should resolve other dependencies from their checkout", async () => {
			expect(resolved("private", importer).url).toBe(url(join(bound, "node_modules/private/index.js")));
		});

	});

	describe("relative imports", () => {

		it("should resolve .js imports from TypeScript modules to the .ts file next to them", async () => {
			expect(resolved("./sub.js", join(checkout, "src/index.ts")).url).toBe(url(join(checkout, "src/sub.ts")));
		});

		it("should leave .js imports that resolve alone", async () => {
			expect(resolved("./sub.js", join(checkout, "dist/index.js")).url).toBe(url(join(checkout, "dist/sub.js")));
		});

		it("should leave missing .js imports from JavaScript modules to the default resolution", async () => {
			expect(() => resolved("./missing.js", join(checkout, "dist/index.js"))).toThrow();
		});

		it("should leave missing .js imports with no .ts file to the default resolution", async () => {
			expect(() => resolved("./missing.js", join(checkout, "src/index.ts"))).toThrow();
		});

	});

	describe("other imports", () => {

		it("should leave installed packages to the default resolution", async () => {
			expect(resolved("installed").calls).toHaveLength(1);
		});

		it("should leave builtins to the default resolution", async () => {
			expect(resolved("node:fs").calls).toHaveLength(1);
		});

	});

	describe("process", () => {

		it("should run a project against the live source of its linked packages", async () => {

			const rack = pathToFileURL(join(import.meta.dirname, "..", "/")).href;

			file(join(project, "hooks.mjs"), `
				import { registerHooks } from "node:module";
				import { fileURLToPath, pathToFileURL } from "node:url";

				// test scaffolding: loads the hooks under test from their TypeScript sources under plain node,
				// mapping the .js relative imports inside the rack source tree to the .ts files next to them

				registerHooks({
					resolve(specifier, context, next) {
						try {
							return next(specifier, context);
						} catch (error) {
							if ( context.parentURL?.startsWith(${JSON.stringify(rack)}) && specifier.endsWith(".js") ) {
								const url = pathToFileURL(fileURLToPath(new URL(specifier, context.parentURL)).replace(/\\.js$/, ".ts")).href;
								return { url, shortCircuit: true };
							} else {
								throw error;
							}
						}
					}
				});

				const { customConditions, symlinks } = await import(${JSON.stringify(`${rack}node/symlinks.ts`)});

				registerHooks(symlinks({ conditions: customConditions(process.cwd()), root: process.cwd() }));
			`);

			file(join(project, "tsconfig.json"), JSON.stringify({ compilerOptions: { customConditions: ["source"] } }));

			file(join(project, "main.mjs"), `
				import { where, sub, peer } from "bound";
				console.log(JSON.stringify({ where, sub, peer }));
			`);

			const output = execFileSync(process.execPath, ["--no-warnings", "--import", "./hooks.mjs", "main.mjs"], {
				cwd: project,
				encoding: "utf8"
			});

			expect(JSON.parse(output)).toEqual({
				where: url(join(bound, "src/index.ts")),
				sub: url(join(bound, "src/sub.ts")),
				peer: url(join(project, "node_modules/peer/index.js"))
			});

		});

	});

});

describe("customConditions()", () => {

	const root = realpathSync(mkdtempSync(join(tmpdir(), "rack-conditions-")));

	function config(path: string, config: object) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), JSON.stringify(config));
	}


	afterAll(async () => {
		rmSync(root, { recursive: true, force: true });
	});


	it("should read the conditions of the nearest tsconfig", async () => {
		config("a/tsconfig.json", { compilerOptions: { customConditions: ["@a/source"] } });
		config("a/b/tsconfig.json", { compilerOptions: { customConditions: ["@b/source"] } });
		expect(customConditions(join(root, "a/b/c"))).toEqual(["@b/source"]);
	});

	it("should follow the extends chain", async () => {
		config("x/tsconfig.base.json", { compilerOptions: { customConditions: ["@x/source"] } });
		config("x/tsconfig.json", { extends: "./tsconfig.base.json", compilerOptions: { strict: true } });
		expect(customConditions(join(root, "x"))).toEqual(["@x/source"]);
	});

	it("should return no conditions when no tsconfig declares any", async () => {
		config("y/tsconfig.json", { compilerOptions: { strict: true } });
		expect(customConditions(join(root, "y"))).toEqual([]);
	});

	it("should return no conditions when no tsconfig is found", async () => {
		mkdirSync(join(root, "z"), { recursive: true });
		expect(customConditions(join(root, "z"))).toEqual([]);
	});

});
