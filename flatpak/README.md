# Flatpak packaging (experimental)

Status: this manifest builds Panes from source and installs it into a Flatpak
sandbox with no host filesystem access. It has been reviewed and written
against the current source tree, but has not been built or run on a real
Linux machine as part of this change (it was authored on macOS). Treat it as
a draft that needs a Linux verification pass before it is offered as a
distribution channel. See "What still needs verifying" below.

Credit: this manifest, the `mise` based tool install approach, and the
document-portal path fix in `src-tauri/src/path_utils.rs` are based on the
work contributor jgillich shared on
[jgillich/panes@flatpak](https://github.com/jgillich/panes/tree/flatpak) in
response to issue #8. It has been rebased onto the current source tree
(the original branch was cut against v0.33) and adjusted to use the
project's own `pnpm run build:desktop` script instead of a hand rolled build
step, but the design decisions (runtime, sandboxing model, mise) are his.

## Building locally

```sh
flatpak install flathub org.gnome.Platform//49 org.gnome.Sdk//49
flatpak install flathub org.freedesktop.Sdk.Extension.node20//24.08 org.freedesktop.Sdk.Extension.rust-stable//24.08
flatpak-builder --user --install --force-clean build-flatpak com.panes.app.yml
flatpak run com.panes.app
```

The manifest allows network access during the build (`--share=network` in
`build-options.build-args`) so `pnpm`, `cargo`, and the bundled `mise`
runtime can fetch dependencies. This is normal for a local build and is not
part of the app's runtime sandbox.

## Sandboxing model: no host filesystem access

Panes is a tool that runs arbitrary agent-driven commands against a user's
repositories, which is exactly the case Flatpak's sandboxing is meant to
help with. This manifest does not request `--filesystem=host` or
`--filesystem=home`. Instead:

- Workspace folders are opened exclusively through
  `@tauri-apps/plugin-dialog`, which on Linux is backed by the
  `xdg-desktop-portal` FileChooser portal. Outside a sandbox this returns a
  real path; inside a Flatpak sandbox it returns a document-portal path
  under `/run/flatpak/doc/<id>/...`.
- `src-tauri/src/path_utils.rs` now leaves `/run/flatpak/doc/` paths
  untouched instead of canonicalizing them, because canonicalizing a portal
  path can resolve it away from the bind mount the portal set up. Without
  this, `db/workspaces.rs` would store a path that stops resolving once the
  portal session ends.
- Everything downstream (terminal `cwd`, git operations, the file editor)
  operates on whatever path was granted, portal or real, without further
  special casing.

Every other permission in `finish-args` is commented in the manifest with
why it is requested (display sockets, `--device=dri` for GPU accelerated
rendering, `--share=network` for git/agent traffic, the tray icon
talk-names, notifications, and `--socket=ssh-auth` for git-over-SSH).

## Installing agent CLIs inside the sandbox (mise)

Flatpak apps cannot see host-installed programs. Harness CLIs like `codex`,
`claude`, or `opencode` are normally installed with a global `npm install
-g`, but a Flatpak's `/app` is read-only at runtime, so that has nowhere to
write to.

The manifest bundles [mise](https://mise.jdx.dev/) (installed via `cargo
install --root /app mise`) as a user-mode tool manager. `flatpak/mise-env.sh`
is installed to `/app/etc/profile.d/` and sourced by `flatpak/panes-wrapper.sh`
before the app launches, so `mise`'s shim directory
(`~/.local/share/mise/shims`, already on Panes' search path via
`runtime_env::augmented_path_entries_for`) is present for every session.

On the backend, `src-tauri/src/commands/harness.rs`'s `check_harnesses` now
reports a `preferred_install_method` ("mise" or "npm") based on
`runtime_env::is_flatpak()` and whether `mise` is resolvable, and
`install_harness` runs `mise use -g npm:<package>` instead of `npm install -g
<package>` when that's the preferred method. The onboarding harness panel
mirrors this in its install-command display and its "install in terminal"
/ "copy command" actions.

This only affects harnesses whose install method is an npm package
(`codex`, `gemini-cli`, `opencode`, `kilo-code`). The curl-pipe installers
for Kiro and Factory Droid are unchanged and untested inside the sandbox;
whether their install scripts write somewhere usable inside `/app` or
`$HOME` has not been verified.

## Known open question: Codex auth inside the sandbox

jgillich reported `codex` returning 401 Unauthorized inside his Flatpak
build even with `~/.codex` mounted. This has not been reproduced or root
caused as part of this change (no Linux environment was available). Two
plausible causes, unverified:

- Codex's login flow may rely on a system keyring or a `xdg-desktop-portal`
  Secret Service interaction that this manifest does not grant
  (`org.freedesktop.secrets` is not in `finish-args`).
- Codex CLI may write its credential file to a path this sandbox's `$HOME`
  does not match if the mount inside the sandbox differs from the host's
  `~/.codex` in ownership or permissions.

This needs to be debugged on a real Flatpak install before the issue can be
considered resolved; the maintainer or jgillich are best placed to do that.

## What still needs verifying on Linux

- The manifest builds and `flatpak-builder` succeeds (untested here).
- The `org.gnome.Platform//49` runtime and matching SDK extensions are
  actually current on Flathub at build time; verify with `flatpak remote-info`
  and bump if a newer runtime has since become the recommended baseline.
- The document-portal folder grant actually persists correctly across
  Panes restarts, and that terminal sessions can read/write the full
  directory tree under the granted folder, not just files explicitly
  touched through the portal.
- Whether the curl-pipe harness installers (Kiro, Factory Droid) work at
  all inside the sandbox.
- The Codex auth issue above.
- Terminal PTY behavior, clipboard, and tray icon integration inside the
  sandbox, which the original issue thread flagged as rough even before the
  mise/permissions changes in this PR.
