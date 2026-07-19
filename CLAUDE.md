# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is (and isn't)

This is the **aggregator/catalog** for agents shown on
[registry.inference-gateway.com](https://registry.inference-gateway.com). It does **not** contain
agent definitions. Each agent's ADL `agent.yaml` lives in its own GitHub repo (the source of
truth); this repo just lists which repos to include and bundles their manifests into
`catalog.json`.

Implication: requests like "add a tool to agent X" or "fix a bug in agent X's prompt" belong in
that agent's upstream repo, not here. The only agent-facing change you make here is editing
`agents.yaml` to add/remove/repin an entry.

## Commands

```bash
npm install              # install deps (requires Node ^24.15.0)
npm run build            # fetch each agent.yaml, validate, write catalog.json
npm run format           # prettier on **/*.md (write)
npm run format:check     # prettier on **/*.md (check, used by CI)

task lint                # markdownlint on **/*.md
task lint:fix            # markdownlint with --fix
```

`npm run build` hits the network (raw.githubusercontent.com for each agent + jsdelivr for the
ADL schema). To validate against a non-default schema (e.g. a local ADL fork):

```bash
ADL_SCHEMA_URL=https://.../schema.json npm run build
```

## Architecture

The pipeline is `agents.yaml` → `scripts/build-catalog.mjs` → `catalog.json`.

- **`agents.yaml`** — the only file humans edit. List of `{ url, ref }` entries pointing at
  public GitHub repos that ship `agent.yaml` at their root. `ref` defaults to `latest`, which
  resolves to the newest GitHub **release** tag (and only falls back to the newest git tag if
  the repo has cut no releases at all, so a tag pushed without a release (e.g. a broken CD)
  never enters the catalog). Set an explicit tag/SHA to pin a third-party agent.
- **`scripts/build-catalog.mjs`** — for each entry: resolves the `ref` (the `latest` sentinel
  via the GitHub releases/tags API; explicit refs are used verbatim), fetches `agent.yaml` from
  `raw.githubusercontent.com/<owner>/<repo>/<ref>/agent.yaml`, validates against the ADL JSON
  Schema via Ajv, rejects duplicate `metadata.name` collisions, sorts by name, and writes
  `catalog.json`. Any single failure aborts the whole write — the catalog is all-or-nothing.
  Each agent doc gets a non-schema `_source: { url, ref, fetchedAt }` block (`ref` is the
  **resolved** ref) appended before serialization. Set `GITHUB_TOKEN` to lift the API rate
  limit from 60/hr to 5000/hr; unset works for public repos.
- **`catalog.json`** — generated, committed, marked `linguist-generated=true` in
  `.gitattributes`. Never hand-edit; regenerate via `npm run build`.

## Distribution & cache window

Consumers pull from `https://cdn.jsdelivr.net/gh/inference-gateway/agents@main/catalog.json`.
jsdelivr's `@main` cache window is up to ~12h, so a merged change isn't instantly visible on
the live registry.

## CI

- **`ci.yml`** (PRs + push to main): markdownlint + prettier `--check`. Both must pass.
- **`build-catalog.yml`** (push to `agents.yaml`/script/workflow, daily cron `0 4 * * *` UTC,
  manual dispatch): rebuilds and auto-commits `catalog.json` via
  `stefanzweifel/git-auto-commit-action` with `[skip ci]`. The daily cron is what rolls
  upstream `agent.yaml` version bumps into the catalog without a PR.
