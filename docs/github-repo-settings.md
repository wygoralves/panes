# GitHub repository settings for controlled contributions

This repository accepts external pull requests, but merge control stays with the maintainer. The settings below assume the current default branch is `master` and the main validation workflow is `.github/workflows/ci.yml`.

## Goals

- Allow anyone to contribute through forks and pull requests
- Keep merge authority with the maintainer
- Require CI to pass before merge
- Avoid accidental direct pushes to the default branch

## Repository access model

- Keep the repository public if you want open contributions.
- Do not grant `write` access unless you trust the person to merge without your final review.
- Contributors should open pull requests from forks by default.

## Pull request review settings

Open `Settings > Pull Requests` and enable:

- Require approvals before merging if you later add more maintainers with write access
- Dismiss stale pull request approvals when new commits are pushed
- Require approval of the most recent reviewable push
- Require conversation resolution before merging

Open `Settings > Moderation options > Code review limits` and enable:

- Limit approvals to users with read or higher access

This prevents random drive-by approvals from counting as repository review authority.

## Branch protection / ruleset

Open `Settings > Rules > Rulesets` and create a branch ruleset for `master`.

Recommended rules:

- Restrict deletions
- Block force pushes
- Require a pull request before merging
- Require status checks to pass before merging
- Require branches to be up to date before merging
- Require conversation resolution before merging
- Require linear history if you want a cleaner history

Status checks to require from the current CI workflow:

- `frontend`
- `rust`

## CODEOWNERS

The repository includes `.github/CODEOWNERS` with the maintainer as the default owner. In the ruleset, enable:

- Require review from Code Owners

This keeps review routing explicit and makes the maintainer the expected approval path for repository changes.

## Recommended merge strategy

Suggested defaults in `Settings > General`:

- Allow squash merging
- Disable merge commits if you want a tighter history
- Disable rebase merging unless you specifically want contributors to preserve commit series
- Automatically delete head branches after merge

For a small maintainer-led project, squash merge is usually the cleanest default.

## Important note on required approvals

If you are the only person with merge authority, requiring `1 approval` on every PR can get in your way because GitHub does not let the pull request author approve their own pull request.

Practical recommendation:

- If you are the only maintainer, require pull requests plus passing checks and resolved conversations.
- Add required approving reviews only after you introduce at least one additional trusted maintainer with `write` access.

## Releases

The current CI workflow publishes releases on pushes to `main` and `master`, but the active branch in this repository is `master`.

Before changing the release workflow:

- Protect `master` first
- Only remove `main` from the workflow after you intentionally standardize on one default branch

## Suggested maintainer routine

1. Review the PR description and validation notes.
2. Confirm CI passed for `frontend` and `rust`.
3. Review screenshots for visible UI changes.
4. Check i18n coverage when user-facing copy changed.
5. Merge with squash after conversations are resolved.
