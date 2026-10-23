# @metreeca/rack

[![npm](https://img.shields.io/npm/v/@metreeca/rack)](https://www.npmjs.com/package/@metreeca/rack)

Everyday tooling for npm package development.

**@metreeca/rack** collects build, test and documentation tooling for recurring npm package development needs, so each
package consumes a single maintained copy instead of carrying its own. Tools are grouped by the toolchain they extend:

| Subpath                     | Contents     |
|-----------------------------|--------------|
| [@metreeca/rack/tool][tool] | CLI tools    |
| [@metreeca/rack/node][node] | Node hooks   |
| [@metreeca/rack/vite][vite] | Vite plugins |

[tool]: https://metreeca.github.io/rack/modules/tool.html

[node]: https://metreeca.github.io/rack/modules/node.html

[vite]: https://metreeca.github.io/rack/modules/vite.html

# Installation

```shell
npm install --save-dev @metreeca/rack
```

> [!WARNING]
>
> TypeScript consumers must use `"moduleResolution": "nodenext"/"node16"/"bundler"` in `tsconfig.json`.
> The legacy `"node"` resolver is not supported.

# Support

- open an [issue](https://github.com/metreeca/rack/issues) to report a problem or to suggest a new feature
- start a [discussion](https://github.com/metreeca/rack/discussions) to ask a how-to question or to share an idea

# License

This project is licensed under the Apache 2.0 License –
see [LICENSE](https://github.com/metreeca/rack?tab=Apache-2.0-1-ov-file) file for details.
