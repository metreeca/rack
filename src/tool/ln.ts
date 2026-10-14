#!/usr/bin/env node

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
	chmodSync,
	existsSync,
	globSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { cli } from "./index.core.js";


if ( import.meta.main ) {
	process.exitCode = cli(ln, "[<deps>]...");
}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Links the local checkouts of the dependencies of the current package into its `node_modules`.
 *
 * The current package, and in a monorepo each of its workspace members, then builds and runs against the working
 * trees of its dependencies instead of their registry releases. Dependencies are matched to checkouts by package name.
 *
 * - **Deps**: each folder searched is either a package or a folder holding packages as direct children; a monorepo
 *   found there contributes its workspace members as well, wherever its `workspaces` patterns place them
 * - **Selection**: links every package named in the `dependencies`, `devDependencies`, `peerDependencies` or
 *   `optionalDependencies` of the current package or its members. Each linked package then brings in the checkouts
 *   named in its own `dependencies`, `peerDependencies` or `optionalDependencies`. A package shared along the chain
 *   is thus loaded once from its working tree, never also as a registry copy with distinct classes and symbols
 * - **Copies**: installed copies of a linked package are replaced with links at any depth, both in the current
 *   package and in linked checkouts, since a linked package resolves its own imports from its checkout
 * - **Commands**: the `bin` commands of each linked package are linked into the `.bin` folder next to it and made
 *   executable, so that npm scripts run the working tree version of a command rather than its registry release
 * - **Precedence**: where a name is found in more than one folder, the folder listed first wins
 * - **Versions**: version ranges are ignored, as a working tree may carry a version that is not released yet
 *
 * Links replace whatever the current package has installed under the same name. Inside a linked checkout, they only
 * replace installed copies and never add new packages. Missing folders are skipped, so the same command runs
 * unchanged on every machine, including machines where some of the named folders hold no local checkouts at all.
 *
 * Each package link is printed on stdout, relative to the current package, such as `node_modules/@scope/name`; links
 * to `bin` commands are created silently, since they follow from the package links already listed.
 *
 * @example
 *
 * Linking the sibling checkouts of a package after a clean install, from an npm script:
 *
 * ```shell
 * npm ci && ln
 * ```
 *
 * Linking from a folder of local dependencies elsewhere:
 *
 * ```shell
 * npm ci && ln ~/Metreeca/Packages
 * ```
 *
 * @param deps The folders searched for local dependencies, in order of precedence; defaults to the parent folder (`..`)
 *
 * @throws Error If the current folder holds no `package.json`
 */
export function ln(...deps: readonly string[]): void {

	type Link = Readonly<{ modules: string, name: string, path: string }>;

	const home = resolve(".");
	const local = join(home, "package.json");

	if ( !existsSync(local) ) {
		throw new Error(`missing package manifest <${local}>`);
	}

	const own = packages(home);
	const names = new Set(own.map(path => manifest(path).name));

	const index = new Map((deps.length ? deps : [".."])
		.map(dep => resolve(dep))
		.flatMap(dep => existsSync(join(dep, "package.json"))
			? [dep]
			: children(dep).map(name => join(dep, name)).filter(folder)
		)
		.flatMap(packages)
		.map((path): [string, string] => [manifest(path).name, path])
		.filter(([name]) => !names.has(name))
		.reverse() // later entries override earlier ones, so that the folder listed first wins
	);

	const linked = closure(own.flatMap(path => dependencies(path, true)));
	const roots = new Set([home, ...[...linked.values()].map(path => checkout(path))]);

	linked.forEach((path, name) => link({ modules: join(home, "node_modules"), name, path }));

	[...roots]
		.flatMap(packages)
		.flatMap(path => copies(join(path, "node_modules")))
		.forEach(link);


	function link({ modules, name, path }: Link): void {

		const target = join(modules, name);

		replace(target, path);

		console.log(relative(home, target));

		commands(path, name).forEach(([command, script]) => {

			replace(join(modules, ".bin", command), join(target, script));

			if ( existsSync(join(path, script)) ) {
				chmodSync(join(path, script), 0o755); // as npm does, since builds such as tsc emit scripts without the mode
			}

		});

	}

	function replace(link: string, target: string): void {
		rmSync(link, { recursive: true, force: true }); // removes links without following them
		mkdirSync(dirname(link), { recursive: true });
		symlinkSync(relative(dirname(link), target), link, "junction"); // type ignored outside Windows
	}

	function commands(path: string, name: string): readonly (readonly [string, string])[] {

		const { bin } = manifest(path);

		if ( process.platform === "win32" ) {
			return []; // npm exposes commands through generated shims rather than links
		} else if ( typeof bin === "string" ) {
			return [[name.replace(/^@[^/]+\//, ""), bin]];
		} else {
			return Object.entries(bin ?? {});
		}

	}

	function copies(modules: string): readonly Link[] {
		return children(modules)
			.filter(name => !name.startsWith("."))
			.flatMap(name => name.startsWith("@")
				? children(join(modules, name)).map(member => `${name}/${member}`)
				: [name]
			)
			.flatMap(name => {

				const copy = join(modules, name);
				const path = linked.get(name);

				if ( path !== undefined ) {
					return existsSync(copy) && realpathSync(copy) === realpathSync(path) ? [] : [{ modules, name, path }];
				} else if ( lstatSync(copy).isSymbolicLink() ) {
					return []; // a link into another checkout, inspected as a root of its own when linked
				} else {
					return copies(join(copy, "node_modules"));
				}

			});
	}

	function packages(path: string): readonly string[] {
		return existsSync(join(path, "package.json")) ? [path, ...(manifest(path).workspaces ?? [])
			.flatMap(pattern => globSync(pattern, { cwd: path }))
			.map(member => join(path, member))
			.filter(member => existsSync(join(member, "package.json")))
		] : [];
	}

	function checkout(path: string, parent: string = dirname(path)): string {
		if ( parent === dirname(parent) ) {
			return path;
		} else if ( existsSync(join(parent, "package.json")) ) {
			return packages(parent).includes(path) ? parent : path;
		} else {
			return checkout(path, dirname(parent));
		}
	}

	function children(path: string): readonly string[] {
		return folder(path) ? readdirSync(path) : [];
	}

	function folder(path: string): boolean {
		return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
	}

	function closure(
		required: readonly string[],
		closed: ReadonlyMap<string, string> = new Map()
	): ReadonlyMap<string, string> {

		const fresh = new Map(required.flatMap((name): [string, string][] => {

			const path = index.get(name);

			return path !== undefined && !closed.has(name) ? [[name, path]] : [];

		}));

		return fresh.size
			? closure([...fresh.values()].flatMap(path => dependencies(path)), new Map([...closed, ...fresh]))
			: closed;

	}

	function dependencies(path: string, dev: boolean = false): readonly string[] {

		const { dependencies, devDependencies, peerDependencies, optionalDependencies } = manifest(path);

		return Object.keys({

			...dependencies,
			...(dev ? devDependencies : {}),
			...peerDependencies,
			...optionalDependencies

		});

	}

	function manifest(path: string): Readonly<{

		name: string
		bin?: string | Readonly<Record<string, string>>
		workspaces?: readonly string[]

		dependencies?: Readonly<Record<string, string>>
		devDependencies?: Readonly<Record<string, string>>
		peerDependencies?: Readonly<Record<string, string>>
		optionalDependencies?: Readonly<Record<string, string>>

	}> {

		return JSON.parse(readFileSync(join(path, "package.json"), "utf8")); // trusted local file, not validated

	}

}
