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

import { parse } from "node:path";
import { parseArgs } from "node:util";


/**
 * Runs a tool on a command line, with GNU-style help and error messages.
 *
 * The tool receives the operands as its arguments, with `undefined` in place of a missing one, and throws a
 * `TypeError` on a command line it cannot act on, so that the error message also points to the help.
 *
 * `--help` and `-h` print the usage line to stdout and skip the tool. Errors go to stderr prefixed with the tool name;
 * usage errors, including unrecognized options, also point to `--help`. Operands starting with `-` follow `--`.
 *
 * @param tool The tool to run on the operands
 * @param help The operand synopsis printed by `--help` after the tool name, such as `<target> <pattern>...`
 * @param name The tool name prefixing messages; defaults to the script name without extension, else the `tool` name
 * @param args The command line arguments after the script path; defaults to those the process was launched with
 *
 * @returns The process exit status: `0` on success, `1` on failure
 */
export function cli(
	tool: (...args: string[]) => void,
	help: string,
	name: string = process.argv[1] !== undefined ? parse(process.argv[1]).name : tool.name,
	args: readonly string[] = process.argv.slice(2)
): number {

	const { values, positionals, tokens } = parseArgs({
		args: [...args],
		options: { help: { type: "boolean", short: "h" } },
		allowPositionals: true,
		strict: false, // unknown options are rejected below, with a GNU-style message
		tokens: true
	});

	const unknown = tokens.find(token =>
		token.kind === "option" && token.name !== "help"
	);

	if ( unknown?.kind === "option" ) {

		return fail(`unrecognized option <${unknown.rawName}>`, true);

	} else if ( values.help ) {

		console.log(`Usage: ${name} ${help}`);

		return 0;

	} else {

		try {

			tool(...positionals);

			return 0;

		} catch ( error ) {

			return fail(error instanceof Error ? error.message : String(error), error instanceof TypeError);

		}

	}


	function fail(message: string, usage: boolean): number {

		console.error(usage
			? `${name}: ${message}\nTry '${name} --help' for more information.`
			: `${name}: ${message}`
		);

		return 1;

	}

}
