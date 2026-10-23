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
 * Node module hooks running a process against the live source of locally linked packages, with no rebuild.
 *
 * Importing this module registers the {@link symlinks} hooks for the rest of the process, with the `customConditions`
 * of the `tsconfig.json` nearest to the current working directory. Node then resolves locally linked packages to the
 * same sources the IDE does. The module must load before any module it resolves, through the `--import` option given
 * on the command line, in an npm script or in the Node.js run configuration template of the IDE:
 *
 * ```shell
 * node --import @metreeca/rack/node src/index.ts
 * ```
 *
 * Plain `node` runs TypeScript sources through its built-in type stripping, which supports erasable syntax only.
 * Sources using `enum`, `namespace` or parameter properties need a loader such as `tsx` registered ahead of the
 * hooks, as in `node --import tsx --import @metreeca/rack/node` or `tsx --import @metreeca/rack/node`.
 *
 * @module
 */

import { registerHooks } from "node:module";
import { customConditions, symlinks } from "./symlinks.js";

export { symlinks, customConditions };


registerHooks(symlinks({ conditions: customConditions(process.cwd()) }));
