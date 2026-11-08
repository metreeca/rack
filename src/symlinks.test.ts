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

import { mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { manifest } from "./symlinks.js";


describe("manifest()", () => {

	let folder: string; // a fresh package folder per test, so cached manifests never leak across tests

	function save(exports: Readonly<Record<string, string>>, modified = new Date()) {

		const file = join(folder, "package.json");

		writeFileSync(file, JSON.stringify({ name: "linked", exports }));
		utimesSync(file, modified, modified);

	}


	beforeEach(async () => {
		folder = realpathSync(mkdtempSync(join(tmpdir(), "rack-manifest-")));
	});

	afterEach(async () => {
		rmSync(folder, { recursive: true, force: true });
	});


	it("reads the saved manifest", async () => {

		save({ ".": "./a.js" });

		expect(manifest(folder)).toEqual({ name: "linked", exports: { ".": "./a.js" } });

	});

	it("reuses the manifest while its file is unchanged", async () => {

		save({ ".": "./a.js" });

		expect(manifest(folder)).toBe(manifest(folder));

	});

	it("reflects edits saved after a previous read", async () => {

		save({ ".": "./a.js" });
		manifest(folder);

		save({ ".": "./a.js", "./b": "./b.js" });

		expect(manifest(folder).exports).toEqual({ ".": "./a.js", "./b": "./b.js" });

	});

	it("reflects edits that leave the file size unchanged", async () => {

		save({ ".": "./a.js" }, new Date(2026, 0, 1));
		manifest(folder);

		save({ ".": "./b.js" }, new Date(2026, 0, 2));

		expect(manifest(folder).exports).toEqual({ ".": "./b.js" });

	});

	it("reflects edits that leave the modification time unchanged", async () => {

		save({ ".": "./a.js" }, new Date(2026, 0, 1));
		manifest(folder);

		save({ ".": "./a.js", "./b": "./b.js" }, new Date(2026, 0, 1));

		expect(manifest(folder).exports).toEqual({ ".": "./a.js", "./b": "./b.js" });

	});

});
