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
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { exports, type Package } from "resolve.exports";
import type { Plugin } from "vite";


/**
 * Creates a plugin running tests against the live source of locally linked packages, with no rebuild.
 *
 * Imports of workspace members and of sibling checkouts linked into `node_modules` resolve to their TypeScript source,
 * so edits are picked up as they are saved. Packages installed from the registry keep resolving to their build.
 *
 * Packages are looked up as Node does, from the `node_modules` nearest to the importer up through its ancestors, so
 * links hoisted to a workspace root are found from any member; imports with no importer start from the Vite root.
 * A package the importer resolves to an installed copy is looked up again from the Vite root, so a linked checkout
 * importing a package the project links as well loads the linked source rather than its own registry copy.
 *
 * The project and its linked packages load a single copy of every linked package and of each of their
 * `peerDependencies`, as libraries holding module state such as Preact hooks require: the links found in the
 * `node_modules` of the Vite root and of its workspace members extend `resolve.dedupe`, so that those packages always
 * resolve from the project, dependencies prebundled by the optimizer included, whatever copies a linked checkout
 * installs for itself. Other dependencies of a linked package resolve from its checkout, as Node does.
 *
 * The plugin replaces `resolve.conditions`, which breaks registry packages whose exports name a condition without
 * publishing its target: Vite does not fall back to `default` when that target is missing from the installed files.
 *
 * @example
 *
 * Linked packages map each exported subpath to its source under a custom condition, next to the build:
 *
 * ```json
 * {
 *   "exports": {
 *     ".": { "source": "./src/index.ts", "default": "./dist/index.js" }
 *   }
 * }
 * ```
 *
 * The consuming project registers the plugin with the same condition in its Vite or Vitest configuration:
 *
 * ```typescript
 * import { symlinks } from "@metreeca/rack/vite";
 * import { defineConfig } from "vitest/config";
 *
 * export default defineConfig({
 *   plugins: [symlinks({ conditions: "source" })]
 * });
 * ```
 *
 * @param options The resolution settings
 *
 * @returns A plugin resolving linked imports to source, deduplicating linked packages and their peers, and leaving all
 * other imports to the default resolution
 */
export function symlinks({

	conditions

}: {

	/**
	 * The export conditions mapping each subpath to its source file, as listed in `customConditions`; where a package
	 * matches more than one, the key order of its own `exports` decides which applies.
	 */
	conditions: string | readonly string[]

}): Plugin {

	type Manifest = Package & Readonly<{ peerDependencies?: Readonly<Record<string, string>> }>;

	const $conditions = typeof conditions === "string" ? [conditions] : conditions;

	const manifests = new Map<string, Manifest>(); // memoised by link real path

	return {

		name: "symlinks",
		enforce: "pre",

		config({ root }) {

			const names = links(resolve(root ?? "")).flatMap(link => {

				const { name, peerDependencies } = manifest(realpathSync(link));

				return [name, ...Object.keys(peerDependencies ?? {})];

			});

			return { resolve: { dedupe: [...new Set(names)] } };

		},

		resolveId(id, importer) {

			const root = this.environment.config.root;
			const name = id.match(/^(@[^/]+\/)?[^/]+/)?.[0];
			const base = importer && isAbsolute(importer) ? dirname(importer) : root;
			const link = name && (lookup(name, base) ?? lookup(name, root));

			if ( link ) {

				try {

					const path = realpathSync(link);
					const target = exports(manifest(path), id, { conditions: $conditions })?.[0];

					return target === undefined ? null : resolve(path, target);

				} catch { // subpath not exported or excluded by a null target

					return null;

				}

			} else {

				return null;

			}

		}

	};


	function lookup(name: string, directory: string): string | undefined {

		const path = (createRequire(join(directory, sep)).resolve.paths(name) ?? [])
			.map(modules => join(modules, name))
			.find(candidate => lstatSync(candidate, { throwIfNoEntry: false }));

		return path !== undefined && lstatSync(path).isSymbolicLink() ? path : undefined;

	}

	function links(root: string): readonly string[] { // the links found around the root and its workspace members
		return [...ancestors(root), ...members(root)]
			.map(directory => join(directory, "node_modules"))
			.flatMap(modules => children(modules)
				.filter(entry => !entry.startsWith("."))
				.flatMap(entry => entry.startsWith("@")
					? children(join(modules, entry)).map(name => join(modules, entry, name))
					: [join(modules, entry)]
				)
				.filter(entry => lstatSync(entry).isSymbolicLink())
			);
	}

	function members(root: string): readonly string[] {

		const path = join(root, "package.json");

		const { workspaces = [] }: Readonly<{ workspaces?: readonly string[] }> = existsSync(path)
			? JSON.parse(readFileSync(path, "utf8")) // trusted local file, not validated
			: {};

		return workspaces
			.flatMap(pattern => globSync(pattern, { cwd: root }))
			.map(member => join(root, member));

	}

	function ancestors(directory: string): readonly string[] { // the directory itself first, file system root excluded

		const { root } = parse(directory);
		const segments = relative(root, directory).split(sep).filter(Boolean);

		return segments.map((_, index) => join(root, ...segments.slice(0, segments.length-index)));

	}

	function children(path: string): readonly string[] {
		return statSync(path, { throwIfNoEntry: false })?.isDirectory() ? readdirSync(path) : [];
	}

	function manifest(path: string): Manifest {

		const cached = manifests.get(path);

		if ( cached === undefined ) {

			const loaded: Manifest = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));

			manifests.set(path, loaded);

			return loaded;

		} else {

			return cached;

		}

	}

}
