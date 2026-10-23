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

/**
 * Unix-like command line tools for npm package scripts.
 *
 * Each tool runs as a subcommand of the `ush` command installed with the package, as in `ush <tool> <operand>...`.
 * Tools behave the same on every platform and shell, and leave system commands with the same name untouched.
 * `ush --help` lists the available tools, and `ush <tool> --help` prints the usage of a single tool.
 *
 * Tools list the paths they act on to stdout, one per line prefixed with the tool name, so that a script log shows
 * what changed on disk and which command changed it. A failing tool exits with a non-zero status after printing an
 * error message to stderr, prefixed with its full command so that the log points to the command that failed.
 *
 * Build scripts can call the same tools as functions, passing the command operands as arguments: a function throws on
 * failure instead of printing an error message to stderr and setting a non-zero exit status for the process.
 *
 * @module
 */

import { parse } from "node:path";
import { cp } from "./cp.js";
import { cli } from "./index.core.js";
import { ln } from "./ln.js";
import { rm } from "./rm.js";

export {
	cp,
	ln,
	rm
};


const commands = [
	cp,
	ln,
	rm
];


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

if ( import.meta.main ) {
	process.exitCode = ush();
}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Runs the tool named on a command line, as in `ush rm dist`, with GNU-style help and error messages.
 *
 * `ush --help` lists every tool with its operands, and `ush <tool> --help` prints the usage of a single tool. Messages
 * are prefixed with the command as invoked, as in `ush cp: missing target operand`, and messages about a malformed
 * command line also point to the help of the command that received it, either `ush --help` or `ush <tool> --help`.
 *
 * @param args The script path, followed by the tool name and its operands; defaults to the process command line
 *
 * @returns The process exit status: `0` on success, `1` on failure
 */
function ush([path, name, ...operands]: readonly string[] = process.argv.slice(1)): number {

	const program = parse(path).name;
	const command = commands.find(tool => tool.name === name);

	return command
		? cli(command, command.usage, `${program} ${name}`, operands)
		: cli(reject, "<command> [<operand>]...", program, name === undefined ? [] : [name, ...operands], listing());


	function listing(): string {
		return ["Commands:", ...commands.map(tool => `  ${tool.name} ${tool.usage}`)].join("\n");
	}

	function reject(operand?: string): void {
		throw new TypeError(operand === undefined ? "missing command operand" : `unknown command <${operand}>`);
	}

}
