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

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { createServer, type Server as NetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { ws } from "./ws.js";


const { spawn } = vi.hoisted(() => ({ // browser launches are recorded rather than run

	spawn: vi.fn(() => {

		const child = { on: () => child, unref: () => {} };

		return child;

	})

}));

vi.mock("node:child_process", () => ({ spawn }));


let base: string; // assigned by the setup hook for each test
let root: string; // the served folder, inside base
let stdout: MockInstance;
let instance: Server | undefined; // assigned by start()

function file(path: string, content: string = path) {
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), content);
}

/**
 * Starts a server, resolving to its address once it is listening.
 *
 * @returns The address of the server, with no trailing slash
 */
async function start(serve: () => Server = () => ws(root)): Promise<string> {

	const listening = serve();

	instance = listening;

	await new Promise(resolve => listening.once("listening", resolve)); // once() rejects on the fallback error

	const address = listening.address();

	return typeof address === "object" && address !== null ? `http://localhost:${address.port}` : "";

}

async function get(url: string): Promise<Response> {
	return fetch(url, { redirect: "manual" });
}

/**
 * Binds a port on `localhost`.
 *
 * @returns The bound server, or `undefined` if the port is taken
 */
async function bind(port: number): Promise<NetServer | undefined> {

	const probe = createServer();

	return new Promise(resolve => probe
		.once("listening", () => resolve(probe))
		.once("error", () => resolve(undefined))
		.listen(port, "localhost")
	);

}


beforeEach(async () => {
	base = realpathSync(mkdtempSync(join(tmpdir(), "rack-ws-")));
	root = join(base, "docs");
	stdout = vi.spyOn(console, "log").mockImplementation(() => {});
	spawn.mockClear();
});

afterEach(async () => {

	instance?.closeAllConnections();
	instance?.close();
	instance = undefined;

	vi.restoreAllMocks();
	rmSync(base, { recursive: true, force: true });

});


describe("ws()", () => {

	describe("listening", () => {

		it("should print the address it listens on", async () => {
			const url = await start();
			expect(stdout).toHaveBeenCalledWith(`ws ${url}/`);
		});

		it("should listen on port 8000 if free", async ({ skip }) => {

			const probe = await bind(8000);

			probe?.close();

			skip(probe === undefined, "port 8000 is taken by another process");

			expect(await start()).toBe("http://localhost:8000");

		});

		it("should fall back to a free port if port 8000 is taken", async () => {

			const probe = await bind(8000); // undefined if already taken by another process

			try {

				const url = await start();

				expect(url).toMatch(/^http:\/\/localhost:\d+$/);
				expect(url).not.toBe("http://localhost:8000");

			} finally {
				probe?.close();
			}

		});

		it("should not open the browser", async () => {
			await start();
			expect(spawn).not.toHaveBeenCalled();
		});

	});

	describe("errors", () => {

		it.each([undefined, ""])("should reject the missing folder %j as a usage error", async folder => {
			expect(() => ws(folder)).toThrow(TypeError);
		});

	});

	describe("files", () => {

		it("should serve files with their media type", async () => {

			file("assets/style.css", "body {}");
			file("assets/main.js", "export {}");

			const url = await start();

			const css = await get(`${url}/assets/style.css`);
			const js = await get(`${url}/assets/main.js`);

			expect(css.status).toBe(200);
			expect(css.headers.get("content-type")).toMatch(/^text\/css/);
			expect(await css.text()).toBe("body {}");

			expect(js.status).toBe(200);
			expect(js.headers.get("content-type")).toMatch(/^text\/javascript/);
			expect(await js.text()).toBe("export {}");

		});

		it("should serve folders through their index page", async () => {

			file("index.html", "<html><body>root</body></html>");
			file("modules/index.html", "<html><body>modules</body></html>");

			const url = await start();

			const top = await get(`${url}/`);
			const nested = await get(`${url}/modules/`);

			expect(top.status).toBe(200);
			expect(top.headers.get("content-type")).toMatch(/^text\/html/);
			expect(await top.text()).toContain("root");

			expect(nested.status).toBe(200);
			expect(await nested.text()).toContain("modules");

		});

		it("should redirect folders addressed without a trailing slash", async () => {

			file("modules/index.html");

			const url = await start();

			const response = await get(`${url}/modules`);

			expect(response.status).toBe(301);
			expect(response.headers.get("location")).toBe("/modules/");

		});

		it("should decode percent-encoded paths", async () => {

			file("a b.txt", "spaced");

			const url = await start();

			expect(await (await get(`${url}/a%20b.txt`)).text()).toBe("spaced");

		});

		it("should answer not found for missing files", async () => {

			file("index.html");

			const url = await start();

			expect((await get(`${url}/missing.html`)).status).toBe(404);
			expect((await get(`${url}/folder/`)).status).toBe(404);

		});

		it("should answer not found while the folder is missing", async () => {

			const url = await start();

			expect((await get(`${url}/`)).status).toBe(404);

		});

		it("should not serve files outside the folder", async () => {

			writeFileSync(join(base, "secret.txt"), "secret");
			file("index.html");

			const url = await start();

			const response = await get(`${url}/..%2Fsecret.txt`);

			expect(response.status).toBe(404);
			expect(await response.text()).not.toContain("secret");

		});

		it("should disable caching", async () => {

			file("index.html");

			const url = await start();

			expect((await get(`${url}/`)).headers.get("cache-control")).toBe("no-store");

		});

	});
	describe("reload", () => {

		function endpoint(page: string): string {
			return page.match(/EventSource\(["']([^"']+)["']\)/)?.[1] ?? "";
		}

		/**
		 * Connects to the reload events of a page, resolving once the connection is established.
		 *
		 * @returns A function resolving to `true` on the next reload event, or to `false` if none arrives in time
		 */
		async function connect(url: string): Promise<(timeout?: number) => Promise<boolean>> {

			const page = await (await get(`${url}/`)).text();
			const response = await fetch(new URL(endpoint(page), url));
			const reader = response.body?.getReader();
			const decoder = new TextDecoder();

			await reader?.read(); // connection established

			return async (timeout = 3000) => {

				const timer = new Promise<boolean>(resolve => setTimeout(() => resolve(false), timeout));

				const event = (async function next(): Promise<boolean> {

					const chunk = await reader?.read();

					return chunk === undefined || chunk.done ? false
						: decoder.decode(chunk.value).includes("data:") ? true
							: next();

				})();

				return Promise.race([event, timer]);

			};

		}


		it("should insert the reload script into pages", async () => {

			file("index.html", "<html><body><p>content</p></body></html>");

			const url = await start();

			const page = await (await get(`${url}/`)).text();

			expect(endpoint(page)).not.toBe("");
			expect(page).toMatch(/<p>content<\/p><script>.*<\/script><\/body>/s);

		});

		it("should append the reload script to pages without a body end tag", async () => {

			file("index.html", "<p>content</p>");

			const url = await start();

			expect(endpoint(await (await get(`${url}/`)).text())).not.toBe("");

		});

		it("should insert the reload script into not found pages", async () => {

			const url = await start();

			expect(endpoint(await (await get(`${url}/`)).text())).not.toBe("");

		});

		it("should not alter other files", async () => {

			file("assets/style.css", "body {}");

			const url = await start();

			expect(await (await get(`${url}/assets/style.css`)).text()).toBe("body {}");

		});

		it("should notify changes to files", async () => {

			file("index.html");

			const url = await start();
			const reloaded = await connect(url);

			file("index.html", "changed");

			expect(await reloaded()).toBe(true);

		});

		it("should notify changes to nested files", async () => {

			file("index.html");
			file("modules/index.html");

			const url = await start();
			const reloaded = await connect(url);

			file("modules/index.html", "changed");

			expect(await reloaded()).toBe(true);

		});

		it("should notify a burst of changes once", async () => {

			file("index.html");

			const url = await start();
			const reloaded = await connect(url);

			Array.from({ length: 20 }, (_, index) => file(`page-${index}.html`));

			expect(await reloaded()).toBe(true);
			expect(await reloaded(500)).toBe(false);

		});

		it("should ignore changes outside the folder", async () => {

			file("index.html");

			const url = await start();
			const reloaded = await connect(url);

			await reloaded(500); // macOS reports writes made just before the watch started

			writeFileSync(join(base, "sibling.txt"), "sibling");

			expect(await reloaded(500)).toBe(false);

		});

		it("should notify the creation of a folder missing at startup", async () => {

			const url = await start();
			const reloaded = await connect(url);

			file("index.html");

			expect(await reloaded()).toBe(true);

		});

		it("should notify the creation of a folder whose parents are missing at startup", async () => {

			root = join(base, "build", "docs");

			const url = await start();
			const reloaded = await connect(url);

			file("index.html");

			expect(await reloaded()).toBe(true);

		});

		it("should notify the removal of the folder", async () => {

			file("index.html");

			const url = await start();
			const reloaded = await connect(url);

			rmSync(root, { recursive: true, force: true });

			expect(await reloaded()).toBe(true);

		});

		it("should keep notifying changes after the folder is created again", async () => {

			file("index.html");

			const url = await start();
			const reloaded = await connect(url);

			rmSync(root, { recursive: true, force: true });
			file("index.html", "rebuilt");

			expect(await reloaded()).toBe(true);

			file("index.html", "changed");

			expect(await reloaded()).toBe(true);
			expect(await (await get(`${url}/`)).text()).toContain("changed");

		});

	});

});

describe("ws.with()", () => {

	it("should open the browser on the folder with an empty page", async () => {
		const url = await start(() => ws.with({ open: "" })(root));
		expect(spawn).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([`${url}/`]), expect.anything());
	});

	it.each(["api/", "/api/"])("should open the browser on the page %s", async page => {
		const url = await start(() => ws.with({ open: page })(root));
		expect(spawn).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([`${url}/api/`]), expect.anything());
	});

	it("should not open the browser with no page", async () => {
		await start(() => ws.with({})(root));
		expect(spawn).not.toHaveBeenCalled();
	});

	it.each([undefined, ""])("should reject the missing folder %j as a usage error", async folder => {
		expect(() => ws.with({ open: "" })(folder)).toThrow(TypeError);
	});

});
