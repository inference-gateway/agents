# Agents Catalog

Source list for the agents shown on
[registry.inference-gateway.com](https://registry.inference-gateway.com).

This repo doesn't store agent definitions itself — each agent's
[ADL](https://github.com/inference-gateway/adl) `agent.yaml` lives in its own GitHub repo and is
the source of truth. This repo just lists which agents to include in the catalog. A scheduled
build job pulls each `agent.yaml`, validates it against the ADL JSON Schema, and bundles
everything into a single `catalog.json` served via jsdelivr.

## Layout

```
agents.yaml                 # the only file you edit — list of GitHub repos to include
scripts/build-catalog.mjs   # fetches + validates + bundles into catalog.json
catalog.json                # generated, committed; consumed by the registry SPA
.github/workflows/build-catalog.yml
```

## Adding an agent

1. Make sure the agent's repo has an ADL `agent.yaml` at its root
   (see [`inference-gateway/adl`](https://github.com/inference-gateway/adl) for the schema).
2. Open a PR appending one entry to `agents.yaml`:

   ```yaml
   - url: https://github.com/some-org/cool-agent
     ref: main # branch, tag, or SHA. Pin to a release tag if you can.
   ```

3. On merge, CI rebuilds `catalog.json`. The live registry picks it up within the jsdelivr
   `@main` cache window (up to ~12h).

Third-party agents are welcome — the `url` does not have to live under `inference-gateway`.

## Catalog endpoint

```
https://cdn.jsdelivr.net/gh/inference-gateway/agents@main/catalog.json
```

Shape:

```json
{
  "version": 1,
  "updated": "2026-05-25T00:00:00Z",
  "agents": [
    {
      "apiVersion": "adl.inference-gateway.com/v1",
      "kind": "Agent",
      "metadata": { "name": "...", "description": "...", "version": "..." },
      "spec": { "...": "..." },
      "_source": { "url": "https://github.com/...", "ref": "main", "fetchedAt": "..." }
    }
  ]
}
```

Each agent doc is a pure ADL manifest plus a non-schema `_source` block recording where the
aggregator pulled it from.

## Local build

```bash
npm install
npm run build      # writes catalog.json
```

The build script:

1. Reads `agents.yaml`.
2. Fetches `agent.yaml` from `raw.githubusercontent.com/<owner>/<repo>/<ref>/agent.yaml` for each entry.
3. Validates against the ADL JSON Schema (`adl/schema/v1/schema.json`) via Ajv.
4. Rejects duplicate `metadata.name` collisions.
5. Sorts by `metadata.name` and writes `catalog.json`.

Override the ADL schema location with `ADL_SCHEMA_URL=...` if needed (for testing against a fork).

## Schedule

The workflow runs on `push` to `agents.yaml` / scripts / workflow, plus a daily cron
(`0 4 * * *` UTC) so upstream `agent.yaml` version bumps roll into the catalog without manual
intervention.
