import { useEffect, useMemo, useState } from "react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useGitStore } from "../../stores/gitStore";

export function GitPanel() {
  const { repos, activeRepoId } = useWorkspaceStore();
  const { status, diff, selectedFile, refresh, selectFile, stage, unstage, commit, error } = useGitStore();
  const [commitMessage, setCommitMessage] = useState("");

  const activeRepo = useMemo(
    () => repos.find((repo) => repo.id === activeRepoId) ?? repos[0],
    [repos, activeRepoId]
  );

  useEffect(() => {
    if (!activeRepo) {
      return;
    }
    void refresh(activeRepo.path);
  }, [activeRepo, refresh]);

  async function onCommit() {
    if (!activeRepo || !commitMessage.trim()) {
      return;
    }
    await commit(activeRepo.path, commitMessage.trim());
    setCommitMessage("");
  }

  return (
    <div style={{ height: "100%", display: "grid", gridTemplateRows: "auto 1fr auto", gap: 10, padding: 16 }}>
      <div>
        <h2 className="section-title">Git</h2>
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-soft)" }}>
          {activeRepo ? `${activeRepo.name} (${status?.branch ?? "..."})` : "No repo selected"}
        </p>
      </div>

      <div className="surface" style={{ overflow: "auto", padding: 10 }}>
        {status?.files.length ? (
          <div style={{ display: "grid", gap: 8 }}>
            {status.files.map((file) => (
              <div key={file.path} className="surface" style={{ padding: 8 }}>
                <p style={{ margin: 0, fontSize: 13 }}>{file.path}</p>
                <p style={{ margin: "3px 0", fontSize: 12, color: "var(--text-soft)" }}>
                  {file.status} {file.staged ? "(staged)" : ""}
                </p>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => activeRepo && void selectFile(activeRepo.path, file.path, file.staged)}
                  >
                    Diff
                  </button>
                  {file.staged ? (
                    <button type="button" onClick={() => activeRepo && void unstage(activeRepo.path, file.path)}>
                      Unstage
                    </button>
                  ) : (
                    <button type="button" onClick={() => activeRepo && void stage(activeRepo.path, file.path)}>
                      Stage
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ margin: 0, color: "var(--text-soft)", fontSize: 13 }}>Working tree clean.</p>
        )}
      </div>

      <div className="surface" style={{ padding: 10, display: "grid", gap: 8 }}>
        {selectedFile && (
          <div>
            <p style={{ margin: "0 0 4px", fontSize: 12, color: "var(--text-soft)" }}>{selectedFile}</p>
            <pre style={{ margin: 0, maxHeight: 160, overflow: "auto", whiteSpace: "pre-wrap" }}>
              {diff || "No diff available"}
            </pre>
          </div>
        )}
        <textarea
          rows={2}
          value={commitMessage}
          onChange={(event) => setCommitMessage(event.target.value)}
          placeholder="Commit message"
        />
        <button type="button" onClick={() => void onCommit()}>
          Commit
        </button>
        {error && <p style={{ margin: 0, fontSize: 12, color: "var(--danger)" }}>{error}</p>}
      </div>
    </div>
  );
}
