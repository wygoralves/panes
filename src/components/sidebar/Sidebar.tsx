import { FolderGit2 } from "lucide-react";
import { useWorkspaceStore } from "../../stores/workspaceStore";

export function Sidebar() {
  const { workspaces, repos, activeRepoId, setActiveRepo } = useWorkspaceStore();

  return (
    <div style={{ padding: 16, height: "100%", overflow: "auto" }}>
      <h2 className="section-title">Workspaces</h2>
      <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
        {workspaces.length === 0 ? (
          <div className="surface" style={{ padding: 12, color: "var(--text-soft)", fontSize: 13 }}>
            Open a workspace from the command bar or onboarding flow.
          </div>
        ) : (
          workspaces.map((workspace) => (
            <div key={workspace.id} className="surface" style={{ padding: 10 }}>
              <p style={{ margin: 0, fontWeight: 600 }}>{workspace.name}</p>
              <p style={{ margin: "4px 0 0", color: "var(--text-soft)", fontSize: 12 }}>
                {workspace.rootPath}
              </p>
            </div>
          ))
        )}
      </div>

      <h2 className="section-title" style={{ marginTop: 18 }}>
        Repositories
      </h2>
      <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
        {repos.map((repo) => (
          <button
            key={repo.id}
            type="button"
            onClick={() => setActiveRepo(repo.id)}
            className="surface"
            style={{
              padding: "10px 12px",
              textAlign: "left",
              background: repo.id === activeRepoId ? "#243049" : undefined,
              color: "var(--text-main)",
              borderColor: repo.id === activeRepoId ? "var(--accent)" : undefined,
              cursor: "pointer"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <FolderGit2 size={14} />
              <span>{repo.name}</span>
            </div>
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-soft)" }}>{repo.path}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
