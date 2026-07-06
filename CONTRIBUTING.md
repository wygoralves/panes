# Contributing to Panes

Thanks for contributing to Panes.

Panes is a local-first desktop cockpit for AI-assisted coding. The project accepts external contributions, but merges stay maintainer-reviewed. Please assume that every change lands through a pull request and a final maintainer check.

## Before you start

- Open an issue first for large features, broad UX changes, or architectural refactors.
- Small bug fixes, docs updates, and focused improvements can go straight to a pull request.
- Keep changes scoped. Large mixed PRs are hard to review and slow down merge decisions.

## Development setup

Prerequisites:

- Rust stable
- Node.js 20+
- pnpm 9+
- Tauri v2 host prerequisites
- `codex` on `PATH` if you want to exercise the Codex engine locally

Install and run:

```bash
pnpm install
pnpm tauri:dev
```

Useful checks:

```bash
pnpm typecheck
pnpm test
pnpm build

cd src-tauri
cargo fmt -- --check
cargo check
```

## Pull request access

This repository currently has GitHub's pull request creation policy set to `collaborators_only`. That means only accounts with collaborator access can open a pull request directly against this repo, even though anyone can fork it and push a branch.

If you are not a collaborator, the working path today is:

1. Fork the repo and push your change to a branch on your fork.
2. Open an issue describing the change, linking your fork and branch (a compare URL such as `https://github.com/<you>/panes/compare/master...<you>:panes:<branch>` works well).
3. A maintainer reviews the diff from the issue, then either pulls the branch in directly or grants access so you can open the PR yourself.

This is a temporary restriction while the project has one maintainer doing review, not a rejection of outside contributions. The policy may open up to all forks later; until then, route proposed changes through an issue first.

### Translation contributions

Localized READMEs follow the `README.<locale>.md` convention already used for `README.pt-BR.md`. A Chinese translation would live at `README.zh-CN.md` at the repo root, linked from the language line at the top of `README.md` alongside the existing English and Portuguese links. Propose translations through the same fork-and-issue path described above.

## Contribution rules

- Send changes through a branch in your fork. If you already have collaborator access, open a pull request against `master` directly; otherwise see [Pull request access](#pull-request-access) above.
- Keep one PR focused on one problem.
- Update docs when behavior, setup, or workflow changes.
- If you add or change user-facing copy, update both locale resource sets under `src/i18n/resources/en/` and `src/i18n/resources/pt-BR/`.
- Reuse the existing IPC/store patterns instead of introducing ad hoc flows.
- Prefer active runtime paths over legacy or placeholder code paths.

## Pull request expectations

- Explain the problem and the chosen fix clearly.
- Include screenshots or a short recording for visible UI changes.
- Call out tradeoffs, follow-ups, or known gaps.
- List the checks you ran locally.
- Mark skipped validation explicitly instead of leaving reviewers to guess.

## Review and merge policy

- The maintainer is the final reviewer for merges.
- `CODEOWNERS` routes repository-wide review requests to the maintainer.
- GitHub branch protection/rulesets should require pull requests, passing checks, and resolved conversations before merge.
- External approvals are welcome as feedback, but merge authority stays with the maintainer unless explicit write access is granted.

## What tends to slow reviews down

- Unrelated refactors bundled with a bug fix
- Missing screenshots for UI changes
- New strings without i18n updates
- PRs that do not say which checks were run
- Changes that bypass existing shared primitives without a strong reason

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
