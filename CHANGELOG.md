# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0](https://github.com/metreeca/rack/compare/v0.1.0...HEAD)

### Added

- `symlinks` Vite plugin resolving imports of packages linked into `node_modules` to their TypeScript source, so tests
  run against the working tree of workspace members and sibling checkouts with no prior build
- `@metreeca/rack/tool` module for Unix-like command line tools behaving the same in npm scripts on every platform
- `cp` command copying the files matched by glob patterns into a directory, keeping their relative layout

### Changed

- Package scope widened from tooling for @metreeca packages to everyday tooling for npm package development

### Removed

- `@metreeca/rack` root entry point, which exported nothing: each tool is imported from the subpath of the toolchain
  it extends, such as `@metreeca/rack/vite`, so code importing the bare package name has to switch to that subpath

## [0.1.0](https://github.com/metreeca/rack/releases/tag/v0.1.0) - 2026-10-14

Initial release, establishing the package as the single maintained home for the build, test and documentation
tooling shared across @metreeca packages, with tools grouped by the toolchain they extend:

- `@metreeca/rack/vite` module for Vite plugins used to build and test @metreeca packages
