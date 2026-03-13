import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Monitor } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  CodexMethodAvailability,
  CodexProtocolDiagnostics,
  CodexSkill,
} from "../../types";

interface CodexRuntimePickerProps {
  diagnostics?: CodexProtocolDiagnostics;
  skills?: CodexSkill[];
  disabled?: boolean;
}

function humanizeIdentifier(value: string): string {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_/.-]+/g, " ")
    .trim();
  if (!normalized) {
    return value;
  }

  return normalized
    .split(/\s+/)
    .map((segment) => {
      const lower = segment.toLowerCase();
      if (lower === "api") return "API";
      if (lower === "oauth") return "OAuth";
      if (lower === "mcp") return "MCP";
      if (lower === "chatgpt") return "ChatGPT";
      if (lower === "gpt") return "GPT";
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function formatTimestamp(value?: string): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function formatJsonValue(value: unknown, noneLabel: string): string {
  if (value === null || value === undefined) {
    return noneLabel;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    const serialized = JSON.stringify(value);
    if (!serialized) {
      return noneLabel;
    }
    return serialized.length > 120 ? `${serialized.slice(0, 117)}...` : serialized;
  } catch {
    return noneLabel;
  }
}

function getMethodIssues(methodAvailability: CodexMethodAvailability[]): CodexMethodAvailability[] {
  return methodAvailability.filter((entry) => entry.status !== "available");
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      style={{
        display: "grid",
        gap: 8,
        paddingTop: 10,
        borderTop: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.03em",
          textTransform: "uppercase",
          color: "var(--text-2)",
        }}
      >
        {title}
      </div>
      {children}
    </section>
  );
}

function FieldRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(120px, 160px) minmax(0, 1fr)",
        gap: 8,
        alignItems: "start",
        fontSize: 11,
      }}
    >
      <span style={{ color: "var(--text-3)" }}>{label}</span>
      <div
        style={{
          color: "var(--text-1)",
          minWidth: 0,
          wordBreak: "break-word",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function ChipList({
  items,
  emptyLabel,
}: {
  items: string[];
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return <div className="codex-config-note">{emptyLabel}</div>;
  }

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
      }}
    >
      {items.map((item) => (
        <span
          key={item}
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "3px 8px",
            borderRadius: 999,
            border: "1px solid var(--border)",
            background: "var(--bg-2)",
            color: "var(--text-2)",
            fontSize: 11,
          }}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

export function CodexRuntimePicker({
  diagnostics,
  skills,
  disabled = false,
}: CodexRuntimePickerProps) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ bottom: 0, left: 0 });

  const methodIssues = useMemo(
    () => getMethodIssues(diagnostics?.methodAvailability ?? []),
    [diagnostics?.methodAvailability],
  );
  const issueCount =
    methodIssues.length +
    (diagnostics?.lastConfigWarning ? 1 : 0) +
    (diagnostics?.lastAccountLogin?.success === false ? 1 : 0) +
    (diagnostics?.lastMcpOauth?.success === false ? 1 : 0);
  const enabledFeatures = useMemo(
    () =>
      (diagnostics?.experimentalFeatures ?? [])
        .filter((feature) => feature.enabled)
        .map((feature) => `${humanizeIdentifier(feature.name)} · ${humanizeIdentifier(feature.stage)}`),
    [diagnostics?.experimentalFeatures],
  );
  const skillLabels = useMemo(
    () =>
      (skills ?? diagnostics?.skills ?? []).map((skill) => {
        const scope = humanizeIdentifier(skill.scope);
        return `${skill.name} · ${scope}`;
      }),
    [diagnostics?.skills, skills],
  );
  const appLabels = useMemo(
    () =>
      (diagnostics?.apps ?? []).map((app) => {
        const state = [
          app.isEnabled ? t("runtimePicker.fields.enabled") : null,
          app.isAccessible ? t("runtimePicker.fields.accessible") : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return state ? `${app.name} · ${state}` : app.name;
      }),
    [diagnostics?.apps, t],
  );
  const collaborationModes = useMemo(
    () =>
      (diagnostics?.collaborationModes ?? []).map((mode) => humanizeIdentifier(mode)),
    [diagnostics?.collaborationModes],
  );
  const planModeAdvertisement = useMemo<
    "advertised" | "notAdvertised" | "unknown"
  >(() => {
    if (!diagnostics) {
      return "unknown";
    }

    const collaborationModeStatus = diagnostics.methodAvailability.find(
      (entry) => entry.method === "collaborationMode/list",
    )?.status;
    if (collaborationModeStatus && collaborationModeStatus !== "available") {
      return "unknown";
    }

    return diagnostics.collaborationModes.includes("plan")
      ? "advertised"
      : "notAdvertised";
  }, [diagnostics]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      return;
    }

    const rect = triggerRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 500));
    setPos({
      bottom: window.innerHeight - rect.top + 6,
      left,
    });
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const account = diagnostics?.account;
  const config = diagnostics?.config;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`chat-toolbar-btn chat-toolbar-btn-bordered${open ? " chat-toolbar-btn-active" : ""}`}
        disabled={disabled}
        title={t("runtimePicker.title")}
        onClick={() => setOpen((current) => !current)}
      >
        <Monitor size={12} />
        <span style={{ fontSize: 11 }}>{t("runtimePicker.shortTitle")}</span>
        {issueCount > 0 ? (
          <span className="chat-toolbar-badge">{issueCount}</span>
        ) : null}
        <ChevronDown size={12} />
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className="codex-config-popover"
            style={{
              position: "fixed",
              zIndex: 1300,
              bottom: pos.bottom,
              left: pos.left,
              width: "min(480px, calc(100vw - 16px))",
              maxHeight: "min(72vh, 620px)",
              overflowY: "auto",
            }}
          >
            <div className="codex-config-header">
              <div>
                <div className="codex-config-title">{t("runtimePicker.title")}</div>
                <div className="codex-config-subtitle">
                  {t("runtimePicker.subtitle")}
                </div>
              </div>
              {issueCount > 0 ? (
                <span className="codex-config-count">
                  {t("runtimePicker.issues", { count: issueCount })}
                </span>
              ) : null}
            </div>

            {!diagnostics ? (
              <div className="codex-config-note">{t("runtimePicker.notLoaded")}</div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                <FieldRow
                  label={t("runtimePicker.status")}
                  value={
                    diagnostics.stale
                      ? t("runtimePicker.statusStale")
                      : t("runtimePicker.statusCurrent")
                  }
                />
                <FieldRow
                  label={t("runtimePicker.fetchedAt")}
                  value={formatTimestamp(diagnostics.fetchedAt) ?? t("runtimePicker.none")}
                />

                {account ? (
                  <Section title={t("runtimePicker.sections.account")}>
                    <FieldRow
                      label={t("runtimePicker.fields.provider")}
                      value={
                        account.provider === "none"
                          ? t("runtimePicker.none")
                          : humanizeIdentifier(account.provider)
                      }
                    />
                    <FieldRow
                      label={t("runtimePicker.fields.email")}
                      value={account.email ?? t("runtimePicker.none")}
                    />
                    <FieldRow
                      label={t("runtimePicker.fields.plan")}
                      value={
                        account.planType
                          ? humanizeIdentifier(account.planType)
                          : t("runtimePicker.none")
                      }
                    />
                    <FieldRow
                      label={t("runtimePicker.requiresOpenaiAuth")}
                      value={
                        account.requiresOpenaiAuth
                          ? t("runtimePicker.yes")
                          : t("runtimePicker.no")
                      }
                    />
                  </Section>
                ) : null}

                {config ? (
                  <Section title={t("runtimePicker.sections.config")}>
                    <FieldRow
                      label={t("runtimePicker.fields.model")}
                      value={config.model ?? t("runtimePicker.none")}
                    />
                    <FieldRow
                      label={t("runtimePicker.fields.modelProvider")}
                      value={
                        config.modelProvider
                          ? humanizeIdentifier(config.modelProvider)
                          : t("runtimePicker.none")
                      }
                    />
                    <FieldRow
                      label={t("runtimePicker.fields.serviceTier")}
                      value={
                        config.serviceTier
                          ? humanizeIdentifier(config.serviceTier)
                          : t("runtimePicker.none")
                      }
                    />
                    <FieldRow
                      label={t("runtimePicker.fields.approvalPolicy")}
                      value={formatJsonValue(config.approvalPolicy, t("runtimePicker.none"))}
                    />
                    <FieldRow
                      label={t("runtimePicker.fields.sandboxMode")}
                      value={
                        config.sandboxMode
                          ? humanizeIdentifier(config.sandboxMode)
                          : t("runtimePicker.none")
                      }
                    />
                    <FieldRow
                      label={t("runtimePicker.fields.webSearch")}
                      value={
                        config.webSearch
                          ? humanizeIdentifier(config.webSearch)
                          : t("runtimePicker.none")
                      }
                    />
                    <FieldRow
                      label={t("runtimePicker.fields.profile")}
                      value={config.profile ?? t("runtimePicker.none")}
                    />
                    <FieldRow
                      label={t("runtimePicker.fields.layers")}
                      value={
                        config.layers.length > 0 ? (
                          <div style={{ display: "grid", gap: 4 }}>
                            {config.layers.map((layer) => (
                              <div key={`${layer.source}-${layer.version}`}>
                                <span>{layer.source}</span>
                                <span style={{ color: "var(--text-3)" }}>
                                  {` · ${layer.version}`}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          t("runtimePicker.none")
                        )
                      }
                    />
                  </Section>
                ) : null}

                <Section title={t("runtimePicker.sections.modes")}>
                  <ChipList
                    items={collaborationModes}
                    emptyLabel={t("runtimePicker.none")}
                  />
                  <div className="codex-config-note">
                    {planModeAdvertisement === "advertised"
                      ? t("runtimePicker.planModePromptGuided")
                      : planModeAdvertisement === "notAdvertised"
                        ? t("runtimePicker.planModePromptGuidedFallback")
                        : t("runtimePicker.planModePromptGuidedUnknown")}
                  </div>
                </Section>

                <Section title={t("runtimePicker.sections.features")}>
                  <ChipList
                    items={enabledFeatures}
                    emptyLabel={t("runtimePicker.none")}
                  />
                </Section>

                <Section title={t("runtimePicker.sections.skills")}>
                  <ChipList
                    items={skillLabels}
                    emptyLabel={t("runtimePicker.none")}
                  />
                </Section>

                <Section title={t("runtimePicker.sections.apps")}>
                  <ChipList
                    items={appLabels}
                    emptyLabel={t("runtimePicker.none")}
                  />
                </Section>

                <Section title={t("runtimePicker.sections.plugins")}>
                  {diagnostics.pluginMarketplaces.length > 0 ? (
                    <div style={{ display: "grid", gap: 10 }}>
                      {diagnostics.pluginMarketplaces.map((marketplace) => (
                        <div
                          key={`${marketplace.name}-${marketplace.path}`}
                          style={{
                            display: "grid",
                            gap: 6,
                            padding: 10,
                            borderRadius: 10,
                            border: "1px solid var(--border)",
                            background: "var(--bg-2)",
                          }}
                        >
                          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-1)" }}>
                            {marketplace.name}
                          </div>
                          <div className="codex-config-note">{marketplace.path}</div>
                          <div style={{ display: "grid", gap: 6 }}>
                            {marketplace.plugins.map((plugin) => (
                              <div key={plugin.id}>
                                <div style={{ color: "var(--text-1)", fontSize: 11 }}>
                                  {plugin.name}
                                </div>
                                <div className="codex-config-note">
                                  {[
                                    plugin.developerName,
                                    plugin.capabilities.length > 0
                                      ? `${t("runtimePicker.fields.capabilities")}: ${plugin.capabilities
                                          .map((capability) => humanizeIdentifier(capability))
                                          .join(", ")}`
                                      : null,
                                    plugin.description,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ") || t("runtimePicker.none")}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="codex-config-note">{t("runtimePicker.none")}</div>
                  )}
                </Section>

                <Section title={t("runtimePicker.sections.mcpServers")}>
                  {diagnostics.mcpServers.length > 0 ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      {diagnostics.mcpServers.map((server) => (
                        <div
                          key={server.name}
                          style={{
                            display: "grid",
                            gap: 4,
                            padding: 10,
                            borderRadius: 10,
                            border: "1px solid var(--border)",
                            background: "var(--bg-2)",
                          }}
                        >
                          <div style={{ color: "var(--text-1)", fontSize: 11, fontWeight: 600 }}>
                            {server.name}
                          </div>
                          <div className="codex-config-note">
                            {`${t("runtimePicker.fields.authStatus")}: ${humanizeIdentifier(server.authStatus)}`}
                          </div>
                          <div className="codex-config-note">
                            {[
                              `${t("runtimePicker.fields.tools")}: ${server.toolCount}`,
                              `${t("runtimePicker.fields.resources")}: ${server.resourceCount}`,
                              `${t("runtimePicker.fields.templates")}: ${server.resourceTemplateCount}`,
                            ].join(" · ")}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="codex-config-note">{t("runtimePicker.none")}</div>
                  )}
                </Section>

                {methodIssues.length > 0 ? (
                  <Section title={t("runtimePicker.sections.methodIssues")}>
                    <div style={{ display: "grid", gap: 8 }}>
                      {methodIssues.map((issue) => (
                        <div
                          key={issue.method}
                          style={{
                            padding: 10,
                            borderRadius: 10,
                            background: "rgba(245, 158, 11, 0.10)",
                            border: "1px solid rgba(245, 158, 11, 0.22)",
                          }}
                        >
                          <div style={{ color: "var(--text-1)", fontSize: 11, fontWeight: 600 }}>
                            {issue.method}
                          </div>
                          <div className="codex-config-note">
                            {humanizeIdentifier(issue.status)}
                            {issue.detail ? ` · ${issue.detail}` : ""}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>
                ) : null}

                {(diagnostics.lastConfigWarning ||
                  diagnostics.lastAccountLogin ||
                  diagnostics.lastMcpOauth) ? (
                  <Section title={t("runtimePicker.sections.events")}>
                    <div style={{ display: "grid", gap: 8 }}>
                      {diagnostics.lastConfigWarning ? (
                        <div>
                          <div style={{ color: "var(--text-1)", fontSize: 11, fontWeight: 600 }}>
                            {t("runtimePicker.events.configWarning")}
                          </div>
                          <div className="codex-config-note">
                            {[
                              diagnostics.lastConfigWarning.summary,
                              diagnostics.lastConfigWarning.path,
                              diagnostics.lastConfigWarning.details,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        </div>
                      ) : null}
                      {diagnostics.lastAccountLogin ? (
                        <div>
                          <div style={{ color: "var(--text-1)", fontSize: 11, fontWeight: 600 }}>
                            {t("runtimePicker.events.accountLogin")}
                          </div>
                          <div className="codex-config-note">
                            {diagnostics.lastAccountLogin.success
                              ? t("runtimePicker.statusCurrent")
                              : diagnostics.lastAccountLogin.error ?? t("runtimePicker.unknown")}
                          </div>
                        </div>
                      ) : null}
                      {diagnostics.lastMcpOauth ? (
                        <div>
                          <div style={{ color: "var(--text-1)", fontSize: 11, fontWeight: 600 }}>
                            {t("runtimePicker.events.mcpOauth")}
                          </div>
                          <div className="codex-config-note">
                            {`${diagnostics.lastMcpOauth.name} · ${
                              diagnostics.lastMcpOauth.success
                                ? t("runtimePicker.statusCurrent")
                                : diagnostics.lastMcpOauth.error ?? t("runtimePicker.unknown")
                            }`}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </Section>
                ) : null}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
