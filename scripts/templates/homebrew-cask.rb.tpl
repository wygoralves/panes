cask "panes" do
  version "__VERSION__"
  sha256 "__SHA256__"

  url "__URL__"
  name "Panes"
  desc "Local-first cockpit for AI-assisted coding"
  homepage "https://github.com/wygoralves/panes"

  auto_updates true
  depends_on macos: :ventura

  app "Panes.app"

  postflight do
    # Best-effort friction reduction for unsigned / unnotarized builds.
    system_command "/usr/bin/xattr",
      args: ["-dr", "com.apple.quarantine", "#{appdir}/Panes.app"]
  end

  zap launchctl: "com.panes.app.helper.keepawake",
      trash:     [
        "~/.agent-workspace",
      ]
end
