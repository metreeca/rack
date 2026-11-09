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
 * Each tool runs as a subcommand of the `ush` command installed with the package, as in `ush <tool> <argument>...`.
 * Tools behave the same on every platform and shell, and leave system commands with the same name untouched.
 * `ush --help` lists the available tools, and `ush <tool> --help` prints the options and operands of a single tool.
 *
 * Tools print what they act on to stdout, one path or address per line prefixed with the tool name, so that a script
 * log shows what changed on disk and which command changed it. A failing tool prints an error message to stderr and
 * exits with a non-zero status; the message is prefixed with the full command, so the log points to the failing one.
 *
 * Build scripts can call the same tools as functions, passing the operands as arguments; tools accepting options are
 * configured through their `with()` method, as in `ws.with({ open: "api/" })("docs")`. A function throws on failure
 * instead of printing an error message to stderr and setting a non-zero exit status for the process.
 *
 * @module
 */

import { parse } from "node:path";
import { cp } from "./cp.js";
import { cli, usage } from "./index.core.js";
import { ln } from "./ln.js";
import { rm } from "./rm.js";
import { ws } from "./ws.js";

export {
	cp,
	rm,
	ln,
	ws
};


const commands = [
	cp,
	rm,
	ln,
	ws
];


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

if ( import.meta.main ) {
	process.exitCode = ush();
}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Runs the tool named on a command line, as in `ush rm dist`, with GNU-style help and error messages.
 *
 * `ush --help` lists every tool with its options and operands, and `ush <tool> --help` prints the usage of one tool.
 * Messages are prefixed with the command as invoked, as in `ush cp: missing target operand`. Messages about a malformed
 * command line also point to the help of the command that received it, either `ush --help` or `ush <tool> --help`.
 *
 * @param args The script path, followed by the tool name and its arguments; defaults to the process command line
 *
 * @returns The process exit status: `0` on success, `1` on failure
 */
function ush([path, name, ...operands]: readonly string[] = process.argv.slice(1)): number {

	const program = parse(path).name;
	const command = commands.find(tool => tool.name === name);

	reject.args = [

		"<command>",
		"[<operand>]..."

	];

	return command
		? cli(command, `${program} ${name}`, operands)
		: cli(reject, program, name === undefined ? [] : [name, ...operands], listing());


	function listing(): string {
		return ["Commands:", ...commands.map(tool => `  ${tool.name} ${usage(tool)}`)].join("\n");
	}

	function reject(operand?: string): void {
		throw new TypeError(operand === undefined ? "missing command operand" : `unknown command <${operand}>`);
	}

}
