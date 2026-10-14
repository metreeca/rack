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

import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rm } from "./rm.js";


describe("rm()", () => {

	let root: string; // assigned by the setup hook for each test

	const path = (path: string) => join(root, path);

	function file(path: string) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, path);
	}

	function remaining() {
		return readdirSync(root, { recursive: true, withFileTypes: true })
			.map(entry => join(entry.parentPath, entry.name).slice(root.length + 1))
			.sort();
	}


	beforeEach(async () => {

		root = realpathSync(mkdtempSync(join(tmpdir(), "rack-rm-")));

		file(path("index.ts"));
		file(path("dist/index.js"));
		file(path("dist/a/a.js"));
		file(path("src/a.tsbuildinfo"));
		file(path("src/b/b.tsbuildinfo"));

	});

	afterEach(async () => {
		rmSync(root, { recursive: true, force: true });
	});


	describe("removal", () => {

		it("should remove plain file paths", async () => {
			rm(path("index.ts"));
			expect(remaining()).not.toContain("index.ts");
		});

		it("should remove directories with their content", async () => {
			rm(path("dist"));
			expect(remaining()).toEqual(["index.ts", "src", "src/a.tsbuildinfo", "src/b", "src/b/b.tsbuildinfo"]);
		});

		it("should remove the matches of glob patterns", async () => {
			rm(path("src/**/*.tsbuildinfo"));
			expect(remaining()).toEqual(["dist", "dist/a", "dist/a/a.js", "dist/index.js", "index.ts", "src", "src/b"]);
		});

		it("should remove nested matches along with their ancestors", async () => {
			rm(path("dist/**"));
			expect(remaining()).toEqual(["index.ts", "src", "src/a.tsbuildinfo", "src/b", "src/b/b.tsbuildinfo"]);
		});

		it("should merge the matches of multiple patterns", async () => {
			rm(path("dist"), path("src"));
			expect(remaining()).toEqual(["index.ts"]);
		});

	});

	describe("errors", () => {

		it("should ignore patterns matching nothing", async () => {
			expect(() => rm(path("docs"), path("*.md"))).not.toThrow();
			expect(remaining()).toContain("index.ts");
		});

		it("should reject missing patterns as a usage error", async () => {
			expect(() => rm()).toThrow(TypeError);
			expect(() => rm()).toThrow(/pattern/);
		});

	});

});
