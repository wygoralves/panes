import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import type { WorktreeRemovalRisk } from "../../types";

interface Props {
  risks: WorktreeRemovalRisk[] | null;
  onForceRemove: () => void;
  onKeep: () => void;
  onDismiss?: () => void;
}

function worktreeName(risk: WorktreeRemovalRisk): string {
  if (risk.branch) return risk.branch;
  const segments = risk.worktreePath.replace(/[\\/]+$/, "").split(/[\\/]/);
  return segments[segments.length - 1] || risk.worktreePath;
}

export function describeWorktreeRemovalRisks(
  risks: WorktreeRemovalRisk[],
  t: TFunction<"app">,
): string {
  return risks
    .map((risk) => {
      const parts: string[] = [];
      if (risk.changedCount > 0) {
        parts.push(t("terminal.unsavedChangedFiles", { count: risk.changedCount }));
      }
      if (risk.untrackedCount > 0) {
        parts.push(t("terminal.unsavedUntrackedFiles", { count: risk.untrackedCount }));
      }
      if (risk.unmergedCommitCount > 0) {
        parts.push(t("terminal.unsavedUnmergedCommits", { count: risk.unmergedCommitCount }));
      }
      return t("terminal.unsavedWorktreeEntry", {
        name: worktreeName(risk),
        summary: parts.join(", "),
      });
    })
    .join("; ");
}

/**
 * Second confirmation before worktrees holding uncommitted files or unmerged
 * commits are force-removed. It names what would be lost for each worktree.
 */
export function WorktreeRemovalRiskDialog({ risks, onForceRemove, onKeep, onDismiss }: Props) {
  const { t } = useTranslation("app");
  return (
    <ConfirmDialog
      open={risks !== null && risks.length > 0}
      title={t("terminal.unsavedWorktreesTitle")}
      message={t("terminal.unsavedWorktreesMessage", {
        details: describeWorktreeRemovalRisks(risks ?? [], t),
      })}
      confirmLabel={t("terminal.forceRemoveWorktrees")}
      cancelLabel={t("terminal.keepUnsavedWorktrees")}
      onConfirm={onForceRemove}
      onCancel={onKeep}
      onDismiss={onDismiss}
    />
  );
}
