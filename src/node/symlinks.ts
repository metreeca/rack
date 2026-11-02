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

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire, type ResolveHookSync } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exports } from "resolve.exports";
import { bare, lookup, manifest, shared } from "../symlinks.js";


/**
 * Creates module hooks running a Node process against the live source of locally linked packages, with no rebuild.
 *
 * Imports of workspace members and of sibling checkouts linked into `node_modules` resolve to their TypeScript source,
 * which Node runs through its built-in type stripping, so edits are picked up as they are saved. Packages installed
 * from the registry keep resolving to their build, as do packages whose `exports` name none of the conditions.
 *
 * Packages are looked up as Node does, from the `node_modules` nearest to the importer up through its ancestors;
 * imports with no importer start from the root. A linked checkout importing a package the project links as well
 * loads the linked source rather than the registry copy it installs for itself, so the two never diverge.
 *
 * The process loads a single copy of every linked package and of each of their `peerDependencies`, as libraries
 * holding module state such as Preact hooks require. Those packages resolve from the root, whatever copies a linked
 * checkout installs for itself, and from the importer only where the root does not install them. Other dependencies
 * of a linked package resolve from its checkout, as Node does, since the process loads no other copy of them.
 *
 * Relative imports of a `.js` file from a TypeScript module, as `NodeNext` module resolution requires, resolve to the
 * `.ts` file next to it when the `.js` file does not exist. Sources compiled to `dist` thus run from `src` under plain
 * `node`, with no loader such as `tsx`. Where such a loader is registered as well, the imports it resolves are left
 * to it, and the hooks only add the resolution of linked packages to their TypeScript source.
 *
 * The hooks take effect once registered with `registerHooks` from `node:module`, before the first import they have
 * to resolve, typically from a module loaded with `--import`. Importing `@metreeca/rack/node` registers them with the
 * conditions of the `tsconfig.json` nearest to the current working directory, with no setup module to write.
 *
 * @param options The resolution settings
 *
 * @returns Synchronous module hooks resolving linked imports to source, deduplicating linked packages and their
 * peers, mapping `.js` relative imports to their `.ts` sources, and leaving all other imports to the default resolution
 */
export function symlinks({

	conditions,
	root = process.cwd()

}: {

	/**
	 * The export conditions mapping each subpath to its source file, as listed in `customConditions`; where a package
	 * matches more than one, the key order of its own `exports` decides which applies.
	 */
	conditions: string | readonly string[]

	/**
	 * The project root the linked packages and their peers resolve from; defaults to the current working directory.
	 */
	root?: string

}): Readonly<{ resolve: ResolveHookSync }> {

	const $conditions = typeof conditions === "string" ? [conditions] : conditions;

	const names = new Set(shared(root)); // the packages resolved from the root, whoever imports them

	return {

		resolve(specifier, context, next) {

			const { parentURL } = context;
			const parent = parentURL?.startsWith("file:") ? fileURLToPath(parentURL) : undefined;
			const base = parent === undefined ? root : dirname(parent);
			const name = bare(specifier);
			const link = name === undefined ? undefined : lookup(name, base) ?? lookup(name, root);

			if ( link !== undefined ) {

				const path = realpathSync(link);
				const target = source(path, specifier, context.conditions);

				return target === undefined
					? next(specifier, context) // subpath not exported or excluded by a null target: node reports it
					: { url: pathToFileURL(resolve(path, target)).href, shortCircuit: true };

			} else if ( name !== undefined && names.has(name) ) {

				return rooted(specifier, context, next);

			} else if ( parent?.endsWith(".ts") && /^\.\.?\/.*\.js$/.test(specifier) ) {

				return sibling(specifier, context, next, resolve(base, specifier).replace(/\.js$/, ".ts"));

			} else {

				return next(specifier, context);

			}

		}

	};


	function source(path: string, specifier: string, conditions: readonly string[]): string | undefined {
		try {

			return exports(manifest(path), specifier, {
				conditions: $conditions,
				require: conditions.includes("require")
			})?.[0];

		} catch { // subpath not exported or excluded by a null target

			return undefined;

		}
	}

	function rooted(
		specifier: string,
		context: Parameters<ResolveHookSync>[1],
		next: Parameters<ResolveHookSync>[2]
	): ReturnType<ResolveHookSync> {
		try {

			return next(specifier, { ...context, parentURL: pathToFileURL(join(root, "package.json")).href });

		} catch { // not installed by the root: falls back to the importer

			return next(specifier, context);

		}
	}

	function sibling(
		specifier: string,
		context: Parameters<ResolveHookSync>[1],
		next: Parameters<ResolveHookSync>[2],
		path: string
	): ReturnType<ResolveHookSync> {
		try {

			return next(specifier, context);

		} catch ( error ) { // the .js file does not exist: a .ts file next to it is the source

			if ( existsSync(path) ) {
				return { url: pathToFileURL(path).href, shortCircuit: true };
			} else {
				throw error;
			}

		}
	}

}

/**
 * Reads the custom export conditions a project asks its TypeScript language service to resolve.
 *
 * Configurations are read as TypeScript reads them, so linked packages run from the same sources `tsc` and the IDE
 * check them against. Byte order marks, comments and trailing commas are accepted. `extends` may name a relative path
 * with or without its `.json` extension, a package through the `tsconfig` field of its manifest, or a file inside a
 * package. It may also name an array of these, where later entries override the conditions of earlier ones.
 *
 * @param directory The directory the search for `tsconfig.json` starts from, walking up through its ancestors
 *
 * @returns The `customConditions` of the nearest `tsconfig.json`, read through its `extends` chain where it declares
 * none of its own; empty if no configuration is found or none declares any, so that linked packages resolve to `dist`
 *
 * @throws Error If a configuration in the chain is malformed, extends one that cannot be resolved, or extends itself
 * through the chain; the message names the offending file, so a broken link in the chain can be located at once
 */
export function customConditions(directory: string): readonly string[] {

	const config = join(directory, "tsconfig.json");
	const parent = dirname(directory);

	return existsSync(config) ? declared(config) ?? []
		: parent === directory ? []
			: customConditions(parent);


	function declared(config: string, chain: readonly string[] = []): readonly string[] | undefined {

		if ( chain.includes(config) ) {

			throw new Error(`circular base configuration <${config}>`);

		} else {

			const { extends: bases = [], compilerOptions } = parsed(config);

			return compilerOptions?.customConditions ?? [bases].flat()
				.map(base => located(base, config))
				.reduceRight<readonly string[] | undefined>(
					(conditions, base) => conditions ?? declared(base, [...chain, config]),
					undefined
				);

		}

	}

	function parsed(config: string): Readonly<{

		extends?: string | readonly string[]
		compilerOptions?: Readonly<{ customConditions?: readonly string[] }>

	}> {

		const text = jsonc(readFileSync(config, "utf8"));

		try {

			return JSON.parse(text); // trusted local file, not validated

		} catch ( error ) {

			throw new Error(`malformed configuration <${config}>`, { cause: error });

		}

	}

	function located(base: string, config: string): string {

		const require = createRequire(config);

		const path = [
			() => require.resolve(base),
			() => require.resolve(`${base}.json`),
			() => field(require.resolve(`${base}/package.json`)),
			() => require.resolve(`${base}/tsconfig.json`)
		]
			.map(resolved)
			.find(path => path?.endsWith(".json"));

		if ( path === undefined ) {
			throw new Error(`unresolved base configuration <${base}> in <${config}>`);
		} else {
			return path;
		}


		function field(manifest: string): string {

			const { tsconfig = "tsconfig.json" }: Readonly<{

				tsconfig?: string

			}> = JSON.parse(readFileSync(manifest, "utf8")); // trusted local file, not validated

			return require.resolve(resolve(dirname(manifest), tsconfig));

		}

	}

	function resolved(resolve: () => string): string | undefined {
		try {

			return resolve();

		} catch { // not found: the next candidate may be

			return undefined;

		}
	}

	function jsonc(text: string): string {

		const string = /"(?:\\.|[^"\\])*"/.source;

		return text
			.replace(/^﻿/, "")
			.replace(new RegExp(`(${string})|//.*|/\\*[\\s\\S]*?\\*/`, "g"), (_, kept = "") => kept)
			.replace(new RegExp(`(${string})|,(?=\\s*[}\\]])`, "g"), (_, kept = "") => kept);

	}

}
