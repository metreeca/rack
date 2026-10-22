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

import {
	accessSync,
	constants,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readlinkSync,
	realpathSync,
	rmSync,
	writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ln } from "./ln.js";


describe("ln()", () => {

	let root: string; // assigned by the setup hook for each test
	let cwd: string;

	const path = (path: string) => join(root, path);
	const module = (name: string) => path(`deps/app/node_modules/${name}`);

	function manifest(dir: string, manifest: object) {
		mkdirSync(path(dir), { recursive: true });
		writeFileSync(path(`${dir}/package.json`), JSON.stringify(manifest));
	}

	function linked(name: string) {
		return existsSync(module(name)) ? realpathSync(module(name)) : undefined;
	}


	beforeEach(async () => {

		root = realpathSync(mkdtempSync(join(tmpdir(), "rack-ln-")));
		cwd = process.cwd();

		manifest("deps/core", { name: "@x/core" });
		manifest("deps/http", { name: "@x/http", dependencies: { "@x/core": "^1.0.0" } });
		manifest("deps/blue", { name: "@x/blue", peerDependencies: { "@x/core": "^1.0.0" }, devDependencies: { "@x/tool": "^1.0.0" } });
		manifest("deps/tool", { name: "@x/tool" });

		manifest("deps/keep", { name: "keep", private: true, workspaces: ["packages/*/*"] });
		manifest("deps/keep/packages/components/keep", { name: "@x/keep", optionalDependencies: { "@x/blue": "^1.0.0" } });
		manifest("deps/keep/packages/connectors/keep-rest", { name: "@x/keep-rest", dependencies: { "@x/keep": "^1.0.0" } });

		manifest("deps/app", {
			name: "@x/app",
			dependencies: { "@x/http": "^2.0.0-dev", "lodash": "^4.0.0" },
			devDependencies: { "@x/keep-rest": "^1.0.0" }
		});

		process.chdir(path("deps/app"));

	});

	afterEach(async () => {
		process.chdir(cwd);
		rmSync(root, { recursive: true, force: true });
	});


	describe("selection", () => {

		it("should link the dependencies of the current package", async () => {
			ln();
			expect(linked("@x/http")).toBe(path("deps/http"));
			expect(linked("@x/keep-rest")).toBe(path("deps/keep/packages/connectors/keep-rest"));
		});

		it("should link the dependencies of linked packages", async () => {
			ln();
			expect(linked("@x/core")).toBe(path("deps/core"));
			expect(linked("@x/keep")).toBe(path("deps/keep/packages/components/keep"));
			expect(linked("@x/blue")).toBe(path("deps/blue"));
		});

		it("should skip the dev dependencies of linked packages", async () => {
			ln();
			expect(linked("@x/tool")).toBeUndefined();
		});

		it("should skip dependencies found in no deps folder", async () => {
			ln();
			expect(linked("lodash")).toBeUndefined();
		});

		it("should link the dependencies of the workspace members of the current package", async () => {

			manifest("deps/mono", { name: "mono", private: true, workspaces: ["packages/*"] });
			manifest("deps/mono/packages/a", { name: "@x/a", dependencies: { "@x/b": "^1.0.0", "@x/core": "^1.0.0" } });
			manifest("deps/mono/packages/b", { name: "@x/b" });

			process.chdir(path("deps/mono"));
			ln();

			expect(existsSync(path("deps/mono/node_modules/@x/core"))).toBe(true);
			expect(existsSync(path("deps/mono/node_modules/@x/b"))).toBe(false);

		});

	});

	describe("links", () => {

		it("should link with paths relative to the link location", async () => {
			ln();
			expect(isAbsolute(readlinkSync(module("@x/http")))).toBe(false);
		});

		it("should replace installed packages", async () => {
			manifest("deps/app/node_modules/@x/http", { name: "@x/http", version: "1.0.0" });
			ln();
			expect(linked("@x/http")).toBe(path("deps/http"));
		});

		it("should be idempotent", async () => {
			ln();
			ln();
			expect(linked("@x/http")).toBe(path("deps/http"));
		});

	});

	describe("copies", () => {

		function copy(dir: string, name: string) {
			manifest(`${dir}/node_modules/${name}`, { name, version: "1.0.0" });
		}

		function target(dir: string, name: string) {
			return realpathSync(path(`${dir}/node_modules/${name}`));
		}

		it("should replace nested copies in the current package", async () => {
			copy("deps/app/node_modules/lodash", "@x/core");
			ln();
			expect(target("deps/app/node_modules/lodash", "@x/core")).toBe(path("deps/core"));
		});

		it("should replace copies in the workspace members of the current package", async () => {

			manifest("deps/mono", { name: "mono", private: true, workspaces: ["packages/*"] });
			manifest("deps/mono/packages/a", { name: "@x/a", dependencies: { "@x/core": "^1.0.0" } });
			copy("deps/mono/packages/a", "@x/core");

			process.chdir(path("deps/mono"));
			ln();

			expect(target("deps/mono/packages/a", "@x/core")).toBe(path("deps/core"));

		});

		it("should replace copies in linked checkouts", async () => {
			copy("deps/http", "@x/core");
			copy("deps/keep", "@x/blue");
			ln();
			expect(target("deps/http", "@x/core")).toBe(path("deps/core"));
			expect(target("deps/keep", "@x/blue")).toBe(path("deps/blue"));
		});

		it("should replace copies in the monorepos of linked members given as deps", async () => {

			copy("deps/keep", "@x/blue");

			ln(
				path("deps/keep/packages/connectors/keep-rest"),
				path("deps/keep/packages/components/keep"),
				path("deps/blue")
			);

			expect(target("deps/keep", "@x/blue")).toBe(path("deps/blue"));

		});

		it("should not install into linked checkouts", async () => {
			ln();
			expect(existsSync(path("deps/http/node_modules"))).toBe(false);
		});

		it("should leave checkouts that are not linked alone", async () => {
			copy("deps/tool", "@x/core");
			ln();
			expect(target("deps/tool", "@x/core")).toBe(path("deps/tool/node_modules/@x/core"));
		});

	});

	describe("peers", () => {

		function copy(dir: string, name: string) {
			manifest(`${dir}/node_modules/${name}`, { name, version: "1.0.0" });
		}

		function target(dir: string, name: string) {
			return realpathSync(path(`${dir}/node_modules/${name}`));
		}


		beforeEach(async () => {
			manifest("deps/blue", { name: "@x/blue", peerDependencies: { "@x/core": "^1.0.0", "peer": "^1.0.0" } });
			copy("deps/app", "peer");
		});


		it("should replace the peers of linked packages in their checkouts with the copies of the current package", async () => {
			copy("deps/blue", "peer");
			ln();
			expect(target("deps/blue", "peer")).toBe(path("deps/app/node_modules/peer"));
		});

		it("should replace the peers of linked members in the monorepos holding them", async () => {
			manifest("deps/keep/packages/components/keep", { name: "@x/keep", peerDependencies: { "peer": "^1.0.0" } });
			copy("deps/keep", "peer");
			ln();
			expect(target("deps/keep", "peer")).toBe(path("deps/app/node_modules/peer"));
		});

		it("should link the commands of shared peers into the checkouts", async () => {

			manifest("deps/app/node_modules/peer", { name: "peer", version: "1.0.0", bin: "peer.js" });
			writeFileSync(path("deps/app/node_modules/peer/peer.js"), "#!/usr/bin/env node\n");
			copy("deps/blue", "peer");

			ln();

			expect(realpathSync(path("deps/blue/node_modules/.bin/peer"))).toBe(path("deps/app/node_modules/peer/peer.js"));

		});

		it("should leave peers missing from the current package installed in the checkouts", async () => {
			manifest("deps/blue", { name: "@x/blue", peerDependencies: { "other": "^1.0.0" } });
			copy("deps/blue", "other");
			ln();
			expect(target("deps/blue", "other")).toBe(path("deps/blue/node_modules/other"));
		});

		it("should leave dependencies other than peers installed in the checkouts", async () => {
			copy("deps/http", "peer");
			ln();
			expect(target("deps/http", "peer")).toBe(path("deps/http/node_modules/peer"));
		});

		it("should leave nested copies of peers in the checkouts alone", async () => {
			copy("deps/blue/node_modules/lib", "peer");
			ln();
			expect(target("deps/blue/node_modules/lib", "peer")).toBe(path("deps/blue/node_modules/lib/node_modules/peer"));
		});

		it("should leave nested copies of peers in the current package alone", async () => {
			copy("deps/app/node_modules/lodash", "peer");
			ln();
			expect(target("deps/app/node_modules/lodash", "peer")).toBe(path("deps/app/node_modules/lodash/node_modules/peer"));
		});

		it("should not install peers into the checkouts", async () => {
			ln();
			expect(existsSync(path("deps/blue/node_modules/peer"))).toBe(false);
		});

	});

	describe("bins", () => {

		function script(file: string) {
			writeFileSync(path(file), "#!/usr/bin/env node\n");
		}

		function command(name: string) {
			return path(`deps/app/node_modules/.bin/${name}`);
		}

		it("should link the commands of linked packages", async () => {

			manifest("deps/core", { name: "@x/core", bin: "core.js" });
			manifest("deps/http", { name: "@x/http", bin: { "get": "get.js" }, dependencies: { "@x/core": "^1.0.0" } });
			script("deps/core/core.js");
			script("deps/http/get.js");

			ln();

			expect(realpathSync(command("core"))).toBe(path("deps/core/core.js"));
			expect(realpathSync(command("get"))).toBe(path("deps/http/get.js"));
			expect(isAbsolute(readlinkSync(command("get")))).toBe(false);

		});

		it("should make command scripts executable", async () => {

			manifest("deps/http", { name: "@x/http", bin: { "get": "get.js" } });
			script("deps/http/get.js");

			ln();

			expect(() => accessSync(command("get"), constants.X_OK)).not.toThrow();

		});

	});

	describe("deps", () => {

		it("should default to the parent folder", async () => {
			ln();
			expect(linked("@x/http")).toBe(path("deps/http"));
		});

		it("should look up packages given as deps", async () => {
			ln(path("deps/http"), path("deps/core"));
			expect(linked("@x/http")).toBe(path("deps/http"));
			expect(linked("@x/core")).toBe(path("deps/core"));
			expect(linked("@x/keep-rest")).toBeUndefined();
		});

		it("should look up workspace members of monorepos given as deps", async () => {
			ln(path("deps/keep"));
			expect(linked("@x/keep-rest")).toBe(path("deps/keep/packages/connectors/keep-rest"));
		});

		it("should give precedence to deps listed first", async () => {
			manifest("other/http", { name: "@x/http" });
			ln(path("other"), path("deps"));
			expect(linked("@x/http")).toBe(path("other/http"));
		});

		it("should skip missing deps", async () => {
			expect(() => ln(path("missing"), path("deps"))).not.toThrow();
			expect(linked("@x/http")).toBe(path("deps/http"));
		});

		it("should skip deps that are not folders", async () => {
			writeFileSync(path("file"), "");
			expect(() => ln(path("file"), path("deps"))).not.toThrow();
			expect(linked("@x/http")).toBe(path("deps/http"));
		});

	});

	describe("errors", () => {

		it("should reject a current folder without a package manifest", async () => {
			process.chdir(path("deps"));
			expect(() => ln()).toThrow(/package\.json/);
		});

	});

});
