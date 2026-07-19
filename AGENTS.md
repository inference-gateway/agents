# Repository Guidelines

## Project Structure & Module Organization

This repository is the source list and build pipeline for the Inference Gateway agents catalog. It does not contain agent implementations.

- `agents.yaml` is the main contributor-edited file. Add, remove, or repin public GitHub repos here.
- `scripts/build-catalog.mjs` fetches each upstream `agent.yaml`, validates it against the ADL schema, and writes the catalog.
- `catalog.json` is generated and committed for registry consumers. Do not hand-edit it.
- `.github/workflows/ci.yml` checks Markdown linting and formatting. `.github/workflows/build-catalog.yml` rebuilds `catalog.json` on relevant pushes and daily cron.
- `README.md` and `CLAUDE.md` document catalog behavior and maintainer workflow.

## Build, Test, and Development Commands

- `npm install` or `npm ci`: install dependencies. Use Node `^24.15.0`.
- `npm run build`: aggregate upstream agent manifests and rewrite `catalog.json`. This requires network access to GitHub and the ADL schema URL.
- `ADL_SCHEMA_URL=https://... npm run build`: validate against a custom schema, useful for schema fork testing.
- `npm run format`: run Prettier on Markdown files.
- `npm run format:check`: verify Markdown formatting without writing changes.
- `task lint`: run `markdownlint` for Markdown files.
- `task lint:fix`: auto-fix Markdown lint issues where possible.

## Coding Style & Naming Conventions

JavaScript uses ESM (`"type": "module"`), two-space indentation, single quotes, and semicolons as shown in `scripts/build-catalog.mjs`. Keep script changes small and all-or-nothing: validation failures should abort catalog writes. In YAML, use two-space indentation and entries shaped like:

```yaml
- url: https://github.com/some-org/cool-agent
  ref: v1.2.3
```

Omitting `ref` tracks the agent's newest GitHub release (falling back to the newest tag only if it has none). Pin third-party agents to a tag or SHA when practical.

## Testing Guidelines

`npm test` runs the `node:test` unit checks for the build script (currently the ref/semver resolution logic). Treat `npm test`, `npm run build`, `task lint`, and `npm run format:check` as the required validation set. After changing `agents.yaml` or the build script, run `npm run build` and review the generated `catalog.json` diff for expected source, version, and sorting changes.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commits such as `feat: Add grafana and mock agent`, `refactor(ci): ...`, and `chore(catalog): Rebuild catalog.json [skip ci]`. Follow that pattern. PRs should describe the catalog change, link the upstream agent repo or issue, note whether `catalog.json` was regenerated, and include validation commands run locally.

