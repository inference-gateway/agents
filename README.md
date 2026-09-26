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
   With `ref` omitted (or set to `latest`) the build does **not** read the default branch: it
   resolves the newest GitHub release tag and fetches
   `raw.githubusercontent.com/<owner>/<repo>/<resolved-tag>/agent.yaml`, so `agent.yaml` must
   already be present in that release - a copy committed to `main` after the last release is a 404.
   The repo also needs at least one GitHub release or git tag, otherwise the build fails with
   `'latest' requested but the repo has no releases or tags`. If neither holds, set an explicit
   `ref` (branch, tag, or commit SHA, as documented in the `agents.yaml` header).
2. Open a PR appending one entry to `agents.yaml`:

   ```yaml
   - url: https://github.com/some-org/cool-agent
     # ref omitted → tracks the newest GitHub release (falls back to the newest
     # tag if the repo has none). Set `ref: v1.2.3` to pin an agent you don't control.
   ```

3. On merge, CI rebuilds `catalog.json` and opens a follow-up PR with the result. Once that
   merges, the live registry picks it up within the jsdelivr `@main` cache window (up to ~12h).

   The build is all-or-nothing: **any** failing entry (fetch error such as a 404, YAML parse
   error, ADL validation failure, duplicate `metadata.name`) makes the script exit non-zero with
   `N agent(s) failed to aggregate; aborting catalog write` and write no `catalog.json` - so no
   follow-up PR is opened, for any agent, until that entry is fixed.

Third-party agents are welcome — the `url` does not have to live under `inference-gateway`.

## Catalog endpoint

```text
https://cdn.jsdelivr.net/gh/inference-gateway/agents@main/catalog.json
```

Shape:

```json
{
  "version": 1,
  "updated": "2026-05-25T00:00:00.000Z",
  "agents": [
    {
      "apiVersion": "adl.inference-gateway.com/v1",
      "kind": "Agent",
      "metadata": { "name": "...", "description": "...", "version": "..." },
      "spec": { "...": "..." },
      "_source": {
        "url": "https://github.com/...",
        "ref": "v1.2.3",
        "fetchedAt": "2026-05-25T00:00:00.000Z"
      }
    }
  ]
}
```

Each agent doc is a pure ADL manifest plus a non-schema `_source` block recording where the
aggregator pulled it from.

Both timestamps are `Date.toISOString()` values (e.g. `2026-05-25T00:00:00.000Z`), and neither
is simply "the time of the last build":

- `updated` is the time of the last build that actually changed catalog content. A rebuild that
  finds no upstream change leaves it as is.
- `_source.fetchedAt` is carried forward for an entry whose content is unchanged, so it marks
  when that entry's current content first entered the catalog - not the most recent fetch of it.

## Local build

```bash
npm install
npm run build      # writes catalog.json, but only when its content changed
```

When nothing changed, the script logs
`Catalog unchanged; leaving <path>/catalog.json untouched` and exits 0 without writing - so
running it twice in a row leaves the file untouched the second time.

The build script:

1. Reads `agents.yaml`.
2. Resolves each entry's `ref` (the `latest` default → newest GitHub release, else
   newest tag) and fetches `agent.yaml` from `raw.githubusercontent.com/<owner>/<repo>/<ref>/agent.yaml`.
3. Validates against the ADL JSON Schema (`adl/schema/v1/schema.json`) via Ajv.
4. Rejects duplicate `metadata.name` collisions.
5. Sorts by `metadata.name`, then compares the result against the previous `catalog.json`
   ignoring timestamps (`carryTimestamps` / `withoutTimestamps`) and writes the file only if an
   entry was added, removed, or changed. A run where only the timestamps would move skips the
   write entirely.

Failures are collected per entry, but they are not skipped: if any entry fails at steps 2-4, the
script throws `N agent(s) failed to aggregate; aborting catalog write` and exits non-zero without
touching `catalog.json`. The catalog is all-or-nothing.

Override the ADL schema location with `ADL_SCHEMA_URL=...` if needed (for testing against a fork).

## When the catalog rebuilds

The workflow runs on `push` to `main` touching `agents.yaml` / the build script / package files,
and on manual `workflow_dispatch`. There is no cron, so an upstream `agent.yaml` version bump
does not roll into the catalog on its own - trigger the workflow manually (or push a change
here) to pick it up.

A run that finds no upstream change leaves `catalog.json` untouched, so no `catalog/update` PR is
opened - a dispatch with no resulting PR means there was nothing new to pull in.
