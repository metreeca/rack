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

import { copyFileSync, globSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { cli } from "./index.core.js";


if ( import.meta.main ) {
	process.exitCode = cli(cp, "<target> <pattern>...");
}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Copies the files matching a set of glob patterns into a target directory, keeping their relative layout.
 *
 * Each match lands under `target` at its path relative to the base of its pattern, that is the leading segments free
 * of glob characters: `src/**\/*.css` copies `src/a/b.css` to `<target>/a/b.css`, and a plain file path copies the
 * file to the top of `target`. Missing directories are created and existing files are overwritten.
 *
 * Directories matched by a pattern are skipped: only files are copied.
 *
 * @example
 *
 * Shipping stylesheets next to the compiled modules, from an npm script:
 *
 * ```shell
 * cp dist 'src/**\/*.css'
 * ```
 *
 * Patterns are quoted so that they reach the tool unexpanded, as shells differ in their glob support.
 *
 * @param target The directory receiving the copies
 * @param patterns The glob patterns selecting the files to copy
 *
 * @throws TypeError If `target` is empty or if no pattern is provided
 * @throws Error If a pattern matches no file, in which case no file is copied for any of the patterns
 */
export function cp(target: string, ...patterns: readonly string[]): void {

	if ( !target ) {
		throw new TypeError("missing target operand");
	}

	if ( !patterns.length ) {
		throw new TypeError("missing pattern operand");
	}

	patterns.flatMap(copies).forEach(({ source, destination }) => { // nothing is copied until every pattern matched
		mkdirSync(dirname(destination), { recursive: true });
		copyFileSync(source, destination);
	});


	function copies(pattern: string): readonly { source: string, destination: string }[] {

		const sources = globSync(pattern).filter(source => statSync(source).isFile());

		if ( !sources.length ) {
			throw new Error(`unmatched pattern <${pattern}>`);
		}

		const segments = pattern.split("/");
		const wild = segments.findIndex(segment => /[*?[\]{}]/.test(segment));
		const base = wild < 0 ? dirname(pattern) : segments.slice(0, wild).join("/") || ".";

		return sources.map(source => ({ source, destination: join(target, relative(base, source)) }));

	}

}
