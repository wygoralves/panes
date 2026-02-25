import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate, Easing } from "remotion";
import {
  PanesApp,
  PanesAppWithTerminal,
  PanesAppWithEditor,
  PanesAppSplitView,
  PanesAppMultiRepo,
} from "../components/PanesApp";

/* ─────────────────────────────────────────────────────
   Composition: PanesFullUI
   Shows the full Panes interface — sidebar, chat, git panel
   ───────────────────────────────────────────────────── */

export function PanesFullUI() {
  return (
    <AbsoluteFill style={{ background: "#000000" }}>
      <PanesApp
        showSidebar={true}
        sidebarPinned={true}
        showGitPanel={true}
      />
    </AbsoluteFill>
  );
}

/* ─────────────────────────────────────────────────────
   Composition: PanesWithTerminal
   Full UI + terminal split below chat
   ───────────────────────────────────────────────────── */

export function PanesWithTerminal() {
  return (
    <AbsoluteFill style={{ background: "#000000" }}>
      <PanesAppWithTerminal />
    </AbsoluteFill>
  );
}

/* ─────────────────────────────────────────────────────
   Composition: PanesEditorMode
   Full UI with file editor instead of chat
   ───────────────────────────────────────────────────── */

export function PanesEditorMode() {
  return (
    <AbsoluteFill style={{ background: "#000000" }}>
      <PanesAppWithEditor />
    </AbsoluteFill>
  );
}

/* ─────────────────────────────────────────────────────
   Composition: PanesSplitView
   Chat + Editor in split mode
   ───────────────────────────────────────────────────── */

export function PanesSplitViewComp() {
  return (
    <AbsoluteFill style={{ background: "#000000" }}>
      <PanesAppSplitView />
    </AbsoluteFill>
  );
}

/* ─────────────────────────────────────────────────────
   Composition: PanesMultiRepo
   Git panel with multi-repo switcher bar
   ───────────────────────────────────────────────────── */

export function PanesMultiRepoComp() {
  return (
    <AbsoluteFill style={{ background: "#000000" }}>
      <PanesAppMultiRepo />
    </AbsoluteFill>
  );
}

/* ─────────────────────────────────────────────────────
   Composition: PanesChatOnly
   Just the center chat panel — good for feature highlight
   ───────────────────────────────────────────────────── */

export function PanesChatOnly() {
  return (
    <AbsoluteFill style={{ background: "#000000" }}>
      <PanesApp
        showSidebar={false}
        showGitPanel={false}
      />
    </AbsoluteFill>
  );
}

/* ─────────────────────────────────────────────────────
   Composition: PanesCollapsedSidebar
   UI with collapsed rail sidebar (unpinned)
   ───────────────────────────────────────────────────── */

export function PanesCollapsedSidebar() {
  return (
    <AbsoluteFill style={{ background: "#000000" }}>
      <PanesApp
        showSidebar={true}
        sidebarPinned={false}
        showGitPanel={true}
      />
    </AbsoluteFill>
  );
}

/* ─────────────────────────────────────────────────────
   Composition: PanesAnimatedIntro
   Animated entrance — panels slide in sequentially
   ───────────────────────────────────────────────────── */

export function PanesAnimatedIntro() {
  const frame = useCurrentFrame();

  // Sidebar slides in from left
  const sidebarX = interpolate(frame, [0, 20], [-300, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const sidebarOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Center panel fades in
  const centerOpacity = interpolate(frame, [10, 30], [0, 1], {
    extrapolateRight: "clamp",
  });
  const centerY = interpolate(frame, [10, 30], [20, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // Git panel slides in from right
  const gitX = interpolate(frame, [20, 40], [300, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const gitOpacity = interpolate(frame, [20, 40], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: "#000000" }}>
      <div style={{ width: "100%", height: "100%", display: "flex", overflow: "hidden" }}>
        {/* Sidebar */}
        <div
          style={{
            width: "18%",
            height: "100%",
            flexShrink: 0,
            transform: `translateX(${sidebarX}px)`,
            opacity: sidebarOpacity,
            borderRight: "1px solid rgba(255, 255, 255, 0.16)",
          }}
        >
          <div className="panel panel-border-r" style={{ height: "100%" }}>
            <PanesApp
              showSidebar={true}
              sidebarPinned={true}
              showGitPanel={false}
              sidebarWidth="100%"
            />
          </div>
        </div>

        {/* Center */}
        <div
          style={{
            flex: 1,
            height: "100%",
            opacity: centerOpacity,
            transform: `translateY(${centerY}px)`,
          }}
        >
          <PanesApp
            showSidebar={false}
            showGitPanel={false}
          />
        </div>

        {/* Git */}
        <div
          style={{
            width: "26%",
            height: "100%",
            flexShrink: 0,
            transform: `translateX(${gitX}px)`,
            opacity: gitOpacity,
          }}
        >
          <PanesApp
            showSidebar={false}
            showGitPanel={true}
            gitWidth="100%"
          />
        </div>
      </div>
    </AbsoluteFill>
  );
}
