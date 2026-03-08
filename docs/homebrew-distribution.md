# Homebrew Distribution

Panes publishes its macOS Homebrew cask through a separate tap repository:

- Tap repo: `wygoralves/homebrew-tap`
- Published file: `Casks/panes.rb`
- Source of truth for metadata: the GitHub Release created by the main CI workflow

## Required setup

Before the `Publish Homebrew Cask` job can succeed, ensure:

1. The `wygoralves/homebrew-tap` repository exists.
2. The repository has a `main` branch.
3. The main Panes repo has a `HOMEBREW_TAP_TOKEN` secret with write access to the tap repository.

If the secret is absent, the Homebrew publish job is skipped and the main app release still completes.

## Release flow

After the main release workflow uploads the macOS bundle assets, it:

1. Checks out the released tag from the Panes repo.
2. Checks out the tap repository into a sibling working directory.
3. Runs `node scripts/generate-homebrew-cask.mjs <tag> --output homebrew-tap/Casks/panes.rb`.
4. Commits and pushes the cask update to the tap repository if the rendered file changed.

The cask generator expects exactly one macOS `.dmg` asset in the release. If none or multiple DMGs are present, the job fails instead of publishing an ambiguous cask.
