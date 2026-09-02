import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getHarnessIcon } from "../shared/HarnessLogos";
import {
  CHAT_PROVIDER_KINDS,
  chatProviderSlugFromLabel,
  isValidChatProviderSlug,
  type ChatProviderKind,
} from "../../lib/engineKind";
import { defaultChatProviderHomePath } from "../../lib/chatProviders";
import type { ChatProviderInstance } from "../../types";

interface ChatProviderDialogProps {
  open: boolean;
  provider: ChatProviderInstance | null;
  existingIds: string[];
  saving: boolean;
  onSave: (provider: ChatProviderInstance) => Promise<boolean>;
  onSaved?: (provider: ChatProviderInstance, created: boolean) => void;
  onClose: () => void;
}

interface EnvRow {
  key: string;
  name: string;
  value: string;
}

let envRowSeed = 0;

function envRowsFrom(env: Record<string, string>): EnvRow[] {
  return Object.entries(env).map(([name, value]) => ({
    key: `env-${envRowSeed++}`,
    name,
    value,
  }));
}

export function providerKindIcon(kind: string, size = 16) {
  return getHarnessIcon(kind === "claude" ? "claude-code" : kind, size);
}

export function ChatProviderDialog({
  open,
  provider,
  existingIds,
  saving,
  onSave,
  onSaved,
  onClose,
}: ChatProviderDialogProps) {
  const { t } = useTranslation("app");
  const editing = provider !== null;
  const [kind, setKind] = useState<ChatProviderKind>("claude");
  const [displayName, setDisplayName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [binaryPath, setBinaryPath] = useState("");
  const [homePath, setHomePath] = useState("");
  const [homePathTouched, setHomePathTouched] = useState(false);
  const [launchArgs, setLaunchArgs] = useState("");
  const [envRows, setEnvRows] = useState<EnvRow[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (provider) {
      const providerKind = provider.kind === "codex" ? "codex" : "claude";
      setKind(providerKind);
      setDisplayName(provider.displayName);
      setSlug(provider.builtIn ? "" : provider.id.slice(provider.kind.length + 1));
      setSlugTouched(true);
      setBinaryPath(provider.binaryPath ?? "");
      setHomePath(provider.homePath ?? "");
      setHomePathTouched(true);
      setLaunchArgs(provider.launchArgs ?? "");
      setEnvRows(envRowsFrom(provider.env));
      setEnabled(provider.enabled);
    } else {
      setKind("claude");
      setDisplayName("");
      setSlug("");
      setSlugTouched(false);
      setBinaryPath("");
      setHomePath("");
      setHomePathTouched(false);
      setLaunchArgs("");
      setEnvRows([]);
      setEnabled(true);
    }
    setError(null);
  }, [open, provider]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const isBuiltIn = provider?.builtIn ?? false;
  const providerId = isBuiltIn ? kind : `${kind}_${slug}`;
  const effectiveHomePath =
    isBuiltIn || homePathTouched || homePath
      ? homePath
      : slug
        ? defaultChatProviderHomePath(kind, slug)
        : "";
  const binaryPlaceholder = kind === "codex" ? "codex" : "claude";
  const homePlaceholder = kind === "codex" ? "~/.codex" : "~/.claude";
  const title = editing
    ? t("settingsPage.chat.dialog.editTitle", { name: provider?.displayName ?? "" })
    : t("settingsPage.chat.dialog.addTitle");

  const validationError = useMemo(() => {
    if (!displayName.trim()) return t("settingsPage.chat.dialog.nameRequired");
    if (!isBuiltIn) {
      if (!isValidChatProviderSlug(slug)) return t("settingsPage.chat.dialog.invalidSlug");
      if (!editing && existingIds.includes(providerId)) {
        return t("settingsPage.chat.dialog.duplicateId", { id: providerId });
      }
    }
    for (const row of envRows) {
      const name = row.name.trim();
      if (name && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        return t("settingsPage.chat.dialog.invalidVariable", { name });
      }
    }
    return null;
  }, [displayName, editing, envRows, existingIds, isBuiltIn, providerId, slug, t]);

  if (!open) return null;

  async function submit() {
    if (validationError) {
      setError(validationError);
      return;
    }
    const env: Record<string, string> = {};
    for (const row of envRows) {
      const name = row.name.trim();
      if (name) env[name] = row.value;
    }
    const next: ChatProviderInstance = {
      id: providerId,
      kind,
      displayName: displayName.trim(),
      binaryPath: binaryPath.trim() || null,
      homePath: effectiveHomePath.trim() || null,
      launchArgs: launchArgs.trim() || null,
      env,
      enabled,
      builtIn: isBuiltIn,
    };
    const saved = await onSave(next);
    if (saved) {
      onClose();
      onSaved?.(next, !editing);
    } else {
      setError(t("settingsPage.chat.saveFailed"));
    }
  }

  return createPortal(
    <div
      className="confirm-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="ws-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
        style={{ width: "min(560px, calc(100vw - 48px))" }}
      >
        <div className="ws-header" style={{ padding: "20px 24px 0" }}>
          <div className="ws-header-icon" style={{ width: 40, height: 40, borderRadius: 12 }}>
            {providerKindIcon(kind, 20)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 className="ws-header-title" style={{ fontSize: 15 }}>{title}</h2>
            <div className="ws-header-path" style={{ marginTop: 2 }}>
              {isBuiltIn
                ? t("settingsPage.chat.dialog.builtInDescription")
                : t("settingsPage.chat.dialog.description")}
            </div>
          </div>
          <button type="button" className="ws-close" onClick={onClose} aria-label={t("common:actions.close")}>
            <X size={15} />
          </button>
        </div>

        <div className="ws-divider" style={{ margin: "14px 24px 0" }} />

        <div className="ws-body settings-form" style={{ padding: "16px 24px 20px" }}>
          {!editing ? (
            <div className="settings-field">
              <span className="settings-field-label">{t("settingsPage.chat.dialog.kind")}</span>
              <div className="usp-segmented">
                {CHAT_PROVIDER_KINDS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={kind === option ? "usp-segment-active" : ""}
                    onClick={() => setKind(option)}
                  >
                    {providerKindIcon(option, 13)}
                    {option === "codex" ? "Codex" : "Claude"}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <label className="settings-field">
            <span className="settings-field-label">{t("settingsPage.chat.dialog.displayName")}</span>
            <input
              className="settings-input"
              value={displayName}
              placeholder={t("settingsPage.chat.dialog.displayNamePlaceholder")}
              autoFocus
              onChange={(event) => {
                setDisplayName(event.target.value);
                if (!slugTouched && !isBuiltIn) {
                  setSlug(chatProviderSlugFromLabel(event.target.value));
                }
              }}
            />
            <span className="settings-field-hint">{t("settingsPage.chat.dialog.nameHint")}</span>
          </label>

          {!isBuiltIn ? (
            <label className="settings-field">
              <span className="settings-field-label">{t("settingsPage.chat.dialog.id")}</span>
              <div className="settings-input-group">
                <span className="settings-input-prefix">{kind}_</span>
                <input
                  className="settings-input"
                  value={slug}
                  disabled={editing}
                  spellCheck={false}
                  onChange={(event) => {
                    setSlugTouched(true);
                    setSlug(event.target.value.toLowerCase());
                  }}
                />
              </div>
              <span className="settings-field-hint">{t("settingsPage.chat.dialog.idHint")}</span>
            </label>
          ) : null}

          <label className="settings-field">
            <span className="settings-field-label">{t("settingsPage.chat.dialog.homePath")}</span>
            <input
              className="settings-input"
              value={effectiveHomePath}
              placeholder={homePlaceholder}
              spellCheck={false}
              onChange={(event) => {
                setHomePathTouched(true);
                setHomePath(event.target.value);
              }}
            />
            <span className="settings-field-hint">
              {kind === "codex"
                ? t("settingsPage.chat.dialog.homePathHintCodex")
                : t("settingsPage.chat.dialog.homePathHintClaude")}
            </span>
          </label>

          <label className="settings-field">
            <span className="settings-field-label">{t("settingsPage.chat.dialog.binaryPath")}</span>
            <input
              className="settings-input"
              value={binaryPath}
              placeholder={binaryPlaceholder}
              spellCheck={false}
              onChange={(event) => setBinaryPath(event.target.value)}
            />
            <span className="settings-field-hint">
              {t("settingsPage.chat.dialog.binaryPathHint", { binary: binaryPlaceholder })}
            </span>
          </label>

          <label className="settings-field">
            <span className="settings-field-label">{t("settingsPage.chat.dialog.launchArgs")}</span>
            <input
              className="settings-input"
              value={launchArgs}
              placeholder={kind === "codex" ? "--config key=value" : "--chrome"}
              spellCheck={false}
              onChange={(event) => setLaunchArgs(event.target.value)}
            />
            <span className="settings-field-hint">{t("settingsPage.chat.dialog.launchArgsHint")}</span>
          </label>

          <div className="settings-field">
            <span className="settings-field-label">{t("settingsPage.chat.dialog.env")}</span>
            {envRows.map((row) => (
              <div key={row.key} className="settings-kv-row">
                <input
                  className="settings-input"
                  value={row.name}
                  placeholder={t("settingsPage.chat.dialog.variableName")}
                  spellCheck={false}
                  onChange={(event) =>
                    setEnvRows((rows) =>
                      rows.map((current) =>
                        current.key === row.key ? { ...current, name: event.target.value } : current,
                      ),
                    )
                  }
                />
                <input
                  className="settings-input"
                  value={row.value}
                  placeholder={t("settingsPage.chat.dialog.variableValue")}
                  spellCheck={false}
                  onChange={(event) =>
                    setEnvRows((rows) =>
                      rows.map((current) =>
                        current.key === row.key ? { ...current, value: event.target.value } : current,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className="usp-icon-button"
                  aria-label={t("common:actions.remove")}
                  onClick={() => setEnvRows((rows) => rows.filter((current) => current.key !== row.key))}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            <div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  setEnvRows((rows) => [...rows, { key: `env-${envRowSeed++}`, name: "", value: "" }])
                }
              >
                <Plus size={13} />
                {t("settingsPage.chat.dialog.addVariable")}
              </button>
            </div>
          </div>
          {error ? <div className="settings-form-error">{error}</div> : null}
        </div>

        <div className="ws-footer" style={{ padding: "12px 24px" }}>
          <span className="ws-footer-meta">{providerId}</span>
          <div className="ws-footer-actions">
            <button type="button" className="btn btn-cancel-ghost" onClick={onClose}>
              {t("common:actions.cancel")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={() => void submit()}
            >
              {editing ? t("common:actions.save") : t("settingsPage.chat.dialog.add")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
