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
 * Each tool is installed as a command alongside the package and behaves the same on every platform and shell. Inside
 * npm scripts, these commands take precedence over system commands with the same name, such as the Unix `cp`.
 *
 * Every tool lists the paths it acts on to stdout, one per line, so that a script log shows what changed on disk. It
 * prints its usage with `--help`, and exits with a non-zero status after printing an error message to stderr.
 *
 * | Command                               | Purpose                                                                  |
 * |---------------------------------------|--------------------------------------------------------------------------|
 * | {@link cp `cp <target> <pattern>...`} | Copies files matching glob patterns to a directory, keeping their layout |
 * | {@link rm `rm <pattern>...`}          | Removes files and directories matching glob patterns, with their content |
 * | {@link ln `ln [<deps>]...`}           | Links dependencies to their local checkouts instead of registry releases |
 *
 * Build scripts can call the same tools as functions, passing the command operands as arguments: a function throws on
 * failure instead of printing an error message to stderr and setting a non-zero exit status for the process.
 *
 * @module
 */

export { cp } from "./cp.js";
export { ln } from "./ln.js";
export { rm } from "./rm.js";
