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

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cp } from "./cp.js";


describe("cp()", () => {

	let root: string; // assigned by the setup hook for each test

	const source = (path: string) => join(root, "src", path);
	const target = (path = "") => join(root, "dist", path);

	function file(path: string, content = path) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);
	}

	function copied() {
		return readdirSync(target(), { recursive: true, withFileTypes: true })
			.filter(entry => entry.isFile())
			.map(entry => join(entry.parentPath, entry.name).slice(target().length + 1))
			.sort();
	}


	beforeEach(async () => {

		root = realpathSync(mkdtempSync(join(tmpdir(), "rack-cp-")));

		file(source("index.css"));
		file(source("index.ts"));
		file(source("a/a.css"));
		file(source("a/b/b.css"));

	});

	afterEach(async () => {
		rmSync(root, { recursive: true, force: true });
	});


	describe("layout", () => {

		it("should keep paths relative to the base of recursive patterns", async () => {
			cp(target(), source("**/*.css"));
			expect(copied()).toEqual(["a/a.css", "a/b/b.css", "index.css"]);
		});

		it("should copy only the top level for flat patterns", async () => {
			cp(target(), source("*.css"));
			expect(copied()).toEqual(["index.css"]);
		});

		it("should copy plain file paths to the top of the target", async () => {
			cp(target(), source("a/b/b.css"));
			expect(copied()).toEqual(["b.css"]);
		});

		it("should merge the matches of multiple patterns", async () => {
			cp(target(), source("*.ts"), source("a/*.css"));
			expect(copied()).toEqual(["a.css", "index.ts"]);
		});

		it("should skip matched directories", async () => {
			cp(target(), source("*"));
			expect(copied()).toEqual(["index.css", "index.ts"]);
		});

	});

	describe("content", () => {

		it("should copy file content", async () => {
			cp(target(), source("a/*.css"));
			expect(readFileSync(target("a.css"), "utf8")).toBe(source("a/a.css"));
		});

		it("should overwrite existing files", async () => {
			file(target("index.css"), "stale");
			cp(target(), source("*.css"));
			expect(readFileSync(target("index.css"), "utf8")).toBe(source("index.css"));
		});

	});

	describe("errors", () => {

		it("should reject an empty target as a usage error", async () => {
			expect(() => cp("", source("*.css"))).toThrow(TypeError);
			expect(() => cp("", source("*.css"))).toThrow(/target/);
		});

		it("should reject missing patterns as a usage error", async () => {
			expect(() => cp(target())).toThrow(TypeError);
			expect(() => cp(target())).toThrow(/pattern/);
		});

		it("should reject patterns matching no file", async () => {
			expect(() => cp(target(), source("*.css"), source("*.md"))).toThrow(source("*.md"));
		});

	});

});
