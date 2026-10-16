---
name: Bundled API runtime paths
description: How to resolve project assets and child-process scripts from the bundled API server.
---

The API server bundles its TypeScript routes into one `dist/index.mjs`. A route's `import.meta.url` therefore points at that bundle, not the original `src/routes` directory. Resolve runtime scripts and data from a verified project root rather than assuming a fixed number of parent directories from the module URL.

**Why:** A Python astronomy subprocess could not start when its path was derived from the route URL after bundling.

**How to apply:** When an API route needs a local script or data file, check candidate roots from the process working directory and bundle directory against a stable project file, then build absolute paths from the root that exists.
