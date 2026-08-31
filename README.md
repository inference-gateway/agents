# Agents Catalog

Source list for the agents shown on
[registry.inference-gateway.com](https://registry.inference-gateway.com).

This repo doesn't store agent definitions itself — each agent's
[ADL](https://github.com/inference-gateway/adl) `agent.yaml` lives in its own GitHub repo and is
the source of truth. This repo just lists which agents to include in the catalog. A build job
pulls each `agent.yaml`, validates it against the ADL JSON Schema, and bundles everything into a
single `catalog.json` served via jsdelivr.

## Layout

```text
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
     # ref omitted → tracks the newest GitHub release (falls back to the newest
     # tag if the repo has none). Set `ref: v1.2.3` to pin an agent you don't control.
   ```

3. On merge, CI rebuilds `catalog.json` and opens a follow-up PR with the result. Once that
   merges, the live registry picks it up within the jsdelivr `@main` cache window (up to ~12h).

Third-party agents are welcome — the `url` does not have to live under `inference-gateway`.

## Catalog endpoint

```text
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
      "_source": {
        "url": "https://github.com/...",
        "ref": "v1.2.3",
        "fetchedAt": "..."
      }
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
2. Resolves each entry's `ref` (the `latest` default → newest GitHub release, else
   newest tag) and fetches `agent.yaml` from `raw.githubusercontent.com/<owner>/<repo>/<ref>/agent.yaml`.
3. Validates against the ADL JSON Schema (`adl/schema/v1/schema.json`) via Ajv.
4. Rejects duplicate `metadata.name` collisions.
5. Sorts by `metadata.name` and writes `catalog.json`.

Override the ADL schema location with `ADL_SCHEMA_URL=...` if needed (for testing against a fork).

## When the catalog rebuilds

The workflow runs on `push` to `main` touching `agents.yaml` / the build script / package files,
and on manual `workflow_dispatch`. There is no cron, so an upstream `agent.yaml` version bump
does not roll into the catalog on its own - trigger the workflow manually (or push a change
here) to pick it up.
