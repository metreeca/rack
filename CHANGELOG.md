# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0](https://github.com/metreeca/rack/compare/v0.4.0...HEAD)

### Changed

- `cp`, `ln` and `rm` prefix each path they print on stdout with the tool name, as in `cp src/index.css`, so a script
  log shows which command changed each path; scripts parsing the bare paths printed until 0.4 have to strip the prefix

### Fixed

- `symlinks` plugin sharing the peers of linked packages also with dependencies prebundled by the Vite optimizer, so a
  prebundled library no longer loads a second copy of a peer, such as Preact, next to the one the project resolves

## [0.4.0](https://github.com/metreeca/rack/compare/v0.3.0...v0.4.0) - 2026-10-14

### Added

- `symlinks` plugin sharing the `peerDependencies` of linked packages with the project, so the project and its linked
  packages load a single copy of each peer, such as Preact, without a hand-kept `resolve.dedupe` list

### Fixed

- `cp`, `ln` and `rm` commands kept executable when a linked Rack checkout is rebuilt, so the npm scripts of linked
  consumers no longer fall through to the system commands with the same name after `npm run build` in the checkout

## [0.3.0](https://github.com/metreeca/rack/compare/v0.2.0...v0.3.0) - 2026-10-14

### Added

- `cp`, `ln` and `rm` exported as functions from `@metreeca/rack/tool`, so build scripts can run the tools in process
  and handle their failures as thrown errors rather than as error messages and non-zero process exit statuses

### Changed

- `vite` peer dependency made optional, so projects using only the command line tools no longer have to install Vite;
  a project that does install it still needs Vite 8, which the `symlinks` plugin from `@metreeca/rack/vite` targets

## [0.2.0](https://github.com/metreeca/rack/compare/v0.1.0...v0.2.0) - 2026-10-14

### Added

- `symlinks` Vite plugin resolving imports of packages linked into `node_modules` to their TypeScript source, so tests
  run against the working tree of workspace members and sibling checkouts with no prior build
- `@metreeca/rack/tool` module for Unix-like command line tools behaving the same in npm scripts on every platform
  and listing the paths they act on, so that the script log shows what each command changed on disk
- `cp` command copying the files matched by glob patterns into a directory, keeping their relative layout
- `ln` command linking the local checkouts of dependencies into `node_modules`, along with the packages they depend
  on in turn, so the dependencies of a package or monorepo resolve to their working trees
- `rm` command removing the files and directories matched by glob patterns, with their content

### Changed

- Package scope widened from tooling for @metreeca packages to everyday tooling for npm package development

### Removed

- `@metreeca/rack` root entry point, which exported nothing: each tool is imported from the subpath of the toolchain
  it extends, such as `@metreeca/rack/vite`, so code importing the bare package name has to switch to that subpath

## [0.1.0](https://github.com/metreeca/rack/releases/tag/v0.1.0) - 2026-10-14

Initial release, establishing the package as the single maintained home for the build, test and documentation
tooling shared across @metreeca packages, with tools grouped by the toolchain they extend:

- `@metreeca/rack/vite` module for Vite plugins used to build and test @metreeca packages
