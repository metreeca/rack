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

	const condition = "source";

	const root = realpathSync(mkdtempSync(join(tmpdir(), "rack-symlinks-")));

	const project = join(root, "project");
	const checkout = join(root, "checkout");
	const installed = join(project, "node_modules", "installed");

	const manifest = {
		type: "module",
		exports: {
			".": { [condition]: "./src/index.ts", default: "./dist/index.js" },
			"./sub": { [condition]: "./src/sub.ts", default: "./dist/sub.js" },
			"./hidden": null
		}
	};

	let server: ViteDevServer; // assigned once by the setup hook


	function file(path: string, content: string) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);
	}

	function pkg(path: string, name: string) {
		file(join(path, "package.json"), JSON.stringify({ name, ...manifest }));
		["src/index.ts", "src/sub.ts", "dist/index.js", "dist/sub.js", "dist/hidden.js"].forEach(source =>
			file(join(path, source), "export {};\n")
		);
	}

	async function resolved(id: string) {
		return (await server.environments.ssr.pluginContainer.resolveId(id, join(project, "index.ts")))?.id;
	}


	beforeAll(async () => {

		pkg(checkout, "linked");
		pkg(join(checkout, "..", "scoped"), "@scope/linked");
		pkg(installed, "installed");

		mkdirSync(join(project, "node_modules", "@scope"), { recursive: true });
		symlinkSync(checkout, join(project, "node_modules", "linked"), "dir");
		symlinkSync(join(root, "scoped"), join(project, "node_modules", "@scope", "linked"), "dir");

		server = await createServer({
			root: project,
			configFile: false,
			logLevel: "silent",
			server: { middlewareMode: true, hmr: false, ws: false },
			plugins: [symlinks({ project, condition })]
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

		it("should leave subpaths excluded by a null target to the default resolution", async () => {
			await expect(resolved("linked/hidden")).rejects.toThrow();
		});

		it("should leave subpaths not exported to the default resolution", async () => {
			await expect(resolved("linked/missing")).rejects.toThrow();
		});

	});

	describe("installed packages", () => {

		it("should resolve to the build", async () => {
			expect(await resolved("installed")).toBe(join(installed, "dist/index.js"));
		});

	});

});
