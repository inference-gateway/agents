# Agents Catalog

The source-of-truth catalog for agents listed on
[registry.inference-gateway.com](https://registry.inference-gateway.com).

The registry SPA fetches `catalog.json` from this repo at runtime via jsdelivr, so adding or
updating an agent here propagates to the live registry without redeploying the registry app.

## Layout

```
agents/<agent-id>/metadata.yaml   # source of truth, hand-edited
scripts/build-catalog.mjs         # generates catalog.json
catalog.json                      # generated, committed
.github/workflows/build-catalog.yml
```

## Adding an agent

1. Create `agents/<agent-id>/metadata.yaml` matching the schema below.
2. Open a PR. The CI workflow regenerates `catalog.json` automatically on merge to `main`.
3. The registry will pick up the new agent within the jsdelivr `@main` cache window
   (up to ~12h).

## Metadata schema

```yaml
id: unique-agent-id
name: Human-readable Agent Name
version: 1.0.0
description: Brief description of the agent's purpose
longDescription: |
  Optional multi-line description with features and capabilities.
image:
  repository: ghcr.io/inference-gateway/agent-name
  tag: 1.0.0
  size: 25.3MB
author:
  name: Author Name
  email: author@example.com
  url: https://github.com/author       # optional
license: Apache-2.0
homepage: https://github.com/org/agent
repository: https://github.com/org/agent
documentation: https://docs.example.com
categories:
  - category1
tags:
  - tag1
```

## Catalog endpoint

```
https://cdn.jsdelivr.net/gh/inference-gateway/agents@main/catalog.json
```

Shape:

```json
{
  "version": 1,
  "updated": "2026-05-25T00:00:00Z",
  "agents": [ { "id": "...", "name": "...", ... } ]
}
```

## Local build

```bash
npm install
npm run build      # writes catalog.json
```

The build script validates each `metadata.yaml` and exits non-zero on missing required fields,
so a malformed PR fails CI before a broken catalog can ship.
