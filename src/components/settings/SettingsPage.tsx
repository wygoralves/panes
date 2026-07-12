import { useEffect, useMemo, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpCircle,
  BadgeInfo,
  BatteryCharging,
  BellRing,
  CheckCircle2,
  ChevronRight,
  Download,
  FolderGit2,
  GitBranch,
  Globe2,
  LayoutGrid,
  LockKeyhole,
  Minus,
  Monitor,
  Moon,
  Palette,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sun,
  TerminalSquare,
  Clock3,
  Volume2,
  Zap,
} from "lucide-react";
import { ipc } from "../../lib/ipc";
import {
  emitTerminalAcceleratedRenderingChanged,
  getTerminalAcceleratedRenderingPreferenceVersion,
} from "../../lib/terminalRenderingSettings";
import {
  clampTerminalFontSize,
  DEFAULT_TERMINAL_FONT_SIZE,
  emitTerminalFontSizeChanged,
  getTerminalFontSizePreferenceVersion,
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
} from "../../lib/terminalFontSizeSettings";
import {
  normalizeAppLocale,
  SUPPORTED_APP_LOCALES,
  type AppLocale,
} from "../../lib/locale";
import { THEME_PREFERENCES, type ThemePreference } from "../../lib/theme";
import { useKeepAwakeStore, canToggleKeepAwake } from "../../stores/keepAwakeStore";
import { useTerminalNotificationSettingsStore } from "../../stores/terminalNotificationSettingsStore";
import { useThemeStore } from "../../stores/themeStore";
import { toast } from "../../stores/toastStore";
import { useUiStore, type SettingsSection } from "../../stores/uiStore";
import { useUpdateStore } from "../../stores/updateStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { getHarnessIcon } from "../shared/HarnessLogos";
import { Dropdown } from "../shared/Dropdown";
import { PanesMark, PanesWordmark } from "../shared/PanesBrand";
import { WorkspaceSettingsPage } from "../workspace/WorkspaceSettingsPage";
import type {
  PowerSettingsInput,
  TerminalNotificationIntegrationId,
  TerminalNotificationIntegrationStatus,
} from "../../types";

const SOUND_OPTIONS = [
  "Glass",
  "Ping",
  "Pop",
  "Purr",
  "Tink",
  "Blow",
  "Bottle",
  "Frog",
  "Funk",
  "Hero",
  "Morse",
  "Sosumi",
  "Submarine",
  "Basso",
] as const;

interface SettingsRowProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  children?: React.ReactNode;
  onActivate?: () => void;
}

function SettingsRow({ icon, title, description, children, onActivate }: SettingsRowProps) {
  const content = (
    <>
      <span className="usp-row-icon">{icon}</span>
      <span className="usp-row-copy">
        <span className="usp-row-title">{title}</span>
        <span className="usp-row-description">{description}</span>
      </span>
      {children ? <div className="usp-row-control">{children}</div> : null}
      {onActivate ? <ChevronRight size={14} className="usp-row-chevron" /> : null}
    </>
  );

  if (onActivate) {
    return (
      <button type="button" className="usp-row usp-row-action" onClick={onActivate}>
        {content}
      </button>
    );
  }

  return <div className="usp-row">{content}</div>;
}

interface ToggleProps {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}

function Toggle({ checked, disabled = false, label, onChange }: ToggleProps) {
  return (
    <label className="ws-toggle" title={label}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="ws-toggle-track" />
      <span className="ws-toggle-thumb" />
    </label>
  );
}

function formatRemaining(seconds?: number | null) {
  if (seconds == null) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatBytes(bytes: number, locale: string) {
  const units = ["B", "KB", "MB", "GB"];
  let value = Math.max(0, bytes);
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const formatted = new Intl.NumberFormat(locale, {
    maximumFractionDigits: unitIndex === 0 ? 0 : 1,
  }).format(value);
  return `${formatted} ${units[unitIndex]}`;
}

function workspaceSection(section: SettingsSection) {
  if (section === "workspace-repos") return "repos" as const;
  if (section === "workspace-startup") return "startup" as const;
  return "general" as const;
}

export function SettingsPage() {
  const { t, i18n } = useTranslation(["app", "common", "workspace"]);
  const section = useUiStore((state) => state.settingsSection);
  const setSection = useUiStore((state) => state.setSettingsSection);
  const settingsWorkspaceId = useUiStore((state) => state.settingsWorkspaceId);
  const setSettingsWorkspaceId = useUiStore((state) => state.setSettingsWorkspaceId);
  const setActiveView = useUiStore((state) => state.setActiveView);
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const activeRepos = useWorkspaceStore((state) => state.repos);
  const themePreference = useThemeStore((state) => state.preference);
  const setThemePreference = useThemeStore((state) => state.setPreference);
  const updateStatus = useUpdateStore((state) => state.status);
  const availableVersion = useUpdateStore((state) => state.version);
  const updateError = useUpdateStore((state) => state.error);
  const lastCheckedAt = useUpdateStore((state) => state.lastCheckedAt);
  const downloadPhase = useUpdateStore((state) => state.downloadPhase);
  const downloadedBytes = useUpdateStore((state) => state.downloadedBytes);
  const totalBytes = useUpdateStore((state) => state.totalBytes);
  const checkForUpdate = useUpdateStore((state) => state.checkForUpdate);
  const downloadAndInstall = useUpdateStore((state) => state.downloadAndInstall);
  const keepAwakeState = useKeepAwakeStore((state) => state.state);
  const keepAwakeLoading = useKeepAwakeStore((state) => state.loading);
  const toggleKeepAwake = useKeepAwakeStore((state) => state.toggle);
  const powerSettings = useKeepAwakeStore((state) => state.powerSettings);
  const powerSettingsLoading = useKeepAwakeStore((state) => state.powerSettingsLoading);
  const powerSettingsLoaded = useKeepAwakeStore((state) => state.powerSettingsLoaded);
  const loadPowerSettings = useKeepAwakeStore((state) => state.loadPowerSettings);
  const savePowerSettings = useKeepAwakeStore((state) => state.savePowerSettings);
  const helperStatus = useKeepAwakeStore((state) => state.helperStatus);
  const helperLoading = useKeepAwakeStore((state) => state.helperLoading);
  const loadHelperStatus = useKeepAwakeStore((state) => state.loadHelperStatus);
  const registerHelper = useKeepAwakeStore((state) => state.registerHelper);
  const notificationSettings = useTerminalNotificationSettingsStore((state) => state.settings);
  const notificationLoading = useTerminalNotificationSettingsStore((state) => state.loading);
  const notificationLoaded = useTerminalNotificationSettingsStore((state) => state.loadedOnce);
  const updatingChat = useTerminalNotificationSettingsStore((state) => state.updatingChatEnabled);
  const updatingTerminal = useTerminalNotificationSettingsStore((state) => state.updatingTerminalEnabled);
  const installingIntegration = useTerminalNotificationSettingsStore((state) => state.installingIntegration);
  const loadNotifications = useTerminalNotificationSettingsStore((state) => state.load);
  const setChatEnabled = useTerminalNotificationSettingsStore((state) => state.setChatEnabled);
  const setTerminalEnabled = useTerminalNotificationSettingsStore((state) => state.setTerminalEnabled);
  const setNotificationSound = useTerminalNotificationSettingsStore((state) => state.setNotificationSound);
  const previewSound = useTerminalNotificationSettingsStore((state) => state.previewSound);
  const installIntegration = useTerminalNotificationSettingsStore((state) => state.installIntegration);

  const [query, setQuery] = useState("");
  const [terminalAcceleratedRendering, setTerminalAcceleratedRendering] = useState(true);
  const [terminalFontSize, setTerminalFontSize] = useState(DEFAULT_TERMINAL_FONT_SIZE);
  const [updatingTerminalPreference, setUpdatingTerminalPreference] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [powerDraft, setPowerDraft] = useState<PowerSettingsInput | null>(null);
  const [customHours, setCustomHours] = useState("");
  const [customMinutes, setCustomMinutes] = useState("");

  const activeLocale = normalizeAppLocale(i18n.language);
  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === settingsWorkspaceId)
    ?? workspaces.find((workspace) => workspace.id === activeWorkspaceId)
    ?? workspaces[0]
    ?? null;
  const isWorkspaceSection = section.startsWith("workspace-");
  const isMacOS = navigator.platform.startsWith("Mac");

  useEffect(() => {
    void getVersion().then(setAppVersion).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!settingsWorkspaceId && selectedWorkspace) {
      setSettingsWorkspaceId(selectedWorkspace.id);
    }
  }, [selectedWorkspace, setSettingsWorkspaceId, settingsWorkspaceId]);

  useEffect(() => {
    if (!notificationLoaded && !notificationLoading) {
      void loadNotifications();
    }
  }, [loadNotifications, notificationLoaded, notificationLoading]);

  useEffect(() => {
    if (section !== "power" || powerSettingsLoaded || powerSettingsLoading) return;
    void loadPowerSettings();
  }, [loadPowerSettings, powerSettingsLoaded, powerSettingsLoading, section]);

  useEffect(() => {
    if (!powerSettings) return;
    setPowerDraft({ ...powerSettings });
    const duration = powerSettings.sessionDurationSecs;
    if (duration != null && ![1800, 3600, 7200].includes(duration)) {
      setCustomHours(String(Math.floor(duration / 3600) || ""));
      setCustomMinutes(String(Math.floor((duration % 3600) / 60) || ""));
    } else {
      setCustomHours("");
      setCustomMinutes("");
    }
  }, [powerSettings]);

  useEffect(() => {
    if (section === "power" && isMacOS && !helperStatus && !helperLoading) {
      void loadHelperStatus();
    }
  }, [helperLoading, helperStatus, isMacOS, loadHelperStatus, section]);

  useEffect(() => {
    let cancelled = false;
    const renderingVersion = getTerminalAcceleratedRenderingPreferenceVersion();
    const fontVersion = getTerminalFontSizePreferenceVersion();

    void ipc.getTerminalAcceleratedRendering()
      .then((enabled) => {
        if (!cancelled && renderingVersion === getTerminalAcceleratedRenderingPreferenceVersion()) {
          setTerminalAcceleratedRendering(enabled);
        }
      })
      .catch(() => undefined);
    void ipc.getTerminalFontSize()
      .then((fontSize) => {
        if (!cancelled && fontVersion === getTerminalFontSizePreferenceVersion()) {
          setTerminalFontSize(fontSize);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActiveView("chat");
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [setActiveView]);

  const navItems = useMemo(
    () => [
      { id: "overview" as const, icon: <LayoutGrid size={15} />, label: t("app:settingsPage.nav.overview") },
      { id: "appearance" as const, icon: <Palette size={15} />, label: t("app:settingsPage.nav.appearance") },
      { id: "terminal" as const, icon: <TerminalSquare size={15} />, label: t("app:settingsPage.nav.terminal") },
      { id: "notifications" as const, icon: <BellRing size={15} />, label: t("app:settingsPage.nav.notifications") },
      { id: "power" as const, icon: <Zap size={15} />, label: t("app:settingsPage.nav.power") },
      { id: "about" as const, icon: <BadgeInfo size={15} />, label: t("app:settingsPage.nav.about") },
      { id: "workspace-general" as const, icon: <FolderGit2 size={15} />, label: t("workspace:nav.general") },
      { id: "workspace-repos" as const, icon: <GitBranch size={15} />, label: t("workspace:nav.repositories") },
      { id: "workspace-startup" as const, icon: <Play size={15} />, label: t("workspace:nav.startup") },
    ],
    [t],
  );

  const normalizedQuery = query.trim().toLocaleLowerCase(i18n.language);
  const filteredNavItems = normalizedQuery
    ? navItems.filter((item) => item.label.toLocaleLowerCase(i18n.language).includes(normalizedQuery))
    : navItems;
  const globalNavItems = filteredNavItems.filter((item) => !item.id.startsWith("workspace-"));
  const workspaceNavItems = filteredNavItems.filter((item) => item.id.startsWith("workspace-"));

  const sectionTitle = t(`app:settingsPage.sections.${section}.title`);
  const sectionDescription = t(`app:settingsPage.sections.${section}.description`);
  const remaining = formatRemaining(keepAwakeState?.sessionRemainingSecs);
  const keepAwakeDescription = !keepAwakeState?.supported
    ? t("app:sidebar.keepAwakeUnsupported")
    : keepAwakeState.enabled && keepAwakeState.active
      ? remaining
        ? t("app:settingsPage.overview.keepAwakeRemaining", { time: remaining })
        : t("app:settingsPage.overview.keepAwakeActive")
      : t("app:settingsPage.overview.keepAwakeOff");
  const notificationsDescription = notificationSettings?.chatEnabled && notificationSettings.terminalEnabled
    ? t("app:sidebar.terminalNotificationsEnabledAll")
    : notificationSettings?.chatEnabled
      ? t("app:sidebar.terminalNotificationsEnabledChat")
      : notificationSettings?.terminalEnabled
        ? t("app:sidebar.terminalNotificationsEnabledTerminal")
        : t("app:settingsPage.overview.notificationsOff");
  const lastCheckedLabel = lastCheckedAt
    ? new Intl.DateTimeFormat(i18n.language, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(lastCheckedAt)
    : null;
  const downloadPercent = totalBytes && totalBytes > 0
    ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
    : null;
  const downloadedSizeLabel = formatBytes(downloadedBytes, i18n.language);
  const totalSizeLabel = totalBytes ? formatBytes(totalBytes, i18n.language) : null;

  const updateStatusContent = (() => {
    if (updateStatus === "checking") {
      return {
        icon: <RefreshCw size={17} className="usp-spin" />,
        title: t("app:settingsPage.about.checkingTitle"),
        description: t("app:settingsPage.about.checkingDescription"),
      };
    }
    if (updateStatus === "available") {
      return {
        icon: <ArrowUpCircle size={17} />,
        title: t("app:updates.availableTitle", { version: availableVersion }),
        description: t("app:updates.availableMessage"),
      };
    }
    if (updateStatus === "downloading") {
      if (downloadPhase === "installing") {
        return {
          icon: <Download size={17} />,
          title: t("app:settingsPage.about.installingTitle"),
          description: t("app:settingsPage.about.installingDescription"),
        };
      }
      return {
        icon: <Download size={17} />,
        title: t("app:settingsPage.about.downloadingTitle"),
        description: totalSizeLabel && downloadPercent != null
          ? t("app:settingsPage.about.downloadingProgress", {
              downloaded: downloadedSizeLabel,
              total: totalSizeLabel,
              percent: downloadPercent,
            })
          : downloadedBytes > 0
            ? t("app:settingsPage.about.downloadingUnknown", { downloaded: downloadedSizeLabel })
            : t("app:settingsPage.about.preparingDownload"),
      };
    }
    if (updateStatus === "ready") {
      return {
        icon: <CheckCircle2 size={17} />,
        title: t("app:settingsPage.about.readyTitle"),
        description: t("app:settingsPage.about.readyDescription"),
      };
    }
    if (updateStatus === "error") {
      return {
        icon: <AlertCircle size={17} className="usp-status-icon-error" />,
        title: t("app:updates.failedTitle"),
        description: updateError || t("app:updates.failedMessage"),
      };
    }
    if (lastCheckedLabel) {
      return {
        icon: <CheckCircle2 size={17} />,
        title: t("app:settingsPage.about.upToDateTitle"),
        description: t("app:settingsPage.about.lastChecked", { time: lastCheckedLabel }),
      };
    }
    return {
      icon: <RefreshCw size={17} />,
      title: t("app:settingsPage.about.automaticTitle"),
      description: t("app:settingsPage.about.automaticDescription"),
    };
  })();

  async function changeLocale(locale: AppLocale) {
    if (locale === activeLocale) return;
    try {
      const savedLocale = await ipc.setAppLocale(locale);
      await i18n.changeLanguage(savedLocale);
      toast.info(t("common:language.changed"));
    } catch {
      toast.error(t("app:sidebar.languageFailed"));
    }
  }

  async function changeTheme(theme: ThemePreference) {
    if (theme === themePreference) return;
    const saved = await setThemePreference(theme);
    if (!saved) toast.error(t("app:sidebar.themeFailed"));
  }

  async function toggleAcceleratedRendering(enabled: boolean) {
    if (updatingTerminalPreference) return;
    setUpdatingTerminalPreference(true);
    try {
      const saved = await ipc.setTerminalAcceleratedRendering(enabled);
      setTerminalAcceleratedRendering(saved);
      emitTerminalAcceleratedRenderingChanged(saved);
    } catch {
      toast.error(t("app:sidebar.terminalAcceleratedRenderingFailed"));
    } finally {
      setUpdatingTerminalPreference(false);
    }
  }

  async function changeTerminalFontSize(delta: number) {
    const next = clampTerminalFontSize(terminalFontSize + delta);
    if (next === terminalFontSize || updatingTerminalPreference) return;
    setUpdatingTerminalPreference(true);
    try {
      const saved = await ipc.setTerminalFontSize(next);
      setTerminalFontSize(saved);
      emitTerminalFontSizeChanged(saved);
    } catch {
      toast.error(t("app:sidebar.terminalFontSizeFailed"));
    } finally {
      setUpdatingTerminalPreference(false);
    }
  }

  function updatePowerDraft(patch: Partial<PowerSettingsInput>) {
    setPowerDraft((current) => current ? { ...current, ...patch } : current);
  }

  function updateCustomDuration(hours: string, minutes: string) {
    setCustomHours(hours);
    setCustomMinutes(minutes);
    const parsedHours = Math.max(0, Number(hours) || 0);
    const parsedMinutes = Math.max(0, Number(minutes) || 0);
    const seconds = Math.round((parsedHours * 3600) + (parsedMinutes * 60));
    updatePowerDraft({ sessionDurationSecs: seconds > 0 ? seconds : 3600 });
  }

  async function savePowerDraft() {
    if (!powerDraft || powerSettingsLoading || keepAwakeLoading) return;
    await savePowerSettings(powerDraft);
  }

  function renderIntegration(
    id: TerminalNotificationIntegrationId,
    status: TerminalNotificationIntegrationStatus | undefined,
  ) {
    const configured = status?.configured ?? false;
    const installing = installingIntegration === id;
    const actionLabel = configured
      ? t("app:notificationSettings.reinstall")
      : status?.conflict
        ? t("app:notificationSettings.replace")
        : t("app:notificationSettings.install");
    return (
      <SettingsRow
        icon={getHarnessIcon(id === "claude" ? "claude-code" : "codex", 16)}
        title={t(`app:notificationSettings.integrations.${id}.title`)}
        description={t(`app:notificationSettings.integrations.${id}.description`)}
      >
        <span className={`usp-status${configured ? " usp-status-ready" : ""}`}>
          {configured
            ? t("app:notificationSettings.status.installed")
            : t("app:notificationSettings.status.needsAttention")}
        </span>
        <button
          type="button"
          className="usp-button"
          disabled={notificationLoading || installingIntegration !== null}
          onClick={() => void installIntegration(id)}
        >
          <Download size={13} />
          {installing ? t("app:notificationSettings.installing") : actionLabel}
        </button>
      </SettingsRow>
    );
  }

  return (
    <div className="usp-root">
      <aside className="usp-nav" aria-label={t("app:settingsPage.navigationLabel")}>
        <div className="usp-nav-top">
          <div className="usp-brand">
            <PanesMark size={34} />
            <span className="usp-brand-copy">
              <PanesWordmark width={68} />
              <span className="usp-brand-version">
                {appVersion ? `v${appVersion}` : t("app:settingsPage.versionUnavailable")}
              </span>
            </span>
          </div>
          <div className="usp-search">
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("app:settingsPage.searchPlaceholder")}
              aria-label={t("app:settingsPage.searchPlaceholder")}
            />
          </div>
        </div>

        <div className="usp-nav-scroll">
          {globalNavItems.length > 0 ? (
            <div className="usp-nav-group">
              <div className="usp-nav-group-label">{t("app:settingsPage.groups.panes")}</div>
              {globalNavItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`usp-nav-item${section === item.id ? " usp-nav-item-active" : ""}`}
                  onClick={() => setSection(item.id)}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ) : null}

          {workspaceNavItems.length > 0 ? (
            <div className="usp-nav-group">
              <div className="usp-nav-group-label">{t("app:settingsPage.groups.workspace")}</div>
              {workspaceNavItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`usp-nav-item${section === item.id ? " usp-nav-item-active" : ""}`}
                  disabled={!selectedWorkspace}
                  onClick={() => setSection(item.id)}
                >
                  {item.icon}
                  <span>{item.label}</span>
                  {item.id === "workspace-repos" && selectedWorkspace?.id === activeWorkspaceId && activeRepos.length > 0 ? (
                    <span className="usp-nav-count">{activeRepos.length}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}

          {filteredNavItems.length === 0 ? (
            <div className="usp-nav-empty">{t("app:settingsPage.noResults")}</div>
          ) : null}
        </div>

        <button type="button" className="usp-back" onClick={() => setActiveView("chat")}>
          <ArrowLeft size={15} />
          {t("app:settingsPage.backToPanes")}
        </button>
      </aside>

      <div className="usp-main-scroll">
        <main className="usp-main">
          <header className="usp-page-header">
            <div className="usp-page-heading-row">
              <div>
                <h1>{sectionTitle}</h1>
                <p>{sectionDescription}</p>
              </div>
              {isWorkspaceSection && selectedWorkspace ? (
                <div className="usp-workspace-selector">
                  <span>{t("app:settingsPage.editingWorkspace")}</span>
                  <Dropdown
                    value={selectedWorkspace.id}
                    options={workspaces.map((workspace) => ({
                      value: workspace.id,
                      label: workspace.name || workspace.rootPath.split("/").pop() || t("workspace:general.workspaceFallback"),
                      icon: <FolderGit2 size={13} />,
                    }))}
                    onChange={setSettingsWorkspaceId}
                    triggerStyle={{ minWidth: 160, height: 32 }}
                  />
                </div>
              ) : null}
            </div>
          </header>

          {section === "overview" ? (
            <>
              {notificationSettings && (!notificationSettings.claude.configured || !notificationSettings.codex.configured) ? (
                <div className="usp-notice">
                  <BellRing size={17} />
                  <div>
                    <strong>{t("app:settingsPage.overview.setupTitle")}</strong>
                    <span>{t("app:settingsPage.overview.setupDescription")}</span>
                  </div>
                  <button type="button" className="usp-button" onClick={() => setSection("notifications")}>
                    {t("app:settingsPage.overview.reviewSetup")}
                  </button>
                </div>
              ) : null}

              <section className="usp-section">
                <div className="usp-section-header">
                  <h2>{t("app:settingsPage.overview.quickControls")}</h2>
                  <p>{t("app:settingsPage.overview.quickControlsDescription")}</p>
                </div>
                <div className="usp-group">
                  <SettingsRow icon={<Zap size={17} />} title={t("app:sidebar.keepAwake")} description={keepAwakeDescription}>
                    <Toggle
                      checked={keepAwakeState?.enabled ?? false}
                      disabled={keepAwakeLoading || !canToggleKeepAwake(keepAwakeState)}
                      label={t("app:sidebar.keepAwake")}
                      onChange={() => void toggleKeepAwake()}
                    />
                  </SettingsRow>
                  <SettingsRow
                    icon={<BellRing size={17} />}
                    title={t("app:sidebar.terminalNotifications")}
                    description={notificationsDescription}
                    onActivate={() => setSection("notifications")}
                  />
                  <SettingsRow
                    icon={<TerminalSquare size={17} />}
                    title={t("app:settingsPage.nav.terminal")}
                    description={t("app:settingsPage.overview.terminalSummary", { size: terminalFontSize })}
                    onActivate={() => setSection("terminal")}
                  />
                  <SettingsRow
                    icon={<Palette size={17} />}
                    title={t("app:settingsPage.nav.appearance")}
                    description={t(`app:sidebar.theme_${themePreference}`)}
                    onActivate={() => setSection("appearance")}
                  />
                </div>
              </section>

              <section className="usp-section">
                <div className="usp-section-header">
                  <h2>{t("app:settingsPage.overview.currentWorkspace")}</h2>
                  <p>{selectedWorkspace?.rootPath ?? t("app:settingsPage.overview.noWorkspace")}</p>
                </div>
                <div className="usp-group">
                  <SettingsRow
                    icon={<FolderGit2 size={17} />}
                    title={selectedWorkspace?.name || t("workspace:general.workspaceFallback")}
                    description={t("app:settingsPage.overview.workspaceGeneralDescription")}
                    onActivate={selectedWorkspace ? () => setSection("workspace-general") : undefined}
                  />
                  <SettingsRow
                    icon={<GitBranch size={17} />}
                    title={t("workspace:nav.repositories")}
                    description={t("app:settingsPage.overview.repositoriesDescription")}
                    onActivate={selectedWorkspace ? () => setSection("workspace-repos") : undefined}
                  />
                  <SettingsRow
                    icon={<Play size={17} />}
                    title={t("workspace:nav.startup")}
                    description={t("app:settingsPage.overview.startupDescription")}
                    onActivate={selectedWorkspace ? () => setSection("workspace-startup") : undefined}
                  />
                </div>
              </section>
            </>
          ) : null}

          {section === "appearance" ? (
            <section className="usp-section usp-section-first">
              <div className="usp-section-header">
                <h2>{t("app:settingsPage.appearance.interface")}</h2>
                <p>{t("app:settingsPage.appearance.interfaceDescription")}</p>
              </div>
              <div className="usp-group">
                <SettingsRow icon={<Palette size={17} />} title={t("app:sidebar.theme")} description={t("app:settingsPage.appearance.themeDescription")}>
                  <div className="usp-segmented">
                    {THEME_PREFERENCES.map((theme) => {
                      const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
                      return (
                        <button
                          key={theme}
                          type="button"
                          className={themePreference === theme ? "usp-segment-active" : ""}
                          onClick={() => void changeTheme(theme)}
                        >
                          <ThemeIcon size={13} />
                          {t(`app:sidebar.theme_${theme}`)}
                        </button>
                      );
                    })}
                  </div>
                </SettingsRow>
                <SettingsRow icon={<Globe2 size={17} />} title={t("common:language.label")} description={t("app:settingsPage.appearance.languageDescription")}>
                  <Dropdown
                    value={activeLocale}
                    options={SUPPORTED_APP_LOCALES.map((locale) => ({
                      value: locale,
                      label: locale === "en" ? t("common:language.english") : t("common:language.portugueseBrazil"),
                    }))}
                    onChange={(value) => void changeLocale(value as AppLocale)}
                    triggerStyle={{ minWidth: 154, height: 32 }}
                  />
                </SettingsRow>
              </div>
            </section>
          ) : null}

          {section === "terminal" ? (
            <section className="usp-section usp-section-first">
              <div className="usp-section-header">
                <h2>{t("app:settingsPage.terminal.display")}</h2>
                <p>{t("app:settingsPage.terminal.displayDescription")}</p>
              </div>
              <div className="usp-group">
                <SettingsRow
                  icon={<TerminalSquare size={17} />}
                  title={t("app:sidebar.terminalFontSize")}
                  description={t("app:settingsPage.terminal.fontDescription")}
                >
                  <div className="usp-stepper">
                    <button
                      type="button"
                      aria-label={t("app:sidebar.terminalFontSizeDecrease")}
                      disabled={updatingTerminalPreference || terminalFontSize <= MIN_TERMINAL_FONT_SIZE}
                      onClick={() => void changeTerminalFontSize(-1)}
                    >
                      <Minus size={13} />
                    </button>
                    <span>{terminalFontSize}px</span>
                    <button
                      type="button"
                      aria-label={t("app:sidebar.terminalFontSizeIncrease")}
                      disabled={updatingTerminalPreference || terminalFontSize >= MAX_TERMINAL_FONT_SIZE}
                      onClick={() => void changeTerminalFontSize(1)}
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                </SettingsRow>
                <SettingsRow
                  icon={<Zap size={17} />}
                  title={t("app:sidebar.terminalAcceleratedRendering")}
                  description={t("app:settingsPage.terminal.acceleratedDescription")}
                >
                  <Toggle
                    checked={terminalAcceleratedRendering}
                    disabled={updatingTerminalPreference}
                    label={t("app:sidebar.terminalAcceleratedRendering")}
                    onChange={(enabled) => void toggleAcceleratedRendering(enabled)}
                  />
                </SettingsRow>
              </div>
              <div className="usp-terminal-preview" style={{ fontSize: terminalFontSize }}>
                <div><span>➜</span> ~/panes pnpm typecheck</div>
                <p>{t("app:settingsPage.terminal.previewOutput")}</p>
                <div><span>➜</span> ~/panes <i /></div>
              </div>
            </section>
          ) : null}

          {section === "notifications" ? (
            <>
              <section className="usp-section usp-section-first">
                <div className="usp-section-header">
                  <h2>{t("app:notificationSettings.title")}</h2>
                  <p>{t("app:notificationSettings.description")}</p>
                </div>
                <div className="usp-group">
                  <SettingsRow icon={<BellRing size={17} />} title={t("app:notificationSettings.chatCard.title")} description={t("app:notificationSettings.chatCard.descriptionShort")}>
                    <Toggle
                      checked={notificationSettings?.chatEnabled ?? false}
                      disabled={notificationLoading || updatingChat}
                      label={t("app:notificationSettings.chatCard.title")}
                      onChange={(enabled) => void setChatEnabled(enabled)}
                    />
                  </SettingsRow>
                  <SettingsRow icon={<TerminalSquare size={17} />} title={t("app:notificationSettings.terminalCard.title")} description={t("app:notificationSettings.terminalCard.descriptionShort")}>
                    <Toggle
                      checked={notificationSettings?.terminalEnabled ?? false}
                      disabled={notificationLoading || updatingTerminal || installingIntegration !== null}
                      label={t("app:notificationSettings.terminalCard.title")}
                      onChange={(enabled) => void setTerminalEnabled(enabled)}
                    />
                  </SettingsRow>
                  <SettingsRow icon={<Volume2 size={17} />} title={t("app:notificationSettings.sound.title")} description={t("app:notificationSettings.sound.description")}>
                    <Dropdown
                      value={notificationSettings?.notificationSound ?? "none"}
                      disabled={notificationLoading}
                      options={[
                        { value: "none", label: t("app:notificationSettings.sound.none") },
                        ...SOUND_OPTIONS.map((sound) => ({ value: sound, label: sound })),
                      ]}
                      onChange={(value) => void setNotificationSound(value)}
                      triggerStyle={{ minWidth: 128, height: 32 }}
                    />
                    <button
                      type="button"
                      className="usp-icon-button"
                      disabled={!notificationSettings?.notificationSound}
                      title={t("app:notificationSettings.sound.preview")}
                      aria-label={t("app:notificationSettings.sound.preview")}
                      onClick={() => void previewSound(notificationSettings?.notificationSound ?? "Glass")}
                    >
                      <Play size={13} />
                    </button>
                  </SettingsRow>
                </div>
              </section>
              <section className="usp-section">
                <div className="usp-section-header">
                  <h2>{t("app:notificationSettings.integrationsLabel")}</h2>
                  <p>{t("app:notificationSettings.workflowShort")}</p>
                </div>
                <div className="usp-group">
                  {renderIntegration("claude", notificationSettings?.claude)}
                  {renderIntegration("codex", notificationSettings?.codex)}
                </div>
              </section>
            </>
          ) : null}

          {section === "power" ? (
            <>
              <section className="usp-section usp-section-first">
                <div className="usp-power-status">
                  <span className="usp-power-icon"><Zap size={19} /></span>
                  <div>
                    <strong>{keepAwakeState?.active ? t("app:powerModal.statusActive") : t("app:powerModal.statusPaused")}</strong>
                    <span>{keepAwakeDescription}</span>
                  </div>
                  <Toggle
                    checked={powerDraft?.keepAwakeEnabled ?? keepAwakeState?.enabled ?? false}
                    disabled={!powerDraft || powerSettingsLoading || !canToggleKeepAwake(keepAwakeState)}
                    label={t("app:sidebar.keepAwake")}
                    onChange={(enabled) => updatePowerDraft({ keepAwakeEnabled: enabled })}
                  />
                </div>
              </section>

              <section className="usp-section">
                <div className="usp-section-header">
                  <h2>{t("app:powerModal.displaySection")}</h2>
                  <p>{t("app:settingsPage.power.displaySummary")}</p>
                </div>
                <div className="usp-group">
                  <SettingsRow icon={<Monitor size={17} />} title={t("app:powerModal.preventDisplaySleep")} description={t("app:powerModal.preventDisplaySleepDescription")}>
                    <Toggle
                      checked={powerDraft?.preventDisplaySleep ?? false}
                      disabled={!powerDraft || !powerDraft.keepAwakeEnabled}
                      label={t("app:powerModal.preventDisplaySleep")}
                      onChange={(enabled) => updatePowerDraft({ preventDisplaySleep: enabled })}
                    />
                  </SettingsRow>
                  <SettingsRow icon={<Monitor size={17} />} title={t("app:powerModal.preventScreenSaver")} description={t("app:powerModal.preventScreenSaverDescription")}>
                    <Toggle
                      checked={powerDraft?.preventScreenSaver ?? false}
                      disabled={!powerDraft || !powerDraft.keepAwakeEnabled}
                      label={t("app:powerModal.preventScreenSaver")}
                      onChange={(enabled) => updatePowerDraft({ preventScreenSaver: enabled })}
                    />
                  </SettingsRow>
                </div>
              </section>

              <section className="usp-section">
                <div className="usp-section-header">
                  <h2>{t("app:powerModal.powerSourceSection")}</h2>
                  <p>{t("app:settingsPage.power.sourceSummary")}</p>
                </div>
                <div className="usp-group">
                  <SettingsRow icon={<BatteryCharging size={17} />} title={t("app:powerModal.acOnlyMode")} description={t("app:powerModal.acOnlyModeDescription")}>
                    <Toggle
                      checked={powerDraft?.acOnlyMode ?? false}
                      disabled={!powerDraft || !powerDraft.keepAwakeEnabled}
                      label={t("app:powerModal.acOnlyMode")}
                      onChange={(enabled) => updatePowerDraft({ acOnlyMode: enabled })}
                    />
                  </SettingsRow>
                  <SettingsRow icon={<BatteryCharging size={17} />} title={t("app:powerModal.batteryThreshold")} description={t("app:powerModal.batteryThresholdDescription")}>
                    <div className="usp-threshold-control">
                      {powerDraft?.batteryThreshold != null ? (
                        <label className="usp-number-field">
                          <input
                            type="number"
                            min={1}
                            max={99}
                            value={powerDraft.batteryThreshold}
                            disabled={!powerDraft.keepAwakeEnabled}
                            onChange={(event) => updatePowerDraft({
                              batteryThreshold: Math.max(1, Math.min(99, Number(event.target.value))),
                            })}
                          />
                          <span>%</span>
                        </label>
                      ) : null}
                      <Toggle
                        checked={powerDraft?.batteryThreshold != null}
                        disabled={!powerDraft || !powerDraft.keepAwakeEnabled}
                        label={t("app:powerModal.batteryThreshold")}
                        onChange={(enabled) => updatePowerDraft({ batteryThreshold: enabled ? 20 : null })}
                      />
                    </div>
                  </SettingsRow>
                </div>
              </section>

              <section className="usp-section">
                <div className="usp-section-header">
                  <h2>{t("app:powerModal.sessionSection")}</h2>
                  <p>{t("app:settingsPage.power.sessionDescription")}</p>
                </div>
                <div className="usp-group">
                  <SettingsRow icon={<Clock3 size={17} />} title={t("app:powerModal.fixedDuration")} description={t("app:settingsPage.power.durationDescription")}>
                    <Dropdown
                      value={powerDraft?.sessionDurationSecs == null
                        ? "indefinite"
                        : [1800, 3600, 7200].includes(powerDraft.sessionDurationSecs)
                          ? String(powerDraft.sessionDurationSecs)
                          : "custom"}
                      disabled={!powerDraft || !powerDraft.keepAwakeEnabled}
                      options={[
                        { value: "indefinite", label: t("app:powerModal.indefinite") },
                        { value: "1800", label: t("app:powerModal.duration30m") },
                        { value: "3600", label: t("app:powerModal.duration1h") },
                        { value: "7200", label: t("app:powerModal.duration2h") },
                        { value: "custom", label: t("app:powerModal.durationCustom") },
                      ]}
                      onChange={(value) => {
                        if (value === "indefinite") {
                          updatePowerDraft({ sessionDurationSecs: null });
                          return;
                        }
                        if (value === "custom") {
                          updateCustomDuration(customHours || "1", customMinutes);
                          return;
                        }
                        setCustomHours("");
                        setCustomMinutes("");
                        updatePowerDraft({ sessionDurationSecs: Number(value) });
                      }}
                      triggerStyle={{ minWidth: 132, height: 32 }}
                    />
                  </SettingsRow>
                  {powerDraft?.sessionDurationSecs != null && ![1800, 3600, 7200].includes(powerDraft.sessionDurationSecs) ? (
                    <SettingsRow icon={<Clock3 size={17} />} title={t("app:powerModal.durationCustom")} description={t("app:settingsPage.power.customDurationDescription")}>
                      <div className="usp-duration-inputs">
                        <label className="usp-number-field">
                          <input
                            type="number"
                            min={0}
                            value={customHours}
                            onChange={(event) => updateCustomDuration(event.target.value, customMinutes)}
                          />
                          <span>{t("app:powerModal.customHours")}</span>
                        </label>
                        <label className="usp-number-field">
                          <input
                            type="number"
                            min={0}
                            max={59}
                            value={customMinutes}
                            onChange={(event) => updateCustomDuration(customHours, event.target.value)}
                          />
                          <span>{t("app:powerModal.customMinutesShort")}</span>
                        </label>
                      </div>
                    </SettingsRow>
                  ) : null}
                </div>
              </section>

              {isMacOS ? (
                <section className="usp-section">
                  <div className="usp-section-header">
                    <h2>{t("app:powerModal.closedDisplaySection")}</h2>
                    <p>{t("app:settingsPage.power.advancedSummary")}</p>
                  </div>
                  <div className="usp-group">
                    <SettingsRow icon={<LockKeyhole size={17} />} title={t("app:powerModal.preventClosedDisplaySleep")} description={t("app:powerModal.preventClosedDisplaySleepDescription")}>
                      <Toggle
                        checked={powerDraft?.preventClosedDisplaySleep ?? false}
                        disabled={!powerDraft || !powerDraft.keepAwakeEnabled}
                        label={t("app:powerModal.preventClosedDisplaySleep")}
                        onChange={(enabled) => updatePowerDraft({ preventClosedDisplaySleep: enabled })}
                      />
                    </SettingsRow>
                    <SettingsRow
                      icon={helperStatus?.status === "registered" ? <CheckCircle2 size={17} /> : <Download size={17} />}
                      title={helperStatus?.status === "registered" ? t("app:powerModal.helperInstalled") : t("app:powerModal.helperNotInstalled")}
                      description={helperStatus?.status === "requiresApproval" ? t("app:powerModal.helperApprovalNote") : t("app:powerModal.helperPasswordFallback")}
                    >
                      {helperStatus?.status !== "registered" ? (
                        <button type="button" className="usp-button" disabled={helperLoading} onClick={() => void registerHelper()}>
                          <Download size={13} />
                          {helperLoading ? t("app:powerModal.helperInstallingButton") : t("app:powerModal.helperInstallButton")}
                        </button>
                      ) : null}
                    </SettingsRow>
                  </div>
                </section>
              ) : null}

              <div className="usp-power-actions">
                <button
                  type="button"
                  className="usp-button usp-button-primary"
                  disabled={!powerDraft || powerSettingsLoading || keepAwakeLoading}
                  onClick={() => void savePowerDraft()}
                >
                  {powerSettingsLoading ? t("app:settingsPage.power.loading") : t("app:powerModal.save")}
                </button>
              </div>
            </>
          ) : null}

          {section === "about" ? (
            <section className="usp-section usp-section-first">
              <div className="usp-section-header">
                <h2>{t("app:settingsPage.about.application")}</h2>
                <p>{t("app:settingsPage.about.applicationDescription")}</p>
              </div>
              <div className="usp-group">
                <SettingsRow
                  icon={<PanesMark size={17} />}
                  title={t("app:settingsPage.about.installedVersion")}
                  description={t("app:settingsPage.about.installedVersionDescription")}
                >
                  <span className="usp-version-value">
                    {appVersion ? `v${appVersion}` : t("app:settingsPage.versionUnavailable")}
                  </span>
                </SettingsRow>
                <SettingsRow
                  icon={updateStatusContent.icon}
                  title={updateStatusContent.title}
                  description={updateStatusContent.description}
                >
                  {updateStatus === "available" ? (
                    <button
                      type="button"
                      className="usp-button usp-button-primary"
                      onClick={() => void downloadAndInstall()}
                    >
                      <Download size={13} />
                      {t("app:updates.install")}
                    </button>
                  ) : updateStatus === "downloading" ? (
                    <div className="usp-update-progress">
                      <span className="usp-update-progress-value">
                        {downloadPhase === "installing"
                          ? t("app:settingsPage.about.installing")
                          : downloadPercent != null
                            ? `${downloadPercent}%`
                            : downloadedSizeLabel}
                      </span>
                      <div
                        className="usp-update-progress-track"
                        role="progressbar"
                        aria-label={updateStatusContent.title}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={downloadPhase === "installing" ? 100 : downloadPercent ?? undefined}
                        aria-valuetext={updateStatusContent.description}
                      >
                        <span
                          className={downloadPercent == null && downloadPhase !== "installing"
                            ? "usp-update-progress-bar usp-update-progress-bar-indeterminate"
                            : "usp-update-progress-bar"}
                          style={downloadPercent != null || downloadPhase === "installing"
                            ? { width: `${downloadPhase === "installing" ? 100 : downloadPercent}%` }
                            : undefined}
                        />
                      </div>
                    </div>
                  ) : updateStatus === "ready" ? null : updateStatus === "error" ? (
                    <button
                      type="button"
                      className="usp-button usp-button-primary"
                      onClick={() => void checkForUpdate()}
                    >
                      <RefreshCw size={13} />
                      {t("common:actions.retry")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="usp-button"
                      disabled={updateStatus === "checking"}
                      onClick={() => void checkForUpdate()}
                    >
                      <RefreshCw size={13} className={updateStatus === "checking" ? "usp-spin" : undefined} />
                      {updateStatus === "checking"
                        ? t("app:settingsPage.about.checking")
                        : t("app:settingsPage.about.checkForUpdates")}
                    </button>
                  )}
                </SettingsRow>
              </div>
            </section>
          ) : null}

          {isWorkspaceSection ? (
            selectedWorkspace ? (
              <div className="usp-workspace-content">
                <WorkspaceSettingsPage embedded section={workspaceSection(section)} />
              </div>
            ) : (
              <div className="usp-empty-state">{t("app:settingsPage.overview.noWorkspace")}</div>
            )
          ) : null}
        </main>
      </div>
    </div>
  );
}
