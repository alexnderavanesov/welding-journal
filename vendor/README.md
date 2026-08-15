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
- SHA-256: `23fbc38044858caada89b0c764d8a1852c343558fd907a6bfa3d4330f8c57780`
- Purpose: reject malformed HEIF, ICNS, and JXL entries whose zero or invalid
  sizes otherwise allow parser loops to stop making progress.

The upstream project has not published a fixed package yet. Keep this build only
until an official release containing fixes for GHSA-w3rx-r6r6-pgpr and
GHSA-5p2g-fcmc-qvqq is available. Regression tests import this package directly
to verify that malformed image metadata is rejected safely.
