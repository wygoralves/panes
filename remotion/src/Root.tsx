import React from "react";
import { Composition } from "remotion";
import {
  PanesFullUI,
  PanesWithTerminal,
  PanesEditorMode,
  PanesSplitViewComp,
  PanesMultiRepoComp,
  PanesChatOnly,
  PanesCollapsedSidebar,
  PanesAnimatedIntro,
} from "./compositions/PanesShowcase";

/* ─────────────────────────────────────────────────────
   Remotion Root — registers all compositions

   All compositions use 1920x1080 (Full HD) by default.
   Adjust fps and duration per composition as needed.
   ───────────────────────────────────────────────────── */

export function RemotionRoot() {
  return (
    <>
      {/* ── Static Showcase Compositions ── */}

      <Composition
        id="PanesFullUI"
        component={PanesFullUI}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
      />

      <Composition
        id="PanesWithTerminal"
        component={PanesWithTerminal}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
      />

      <Composition
        id="PanesEditorMode"
        component={PanesEditorMode}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
      />

      <Composition
        id="PanesSplitView"
        component={PanesSplitViewComp}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
      />

      <Composition
        id="PanesMultiRepo"
        component={PanesMultiRepoComp}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
      />

      <Composition
        id="PanesChatOnly"
        component={PanesChatOnly}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
      />

      <Composition
        id="PanesCollapsedSidebar"
        component={PanesCollapsedSidebar}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
      />

      {/* ── Animated Compositions ── */}

      <Composition
        id="PanesAnimatedIntro"
        component={PanesAnimatedIntro}
        durationInFrames={90}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
}
