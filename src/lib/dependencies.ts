import type { DepStatus, DependencyReport } from "../types";

type DependencyReportLike = Partial<Omit<DependencyReport, "node" | "codex" | "git">> & {
  node?: Partial<DepStatus> | null;
  codex?: Partial<DepStatus> | null;
  git?: Partial<DepStatus> | null;
};

function normalizeDepStatus(status?: Partial<DepStatus> | null): DepStatus {
  return {
    found: status?.found === true,
    version: typeof status?.version === "string" ? status.version : null,
    path: typeof status?.path === "string" ? status.path : null,
    canAutoInstall: status?.canAutoInstall === true,
    installMethod: typeof status?.installMethod === "string" ? status.installMethod : null,
  };
}

export function normalizeDependencyReport(
  report?: DependencyReportLike | null,
): DependencyReport {
  return {
    node: normalizeDepStatus(report?.node),
    codex: normalizeDepStatus(report?.codex),
    git: normalizeDepStatus(report?.git),
    platform: typeof report?.platform === "string" ? report.platform : "unknown",
    packageManagers: Array.isArray(report?.packageManagers)
      ? report.packageManagers.filter((value): value is string => typeof value === "string")
      : [],
  };
}
