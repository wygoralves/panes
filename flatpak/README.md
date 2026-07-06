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
flatpak-builder --user --install --force-clean \
  --install-deps-from=flathub \
  build-flatpak com.panes.app.yml
flatpak run com.panes.app
```

`--install-deps-from=flathub` installs `org.gnome.Platform//50`,
`org.gnome.Sdk//50`, and whatever branch of the `node20` and `rust-stable`
SDK extensions that SDK version actually requires, resolved by
flatpak-builder itself rather than a hand-picked branch in this README. An
earlier draft of this file hardcoded `org.freedesktop.Sdk.Extension.node20//24.08`,
which was a guess, not a verified pairing for GNOME 50; letting
flatpak-builder resolve it avoids shipping a wrong pin.

The manifest allows network access during the build (`--share=network` in
`build-options.build-args`) so `pnpm`, `cargo`, and the bundled `mise`
runtime can fetch dependencies. This is normal for a local build and is not
part of the app's runtime sandbox.

Runtime version note: `org.gnome.Platform//50` was verified against
[GNOME's own release notes](https://release.gnome.org/50/) (GNOME 50 shipped
2026-03-18) and its [Flathub listing](https://flathub.org/apps/org.gnome.Platform)
as of this writing. GNOME 49 (the previous line) remains supported until
roughly September 2026, so it would not have been wrong to stay on it, but
50 is the current line and there was no reason to ship one cycle behind.
Re-check both facts against Flathub before relying on this note long after
it was written, since runtime support windows move.

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

### Known gap: chat attachment drag-and-drop bypasses the portal

Dropping a file onto the chat composer (`ChatPanel.tsx`'s
`onDragDropEvent` handler, which calls `appendAttachmentsFromPaths` with
whatever `event.payload.paths` the native window drag-and-drop event
reports) receives real host filesystem paths directly from the window
system, not through `xdg-desktop-portal`. Outside a sandbox this is fine;
inside this Flatpak sandbox, a path handed over this way was never granted
by the portal and will not be readable, so dropped files will silently fail
to attach.

This has not been fixed in this PR. The attach button in the chat composer
(`ChatPanel.tsx`, the `@tauri-apps/plugin-dialog` based attach flow) is
portal-safe and gives users a working alternative, so this is a rough edge
rather than a broken feature, but it should be fixed properly rather than
left as a silent failure: either detect the sandbox and show a message
explaining that drag-and-drop attachments do not work there, or find a way
to route dropped paths through the portal. Doing either requires exposing
`runtime_env::is_flatpak()` to the frontend, which no existing IPC command
currently does; that is a small, separate follow-up rather than something to
bolt onto this PR's harness-install and workspace-path changes.

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
- The `org.gnome.Platform//50` runtime is still current on Flathub at build
  time; verify with `flatpak remote-info` and bump if a newer runtime has
  since become the recommended baseline (see the runtime version note under
  "Building locally").
- The document-portal folder grant actually persists correctly across
  Panes restarts, and that terminal sessions can read/write the full
  directory tree under the granted folder, not just files explicitly
  touched through the portal.
- Whether the curl-pipe harness installers (Kiro, Factory Droid) work at
  all inside the sandbox.
- The Codex auth issue above.
- The chat attachment drag-and-drop gap above.
- Terminal PTY behavior, clipboard, and tray icon integration inside the
  sandbox, which the original issue thread flagged as rough even before the
  mise/permissions changes in this PR.
- `flatpak/com.panes.app.desktop` does not set `StartupWMClass`. Panes'
  AppImage desktop-entry generator (`src-tauri/src/linux_appimage.rs`)
  deliberately omits it too, and its test suite asserts that omission, which
  reads as a signal that the runtime `WM_CLASS` Tauri/wry sets on Linux does
  not actually match `Panes`; setting it to a wrong value would break
  taskbar/dock window matching worse than leaving it unset. This was not
  independently reverified on real hardware for this PR, it was matched to
  the existing precedent. If a future change verifies the actual `WM_CLASS`
  Panes' window reports on Linux, add `StartupWMClass` back with the
  correct value in both places.
- `flatpak/com.panes.app.metainfo.xml`'s `<releases>` block has a single
  hardcoded entry (currently `0.59.1`) with no wiring into
  `scripts/generate-update-manifest.mjs` or the release workflow. It needs
  to be bumped by hand on every release until (or unless) someone wires it
  into the existing release automation.
