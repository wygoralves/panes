/**
 * Mock data for Panes Remotion promotional video components.
 * All data is static and designed to look realistic in video renders.
 */

// ── Workspace / Project data ──

export interface MockWorkspace {
  id: string;
  name: string;
  rootPath: string;
}

export interface MockThread {
  id: string;
  workspaceId: string;
  title: string;
  lastActivityAt: string;
}

export const workspaces: MockWorkspace[] = [
  { id: "ws-1", name: "panes", rootPath: "/Users/dev/projects/panes" },
  { id: "ws-2", name: "stellar-api", rootPath: "/Users/dev/projects/stellar-api" },
  { id: "ws-3", name: "raycast-ext", rootPath: "/Users/dev/projects/raycast-ext" },
];

export const threads: MockThread[] = [
  { id: "t-1", workspaceId: "ws-1", title: "Refactor panel resize logic", lastActivityAt: "2m" },
  { id: "t-2", workspaceId: "ws-1", title: "Add dark mode toggle", lastActivityAt: "15m" },
  { id: "t-3", workspaceId: "ws-1", title: "Fix terminal WebGL crash", lastActivityAt: "1h" },
  { id: "t-4", workspaceId: "ws-1", title: "Implement git stash view", lastActivityAt: "3h" },
  { id: "t-5", workspaceId: "ws-1", title: "Update CodeMirror themes", lastActivityAt: "1d" },
  { id: "t-6", workspaceId: "ws-2", title: "REST endpoint auth middleware", lastActivityAt: "4h" },
  { id: "t-7", workspaceId: "ws-2", title: "Database migration v2.3", lastActivityAt: "1d" },
  { id: "t-8", workspaceId: "ws-3", title: "Search command implementation", lastActivityAt: "2d" },
];

// ── Chat messages ──

export interface MockContentBlock {
  type: "text" | "code" | "action" | "thinking";
  content: string;
  language?: string;
  actionLabel?: string;
  actionStatus?: "done" | "running" | "pending";
  filePath?: string;
}

export interface MockMessage {
  id: string;
  role: "user" | "assistant";
  content?: string;
  blocks: MockContentBlock[];
  createdAt: string;
}

export const chatMessages: MockMessage[] = [
  {
    id: "msg-1",
    role: "user",
    content: "Can you refactor the panel resize handler to use CSS custom properties instead of inline styles?",
    blocks: [
      {
        type: "text",
        content: "Can you refactor the panel resize handler to use CSS custom properties instead of inline styles?",
      },
    ],
    createdAt: "10:24 AM",
  },
  {
    id: "msg-2",
    role: "assistant",
    content: "",
    blocks: [
      {
        type: "thinking",
        content: "The user wants to refactor the resize handler. Let me look at the current implementation and identify where inline styles are being used for panel sizing...",
      },
      {
        type: "text",
        content: "I'll refactor the panel resize handler to use CSS custom properties. This approach is cleaner and allows for better animation support.",
      },
      {
        type: "action",
        content: "src/components/layout/ThreeColumnLayout.tsx",
        actionLabel: "Edit file",
        actionStatus: "done",
        filePath: "src/components/layout/ThreeColumnLayout.tsx",
      },
      {
        type: "code",
        language: "tsx",
        content: `// ThreeColumnLayout.tsx
const updatePanelSizes = useCallback((sizes: number[]) => {
  const root = document.documentElement;
  root.style.setProperty('--sidebar-width', \`\${sizes[0]}%\`);
  root.style.setProperty('--center-width', \`\${sizes[1]}%\`);
  root.style.setProperty('--git-width', \`\${sizes[2]}%\`);
}, []);`,
      },
      {
        type: "action",
        content: "src/globals.css",
        actionLabel: "Edit file",
        actionStatus: "done",
        filePath: "src/globals.css",
      },
      {
        type: "text",
        content: "Done! The resize handler now updates CSS custom properties on the root element. The panel widths are controlled via `--sidebar-width`, `--center-width`, and `--git-width` variables, which enables smooth transitions and easier theming.",
      },
    ],
    createdAt: "10:24 AM",
  },
  {
    id: "msg-3",
    role: "user",
    content: "Nice. Can you also add a subtle animation when the panels resize?",
    blocks: [
      {
        type: "text",
        content: "Nice. Can you also add a subtle animation when the panels resize?",
      },
    ],
    createdAt: "10:26 AM",
  },
  {
    id: "msg-4",
    role: "assistant",
    content: "",
    blocks: [
      {
        type: "action",
        content: "src/globals.css",
        actionLabel: "Edit file",
        actionStatus: "done",
        filePath: "src/globals.css",
      },
      {
        type: "code",
        language: "css",
        content: `.panel-animated {
  transition: width var(--duration-normal) var(--ease-out);
  will-change: width;
}

.resize-handle:active ~ .panel-animated {
  transition: none;
}`,
      },
      {
        type: "text",
        content: "Added a `panel-animated` class with a smooth width transition using the existing design tokens. The transition is disabled during active drag to avoid janky behavior, then snaps back smoothly when released.",
      },
    ],
    createdAt: "10:26 AM",
  },
];

// ── Git panel data ──

export interface MockGitFile {
  name: string;
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
}

export interface MockGitCommit {
  hash: string;
  subject: string;
  author: string;
  date: string;
}

export const gitBranch = "feat/panel-resize-refactor";
export const gitUpstream = "origin/feat/panel-resize-refactor";
export const gitAhead = 2;
export const gitBehind = 0;

export const gitStagedFiles: MockGitFile[] = [
  { name: "ThreeColumnLayout.tsx", path: "src/components/layout/ThreeColumnLayout.tsx", status: "modified" },
  { name: "globals.css", path: "src/globals.css", status: "modified" },
];

export const gitUnstagedFiles: MockGitFile[] = [
  { name: "ChatPanel.tsx", path: "src/components/chat/ChatPanel.tsx", status: "modified" },
  { name: "panel-utils.ts", path: "src/lib/panel-utils.ts", status: "added" },
  { name: "old-resize.ts", path: "src/lib/old-resize.ts", status: "deleted" },
];

export const gitCommits: MockGitCommit[] = [
  { hash: "a3f8e21", subject: "refactor: use CSS custom props for panel sizing", author: "dev", date: "2 min ago" },
  { hash: "b7c4d19", subject: "feat: add resize animation with ease-out", author: "dev", date: "5 min ago" },
  { hash: "e1a9c38", subject: "fix: terminal WebGL context loss on resize", author: "dev", date: "1 hour ago" },
  { hash: "f4b2e67", subject: "chore: bump codemirror to 6.39.15", author: "dev", date: "3 hours ago" },
  { hash: "c8d1f45", subject: "feat: add git stash view with pop/apply/drop", author: "dev", date: "5 hours ago" },
  { hash: "d9e3a12", subject: "fix: sidebar flyout z-index on multi-monitor", author: "dev", date: "8 hours ago" },
  { hash: "1b5c7e9", subject: "docs: update README with new keyboard shortcuts", author: "dev", date: "1 day ago" },
];

export const gitDiffContent = `@@ -14,8 +14,12 @@ export function ThreeColumnLayout() {
   const sidebarVisible = showSidebar && sidebarPinned;
-  const centerDefaultSize = sidebarVisible && showGitPanel ? 56 : 74;
+  const updatePanelSizes = useCallback((sizes: number[]) => {
+    const root = document.documentElement;
+    root.style.setProperty('--sidebar-width', \`\${sizes[0]}%\`);
+    root.style.setProperty('--center-width', \`\${sizes[1]}%\`);
+    root.style.setProperty('--git-width', \`\${sizes[2]}%\`);
+  }, []);

   return (
     <div style={{ height: "100%", display: "flex" }}>`;

// ── Terminal data ──

export const terminalSessions = [
  { id: "term-1", label: "zsh", active: true },
  { id: "term-2", label: "dev server", active: false },
  { id: "term-3", label: "tests", active: false },
];

export const terminalOutput = `\x1b[38;2;115;115;115m~/projects/panes\x1b[0m \x1b[38;2;14;240;195m❯\x1b[0m npm run dev

  \x1b[38;2;14;240;195m➜\x1b[0m  \x1b[1mLocal\x1b[0m:   http://localhost:1420/
  \x1b[38;2;115;115;115m➜\x1b[0m  \x1b[1mNetwork\x1b[0m: use --host to expose
  \x1b[38;2;115;115;115m➜\x1b[0m  press \x1b[1mh + enter\x1b[0m to show help`;

// Cleaned terminal lines for the visual replica (no ANSI codes)
export const terminalLines = [
  { text: "~/projects/panes", color: "#737373" },
  { text: " ❯ ", color: "#0ef0c3" },
  { text: "npm run dev", color: "#f5f5f5" },
  { text: "", color: "" },
  { text: "  ➜  Local:   http://localhost:1420/", parts: [
    { text: "  ➜  ", color: "#0ef0c3" },
    { text: "Local:", color: "#f5f5f5", bold: true },
    { text: "   http://localhost:1420/", color: "#f5f5f5" },
  ]},
  { text: "  ➜  Network: use --host to expose", parts: [
    { text: "  ➜  ", color: "#737373" },
    { text: "Network:", color: "#f5f5f5", bold: true },
    { text: " use --host to expose", color: "#737373" },
  ]},
  { text: "  ➜  press h + enter to show help", parts: [
    { text: "  ➜  ", color: "#737373" },
    { text: "press ", color: "#737373" },
    { text: "h + enter", color: "#f5f5f5", bold: true },
    { text: " to show help", color: "#737373" },
  ]},
  { text: "", color: "" },
  { text: "~/projects/panes", color: "#737373" },
  { text: " ❯ ", color: "#0ef0c3" },
  { text: "█", color: "#f5f5f5" },
];

// ── Multi-repo data ──

export interface MockRepo {
  id: string;
  name: string;
  path: string;
  isActive: boolean;
}

export const repos: MockRepo[] = [
  { id: "repo-1", name: "panes", path: "/Users/dev/projects/panes", isActive: true },
  { id: "repo-2", name: "panes-server", path: "/Users/dev/projects/panes/packages/server", isActive: true },
  { id: "repo-3", name: "panes-shared", path: "/Users/dev/projects/panes/packages/shared", isActive: true },
];

// ── File Editor data ──

export interface MockEditorTab {
  id: string;
  fileName: string;
  filePath: string;
  language: string;
  isDirty: boolean;
  content: string;
}

export const editorTabs: MockEditorTab[] = [
  {
    id: "tab-1",
    fileName: "ThreeColumnLayout.tsx",
    filePath: "src/components/layout/ThreeColumnLayout.tsx",
    language: "tsx",
    isDirty: false,
    content: `import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Sidebar } from "../sidebar/Sidebar";
import { ChatPanel } from "../chat/ChatPanel";
import { GitPanel } from "../git/GitPanel";
import { useUiStore } from "../../stores/uiStore";

export function ThreeColumnLayout() {
  const showSidebar = useUiStore((state) => state.showSidebar);
  const sidebarPinned = useUiStore((state) => state.sidebarPinned);
  const showGitPanel = useUiStore((state) => state.showGitPanel);

  const sidebarVisible = showSidebar && sidebarPinned;

  const updatePanelSizes = useCallback((sizes: number[]) => {
    const root = document.documentElement;
    root.style.setProperty('--sidebar-width', \`\${sizes[0]}%\`);
    root.style.setProperty('--center-width', \`\${sizes[1]}%\`);
    root.style.setProperty('--git-width', \`\${sizes[2]}%\`);
  }, []);

  return (
    <div style={{ height: "100%", display: "flex" }}>
      {showSidebar && !sidebarPinned && <Sidebar />}
      <PanelGroup direction="horizontal" onLayout={updatePanelSizes}>
        {sidebarVisible && (
          <Panel defaultSize={18} minSize={14} maxSize={28}>
            <Sidebar />
          </Panel>
        )}
        <Panel defaultSize={56} minSize={35}>
          <ChatPanel />
        </Panel>
        {showGitPanel && (
          <Panel defaultSize={26} minSize={18} maxSize={40}>
            <GitPanel />
          </Panel>
        )}
      </PanelGroup>
    </div>
  );
}`,
  },
  {
    id: "tab-2",
    fileName: "globals.css",
    filePath: "src/globals.css",
    language: "css",
    isDirty: true,
    content: `.panel-animated {
  transition: width var(--duration-normal) var(--ease-out);
  will-change: width;
}

.resize-handle:active ~ .panel-animated {
  transition: none;
}`,
  },
  {
    id: "tab-3",
    fileName: "ChatPanel.tsx",
    filePath: "src/components/chat/ChatPanel.tsx",
    language: "tsx",
    isDirty: false,
    content: `import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Send, Square, GitBranch, Brain, Shield } from "lucide-react";
import { useChatStore } from "../../stores/chatStore";
import { useEngineStore } from "../../stores/engineStore";

export function ChatPanel() {
  const messages = useChatStore((s) => s.messages);
  const sendMessage = useChatStore((s) => s.sendMessage);
  // ...
}`,
  },
];

export const activeEditorTabId = "tab-1";

// ── Engine / model data ──

export const currentEngine = "OpenAI";
export const currentModel = "GPT-4.1";
export const contextUsagePercent = 34;
export const contextTokens = "42.8k / 128k";
