# Vendored dependencies

## SheetJS Community Edition

- File: `xlsx-0.20.3.tgz`
- Version: `0.20.3`
- Official source: `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`
- SHA-256: `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`
- MD5 published by SheetJS: `aac39517149362ea8123d8a303486c3c`

The package is vendored so production installs do not depend on the availability
of the SheetJS CDN. Verify both the version and checksum before replacing it.

## image-size security build

- File: `image-size-2.0.3-security.0.tgz`
- Based on: official `image-size@2.0.2` package
- Local version: `2.0.3-security.0`
- SHA-256: `24244fadfbc71a3130cbf7aa65962d787f04454f6bb1215049a4dbc59c12a20d`
- Purpose: reject malformed HEIF, ICNS, and JXL entries whose zero or invalid
  sizes otherwise allow parser loops to stop making progress.

The upstream project has not published a fixed package yet. Keep this build only
until an official release containing fixes for GHSA-w3rx-r6r6-pgpr and
GHSA-5p2g-fcmc-qvqq is available. Regression tests import this package directly
to verify that malformed image metadata is rejected safely.

## braces local stack-depth mitigation

- File: `braces-3.0.4-security.0.tgz`
- Based on official `braces@3.0.3`; this is **not an upstream release**.
- SHA-256: `7ed1737f05e7c6ba3b3fdecfa8ca4fd6d99b93fa668b4d90c76b3d1af9da82bf`
- Advisory: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
- The parser checks the combined brace/parenthesis stack; compile, expand and
  stringify independently check recursive AST depth. The fixed ceiling is 256;
  excess depth raises a bounded SyntaxError before native stack exhaustion.
  The AST checks also cover direct caller-supplied trees, not only parsed strings.
- The only source changes are these guards (`lib/depth-limit.js` and calls in
  the four parser/walker files) and the local package version. MIT license retained.
- Regression: `src/lib/braces-security.test.ts`. Dependency override covers all
  transitive development consumers. No advisory ignore was added. Replace this
  temporary local mitigation when an official reviewed fix becomes available.
