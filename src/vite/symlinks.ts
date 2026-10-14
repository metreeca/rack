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

import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { exports, type Package } from "resolve.exports";
import type { Plugin } from "vite";


type Manifest = Package & {
	readonly peerDependencies?: Readonly<Record<string, string>>
};


/**
 * Creates a plugin running tests against the live source of locally linked packages, with no rebuild.
 *
 * Imports of workspace members and of sibling checkouts linked into `node_modules` resolve to their TypeScript source,
 * so edits are picked up as they are saved. Packages installed from the registry keep resolving to their build.
 *
 * Packages are looked up as Node does, from the `node_modules` nearest to the importer up through its ancestors, so
 * links hoisted to a workspace root are found from any member; imports with no importer start from the Vite root.
 *
 * The `peerDependencies` of linked packages are shared with the project, so the project and its linked packages load a
 * single copy of each peer, as libraries holding module state such as Preact hooks require. Peers resolve from the Vite
 * root whoever imports them, including registry packages installed in a checkout and dependencies prebundled by the
 * optimizer. All other imports keep resolving from the checkout they are found in.
 *
 * Peers of packages linked into the `node_modules` of the Vite root or of its ancestors are shared from the start.
 * Peers of packages linked only nearer to an importer, as in a workspace member, are shared once the package is first
 * resolved, and stay duplicated in prebundled dependencies, which the optimizer builds before that point.
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
 * @returns A plugin resolving linked imports to source and leaving all others to the default resolution
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

	const $conditions = typeof conditions === "string" ? [conditions] : conditions;

	const manifests = new Map<string, Manifest>(); // memoised by link real path, also tracking the peers to share

	return {

		name: "symlinks",
		enforce: "pre",

		config({ root }) {

			const peers = links(resolve(root ?? "")).flatMap(link =>
				Object.keys(manifest(realpathSync(link)).peerDependencies ?? {})
			);

			return { resolve: { dedupe: [...new Set(peers)] } };

		},

		resolveId(id, importer, options) {

			const root = this.environment.config.root;
			const name = id.match(/^(@[^/]+\/)?[^/]+/)?.[0];
			const peer = name !== undefined && [...manifests.values()].some(({ peerDependencies }) =>
				peerDependencies !== undefined && Object.hasOwn(peerDependencies, name)
			);
			const base = !peer && importer && isAbsolute(importer) ? dirname(importer) : root;
			const link = name && lookup(name, base);

			if ( link ) {

				try {

					const path = realpathSync(link);
					const target = exports(manifest(path), id, { conditions: $conditions })?.[0];

					return target === undefined ? null : resolve(path, target);

				} catch { // subpath not exported or excluded by a null target

					return null;

				}

			} else if ( peer ) { // falls back to the default resolution if missing from the project

				return this.resolve(id, join(root, "package.json"), { ...options, skipSelf: true });

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

	function links(directory: string): readonly string[] {

		const parent = dirname(directory);
		const modules = join(directory, "node_modules");

		const entries = lstatSync(modules, { throwIfNoEntry: false })?.isDirectory()
			? readdirSync(modules).flatMap(entry => entry.startsWith("@")
				? readdirSync(join(modules, entry)).map(name => join(modules, entry, name))
				: [join(modules, entry)]
			)
			: [];

		return [
			...entries.filter(entry => lstatSync(entry).isSymbolicLink()),
			...(parent === directory ? [] : links(parent))
		];

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
