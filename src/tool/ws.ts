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

import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, type FSWatcher, readFileSync, type Stats, statSync, watch } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";


const reload = "/.ush/reload";
const script = `<script>new EventSource("${reload}").onmessage = () => location.reload();</script>`;
const missing = "<!doctype html><html><head><title>Not Found</title></head><body><h1>Not Found</h1></body></html>";

const port = 8000;
const delay = 250; // ms of quiet closing a burst of changes

const types: Readonly<Record<string, string>> = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".md": "text/markdown; charset=utf-8",
	".xml": "application/xml; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2"
};


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * The options accepted by {@link ws}, each mapped to the synopsis of its argument.
 */
ws.opts = {

	open: "[<page>]"

} satisfies Record<keyof Parameters<typeof ws.with>[0], string>;

/**
 * The operands accepted by {@link ws}, one synopsis each.
 */
ws.args = [

	"<root>"

];

/**
 * Configures {@link ws} with the options otherwise set on the command line, such as `--open`.
 *
 * @param opts The options to apply, keyed by their long names
 *
 * @returns A function serving a folder as {@link ws} does, with the options applied
 */
ws.with = ({

	open: page

}: {

	/**
	 * The page opened in the default browser once the server is listening, as a path relative to the folder, such as
	 * `api/`; an empty string opens the folder itself, and no page at all leaves the browser alone.
	 */
	readonly open?: string

}): (root?: string) => Server => root => {

	if ( !root ) {

		throw new TypeError("missing root operand");

	} else {

		const instance = serve(root);

		return instance.on("listening", () => {

			const address = instance.address();
			const url = typeof address === "object" && address !== null ? `http://localhost:${address.port}/` : "";

			console.log(`ws ${url}`);

			if ( page !== undefined ) {
				open(new URL(page, url).href);
			}

		});

	}

};


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Serves a folder for local preview in the browser, reloading open pages whenever its content changes.
 *
 * Runs on the command line as `ush ws [--open[=<page>]] <root>` until interrupted; `--open` also opens the folder in
 * the default browser, on the page at the `<page>` path relative to the folder if one is provided, as in `--open=api/`.
 *
 * The folder is served on `http://localhost:8000/`, or on a free port if that one is taken; the address is printed on
 * stdout as `ws <url>`. Folders are served through their `index.html` file, addressed with a trailing slash.
 *
 * The folder may be missing at startup, or removed and created again while served, as generators cleaning their
 * output do on each rebuild: pages answer not found while it is missing and reload as soon as it is back, so that the
 * server can start alongside the generator rather than waiting for its first run to complete.
 *
 * Called as a function, the tool returns the running server, so that build scripts and tests can close it when done.
 * Options are set through {@link ws.with}, as in `ws.with({ open: "api/" })("docs")`, which equals `--open=api/`.
 *
 * @example
 *
 * Previewing TypeDoc output while editing sources, from an npm script:
 *
 * ```shell
 * npx typedoc --watch & ush ws --open docs
 * ```
 *
 * @param root The folder to serve
 *
 * @returns The running server
 *
 * @throws TypeError If `root` is missing or empty
 */
export function ws(root?: string): Server {
	return ws.with({})(root);
}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Creates a server for a folder, with live reload of the HTML pages it serves.
 *
 * HTML pages, including not found responses, are served with a script reloading them whenever the folder changes,
 * including when it is created, removed or created again; changes are notified once a burst of writes settles.
 *
 * @param root The folder to serve
 *
 * @returns The server on `localhost`, at the default port or a free one if taken, closing the folder watch when closed
 */
function serve(root: string): Server {

	const $root = resolve(root);

	const events = new EventEmitter().setMaxListeners(0); // one listener for each open page
	const unwatch = observe($root, () => events.emit("reload"));

	const instance = createServer(handle);

	return instance

		.once("error", (error: NodeJS.ErrnoException) => {
			if ( error.code === "EADDRINUSE" ) {
				instance.listen(0, "localhost");
			} else {
				throw error;
			}
		})

		.on("close", unwatch)

		.listen(port, "localhost");


	function handle(request: IncomingMessage, response: ServerResponse): void {

		const { pathname } = new URL(request.url ?? "/", "http://localhost");

		const path = locate(pathname);
		const folder = path !== undefined && inspect(path)?.isDirectory() === true;

		if ( pathname === reload ) {

			stream(response);

		} else if ( folder && !pathname.endsWith("/") ) {

			response.writeHead(301, { "location": `${pathname}/`, "cache-control": "no-store" }).end();

		} else {

			const { status, type, body } = load(folder ? join(path, "index.html") : path)
			?? { status: 404, type: types[".html"], body: Buffer.from(missing) };

			response.writeHead(status, { "content-type": type, "cache-control": "no-store" })
				.end(type === types[".html"] ? inject(body.toString()) : body);

		}

	}

	function stream(response: ServerResponse): void {

		const notify = () => response.write("data: reload\n\n");

		response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
		response.write(": connected\n\n");

		events.on("reload", notify);
		response.on("close", () => events.off("reload", notify));

	}

	function locate(pathname: string): string | undefined {

		const path = decode(pathname);
		const file = path === undefined ? undefined : join($root, path);
		const offset = file === undefined ? undefined : relative($root, file);

		return offset === undefined || offset === ".." || offset.startsWith(`..${sep}`) || isAbsolute(offset)
			? undefined
			: file;

	}

	function decode(pathname: string): string | undefined {
		try {
			return decodeURIComponent(pathname);
		} catch {
			return undefined;
		}
	}

	function inspect(path: string): Stats | undefined {
		try {
			return statSync(path);
		} catch {
			return undefined; // missing, or removed while serving
		}
	}

	function load(path: string | undefined): { status: number, type: string, body: Buffer } | undefined {
		try {
			return path === undefined ? undefined : {
				status: 200,
				type: types[extname(path).toLowerCase()] ?? "application/octet-stream",
				body: readFileSync(path)
			};
		} catch {
			return undefined; // missing, a folder, or removed while serving
		}
	}

	function inject(page: string): string {

		const index = page.lastIndexOf("</body>");

		return index < 0 ? `${page}${script}` : `${page.slice(0, index)}${script}${page.slice(index)}`;

	}

}

/**
 * Watches a folder that may be missing, removed or created again.
 *
 * The folder is watched recursively while it exists, and its nearest existing ancestor is watched for the entry leading
 * to it, so that watching starts over whenever the folder or one of its missing ancestors appears or goes away.
 *
 * @param root The folder to watch
 * @param notify The function called once a burst of changes settles
 *
 * @returns A function closing the watch
 */
function observe(root: string, notify: () => void): () => void {

	let watchers: readonly FSWatcher[] = arm(); // replaced whenever the watch starts over
	let timer: NodeJS.Timeout | undefined; // pending notification of the current burst of changes

	return () => {
		clearTimeout(timer);
		watchers.forEach(watcher => watcher.close());
	};


	function arm(): readonly FSWatcher[] {

		const ancestor = anchor(dirname(root));
		const [entry] = relative(ancestor, root).split(sep);

		return [
			listen(watch(ancestor, (_, name) => name === entry ? rearm() : undefined)),
			...(existsSync(root) ? [listen(watch(root, { recursive: true }, changed))] : [])
		];

	}

	function rearm(): void {
		watchers.forEach(watcher => watcher.close());
		watchers = arm();
		changed(); // changes made before the new watch started are not seen by it
	}

	function changed(): void {
		clearTimeout(timer);
		timer = setTimeout(notify, delay);
	}

	function anchor(path: string): string {
		return existsSync(path) || dirname(path) === path ? path : anchor(dirname(path));
	}

	function listen(watcher: FSWatcher): FSWatcher {
		return watcher.on("error", () => {}); // raised on removal of the watched folder, handled by the ancestor watch
	}

}

/**
 * Opens a URL in the default browser, doing nothing if no browser can be launched.
 *
 * @param url The URL to open
 */
function open(url: string): void {

	const [command, ...args] = process.platform === "darwin" ? ["open", url]
		: process.platform === "win32" ? ["cmd", "/c", "start", "", url]
			: ["xdg-open", url];

	spawn(command, args, { stdio: "ignore", detached: true })
		.on("error", () => {}) // no browser to open: the address is printed anyway
		.unref();

}
