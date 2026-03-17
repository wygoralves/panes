import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Copy,
  KeyRound,
  Loader2,
  MonitorSmartphone,
  RefreshCw,
  Shield,
  Square,
  Wifi,
} from "lucide-react";
import { copyTextToClipboard } from "../../lib/clipboard";
import { formatDateTime, formatRelativeTime } from "../../lib/formatters";
import {
  buildRemoteBrowserLink,
  buildRemoteConnectUrl,
  buildRemoteConnectionDetails,
  DEFAULT_REMOTE_HOST_BIND_ADDR,
  deriveRemoteConnectHost,
  parseRemoteBindAddr,
  buildRemoteWebUrl,
} from "../../lib/remoteConnection";
import { handleDragDoubleClick, handleDragMouseDown } from "../../lib/windowDrag";
import { ipc } from "../../lib/ipc";
import { useUiStore } from "../../stores/uiStore";
import { toast } from "../../stores/toastStore";
import {
  resolveRemoteAccessBindAddrDraft,
  resolveRemoteAccessConnectHostDraft,
} from "./remoteAccessDrafts";
import { Dropdown } from "../shared/Dropdown";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import type {
  CreatedRemoteDeviceGrant,
  RemoteAuditEvent,
  RemoteDeviceGrant,
  RemoteHostStatus,
} from "../../types";

type GrantPresetId = "viewer" | "controller";
type ExpiryPresetId = "never" | "day" | "week" | "month";
type GrantState = "active" | "expired" | "revoked";

interface GrantPreset {
  id: GrantPresetId;
  scopes: string[];
}

const GRANT_PRESETS: GrantPreset[] = [
  {
    id: "viewer",
    scopes: ["workspace.read", "repo.read", "thread.read", "terminal.read", "controller.read"],
  },
  {
    id: "controller",
    scopes: [
      "workspace.read",
      "repo.read",
      "thread.read",
      "terminal.read",
      "controller.read",
      "controller.write",
    ],
  },
];

function getGrantPreset(id: GrantPresetId): GrantPreset {
  return GRANT_PRESETS.find((preset) => preset.id === id) ?? GRANT_PRESETS[1];
}

function scopesMatchPreset(scopes: string[], preset: GrantPreset): boolean {
  if (scopes.length !== preset.scopes.length) {
    return false;
  }

  const current = [...scopes].sort();
  const expected = [...preset.scopes].sort();
  return current.every((scope, index) => scope === expected[index]);
}

function resolveGrantPresetId(scopes: string[]): GrantPresetId | null {
  const preset = GRANT_PRESETS.find((candidate) => scopesMatchPreset(scopes, candidate));
  return preset?.id ?? null;
}

function resolveGrantState(grant: RemoteDeviceGrant): GrantState {
  if (grant.revokedAt) {
    return "revoked";
  }
  if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.now()) {
    return "expired";
  }
  return "active";
}

function buildExpiryTimestamp(preset: ExpiryPresetId): string | null {
  if (preset === "never") {
    return null;
  }

  const millisByPreset: Record<Exclude<ExpiryPresetId, "never">, number> = {
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
  };

  return new Date(Date.now() + millisByPreset[preset]).toISOString();
}

function describeAuditTarget(event: RemoteAuditEvent): string {
  if (event.targetId) {
    return `${event.targetType}:${event.targetId}`;
  }
  return event.targetType;
}

export function RemoteAccessPage() {
  const { t, i18n } = useTranslation(["app", "common"]);
  const setActiveView = useUiStore((state) => state.setActiveView);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hostMutating, setHostMutating] = useState(false);
  const [grantMutating, setGrantMutating] = useState(false);
  const [hostStatus, setHostStatus] = useState<RemoteHostStatus | null>(null);
  const [bindAddrDraft, setBindAddrDraft] = useState(DEFAULT_REMOTE_HOST_BIND_ADDR);
  const [connectHostDraft, setConnectHostDraft] = useState("");
  const [grants, setGrants] = useState<RemoteDeviceGrant[]>([]);
  const [auditEvents, setAuditEvents] = useState<RemoteAuditEvent[]>([]);
  const [grantLabel, setGrantLabel] = useState("");
  const [grantPreset, setGrantPreset] = useState<GrantPresetId>("controller");
  const [grantExpiry, setGrantExpiry] = useState<ExpiryPresetId>("week");
  const [createdGrant, setCreatedGrant] = useState<CreatedRemoteDeviceGrant | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<RemoteDeviceGrant | null>(null);
  const bindAddrDirtyRef = useRef(false);
  const connectHostDirtyRef = useRef(false);

  const goBack = useCallback(() => setActiveView("chat"), [setActiveView]);

  const loadRemoteAccessState = useCallback(
    async (options?: { silent?: boolean }) => {
      if (options?.silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const [nextStatus, nextGrants, nextAuditEvents] = await Promise.all([
          ipc.getRemoteHostStatus(),
          ipc.listRemoteDeviceGrants(),
          ipc.listRemoteAuditEvents(10),
        ]);

        setHostStatus(nextStatus);
        setGrants(nextGrants);
        setAuditEvents(nextAuditEvents);
        setBindAddrDraft((current) =>
          resolveRemoteAccessBindAddrDraft(current, nextStatus.bindAddr, bindAddrDirtyRef.current),
        );
        setConnectHostDraft((current) =>
          resolveRemoteAccessConnectHostDraft(
            current,
            nextStatus.bindAddr ?? DEFAULT_REMOTE_HOST_BIND_ADDR,
            connectHostDirtyRef.current,
          ),
        );
      } catch {
        toast.error(t("app:remoteAccess.toasts.loadFailed"));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void loadRemoteAccessState();
  }, [loadRemoteAccessState]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        goBack();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [goBack]);

  const effectiveBindAddr =
    hostStatus?.bindAddr ?? (bindAddrDraft.trim() || DEFAULT_REMOTE_HOST_BIND_ADDR);
  const parsedBindAddr = parseRemoteBindAddr(effectiveBindAddr);
  const isLoopbackBinding =
    parsedBindAddr?.host === "127.0.0.1" || parsedBindAddr?.host === "::1";
  const needsAdvertisedHost = parsedBindAddr?.wildcard === true && !connectHostDraft.trim();
  const connectUrl = useMemo(
    () => buildRemoteConnectUrl(effectiveBindAddr, connectHostDraft),
    [connectHostDraft, effectiveBindAddr],
  );
  const browserBaseUrl = useMemo(
    () =>
      hostStatus?.webBindAddr
        ? buildRemoteWebUrl(hostStatus.webBindAddr, connectHostDraft)
        : "",
    [connectHostDraft, hostStatus?.webBindAddr],
  );
  const createdBrowserLink = useMemo(
    () =>
      createdGrant
        ? buildRemoteBrowserLink(
            hostStatus?.webBindAddr ?? "",
            effectiveBindAddr,
            createdGrant.token,
            connectHostDraft,
          )
        : "",
    [connectHostDraft, createdGrant, effectiveBindAddr, hostStatus?.webBindAddr],
  );
  const runningHostSummary = hostStatus?.bindAddr ?? t("app:remoteAccess.host.notRunning");

  async function copyValue(
    text: string,
    successKey: string,
    failureKey: string,
  ) {
    if (!text.trim()) {
      toast.error(t(failureKey));
      return;
    }

    try {
      await copyTextToClipboard(text);
      toast.success(t(successKey));
    } catch {
      toast.error(t(failureKey));
    }
  }

  async function handleStartHost() {
    const bindAddr = bindAddrDraft.trim() || DEFAULT_REMOTE_HOST_BIND_ADDR;
    if (!parseRemoteBindAddr(bindAddr)) {
      toast.error(t("app:remoteAccess.toasts.invalidBindAddr"));
      return;
    }

    setHostMutating(true);
    try {
      const nextStatus = await ipc.startRemoteHost(bindAddr);
      setHostStatus(nextStatus);
      setBindAddrDraft(nextStatus.bindAddr ?? bindAddr);
      bindAddrDirtyRef.current = false;
      setConnectHostDraft((current) =>
        resolveRemoteAccessConnectHostDraft(
          current,
          nextStatus.bindAddr ?? bindAddr,
          connectHostDirtyRef.current,
        ),
      );
      toast.success(t("app:remoteAccess.toasts.hostStarted"));
    } catch {
      toast.error(t("app:remoteAccess.toasts.hostStartFailed"));
    } finally {
      setHostMutating(false);
    }
  }

  async function handleStopHost() {
    setHostMutating(true);
    try {
      const nextStatus = await ipc.stopRemoteHost();
      setHostStatus(nextStatus);
      toast.success(t("app:remoteAccess.toasts.hostStopped"));
    } catch {
      toast.error(t("app:remoteAccess.toasts.hostStopFailed"));
    } finally {
      setHostMutating(false);
    }
  }

  async function handleCreateGrant() {
    const label = grantLabel.trim();
    if (!label) {
      toast.error(t("app:remoteAccess.toasts.labelRequired"));
      return;
    }

    setGrantMutating(true);
    try {
      const created = await ipc.createRemoteDeviceGrant(
        label,
        getGrantPreset(grantPreset).scopes,
        buildExpiryTimestamp(grantExpiry),
      );
      setCreatedGrant(created);
      setGrantLabel("");
      await loadRemoteAccessState({ silent: true });
      toast.success(t("app:remoteAccess.toasts.grantCreated"));
    } catch {
      toast.error(t("app:remoteAccess.toasts.grantCreateFailed"));
    } finally {
      setGrantMutating(false);
    }
  }

  async function handleConfirmRevoke() {
    if (!revokeTarget) {
      return;
    }

    setGrantMutating(true);
    try {
      await ipc.revokeRemoteDeviceGrant(revokeTarget.id);
      setRevokeTarget(null);
      await loadRemoteAccessState({ silent: true });
      toast.success(t("app:remoteAccess.toasts.grantRevoked"));
    } catch {
      toast.error(t("app:remoteAccess.toasts.grantRevokeFailed"));
    } finally {
      setGrantMutating(false);
    }
  }

  if (loading) {
    return (
      <div className="wsp-root">
        <div className="wsp-scroll">
          <div className="wsp-inner">
            <div className="remote-access-loading">
              <Loader2 size={16} className="remote-access-spinner" />
              <span>{t("app:remoteAccess.loading")}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="wsp-root">
        <div className="wsp-scroll">
          <div className="wsp-inner">
            <div
              className="wsp-header"
              onMouseDown={handleDragMouseDown}
              onDoubleClick={handleDragDoubleClick}
            >
              <button type="button" className="wsp-back" onClick={goBack} title={t("common:actions.close")}>
                <ArrowLeft size={14} />
              </button>
              <div className="wsp-header-icon">
                <Shield size={18} />
              </div>
              <div className="wsp-header-text">
                <h1 className="wsp-title">{t("app:remoteAccess.title")}</h1>
                <p className="wsp-path">{t("app:remoteAccess.subtitle")}</p>
              </div>
              <button
                type="button"
                className="ws-prop-btn"
                onClick={() => void loadRemoteAccessState({ silent: true })}
                disabled={refreshing || hostMutating || grantMutating}
              >
                <RefreshCw size={11} className={refreshing ? "remote-access-spinner" : undefined} />
                {t("app:remoteAccess.actions.refresh")}
              </button>
            </div>

            <div className="wsp-content">
              <div className="wsp-section">
                <div className="wsp-section-label">{t("app:remoteAccess.sections.host")}</div>
                <div className="wsp-card remote-access-stack">
                  <div className="wsp-field">
                    <span className="wsp-field-label">{t("app:remoteAccess.host.statusLabel")}</span>
                    <div className="remote-access-field-main">
                      <span className="wsp-field-value wsp-mono" title={runningHostSummary}>
                        {runningHostSummary}
                      </span>
                      <span className={`remote-access-pill remote-access-pill-${hostStatus?.running ? "active" : "idle"}`}>
                        {hostStatus?.running
                          ? t("app:remoteAccess.host.running")
                          : t("app:remoteAccess.host.stopped")}
                      </span>
                    </div>
                  </div>

                  <div className="wsp-field-divider" />

                  <div className="wsp-field remote-access-field-block">
                    <div className="remote-access-form-field">
                      <span className="wsp-field-label">{t("app:remoteAccess.host.bindLabel")}</span>
                      <input
                        className="git-inline-input"
                        value={bindAddrDraft}
                        onChange={(event) => {
                          bindAddrDirtyRef.current = true;
                          setBindAddrDraft(event.target.value);
                        }}
                        placeholder={DEFAULT_REMOTE_HOST_BIND_ADDR}
                        spellCheck={false}
                      />
                      <p className="remote-access-help">{t("app:remoteAccess.host.bindHint")}</p>
                    </div>
                  </div>

                  <div className="wsp-field-divider" />

                  <div className="wsp-field remote-access-field-block">
                    <div className="remote-access-form-field">
                      <span className="wsp-field-label">{t("app:remoteAccess.host.connectHostLabel")}</span>
                      <input
                        className="git-inline-input"
                        value={connectHostDraft}
                        onChange={(event) => {
                          connectHostDirtyRef.current = true;
                          setConnectHostDraft(event.target.value);
                        }}
                        placeholder={deriveRemoteConnectHost(effectiveBindAddr)}
                        spellCheck={false}
                      />
                      <p className="remote-access-help">{t("app:remoteAccess.host.connectHostHint")}</p>
                    </div>
                  </div>

                  <div className="wsp-field-divider" />

                  <div className="wsp-field remote-access-field-block">
                    <div className="remote-access-form-field">
                      <span className="wsp-field-label">{t("app:remoteAccess.host.urlLabel")}</span>
                      <div className="remote-access-field-main">
                        <span className="wsp-field-value wsp-mono" title={connectUrl || ""}>
                          {connectUrl || t("app:remoteAccess.host.urlUnavailable")}
                        </span>
                        <button
                          type="button"
                          className="ws-prop-btn"
                          onClick={() =>
                            void copyValue(
                              connectUrl,
                              "app:remoteAccess.toasts.urlCopied",
                              "app:remoteAccess.toasts.urlCopyFailed",
                            )}
                          disabled={!connectUrl}
                        >
                          <Copy size={11} />
                          {t("common:actions.copy")}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="wsp-field-divider" />

                  <div className="wsp-field remote-access-field-block">
                    <div className="remote-access-form-field">
                      <span className="wsp-field-label">{t("app:remoteAccess.host.webLabel")}</span>
                      <div className="remote-access-field-main">
                        <span className="wsp-field-value wsp-mono" title={browserBaseUrl || ""}>
                          {browserBaseUrl || t("app:remoteAccess.host.webUnavailable")}
                        </span>
                        <button
                          type="button"
                          className="ws-prop-btn"
                          onClick={() =>
                            void copyValue(
                              browserBaseUrl,
                              "app:remoteAccess.toasts.webCopied",
                              "app:remoteAccess.toasts.webCopyFailed",
                            )}
                          disabled={!browserBaseUrl}
                        >
                          <Copy size={11} />
                          {t("common:actions.copy")}
                        </button>
                      </div>
                    </div>
                  </div>

                  {isLoopbackBinding && (
                    <div className="remote-access-note">
                      {t("app:remoteAccess.host.loopbackWarning")}
                    </div>
                  )}
                  {needsAdvertisedHost && (
                    <div className="remote-access-note">
                      {t("app:remoteAccess.host.connectHostRequired")}
                    </div>
                  )}

                  <div className="remote-access-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void handleStartHost()}
                      disabled={hostMutating}
                    >
                      <Wifi size={12} />
                      {hostMutating
                        ? t("app:remoteAccess.actions.updating")
                        : t("app:remoteAccess.actions.startHost")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => void handleStopHost()}
                      disabled={!hostStatus?.running || hostMutating}
                    >
                      <Square size={12} />
                      {t("app:remoteAccess.actions.stopHost")}
                    </button>
                  </div>
                </div>
              </div>

              <div className="wsp-section">
                <div className="wsp-section-label">{t("app:remoteAccess.sections.grants")}</div>
                <div className="wsp-card remote-access-stack">
                  <div className="remote-access-grid">
                    <div className="remote-access-form-field">
                      <span className="wsp-field-label">{t("app:remoteAccess.grants.labelLabel")}</span>
                      <input
                        className="git-inline-input"
                        value={grantLabel}
                        onChange={(event) => setGrantLabel(event.target.value)}
                        placeholder={t("app:remoteAccess.grants.labelPlaceholder")}
                        spellCheck={false}
                      />
                    </div>

                    <div className="remote-access-form-field">
                      <span className="wsp-field-label">{t("app:remoteAccess.grants.accessLabel")}</span>
                      <Dropdown
                        options={[
                          {
                            value: "viewer",
                            label: t("app:remoteAccess.grants.presets.viewer.title"),
                          },
                          {
                            value: "controller",
                            label: t("app:remoteAccess.grants.presets.controller.title"),
                          },
                        ]}
                        value={grantPreset}
                        onChange={(value) => setGrantPreset(value as GrantPresetId)}
                      />
                      <p className="remote-access-help">
                        {grantPreset === "controller"
                          ? t("app:remoteAccess.grants.presets.controller.description")
                          : t("app:remoteAccess.grants.presets.viewer.description")}
                      </p>
                    </div>

                    <div className="remote-access-form-field">
                      <span className="wsp-field-label">{t("app:remoteAccess.grants.expiryLabel")}</span>
                      <Dropdown
                        options={[
                          { value: "never", label: t("app:remoteAccess.grants.expiry.never") },
                          { value: "day", label: t("app:remoteAccess.grants.expiry.day") },
                          { value: "week", label: t("app:remoteAccess.grants.expiry.week") },
                          { value: "month", label: t("app:remoteAccess.grants.expiry.month") },
                        ]}
                        value={grantExpiry}
                        onChange={(value) => setGrantExpiry(value as ExpiryPresetId)}
                      />
                    </div>
                  </div>

                  <div className="remote-access-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void handleCreateGrant()}
                      disabled={grantMutating}
                    >
                      <KeyRound size={12} />
                      {grantMutating
                        ? t("app:remoteAccess.actions.creatingGrant")
                        : t("app:remoteAccess.actions.createGrant")}
                    </button>
                  </div>

                  {createdGrant && (
                    <div className="remote-access-created-card">
                      <div className="remote-access-created-header">
                        <span className="remote-access-created-title">
                          {t("app:remoteAccess.grants.createdTitle", {
                            label: createdGrant.grant.label,
                          })}
                        </span>
                        <span className="remote-access-pill remote-access-pill-active">
                          {t("app:remoteAccess.grants.createdOnlyOnce")}
                        </span>
                      </div>
                      <div className="remote-access-secret wsp-mono">{createdGrant.token}</div>
                      <div className="remote-access-actions">
                        <button
                          type="button"
                          className="btn btn-outline"
                          onClick={() =>
                            void copyValue(
                              createdGrant.token,
                              "app:remoteAccess.toasts.tokenCopied",
                              "app:remoteAccess.toasts.tokenCopyFailed",
                            )}
                        >
                          <Copy size={12} />
                          {t("app:remoteAccess.actions.copyToken")}
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline"
                          onClick={() =>
                            void copyValue(
                              createdBrowserLink,
                              "app:remoteAccess.toasts.linkCopied",
                              "app:remoteAccess.toasts.linkCopyFailed",
                            )}
                          disabled={!createdBrowserLink}
                        >
                          <MonitorSmartphone size={12} />
                          {t("app:remoteAccess.actions.copyLink")}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() =>
                            void copyValue(
                              buildRemoteConnectionDetails(
                                effectiveBindAddr,
                                createdGrant.token,
                                connectHostDraft,
                              ),
                              "app:remoteAccess.toasts.detailsCopied",
                              "app:remoteAccess.toasts.detailsCopyFailed",
                            )}
                        >
                          <MonitorSmartphone size={12} />
                          {t("app:remoteAccess.actions.copyDetails")}
                        </button>
                      </div>
                    </div>
                  )}

                  {grants.length === 0 ? (
                    <div className="wsp-empty">{t("app:remoteAccess.grants.empty")}</div>
                  ) : (
                    <div className="remote-access-list">
                      {grants.map((grant) => {
                        const state = resolveGrantState(grant);
                        const presetId = resolveGrantPresetId(grant.scopes);
                        return (
                          <div key={grant.id} className="remote-access-list-row">
                            <div className="remote-access-list-main">
                              <div className="remote-access-list-topline">
                                <span className="remote-access-list-title">{grant.label}</span>
                                <span className={`remote-access-pill remote-access-pill-${state}`}>
                                  {t(`app:remoteAccess.grants.states.${state}`)}
                                </span>
                                <span className="remote-access-pill remote-access-pill-muted">
                                  {presetId
                                    ? t(`app:remoteAccess.grants.presets.${presetId}.title`)
                                    : t("app:remoteAccess.grants.presets.custom")}
                                </span>
                              </div>
                              <div className="remote-access-meta">
                                <span>
                                  {t("app:remoteAccess.grants.createdAt", {
                                    value: formatDateTime(grant.createdAt, i18n.language),
                                  })}
                                </span>
                                <span>
                                  {grant.lastUsedAt
                                    ? t("app:remoteAccess.grants.lastUsedAt", {
                                        value: formatRelativeTime(grant.lastUsedAt, i18n.language, {
                                          style: "short-with-suffix",
                                        }),
                                      })
                                    : t("app:remoteAccess.grants.neverUsed")}
                                </span>
                                <span>
                                  {grant.expiresAt
                                    ? t("app:remoteAccess.grants.expiresAt", {
                                        value: formatDateTime(grant.expiresAt, i18n.language),
                                      })
                                    : t("app:remoteAccess.grants.noExpiry")}
                                </span>
                              </div>
                              {!presetId && (
                                <div className="remote-access-help wsp-mono">
                                  {grant.scopes.join(", ")}
                                </div>
                              )}
                            </div>
                            <button
                              type="button"
                              className="btn btn-danger-ghost"
                              onClick={() => setRevokeTarget(grant)}
                              disabled={grantMutating || state !== "active"}
                            >
                              {t("app:remoteAccess.actions.revokeGrant")}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="wsp-section">
                <div className="wsp-section-label">{t("app:remoteAccess.sections.audit")}</div>
                <div className="wsp-card remote-access-stack">
                  {auditEvents.length === 0 ? (
                    <div className="wsp-empty">{t("app:remoteAccess.audit.empty")}</div>
                  ) : (
                    <div className="remote-access-list">
                      {auditEvents.map((event) => (
                        <div key={event.id} className="remote-access-list-row">
                          <div className="remote-access-list-main">
                            <div className="remote-access-list-topline">
                              <span className="remote-access-list-title">
                                {t(`app:remoteAccess.audit.actions.${event.actionType}`, {
                                  defaultValue: event.actionType,
                                })}
                              </span>
                              <span className="remote-access-pill remote-access-pill-muted">
                                {describeAuditTarget(event)}
                              </span>
                            </div>
                            <div className="remote-access-meta">
                              <span>
                                {t("app:remoteAccess.audit.occurredAt", {
                                  value: formatRelativeTime(event.createdAt, i18n.language, {
                                    style: "short-with-suffix",
                                  }),
                                })}
                              </span>
                              {event.deviceGrantId && (
                                <span className="wsp-mono">
                                  {t("app:remoteAccess.audit.deviceGrant", {
                                    id: event.deviceGrantId,
                                  })}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={revokeTarget !== null}
        title={
          revokeTarget
            ? t("app:remoteAccess.grants.revokeTitle", { label: revokeTarget.label })
            : ""
        }
        message={
          revokeTarget
            ? t("app:remoteAccess.grants.revokeMessage", { label: revokeTarget.label })
            : ""
        }
        confirmLabel={t("app:remoteAccess.actions.revokeGrant")}
        cancelLabel={t("common:actions.cancel")}
        onConfirm={() => void handleConfirmRevoke()}
        onCancel={() => setRevokeTarget(null)}
      />
    </>
  );
}
