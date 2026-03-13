import { useEffect, useState } from "react";
import {
  FlaskConical,
  GitBranch,
  Minimize2,
  RotateCcw,
  Scissors,
  Search,
  Server,
  UserCircle,
  X,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  CodexExperimentalFeature,
  CodexMcpServer,
  CodexReviewDelivery,
  CodexReviewTarget,
  CodexSkill,
} from "../../types";

type ReviewTargetMode =
  | "uncommittedChanges"
  | "baseBranch"
  | "commit"
  | "custom";

export type ActiveSlashCommand =
  | { type: "review" }
  | { type: "fork" }
  | { type: "rollback" }
  | { type: "compact" }
  | { type: "fast" }
  | { type: "personality" }
  | { type: "skills" }
  | { type: "mcp" }
  | { type: "experimental" };

export interface SlashCommandPayload {
  target?: CodexReviewTarget;
  delivery?: CodexReviewDelivery;
  numTurns?: number;
  serviceTier?: string;
  personality?: string;
}

interface ChatCommandPanelProps {
  command: ActiveSlashCommand;
  busy: boolean;
  error: string | null;
  defaultBaseBranch: string | null;
  /** Current values for config commands */
  currentServiceTier?: string;
  currentPersonality?: string;
  personalitySupported?: boolean;
  /** Data for info panels */
  skills?: CodexSkill[];
  mcpServers?: CodexMcpServer[];
  experimentalFeatures?: CodexExperimentalFeature[];
  onConfirm: (
    command: ActiveSlashCommand,
    payload?: SlashCommandPayload,
  ) => void;
  onDismiss: () => void;
}

export function ChatCommandPanel({
  command,
  busy,
  error,
  defaultBaseBranch,
  currentServiceTier,
  currentPersonality,
  personalitySupported,
  skills,
  mcpServers,
  experimentalFeatures,
  onConfirm,
  onDismiss,
}: ChatCommandPanelProps) {
  const { t } = useTranslation("chat");

  switch (command.type) {
    case "review":
      return (
        <ReviewPanel
          busy={busy}
          error={error}
          defaultBaseBranch={defaultBaseBranch}
          onConfirm={(target, delivery) =>
            onConfirm(command, { target, delivery })
          }
          onDismiss={onDismiss}
          t={t}
        />
      );
    case "fork":
      return (
        <ConfirmPanel
          icon={GitBranch}
          title={t("threadPicker.forkTitle")}
          description={t("threadPicker.forkDescription")}
          confirmLabel={t("threadPicker.forkAction")}
          busy={busy}
          error={error}
          onConfirm={() => onConfirm(command)}
          onDismiss={onDismiss}
        />
      );
    case "rollback":
      return (
        <RollbackPanel
          busy={busy}
          error={error}
          onConfirm={(numTurns) => onConfirm(command, { numTurns })}
          onDismiss={onDismiss}
          t={t}
        />
      );
    case "fast":
      return (
        <OptionPickerPanel
          busy={busy}
          error={error}
          icon={Zap}
          title={t("configPicker.serviceTier")}
          description={t("configPicker.serviceTierDescription")}
          options={[
            { value: "inherit", label: t("configPicker.inherit") },
            { value: "fast", label: t("configPicker.serviceTiers.fast") },
            { value: "flex", label: t("configPicker.serviceTiers.flex") },
          ]}
          currentValue={currentServiceTier ?? "inherit"}
          onSelect={(value) => onConfirm(command, { serviceTier: value })}
          onDismiss={onDismiss}
        />
      );
    case "personality":
      return (
        <OptionPickerPanel
          busy={busy}
          error={error}
          icon={UserCircle}
          title={t("configPicker.personality")}
          description={
            personalitySupported
              ? t("configPicker.personalityDescription")
              : t("configPicker.personalityUnsupported")
          }
          options={[
            { value: "inherit", label: t("configPicker.inherit") },
            { value: "none", label: t("configPicker.personalities.none") },
            { value: "friendly", label: t("configPicker.personalities.friendly") },
            { value: "pragmatic", label: t("configPicker.personalities.pragmatic") },
          ]}
          currentValue={currentPersonality ?? "inherit"}
          onSelect={(value) => onConfirm(command, { personality: value })}
          onDismiss={onDismiss}
        />
      );
    case "compact":
      return (
        <ConfirmPanel
          icon={Minimize2}
          title={t("threadPicker.compactTitle")}
          description={t("threadPicker.compactDescription")}
          confirmLabel={t("threadPicker.compactAction")}
          busy={busy}
          error={error}
          onConfirm={() => onConfirm(command)}
          onDismiss={onDismiss}
        />
      );
    case "skills":
      return (
        <InfoListPanel
          icon={Scissors}
          title={t("slashCommands.panels.skills.title")}
          emptyLabel={t("slashCommands.panels.skills.empty")}
          items={(skills ?? []).map((s) => ({
            name: s.name,
            detail: s.description || s.scope,
            enabled: s.enabled,
          }))}
          onDismiss={onDismiss}
        />
      );
    case "mcp":
      return (
        <InfoListPanel
          icon={Server}
          title={t("slashCommands.panels.mcp.title")}
          emptyLabel={t("slashCommands.panels.mcp.empty")}
          items={(mcpServers ?? []).map((s) => ({
            name: s.name,
            detail: `${s.toolCount} tools, ${s.resourceCount} resources`,
            badge: s.authStatus,
          }))}
          onDismiss={onDismiss}
        />
      );
    case "experimental":
      return (
        <InfoListPanel
          icon={FlaskConical}
          title={t("slashCommands.panels.experimental.title")}
          emptyLabel={t("slashCommands.panels.experimental.empty")}
          items={(experimentalFeatures ?? []).map((f) => ({
            name: f.displayName || f.name,
            detail: f.stage,
            enabled: f.enabled,
          }))}
          onDismiss={onDismiss}
        />
      );
  }
}

/* ── Generic confirm panel (fork / compact) ── */

function ConfirmPanel({
  icon: Icon,
  title,
  description,
  confirmLabel,
  busy,
  error,
  onConfirm,
  onDismiss,
}: {
  icon: typeof GitBranch;
  title: string;
  description: string;
  confirmLabel: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation("chat");
  return (
    <div className="chat-command-panel">
      <div className="chat-command-panel-header">
        <div className="chat-command-panel-title">
          <Icon size={12} />
          <span>{title}</span>
        </div>
        <button
          type="button"
          className="chat-command-panel-close"
          onClick={onDismiss}
        >
          <X size={12} />
        </button>
      </div>
      <div className="chat-command-panel-desc">{description}</div>
      {error && <div className="chat-command-panel-error">{error}</div>}
      <div className="chat-command-panel-actions">
        <button
          type="button"
          className="chat-command-panel-btn-secondary"
          onClick={onDismiss}
          disabled={busy}
        >
          {t("panel.approvalActions.cancel")}
        </button>
        <button
          type="button"
          className="chat-command-panel-btn-primary"
          onClick={onConfirm}
          disabled={busy}
        >
          <Icon size={11} />
          {busy ? t("threadPicker.working") : confirmLabel}
        </button>
      </div>
    </div>
  );
}

/* ── Option picker panel (fast / personality / effort) ── */

function OptionPickerPanel({
  busy,
  error,
  icon: Icon,
  title,
  description,
  options,
  currentValue,
  onSelect,
  onDismiss,
}: {
  busy: boolean;
  error: string | null;
  icon: typeof Zap;
  title: string;
  description: string;
  options: { value: string; label: string }[];
  currentValue: string;
  onSelect: (value: string) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="chat-command-panel">
      <div className="chat-command-panel-header">
        <div className="chat-command-panel-title">
          <Icon size={12} />
          <span>{title}</span>
        </div>
        <button
          type="button"
          className="chat-command-panel-close"
          onClick={onDismiss}
          disabled={busy}
        >
          <X size={12} />
        </button>
      </div>
      {description && (
        <div className="chat-command-panel-desc">{description}</div>
      )}
      {error && <div className="chat-command-panel-error">{error}</div>}
      <div className="chat-command-panel-toggle-group">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`chat-command-panel-toggle${opt.value === currentValue ? " chat-command-panel-toggle-active" : ""}`}
            onClick={() => onSelect(opt.value)}
            disabled={busy}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Rollback panel ── */

function RollbackPanel({
  busy,
  error,
  onConfirm,
  onDismiss,
  t,
}: {
  busy: boolean;
  error: string | null;
  onConfirm: (numTurns: number) => void;
  onDismiss: () => void;
  t: ReturnType<typeof useTranslation<"chat">>["t"];
}) {
  const [turnsText, setTurnsText] = useState("1");
  const [localError, setLocalError] = useState<string | null>(null);

  function handleConfirm() {
    const parsed = Number.parseInt(turnsText.trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      setLocalError(t("threadPicker.invalidTurns"));
      return;
    }
    setLocalError(null);
    onConfirm(parsed);
  }

  const displayError = error || localError;

  return (
    <div className="chat-command-panel">
      <div className="chat-command-panel-header">
        <div className="chat-command-panel-title">
          <RotateCcw size={12} />
          <span>{t("threadPicker.rollbackTitle")}</span>
        </div>
        <button
          type="button"
          className="chat-command-panel-close"
          onClick={onDismiss}
        >
          <X size={12} />
        </button>
      </div>
      <div className="chat-command-panel-desc">
        {t("threadPicker.rollbackDescription")}
      </div>
      <div className="chat-command-panel-fields">
        <label className="chat-command-panel-field">
          <span className="chat-command-panel-field-label">
            {t("threadPicker.rollbackTurns")}
          </span>
          <input
            className="chat-command-panel-input"
            type="number"
            min={1}
            value={turnsText}
            onChange={(e) => setTurnsText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleConfirm();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                onDismiss();
              }
            }}
            disabled={busy}
            autoFocus
          />
        </label>
        <div className="chat-command-panel-warning">
          {t("threadPicker.rollbackWarning")}
        </div>
      </div>
      {displayError && (
        <div className="chat-command-panel-error">{displayError}</div>
      )}
      <div className="chat-command-panel-actions">
        <button
          type="button"
          className="chat-command-panel-btn-secondary"
          onClick={onDismiss}
          disabled={busy}
        >
          {t("panel.approvalActions.cancel")}
        </button>
        <button
          type="button"
          className="chat-command-panel-btn-primary"
          onClick={handleConfirm}
          disabled={busy}
        >
          <RotateCcw size={11} />
          {busy ? t("threadPicker.working") : t("threadPicker.rollbackAction")}
        </button>
      </div>
    </div>
  );
}

/* ── Review panel ── */

function ReviewPanel({
  busy,
  error,
  defaultBaseBranch,
  onConfirm,
  onDismiss,
  t,
}: {
  busy: boolean;
  error: string | null;
  defaultBaseBranch: string | null;
  onConfirm: (target: CodexReviewTarget, delivery: CodexReviewDelivery) => void;
  onDismiss: () => void;
  t: ReturnType<typeof useTranslation<"chat">>["t"];
}) {
  const [targetMode, setTargetMode] =
    useState<ReviewTargetMode>("uncommittedChanges");
  const [delivery, setDelivery] = useState<CodexReviewDelivery>("inline");
  const [baseBranch, setBaseBranch] = useState(defaultBaseBranch ?? "");
  const [commitSha, setCommitSha] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setBaseBranch(defaultBaseBranch ?? "");
  }, [defaultBaseBranch]);

  function handleConfirm() {
    let target: CodexReviewTarget;

    if (targetMode === "uncommittedChanges") {
      target = { type: "uncommittedChanges" };
    } else if (targetMode === "baseBranch") {
      const branch = baseBranch.trim();
      if (!branch) {
        setLocalError(t("reviewPicker.errors.branchRequired"));
        return;
      }
      target = { type: "baseBranch", branch };
    } else if (targetMode === "commit") {
      const sha = commitSha.trim();
      if (!sha) {
        setLocalError(t("reviewPicker.errors.commitRequired"));
        return;
      }
      target = { type: "commit", sha };
    } else {
      const instructions = customInstructions.trim();
      if (!instructions) {
        setLocalError(t("reviewPicker.errors.instructionsRequired"));
        return;
      }
      target = { type: "custom", instructions };
    }

    setLocalError(null);
    onConfirm(target, delivery);
  }

  const displayError = error || localError;

  return (
    <div className="chat-command-panel">
      <div className="chat-command-panel-header">
        <div className="chat-command-panel-title">
          <Search size={12} />
          <span>{t("reviewPicker.title")}</span>
        </div>
        <button
          type="button"
          className="chat-command-panel-close"
          onClick={onDismiss}
        >
          <X size={12} />
        </button>
      </div>
      <div className="chat-command-panel-desc">
        {t("reviewPicker.subtitle")}
      </div>

      <div className="chat-command-panel-fields">
        <label className="chat-command-panel-field">
          <span className="chat-command-panel-field-label">
            {t("reviewPicker.targetLabel")}
          </span>
          <div className="chat-command-panel-toggle-group">
            {([
              { value: "uncommittedChanges", label: t("reviewPicker.targets.uncommittedChanges") },
              { value: "baseBranch", label: t("reviewPicker.targets.baseBranch") },
              { value: "commit", label: t("reviewPicker.targets.commit") },
              { value: "custom", label: t("reviewPicker.targets.custom") },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`chat-command-panel-toggle${targetMode === opt.value ? " chat-command-panel-toggle-active" : ""}`}
                onClick={() => setTargetMode(opt.value)}
                disabled={busy}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </label>

        {targetMode === "baseBranch" && (
          <label className="chat-command-panel-field">
            <span className="chat-command-panel-field-label">
              {t("reviewPicker.branchLabel")}
            </span>
            <input
              className="chat-command-panel-input"
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              placeholder={t("reviewPicker.branchPlaceholder")}
              disabled={busy}
              autoFocus
            />
          </label>
        )}

        {targetMode === "commit" && (
          <label className="chat-command-panel-field">
            <span className="chat-command-panel-field-label">
              {t("reviewPicker.commitLabel")}
            </span>
            <input
              className="chat-command-panel-input"
              value={commitSha}
              onChange={(e) => setCommitSha(e.target.value)}
              placeholder={t("reviewPicker.commitPlaceholder")}
              disabled={busy}
              autoFocus
            />
          </label>
        )}

        {targetMode === "custom" && (
          <label className="chat-command-panel-field">
            <span className="chat-command-panel-field-label">
              {t("reviewPicker.instructionsLabel")}
            </span>
            <textarea
              className="chat-command-panel-input"
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              placeholder={t("reviewPicker.instructionsPlaceholder")}
              rows={3}
              disabled={busy}
              spellCheck={false}
              style={{ resize: "vertical" }}
              autoFocus
            />
          </label>
        )}

        <label className="chat-command-panel-field">
          <span className="chat-command-panel-field-label">
            {t("reviewPicker.deliveryLabel")}
          </span>
          <div className="chat-command-panel-toggle-group">
            <button
              type="button"
              className={`chat-command-panel-toggle${delivery === "inline" ? " chat-command-panel-toggle-active" : ""}`}
              onClick={() => setDelivery("inline")}
              disabled={busy}
            >
              {t("reviewPicker.delivery.inline")}
            </button>
            <button
              type="button"
              className={`chat-command-panel-toggle${delivery === "detached" ? " chat-command-panel-toggle-active" : ""}`}
              onClick={() => setDelivery("detached")}
              disabled={busy}
            >
              {t("reviewPicker.delivery.detached")}
            </button>
          </div>
        </label>

        <div className="chat-command-panel-hint">
          {delivery === "detached"
            ? t("reviewPicker.deliveryDescriptions.detached")
            : t("reviewPicker.deliveryDescriptions.inline")}
        </div>
      </div>

      {displayError && (
        <div className="chat-command-panel-error">{displayError}</div>
      )}
      <div className="chat-command-panel-actions">
        <button
          type="button"
          className="chat-command-panel-btn-secondary"
          onClick={onDismiss}
          disabled={busy}
        >
          {t("panel.approvalActions.cancel")}
        </button>
        <button
          type="button"
          className="chat-command-panel-btn-primary"
          onClick={handleConfirm}
          disabled={busy}
        >
          <Search size={11} />
          {busy ? t("reviewPicker.working") : t("reviewPicker.startAction")}
        </button>
      </div>
    </div>
  );
}

/* ── Info list panel (skills / mcp / experimental) ── */

function InfoListPanel({
  icon: Icon,
  title,
  emptyLabel,
  items,
  onDismiss,
}: {
  icon: typeof Scissors;
  title: string;
  emptyLabel: string;
  items: { name: string; detail?: string; enabled?: boolean; badge?: string }[];
  onDismiss: () => void;
}) {
  const { t } = useTranslation("chat");
  return (
    <div className="chat-command-panel">
      <div className="chat-command-panel-header">
        <div className="chat-command-panel-title">
          <Icon size={12} />
          <span>{title}</span>
        </div>
        <button
          type="button"
          className="chat-command-panel-close"
          onClick={onDismiss}
        >
          <X size={12} />
        </button>
      </div>
      {items.length === 0 ? (
        <div className="chat-command-panel-desc">{emptyLabel}</div>
      ) : (
        <div className="chat-command-panel-info-list">
          {items.map((item) => (
            <div key={item.name} className="chat-command-panel-info-item">
              <span className="chat-command-panel-info-name">
                {item.name}
              </span>
              {item.detail && (
                <span className="chat-command-panel-info-detail">
                  {item.detail}
                </span>
              )}
              {item.enabled !== undefined && (
                <span
                  className={`chat-command-panel-info-badge ${item.enabled ? "chat-command-panel-info-badge-on" : "chat-command-panel-info-badge-off"}`}
                >
                  {item.enabled ? t("slashCommands.panels.info.badgeOn") : t("slashCommands.panels.info.badgeOff")}
                </span>
              )}
              {item.badge && (
                <span className="chat-command-panel-info-badge">
                  {item.badge}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
