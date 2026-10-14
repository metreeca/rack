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
 * Every tool prints its usage with `--help`, and exits with a non-zero status after printing an error message.
 *
 * | Tool                       | Purpose                                                                     |
 * |----------------------------|-----------------------------------------------------------------------------|
 * | `cp <target> <pattern>...` | Copies files matching glob patterns into a directory, keeping their layout  |
 * | `ln [<deps>]...`           | Links dependencies to their local checkouts instead of registry releases    |
 * | `rm <pattern>...`          | Removes files and directories matching glob patterns, with their content    |
 *
 * @module
 */

export {};
