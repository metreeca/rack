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

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { symlinks } from "./symlinks.js";


describe("symlinks()", () => {

	const root = realpathSync(mkdtempSync(join(tmpdir(), "rack-symlinks-")));

	const project = join(root, "project");
	const checkout = join(root, "checkout");
	const fork = join(root, "fork");
	const other = join(root, "other");
	const bound = join(root, "bound");
	const installed = join(project, "node_modules", "installed");

	function manifest(condition: string) {
		return {
			type: "module",
			exports: {
				".": { [condition]: "./src/index.ts", default: "./dist/index.js" },
				"./sub": { [condition]: "./src/sub.ts", default: "./dist/sub.js" },
				"./hidden": null
			}
		};
	}

	let server: ViteDevServer; // assigned once by the setup hook


	function file(path: string, content: string) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);
	}

	function pkg(path: string, name: string, condition = "source", peerDependencies = {}) {
		file(join(path, "package.json"), JSON.stringify({ name, ...manifest(condition), peerDependencies }));
		["src/index.ts", "src/sub.ts", "dist/index.js", "dist/sub.js", "dist/hidden.js"].forEach(source =>
			file(join(path, source), "export {};\n")
		);
	}

	function dep(path: string, name: string) {
		file(join(path, "package.json"), JSON.stringify({ name, type: "module", exports: "./index.js" }));
		file(join(path, "index.js"), "export {};\n");
	}

	async function resolved(id: string, importer = "index.ts") {
		return (await server.environments.ssr.pluginContainer.resolveId(id, join(project, importer)))?.id;
	}


	beforeAll(async () => {

		pkg(checkout, "linked");
		pkg(fork, "linked");
		pkg(other, "other", "development");
		pkg(join(root, "scoped"), "@scope/linked");
		pkg(installed, "installed");

		pkg(bound, "bound", "source", { peer: "*" });

		["peer", "private"].forEach(name => {
			dep(join(project, "node_modules", name), name);
			dep(join(bound, "node_modules", name), name);
		});

		mkdirSync(join(project, "node_modules", "@scope"), { recursive: true });
		mkdirSync(join(project, "packages", "nested", "node_modules"), { recursive: true });

		symlinkSync(checkout, join(project, "node_modules", "linked"), "dir");
		symlinkSync(join(root, "scoped"), join(project, "node_modules", "@scope", "linked"), "dir");
		symlinkSync(other, join(project, "node_modules", "other"), "dir");
		symlinkSync(bound, join(project, "node_modules", "bound"), "dir");
		symlinkSync(fork, join(project, "packages", "nested", "node_modules", "linked"), "dir");

		server = await createServer({
			root: project,
			configFile: false,
			logLevel: "silent",
			server: { middlewareMode: true, hmr: false, ws: false },
			plugins: [symlinks({ conditions: ["source", "development"] })]
		});

	});

	afterAll(async () => {
		await server?.close();
		rmSync(root, { recursive: true, force: true });
	});


	describe("linked packages", () => {

		it("should resolve the root export to source", async () => {
			expect(await resolved("linked")).toBe(join(checkout, "src/index.ts"));
		});

		it("should resolve subpath exports to source", async () => {
			expect(await resolved("linked/sub")).toBe(join(checkout, "src/sub.ts"));
		});

		it("should resolve scoped packages to source", async () => {
			expect(await resolved("@scope/linked/sub")).toBe(join(root, "scoped", "src/sub.ts"));
		});

		it("should resolve packages matching any of the listed conditions", async () => {
			expect(await resolved("other")).toBe(join(other, "src/index.ts"));
		});

		it("should leave subpaths excluded by a null target to the default resolution", async () => {
			await expect(resolved("linked/hidden")).rejects.toThrow();
		});

		it("should leave subpaths not exported to the default resolution", async () => {
			await expect(resolved("linked/missing")).rejects.toThrow();
		});

	});

	describe("lookup", () => {

		it("should find links hoisted to an ancestor of the importer", async () => {
			expect(await resolved("linked", "packages/member/src/index.ts")).toBe(join(checkout, "src/index.ts"));
		});

		it("should prefer the links nearest to the importer", async () => {
			expect(await resolved("linked", "packages/nested/src/index.ts")).toBe(join(fork, "src/index.ts"));
		});

		it("should look up imports with no importer from the project root", async () => {
			expect((await server.environments.ssr.pluginContainer.resolveId("linked"))?.id).toBe(
				join(checkout, "src/index.ts")
			);
		});

	});

	describe("dependencies of linked packages", () => {

		async function imported(id: string) {
			return (await server.environments.ssr.pluginContainer.resolveId(id, join(bound, "src/index.ts")))?.id;
		}

		it("should leave deduplication of peers to the default resolution", async () => {
			expect(server.config.resolve.dedupe).not.toContain("peer");
		});

		it("should resolve peers from their checkout", async () => {
			expect(await imported("peer")).toBe(join(bound, "node_modules", "peer", "index.js"));
		});

		it("should resolve other dependencies from their checkout", async () => {
			expect(await imported("private")).toBe(join(bound, "node_modules", "private", "index.js"));
		});

	});

	describe("installed packages", () => {

		it("should resolve to the build", async () => {
			expect(await resolved("installed")).toBe(join(installed, "dist/index.js"));
		});

	});

});
