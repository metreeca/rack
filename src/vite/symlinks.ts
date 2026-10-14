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

import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { exports, type Package } from "resolve.exports";
import type { Plugin } from "vite";


/**
 * Creates a plugin resolving imports of linked packages to their TypeScript source.
 *
 * Tests run against the working tree of workspace members and of sibling checkouts linked by `npm run setup`, with no
 * prior build. Packages installed from the registry keep resolving to their build, as they ship no source.
 *
 * The plugin replaces `resolve.conditions`, which fails on registry packages whose exports name the condition: Vite
 * does not fall back to `default` when a condition target is missing.
 *
 * @param options The resolution settings
 *
 * @returns A plugin resolving linked imports to source and leaving all others to the default resolution
 */
export function symlinks({

	project,
	condition

}: {

	/**
	 * The project directory holding the `node_modules` to read links from.
	 */
	project: string

	/**
	 * The export condition mapping each subpath to its source file, as listed in `customConditions`.
	 */
	condition: string

}): Plugin {

	const manifests = new Map<string, Package>(); // memoised by link real path

	return {

		name: "symlinks",
		enforce: "pre",

		resolveId: id => {

			const name = id.match(/^(@[^/]+\/)?[^/]+/)?.[0];
			const link = name && join(project, "node_modules", name);

			if ( link && lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink() ) {

				try {

					const path = realpathSync(link);
					const target = exports(manifest(path), id, { conditions: [condition] })?.[0];

					return target === undefined ? null : resolve(path, target);

				} catch { // subpath not exported or excluded by a null target

					return null;

				}

			} else {

				return null;

			}

		}

	};

	function manifest(path: string): Package {

		const cached = manifests.get(path);

		if ( cached !== undefined ) {

			return cached;

		} else {

			const loaded: Package = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));

			manifests.set(path, loaded);

			return loaded;

		}

	}

}
