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
import { parseArgs, type ParseArgsOptionDescriptor } from "node:util";


/**
 * A command line tool, declaring the options and operands it accepts.
 *
 * The tool throws a `TypeError` on a command line it cannot act on, so that the error message also points to the help.
 */
export interface Tool {

	/**
	 * Runs the tool with no option set.
	 *
	 * @param args The operands, with `undefined` in place of a missing one
	 */
	(...args: string[]): void

	/**
	 * The long options accepted, each mapped to the synopsis of its argument: `<n>` for a required argument, as in
	 * `--port=<n>`, `[<page>]` for an optional one, as in `--open[=<page>]`, or an empty string for no argument at all.
	 *
	 * Optional arguments follow an equals sign only; required ones may also follow as the next command line argument.
	 * A tool declaring options also provides {@link Tool.with}, which is the only way options reach the tool.
	 */
	readonly opts?: Readonly<Record<string, string>>

	/**
	 * The operand synopsis, one entry per operand, such as `["<target>", "<pattern>..."]`.
	 *
	 * Operands beyond the declared ones are rejected as usage errors, unless the last synopsis ends with `...`.
	 */
	readonly args: readonly string[]

	/**
	 * Configures the tool with a set of options.
	 *
	 * Each option set on the command line maps to its argument, or to `true` if it takes no argument; an option with
	 * an optional argument maps to an empty string if the argument is left out. Options not set are left out as well.
	 *
	 * @param opts The options to apply, keyed by their long names
	 *
	 * @returns The tool configured with the options, to be run on the operands
	 */
	with?(opts: Readonly<Record<string, string | true>>): (...args: string[]) => void

}


/**
 * Composes the command line synopsis of a tool from its options and operands.
 *
 * @param tool The tool to describe
 *
 * @returns The synopsis printed by `--help` after the command name, such as `[--open[=<page>]] <root>`
 */
export function usage({ opts = {}, args }: Tool): string {
	return [
		...Object.entries(opts).map(([name, arg]) => !arg ? `[--${name}]`
			: optional(arg) ? `[--${name}[=${arg.slice(1, -1)}]]`
				: `[--${name}=${arg}]`
		),
		...args
	].join(" ");
}

/**
 * Runs a tool on a command line, with GNU-style help and error messages.
 *
 * Options set on the command line reach the tool through {@link Tool.with}, and the operands are passed to the tool
 * configured with them. Operands starting with `-` follow `--`, which ends option parsing as on any GNU command line.
 *
 * `--help` and `-h` print the usage line composed by {@link usage} to stdout, followed by the description if any, and
 * skip the tool. Errors go to stderr prefixed with the command name. Usage errors also point to `--help`: unrecognized
 * options, missing required arguments, arguments given to options taking none, and operands beyond the declared ones.
 *
 * @param tool The tool to run
 * @param name The command prefixing messages, as in `ush cp`; defaults to the bare script name, else the `tool` name
 * @param args The command line arguments after the command name; defaults to those the process was launched with
 * @param description The text printed by `--help` below the usage line, such as a list of subcommands
 *
 * @returns The process exit status: `0` on success, `1` on failure
 */
export function cli(
	tool: Tool,
	name: string = process.argv[1] !== undefined ? parse(process.argv[1]).name : tool.name,
	args: readonly string[] = process.argv.slice(2),
	description?: string
): number {

	try {

		const { help, options, operands } = scan(tool, args, true);

		const variadic = tool.args.at(-1)?.endsWith("...") === true;
		const extra = variadic ? undefined : operands.at(tool.args.length);

		if ( help ) {

			console.log(description === undefined
				? `Usage: ${name} ${usage(tool)}`
				: `Usage: ${name} ${usage(tool)}\n\n${description}`
			);

		} else if ( extra !== undefined ) {

			throw new TypeError(`extra operand <${extra}>`);

		} else {

			const { opts = {} } = tool;

			const configured = tool.with?.(Object.fromEntries(options.map(({ name, value }) =>
				[name, value ?? (opts[name] ? "" : true)] // a bare option maps to "" if its argument is optional
			))) ?? tool;

			configured(...operands);

		}

		return 0;

	} catch ( error ) {

		return fail(error instanceof Error ? error.message : String(error), error instanceof TypeError);

	}


	function fail(message: string, usage: boolean): number {

		console.error(usage
			? `${name}: ${message}\nTry '${name} --help' for more information.`
			: `${name}: ${message}`
		);

		return 1;

	}

}

/**
 * Reads a command line against the options a tool declares.
 *
 * @param tool The tool declaring the options accepted
 * @param args The command line arguments
 * @param help Whether `--help` and `-h` are also accepted
 *
 * @returns Whether help was requested, the options set in command line order with any argument, and the operands
 *
 * @throws TypeError If an option is not declared, lacks a required argument, or is given an argument it does not take
 */
function scan({ opts = {} }: Pick<Tool, "opts">, args: readonly string[], help: boolean = false): {

	readonly help: boolean
	readonly options: readonly { readonly name: string, readonly value?: string }[]
	readonly operands: readonly string[]

} {

	const required = Object.keys(opts).filter(option => opts[option] && !optional(opts[option]));

	const { values, positionals, tokens } = parseArgs({
		args: [...args],
		options: {
			...(help ? { help: { type: "boolean", short: "h" } } : {}),
			...Object.fromEntries(required.map((option): [string, ParseArgsOptionDescriptor] =>
				[option, { type: "string" }] // also read from the next argument
			))
		},
		allowPositionals: true,
		strict: false, // unknown options are rejected below, with a GNU-style message
		tokens: true
	});

	const options = tokens.flatMap(token => token.kind === "option" ? [token] : []);

	const unknown = options.find(option => !(help && option.name === "help") && !Object.hasOwn(opts, option.name));
	const missing = options.find(option => option.value === undefined && required.includes(option.name));
	const valued = options.find(option => option.value !== undefined && !opts[option.name]);

	if ( unknown !== undefined ) {

		throw new TypeError(`unrecognized option <${unknown.rawName}>`);

	} else if ( missing !== undefined ) {

		throw new TypeError(`option <${missing.rawName}> requires an argument`);

	} else if ( valued !== undefined ) {

		throw new TypeError(`option <${valued.rawName}> takes no argument`);

	} else {

		return {
			help: values.help === true,
			options: options.filter(({ name }) => name !== "help").map(({ name, value }) => ({ name, value })),
			operands: positionals
		};

	}

}


function optional(arg: string): boolean {
	return arg.startsWith("[") && arg.endsWith("]");
}
