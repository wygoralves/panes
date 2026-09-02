import type { ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { createAndActivateWorkspaceThread } from "../../lib/newThreadActions";
import { activateThread } from "../../lib/threadActions";
import { useThreadStore } from "../../stores/threadStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { Dropdown } from "../shared/Dropdown";
import { ProjectIcon } from "../sidebar/ProjectIcon";
import { isDraftThread } from "../sidebar/statusGrouping";
import type { Thread, Workspace } from "../../types";

const NEW_PROJECT_VALUE = "__new-project__";

function workspaceLabel(workspace: Workspace, fallback: string): string {
  return workspace.name || workspace.rootPath.split("/").pop() || fallback;
}

/** An untouched draft in the target project is reused instead of stacking a
 * second empty thread next to it. */
export function findReusableDraftThread(threads: Thread[]): Thread | null {
  return threads.find(isDraftThread) ?? null;
}

interface Props {
  /** Interpolated scope text from the headline. */
  children?: ReactNode;
}

/** The project name inside the draft headline doubles as the project picker,
 * so switching where a new thread starts never leaves the composer. */
export function DraftScopePicker({ children }: Props) {
  const { t } = useTranslation(["chat", "app"]);
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const openWorkspace = useWorkspaceStore((state) => state.openWorkspace);
  const fallbackLabel = t("app:sidebar.workspaceFallback");

  async function onChange(value: string) {
    if (value === NEW_PROJECT_VALUE) {
      const selected = await open({ directory: true, multiple: false });
      if (!selected || Array.isArray(selected)) return;
      await openWorkspace(selected);
      return;
    }
    if (value === activeWorkspaceId) return;

    const draft = findReusableDraftThread(
      useThreadStore.getState().threadsByWorkspace[value] ?? [],
    );
    if (draft) {
      await activateThread(draft);
      return;
    }
    await createAndActivateWorkspaceThread(value);
  }

  return (
    <span className="chat-draft-scope-picker">
      <Dropdown
        value={activeWorkspaceId ?? ""}
        selectedLabel={typeof children === "string" ? children : undefined}
        title={t("chat:panel.draftPickProject")}
        searchable
        searchPlaceholder={t("chat:panel.draftSearchProjects")}
        noResultsLabel={t("chat:panel.draftNoProjectsFound")}
        options={[
          ...workspaces.map((workspace) => {
            const label = workspaceLabel(workspace, fallbackLabel);
            return {
              value: workspace.id,
              label,
              icon: <ProjectIcon label={label} />,
            };
          }),
          {
            value: NEW_PROJECT_VALUE,
            label: t("app:sidebar.newProject"),
            icon: <FolderPlus size={13} />,
          },
        ]}
        onChange={(value) => void onChange(value)}
      />
    </span>
  );
}
