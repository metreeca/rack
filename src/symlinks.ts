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

import { existsSync, globSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, parse, relative, sep } from "node:path";
import type { Package } from "resolve.exports";


/**
 * The package manifests read by {@link manifest}, keyed by package folder path and reused until their file changes.
 */
const manifests = new Map<string, Readonly<{

	stamp: string // the modification time in nanoseconds and the size of the file the manifest was read from
	manifest: Manifest

}>>();


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * The package manifest fields the linked package resolvers and the `ln` command rely on.
 */
export type Manifest = Package & Readonly<{

	bin?: string | Readonly<Record<string, string>>
	workspaces?: readonly string[]

	dependencies?: Readonly<Record<string, string>>
	devDependencies?: Readonly<Record<string, string>>
	peerDependencies?: Readonly<Record<string, string>>
	optionalDependencies?: Readonly<Record<string, string>>

}>;


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Matches the package name a module specifier starts with.
 *
 * @param specifier The module specifier to match
 *
 * @returns The scoped or bare package name at the start of `specifier`, subpath excluded; `undefined` for specifiers
 * that no `node_modules` lookup can resolve: relative and absolute paths, URLs, `node:` builtins and virtual module
 * ids prefixed with `\0`, which bundler plugins reserve for modules with no file behind them
 */
export function bare(specifier: string): string | undefined {
	return specifier.match(/^(?![./\0]|[a-z]+:)(@[^/]+\/)?[^/]+/i)?.[0];
}

/**
 * Looks a package up as Node does, from the `node_modules` nearest to a directory up through its ancestors.
 *
 * @param name The name of the package to look up
 * @param directory The directory the lookup starts from
 *
 * @returns The path of the `node_modules` entry of `name`, if it is a symbolic link; `undefined` if the package is
 * not found or is an installed copy, which the default resolution handles as it does for any registry package
 */
export function lookup(name: string, directory: string): string | undefined {

	const path = (createRequire(join(directory, sep)).resolve.paths(name) ?? []) // trailing separator: a folder, not a file
		.map(modules => join(modules, name))
		.find(candidate => lstatSync(candidate, { throwIfNoEntry: false }));

	return path !== undefined && lstatSync(path).isSymbolicLink() ? path : undefined;

}

/**
 * Lists the packages a project loads a single copy of.
 *
 * @param root The project root
 *
 * @returns The names of the packages linked into the `node_modules` of `root`, of its ancestors and of its workspace
 * members, along with the names of their `peerDependencies`, without duplicates
 */
export function shared(root: string): readonly string[] {
	return [...new Set(linked(root).flatMap(path => {

		const { name, peerDependencies } = manifest(path);

		return [name, ...Object.keys(peerDependencies ?? {})];

	}))];
}

/**
 * Lists the checkouts a project links.
 *
 * @param root The project root
 *
 * @returns The real paths of the packages linked into the `node_modules` of `root`, of its ancestors and of its
 * workspace members, without duplicates, even where several links point to the same checkout
 */
export function linked(root: string): readonly string[] {

	return [...new Set(links().map(link => realpathSync(link)))];


	function links(): readonly string[] {
		return [...ancestors(), ...members()]
			.map(directory => join(directory, "node_modules"))
			.flatMap(modules => children(modules)
				.filter(entry => !entry.startsWith(".")) // hidden entries such as .bin
				.flatMap(entry => entry.startsWith("@")
					? children(join(modules, entry)).map(name => join(modules, entry, name))
					: [join(modules, entry)]
				)
				.filter(entry => lstatSync(entry).isSymbolicLink())
			);
	}

	function ancestors(): readonly string[] { // root itself first, file system root excluded

		const { root: base } = parse(root);
		const segments = relative(base, root).split(sep).filter(Boolean);

		return segments.map((_, index) => join(base, ...segments.slice(0, segments.length-index)));

	}

	function members(): readonly string[] {
		return existsSync(join(root, "package.json"))
			? (manifest(root).workspaces ?? [])
				.flatMap(pattern => globSync(pattern, { cwd: root }))
				.map(member => join(root, member))
			: [];
	}

	function children(path: string): readonly string[] {
		return statSync(path, { throwIfNoEntry: false })?.isDirectory() ? readdirSync(path) : [];
	}

}

/**
 * Reads a package manifest.
 *
 * Edits saved while the process runs, such as new `exports` subpaths in a linked checkout, take effect on the next
 * call, while an unchanged manifest is reused from memory without reading its file again.
 *
 * @param path The path of the package folder
 *
 * @returns The manifest of the package at `path`, as currently saved
 */
export function manifest(path: string): Manifest {

	const file = join(path, "package.json");
	const { mtimeNs, size } = statSync(file, { bigint: true });

	const stamp = `${mtimeNs}:${size}`;
	const cached = manifests.get(path);

	if ( cached?.stamp === stamp ) {

		return cached.manifest;

	} else {

		const loaded: Manifest = JSON.parse(readFileSync(file, "utf8")); // trusted local file

		manifests.set(path, { stamp, manifest: loaded });

		return loaded;

	}

}
