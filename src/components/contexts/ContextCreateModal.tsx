import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { ipc } from "../../lib/ipc";
import { useContextStore } from "../../stores/contextStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { toast } from "../../stores/toastStore";
import type { PrMetadata } from "../../types";

interface Props {
  open: boolean;
  onClose: () => void;
}

const STYLES = {
  backdrop: {
    position: "fixed" as const,
    inset: 0,
    zIndex: 10002,
    background: "rgba(0,0,0,0.55)",
    backdropFilter: "blur(16px)",
    display: "flex",
    justifyContent: "center",
    paddingTop: "min(100px, 12vh)",
  },
  card: {
    width: "min(480px, calc(100% - 40px))",
    maxHeight: "min(600px, 80vh)",
    overflowY: "auto" as const,
    borderRadius: "var(--radius-lg)",
    background: "rgba(14,14,16,0.97)",
    boxShadow:
      "0 0 0 1px rgba(255,255,255,0.08), 0 24px 68px rgba(0,0,0,0.55)",
    padding: "24px",
    animation: "slide-up 180ms cubic-bezier(0.16,1,0.3,1) both",
  },
  title: {
    fontSize: 16,
    fontWeight: 600,
    color: "var(--text-1)",
    marginBottom: 20,
  },
  field: {
    marginBottom: 14,
  },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 500,
    color: "var(--text-2)",
    marginBottom: 5,
  },
  input: {
    width: "100%",
    padding: "8px 10px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.04)",
    color: "var(--text-1)",
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box" as const,
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 20,
  },
  btnCancel: {
    padding: "7px 16px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid rgba(255,255,255,0.1)",
    background: "transparent",
    color: "var(--text-2)",
    fontSize: 13,
    fontFamily: "inherit",
    cursor: "pointer",
  },
  btnCreate: {
    padding: "7px 16px",
    borderRadius: "var(--radius-sm)",
    border: "none",
    background: "var(--color-accent)",
    color: "#fff",
    fontSize: 13,
    fontWeight: 500,
    fontFamily: "inherit",
    cursor: "pointer",
    opacity: 1,
  },
  btnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  prFetchRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  btnFetch: {
    padding: "7px 12px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.04)",
    color: "var(--text-2)",
    fontSize: 12,
    fontFamily: "inherit",
    cursor: "pointer",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  prPreview: {
    marginTop: 8,
    padding: "8px 10px",
    borderRadius: "var(--radius-sm)",
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.06)",
    fontSize: 12,
    color: "var(--text-2)",
    lineHeight: 1.5,
  },
  prPreviewTitle: {
    fontWeight: 600,
    color: "var(--text-1)",
    marginBottom: 4,
  },
  prPreviewMeta: {
    fontSize: 11,
    color: "var(--text-3)",
  },
};

function buildPrContextMessage(metadata: PrMetadata): string {
  const reviewSection =
    metadata.reviewComments.length > 0
      ? metadata.reviewComments
          .map(
            (c) =>
              `- **${c.author}**${c.path ? ` (${c.path}${c.line ? `:${c.line}` : ""})` : ""}: ${c.body}`,
          )
          .join("\n")
      : "No review comments yet.";

  const commentSection =
    metadata.comments.length > 0
      ? metadata.comments
          .map((c) => `- **${c.author}**: ${c.body}`)
          .join("\n")
      : "";

  const parts = [
    `I'm working on PR #${metadata.number}: "${metadata.title}".`,
    "",
    metadata.body
      ? `**PR Description:**\n${metadata.body.length > 2000 ? metadata.body.slice(0, 2000) + "\n\n_(truncated)_" : metadata.body}`
      : "",
    "",
    `**Review comments to address:**`,
    reviewSection,
  ];

  if (commentSection) {
    parts.push("", `**Discussion:**`, commentSection);
  }

  parts.push("", "Help me address these review comments. The codebase is ready in this worktree.");

  return parts.filter((p) => p !== undefined).join("\n");
}

export function ContextCreateModal({ open, onClose }: Props) {
  const { t } = useTranslation("app");
  const createContext = useContextStore((s) => s.createContext);
  const isCreating = useContextStore((s) => s.isCreating);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const activeRepoId = useWorkspaceStore((s) => s.activeRepoId);
  const repos = useWorkspaceStore((s) => s.repos);
  const activeRepo = repos.find((r) => r.id === activeRepoId);

  const [branchName, setBranchName] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [prUrl, setPrUrl] = useState("");
  const [prMetadata, setPrMetadata] = useState<PrMetadata | null>(null);
  const [isFetchingPr, setIsFetchingPr] = useState(false);
  const [branchAutoFilled, setBranchAutoFilled] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setBranchName("");
      setBaseBranch(activeRepo?.defaultBranch ?? "main");
      setDisplayName("");
      setPrUrl("");
      setPrMetadata(null);
      setBranchAutoFilled(false);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open, activeRepo?.defaultBranch]);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onEsc, true);
    return () => window.removeEventListener("keydown", onEsc, true);
  }, [open, onClose]);

  // Auto-derive display name from branch (only when not auto-filled from PR)
  useEffect(() => {
    if (branchAutoFilled) return;
    if (!branchName) {
      setDisplayName("");
      return;
    }
    const derived = branchName
      .replace(/^(fix|feat|feature|hotfix|chore|refactor|docs|test)[/\\-]/, "")
      .replace(/[/\\-]/g, " ")
      .replace(/^\w/, (c) => c.toUpperCase());
    setDisplayName(derived);
  }, [branchName, branchAutoFilled]);

  const handleFetchPr = useCallback(async () => {
    const url = prUrl.trim();
    if (!url) return;

    setIsFetchingPr(true);
    try {
      const metadata = await ipc.fetchPrMetadata(url);
      setPrMetadata(metadata);

      // Auto-fill fields from PR
      if (metadata.headRefName) {
        setBranchName(metadata.headRefName);
        setBranchAutoFilled(true);
      }
      if (metadata.title) {
        setDisplayName(`PR #${metadata.number}: ${metadata.title}`);
      }
    } catch (err) {
      toast.error(String(err));
    } finally {
      setIsFetchingPr(false);
    }
  }, [prUrl]);

  const canCreate = branchName.trim().length > 0 && !isCreating;

  const handleCreate = async () => {
    if (!canCreate || !activeWorkspaceId || !activeRepoId) return;

    const parsedPrNumber = prMetadata?.number ?? (prUrl
      ? parseInt(prUrl.match(/\/pull\/(\d+)/)?.[1] ?? "", 10) || undefined
      : undefined);

    const result = await createContext({
      workspaceId: activeWorkspaceId,
      repoId: activeRepoId,
      branchName: branchName.trim(),
      baseBranch: baseBranch || undefined,
      displayName: displayName.trim() || undefined,
      prUrl: prUrl.trim() || undefined,
      prNumber: parsedPrNumber,
    });

    if (!result) return;

    // If we have PR metadata and the context has a thread, inject PR context
    if (prMetadata && result.threadId) {
      try {
        const contextMessage = buildPrContextMessage(prMetadata);
        await ipc.sendMessage(result.threadId, contextMessage);
      } catch {
        // PR injection is non-fatal — context was created successfully
      }
    }

    onClose();
  };

  if (!open) return null;

  return createPortal(
    <div style={STYLES.backdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        style={STYLES.card}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={STYLES.title}>{t("contexts.create.title")}</div>

        {/* PR URL — moved to top for the "fix this PR" flow */}
        <div style={STYLES.field}>
          <label style={STYLES.label}>{t("contexts.create.prUrl")}</label>
          <div style={STYLES.prFetchRow}>
            <input
              ref={inputRef}
              style={{ ...STYLES.input, flex: 1 }}
              value={prUrl}
              onChange={(e) => {
                setPrUrl(e.target.value);
                setPrMetadata(null);
                setBranchAutoFilled(false);
              }}
              placeholder={t("contexts.create.prUrlPlaceholder")}
              onKeyDown={(e) => {
                if (e.key === "Enter" && prUrl.trim()) {
                  e.preventDefault();
                  void handleFetchPr();
                }
              }}
            />
            <button
              style={{
                ...STYLES.btnFetch,
                ...(isFetchingPr || !prUrl.trim() ? STYLES.btnDisabled : {}),
              }}
              disabled={isFetchingPr || !prUrl.trim()}
              onClick={() => void handleFetchPr()}
            >
              {isFetchingPr && <Loader2 size={12} className="animate-spin" />}
              {isFetchingPr ? t("contexts.create.fetching") : t("contexts.create.fetch")}
            </button>
          </div>
          {prMetadata && (
            <div style={STYLES.prPreview}>
              <div style={STYLES.prPreviewTitle}>
                #{prMetadata.number}: {prMetadata.title}
              </div>
              <div style={STYLES.prPreviewMeta}>
                {t("contexts.create.prBranch", { branch: prMetadata.headRefName })}
                {prMetadata.reviewComments.length > 0 &&
                  ` \u00B7 ${t("contexts.create.prReviewCount", { count: prMetadata.reviewComments.length })}`}
              </div>
            </div>
          )}
        </div>

        <div style={STYLES.field}>
          <label style={STYLES.label}>{t("contexts.create.branchName")}</label>
          <input
            style={STYLES.input}
            value={branchName}
            onChange={(e) => {
              setBranchName(e.target.value);
              setBranchAutoFilled(false);
            }}
            placeholder={t("contexts.create.branchNamePlaceholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canCreate) void handleCreate();
            }}
          />
        </div>

        <div style={STYLES.field}>
          <label style={STYLES.label}>{t("contexts.create.baseBranch")}</label>
          <input
            style={STYLES.input}
            value={baseBranch}
            onChange={(e) => setBaseBranch(e.target.value)}
          />
        </div>

        <div style={STYLES.field}>
          <label style={STYLES.label}>{t("contexts.create.displayName")}</label>
          <input
            style={STYLES.input}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t("contexts.create.displayNamePlaceholder")}
          />
        </div>

        <div style={STYLES.actions}>
          <button style={STYLES.btnCancel} onClick={onClose}>
            {t("contexts.create.cancel")}
          </button>
          <button
            style={{
              ...STYLES.btnCreate,
              ...(canCreate ? {} : STYLES.btnDisabled),
            }}
            disabled={!canCreate}
            onClick={() => void handleCreate()}
          >
            {isCreating
              ? t("contexts.create.creating")
              : t("contexts.create.create")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
