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

import { globSync, rmSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { cli } from "./index.core.js";


if ( import.meta.main ) {
	process.exitCode = cli(rm, "<pattern>...");
}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Removes the files and directories matching a set of glob patterns, with their whole content.
 *
 * Patterns matching nothing are ignored, so that the same command can run again on an already clean tree.
 *
 * Each removed file or directory is printed on stdout once, relative to the current folder. Matches inside a removed
 * directory are not listed, even where a pattern selects them explicitly, as they go along with their ancestor.
 *
 * @example
 *
 * Removing build outputs, from an npm script:
 *
 * ```shell
 * rm dist docs 'src/**\/*.tsbuildinfo'
 * ```
 *
 * Patterns are quoted so that they reach the tool unexpanded, as shells differ in their glob support.
 *
 * @param patterns The glob patterns selecting the files and directories to remove
 *
 * @throws TypeError If no pattern is provided
 */
export function rm(...patterns: readonly string[]): void {

	if ( !patterns.length ) {
		throw new TypeError("missing pattern operand");
	}

	const matches = [...new Set(patterns.flatMap(pattern => globSync(pattern)).map(path => resolve(path)))];
	const paths = matches.filter(path => !matches.some(match => path.startsWith(match + sep))); // gone with ancestors

	paths.forEach(path => {
		rmSync(path, { recursive: true, force: true });
		console.log(relative(".", path));
	});

}
