import { open } from "@tauri-apps/plugin-dialog";
import { FolderGit2, FolderOpen, MessageSquare } from "lucide-react";
import { useChatStore } from "../../stores/chatStore";
import { useThreadStore } from "../../stores/threadStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";

export function Sidebar() {
  const {
    workspaces,
    repos,
    activeRepoId,
    activeWorkspaceId,
    setActiveWorkspace,
    setActiveRepo,
    openWorkspace,
    error
  } = useWorkspaceStore();
  const { threads, activeThreadId, setActiveThread } = useThreadStore();
  const bindChatThread = useChatStore((state) => state.setActiveThread);

  async function onOpenFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) {
      return;
    }

    await openWorkspace(selected);
  }

  async function onSelectThread(threadId: string) {
    const selected = threads.find((item) => item.id === threadId);
    if (selected) {
      setActiveRepo(selected.repoId);
    }
    setActiveThread(threadId);
    await bindChatThread(threadId);
  }

  return (
    <div style={{ padding: 16, height: "100%", overflow: "auto" }}>
      <button
        type="button"
        className="surface"
        onClick={() => void onOpenFolder()}
        style={{
          width: "100%",
          marginBottom: 14,
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          cursor: "pointer"
        }}
      >
        <FolderOpen size={16} />
        Open Folder
      </button>

      <h2 className="section-title">Workspaces</h2>
      <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
        {workspaces.length === 0 ? (
          <div className="surface" style={{ padding: 12, color: "var(--text-soft)", fontSize: 13 }}>
            No workspace opened.
          </div>
        ) : (
          workspaces.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              onClick={() => void setActiveWorkspace(workspace.id)}
              className="surface"
              style={{
                padding: 10,
                textAlign: "left",
                background: workspace.id === activeWorkspaceId ? "#243049" : undefined,
                borderColor: workspace.id === activeWorkspaceId ? "var(--accent)" : undefined,
                cursor: "pointer"
              }}
            >
              <p style={{ margin: 0, fontWeight: 600 }}>{workspace.name}</p>
              <p style={{ margin: "4px 0 0", color: "var(--text-soft)", fontSize: 12 }}>
                {workspace.rootPath}
              </p>
            </button>
          ))
        )}
      </div>

      <h2 className="section-title" style={{ marginTop: 18 }}>
        Repositories
      </h2>
      <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
        {repos.length === 0 ? (
          <p style={{ margin: 0, color: "var(--text-soft)", fontSize: 12 }}>No repositories detected.</p>
        ) : (
          repos.map((repo) => (
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
          ))
        )}
      </div>

      <h2 className="section-title" style={{ marginTop: 18 }}>
        Threads
      </h2>
      <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
        {threads.length === 0 ? (
          <p style={{ margin: 0, color: "var(--text-soft)", fontSize: 12 }}>No thread available yet.</p>
        ) : (
          threads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              onClick={() => void onSelectThread(thread.id)}
              className="surface"
              style={{
                padding: "8px 10px",
                textAlign: "left",
                background: thread.id === activeThreadId ? "#243049" : undefined,
                borderColor: thread.id === activeThreadId ? "var(--accent)" : undefined,
                cursor: "pointer"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <MessageSquare size={14} />
                <span style={{ fontSize: 13 }}>{thread.title || "Thread"}</span>
              </div>
              <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-soft)" }}>
                {thread.engineId} · {thread.modelId}
              </p>
            </button>
          ))
        )}
      </div>

      {error && (
        <p style={{ marginTop: 12, color: "var(--danger)", fontSize: 12 }}>
          {error}
        </p>
      )}
    </div>
  );
}
