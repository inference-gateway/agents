# AGENTS.md

This repo is the source list and build pipeline for the Inference Gateway
agents catalog — the data behind https://registry.inference-gateway.com. It
contains **no agent implementations**. Each agent's ADL `agent.yaml` lives in
its own GitHub repo and is the source of truth; requests like "add a tool to
agent X" or "fix agent X's prompt" belong in that upstream repo. The only
agent-facing change made here is editing `agents.yaml`.

## Pipeline

`agents.yaml` → `scripts/build-catalog.mjs` → `catalog.json`.

- `agents.yaml` — the only file humans edit. Entries are `{ url, ref }`
  pointing at public GitHub repos that ship an `agent.yaml` at their root.
- `scripts/build-catalog.mjs` — resolves each ref (the `latest` sentinel via
  the GitHub releases/tags API; explicit refs are used verbatim), fetches `agent.yaml` from raw.githubusercontent.com, validates via Ajv
  against the ADL JSON Schema, rejects duplicate `metadata.name`, sorts by
  name, and writes `catalog.json`. Any failure aborts the write — the catalog
  is all-or-nothing. Each agent doc gets a non-schema
  `_source: { url, ref, fetchedAt }` block (`ref` is the resolved ref). Unit
  checks live in `scripts/build-catalog.test.mjs`.
- `catalog.json` — generated and committed. Never hand-edit; regenerate with
  `npm run build` and review the diff.

## Commands

```bash
npm ci                 # install deps (Node ^24.15.0)
npm test               # node:test unit checks for the build script
npm run build          # fetch + validate + write catalog.json (needs network)
npm run format         # prettier on **/*.md (write)
npm run format:check   # prettier check on **/*.md (what CI runs)
task lint              # markdownlint on **/*.md
task lint:fix          # markdownlint with --fix
```

Run the full set before any PR: `npm test`, `npm run build`, `task lint`,
`npm run format:check`.

## Conventions

- JavaScript is ESM (`"type": "module"`): two-space indent, single quotes,
  semicolons — match `scripts/build-catalog.mjs`. Keep script changes
  all-or-nothing: validation failures must abort catalog writes.
- `ref` semantics: omitted or `latest` tracks the newest GitHub **release**;
  it falls back to the newest tag only when the repo has no releases at all,
  so a tag pushed without a release never enters the catalog. Pin third-party
  agents you don't control to an explicit tag or SHA.
- Markdown is gated by prettier and markdownlint — after editing docs run
  `task lint:fix` and `npm run format`.

### Code Readability

- Write self-explanatory code: clear names and small, single-purpose functions carry the intent.
  If a block needs a comment to be understood, extract it into a well-named function or variable.
- No inline comments inside function bodies.
- Doc comments on functions and types are at most 5 lines: what it does and why, not how.
- No comments above modules, packages, or files.
- Tool directives are not comments and stay where the tool needs them (lint suppressions, build
  tags, compiler pragmas, code generation markers).

## CI & gotchas

- `ci.yml` (PRs + pushes to main): markdownlint + prettier `--check`. Both
  must pass.
- `build-catalog.yml`: rebuilds `catalog.json` on pushes to `agents.yaml`, the
  build script, package files, or the workflow itself, and on manual dispatch, then opens/updates
  an automated rebuild PR. **No cron** — upstream `agent.yaml` bumps don't
  roll in on their own; dispatch the workflow to refresh.
- `npm run build` hits the GitHub API (60 req/hr tokenless; set `GITHUB_TOKEN`
  to lift to 5000/hr) and jsdelivr for the schema. Validate against a fork
  with `ADL_SCHEMA_URL=https://.../schema.json npm run build`.
- Consumers pull `catalog.json` via jsdelivr `@main`, whose cache window is up
  to ~12h — a merged change isn't instantly live.
- Conventional Commits (e.g. `feat: Add grafana and mock agent`,
  `chore(catalog): rebuild catalog.json [skip ci]`). PRs should describe the
  catalog change, link the upstream repo or issue, note whether `catalog.json`
  was regenerated, and list the validation commands run.