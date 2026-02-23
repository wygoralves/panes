import { create } from "zustand";
import type { LLMContextFile, LLMProvider, Repo } from "../types";
import { ipc } from "../lib/ipc";

// ── Known LLM context file patterns ────────────────────────────────

interface ContextFilePattern {
  /** Paths relative to repo root to check */
  paths: string[];
  provider: LLMProvider;
  providerLabel: string;
}

const CONTEXT_FILE_PATTERNS: ContextFilePattern[] = [
  {
    paths: ["CLAUDE.md", "claude.md", ".claude/settings.json"],
    provider: "claude",
    providerLabel: "Claude Code",
  },
  {
    paths: ["AGENTS.md", "agents.md", "codex.md"],
    provider: "codex",
    providerLabel: "OpenAI Codex",
  },
  {
    paths: [".github/copilot-instructions.md", ".github/copilot-overview.md"],
    provider: "copilot",
    providerLabel: "GitHub Copilot",
  },
  {
    paths: [".cursorrules", ".cursor/rules.md", ".cursor/rules"],
    provider: "cursor",
    providerLabel: "Cursor",
  },
  {
    paths: ["gemini.md", ".gemini/settings.json"],
    provider: "gemini",
    providerLabel: "Google Gemini",
  },
  {
    paths: [".clinerules", ".cline/rules.md"],
    provider: "cline",
    providerLabel: "Cline",
  },
  {
    paths: [".windsurfrules"],
    provider: "windsurf",
    providerLabel: "Windsurf",
  },
  {
    paths: [".ai/instructions.md", "rules.md"],
    provider: "generic",
    providerLabel: "Generic",
  },
];

/** All candidate paths flattened (for scanning) */
const ALL_CANDIDATE_PATHS = CONTEXT_FILE_PATTERNS.flatMap((p) => p.paths);

function matchProvider(
  relativePath: string,
): { provider: LLMProvider; providerLabel: string } | null {
  for (const pattern of CONTEXT_FILE_PATTERNS) {
    if (pattern.paths.includes(relativePath)) {
      return { provider: pattern.provider, providerLabel: pattern.providerLabel };
    }
  }
  return null;
}

function fileId(repoId: string, relativePath: string): string {
  return `${repoId}::${relativePath}`;
}

// ── Creatable templates ─────────────────────────────────────────────

export interface ContextFileTemplate {
  provider: LLMProvider;
  providerLabel: string;
  fileName: string;
  relativePath: string;
  defaultContent: string;
}

export const CONTEXT_FILE_TEMPLATES: ContextFileTemplate[] = [
  {
    provider: "claude",
    providerLabel: "Claude Code",
    fileName: "CLAUDE.md",
    relativePath: "CLAUDE.md",
    defaultContent:
      "# Project Instructions for Claude\n\n## Overview\nDescribe your project here.\n\n## Guidelines\n- Follow existing code style\n- Write tests for new features\n",
  },
  {
    provider: "codex",
    providerLabel: "OpenAI Codex",
    fileName: "AGENTS.md",
    relativePath: "AGENTS.md",
    defaultContent:
      "# Agent Instructions\n\n## Overview\nDescribe your project here.\n\n## Guidelines\n- Follow existing code style\n",
  },
  {
    provider: "copilot",
    providerLabel: "GitHub Copilot",
    fileName: "copilot-instructions.md",
    relativePath: ".github/copilot-instructions.md",
    defaultContent:
      "# Copilot Instructions\n\n## Project Context\nDescribe your project here.\n\n## Coding Standards\n- Follow existing patterns\n",
  },
  {
    provider: "cursor",
    providerLabel: "Cursor",
    fileName: ".cursorrules",
    relativePath: ".cursorrules",
    defaultContent:
      "# Cursor Rules\n\nYou are an expert developer working on this project.\n\n## Guidelines\n- Follow existing code style\n",
  },
  {
    provider: "gemini",
    providerLabel: "Google Gemini",
    fileName: "gemini.md",
    relativePath: "gemini.md",
    defaultContent:
      "# Gemini Instructions\n\n## Overview\nDescribe your project here.\n\n## Guidelines\n- Follow existing code style\n",
  },
  {
    provider: "windsurf",
    providerLabel: "Windsurf",
    fileName: ".windsurfrules",
    relativePath: ".windsurfrules",
    defaultContent:
      "# Windsurf Rules\n\nYou are an expert developer working on this project.\n",
  },
  {
    provider: "cline",
    providerLabel: "Cline",
    fileName: ".clinerules",
    relativePath: ".clinerules",
    defaultContent:
      "# Cline Rules\n\nYou are an expert developer working on this project.\n",
  },
];

// ── Store ───────────────────────────────────────────────────────────

interface ContextState {
  /** Detected context files keyed by workspace ID */
  filesByWorkspace: Record<string, LLMContextFile[]>;
  /** Currently selected file for preview/edit */
  activeFile: LLMContextFile | null;
  /** Loading state per workspace */
  scanning: Record<string, boolean>;
  /** Whether the context panel modal is open */
  panelOpen: boolean;

  openPanel: () => void;
  closePanel: () => void;
  scanWorkspace: (workspaceId: string, repos: Repo[]) => Promise<void>;
  loadFileContent: (file: LLMContextFile) => Promise<void>;
  setActiveFile: (file: LLMContextFile | null) => void;
  saveFileContent: (file: LLMContextFile, content: string) => Promise<void>;
  createContextFile: (
    repo: Repo,
    template: ContextFileTemplate,
  ) => Promise<LLMContextFile | null>;
}

export const useContextStore = create<ContextState>((set, get) => ({
  filesByWorkspace: {},
  activeFile: null,
  scanning: {},
  panelOpen: false,

  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false, activeFile: null }),

  scanWorkspace: async (workspaceId, repos) => {
    set((s) => ({ scanning: { ...s.scanning, [workspaceId]: true } }));

    const detected: LLMContextFile[] = [];

    for (const repo of repos) {
      // Try reading each candidate file to see if it exists
      const checks = ALL_CANDIDATE_PATHS.map(async (relativePath) => {
        try {
          const result = await ipc.readFile(repo.path, relativePath);
          const match = matchProvider(relativePath);
          if (!match) return null;

          return {
            id: fileId(repo.id, relativePath),
            repoId: repo.id,
            repoName: repo.name,
            repoPath: repo.path,
            relativePath,
            fileName: relativePath.split("/").pop() ?? relativePath,
            provider: match.provider,
            providerLabel: match.providerLabel,
            exists: true,
            content: result.isBinary ? undefined : result.content,
            sizeBytes: result.sizeBytes,
          } satisfies LLMContextFile;
        } catch {
          // File doesn't exist, skip
          return null;
        }
      });

      const results = await Promise.all(checks);
      for (const r of results) {
        if (r) detected.push(r);
      }
    }

    set((s) => ({
      filesByWorkspace: { ...s.filesByWorkspace, [workspaceId]: detected },
      scanning: { ...s.scanning, [workspaceId]: false },
    }));
  },

  loadFileContent: async (file) => {
    try {
      const result = await ipc.readFile(file.repoPath, file.relativePath);
      const updated: LLMContextFile = {
        ...file,
        content: result.isBinary ? undefined : result.content,
        sizeBytes: result.sizeBytes,
      };
      set({ activeFile: updated });
    } catch (error) {
      console.error("Failed to load context file:", error);
    }
  },

  setActiveFile: (file) => set({ activeFile: file }),

  saveFileContent: async (file, content) => {
    try {
      await ipc.writeFile(file.repoPath, file.relativePath, content);
      const updated: LLMContextFile = { ...file, content };

      // Update in workspace cache
      set((s) => {
        const wsFiles = Object.entries(s.filesByWorkspace);
        const nextFilesByWorkspace = { ...s.filesByWorkspace };
        for (const [wsId, files] of wsFiles) {
          const idx = files.findIndex((f) => f.id === file.id);
          if (idx >= 0) {
            const nextFiles = [...files];
            nextFiles[idx] = updated;
            nextFilesByWorkspace[wsId] = nextFiles;
          }
        }
        return {
          filesByWorkspace: nextFilesByWorkspace,
          activeFile: s.activeFile?.id === file.id ? updated : s.activeFile,
        };
      });
    } catch (error) {
      console.error("Failed to save context file:", error);
      throw error;
    }
  },

  createContextFile: async (repo, template) => {
    try {
      await ipc.writeFile(repo.path, template.relativePath, template.defaultContent);
      const newFile: LLMContextFile = {
        id: fileId(repo.id, template.relativePath),
        repoId: repo.id,
        repoName: repo.name,
        repoPath: repo.path,
        relativePath: template.relativePath,
        fileName: template.fileName,
        provider: template.provider,
        providerLabel: template.providerLabel,
        exists: true,
        content: template.defaultContent,
      };

      // Add to all workspaces that contain this repo
      set((s) => {
        const nextFilesByWorkspace = { ...s.filesByWorkspace };
        for (const [wsId, files] of Object.entries(nextFilesByWorkspace)) {
          if (files.some((f) => f.repoId === repo.id)) {
            nextFilesByWorkspace[wsId] = [...files, newFile];
          }
        }
        // If not found in any workspace, try adding via any workspace key
        const hasRepo = Object.values(nextFilesByWorkspace).some((files) =>
          files.some((f) => f.repoId === repo.id),
        );
        if (!hasRepo) {
          // Just add to first workspace entry or create one
          const firstKey = Object.keys(nextFilesByWorkspace)[0];
          if (firstKey) {
            nextFilesByWorkspace[firstKey] = [
              ...(nextFilesByWorkspace[firstKey] ?? []),
              newFile,
            ];
          }
        }
        return { filesByWorkspace: nextFilesByWorkspace };
      });

      return newFile;
    } catch (error) {
      console.error("Failed to create context file:", error);
      return null;
    }
  },
}));
