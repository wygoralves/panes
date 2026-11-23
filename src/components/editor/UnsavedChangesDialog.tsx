import { useTranslation } from "react-i18next";
import {
  resolveUnsavedChangesPrompt,
  useUnsavedChangesPromptStore,
} from "../../lib/unsavedChangesGuard";
import { ConfirmDialog } from "../shared/ConfirmDialog";

export function UnsavedChangesDialog() {
  const { t } = useTranslation("app");
  const fileNames = useUnsavedChangesPromptStore((s) => s.fileNames);
  const isSaving = useUnsavedChangesPromptStore((s) => s.isSaving);

  return (
    <ConfirmDialog
      open={fileNames !== null}
      title={t("editor.unsavedOnExit.title")}
      message={t("editor.unsavedOnExit.message", { names: (fileNames ?? []).join(", ") })}
      confirmLabel={t("editor.unsavedOnExit.discard")}
      cancelLabel={t("editor.unsavedOnExit.cancel")}
      secondaryLabel={t("editor.unsavedOnExit.saveAll")}
      onSecondary={() => {
        if (!isSaving) void resolveUnsavedChangesPrompt("save-all");
      }}
      onConfirm={() => void resolveUnsavedChangesPrompt("discard")}
      onCancel={() => void resolveUnsavedChangesPrompt("cancel")}
    />
  );
}
