# Panes Remotion — Agent Guide for Promotional Video Production

> **Purpose**: This document is the single source of truth for any AI agent or developer
> creating Remotion-based promotional videos for the Panes product. It contains the complete
> design system, visual language, component architecture, and strict fidelity rules.

---

## 1. Project Overview

**Panes** is a desktop AI development environment built with Tauri 2 + React 19.
This `/remotion` subfolder contains a standalone Remotion project with 1:1 visual
replicas of every Panes UI component, designed for rendering pixel-perfect promotional
video content.

### Tech Stack (Remotion project)
- **Remotion 4.x** — React-based video rendering framework
- **React 19** — UI library
- **TypeScript 5** — Type safety
- **lucide-react** — Icon library (same as main app)
- **Standalone CSS** — Complete copy of `globals.css` with Google Fonts import

### Directory Structure

```
remotion/
├── package.json              # Standalone package (not shared with parent)
├── tsconfig.json
├── src/
│   ├── index.ts              # Remotion registerRoot entry point
│   ├── Root.tsx              # All Composition registrations
│   ├── styles/
│   │   └── globals.css       # COMPLETE copy of app design system
│   ├── components/
│   │   ├── PanesApp.tsx      # Full 3-column layout orchestrator
│   │   ├── PanesSidebar.tsx  # Sidebar + Rail (pinned/collapsed)
│   │   ├── PanesChatPanel.tsx# Chat messages + input + header
│   │   ├── PanesGitPanel.tsx # Git changes/commits + multi-repo
│   │   ├── PanesTerminalPanel.tsx # Terminal tabs + output
│   │   └── PanesFileEditor.tsx    # Editor tabs + code content
│   ├── compositions/
│   │   └── PanesShowcase.tsx # All video compositions
│   ├── data/
│   │   └── mockData.ts       # Realistic mock data for all panels
│   └── assets/               # Static assets (SVGs, etc.)
```

---

## 2. The Panes Design System

### 2.1 Color Palette

The Panes visual identity is **pitch-black dark mode** with an **electric teal accent**.

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-0` | `#000000` | Root background |
| `--bg-1` | `#000000` | Panel backgrounds |
| `--bg-2` | `#0f0f0f` | Assistant message bg, elevated surfaces |
| `--bg-3` | `#1c1c1c` | User message bg, input areas |
| `--bg-4` | `#282828` | Inline code bg, buttons |
| `--bg-5` | `#333333` | Highest elevation |
| `--text-1` | `#f5f5f5` | Primary text |
| `--text-2` | `#a8a8a8` | Secondary text |
| `--text-3` | `#737373` | Muted/tertiary text |
| `--accent` | `#0ef0c3` | **Primary accent** — Electric Teal |
| `--accent-dim` | `rgba(14, 240, 195, 0.10)` | Accent backgrounds |
| `--accent-glow` | `0 0 12px rgba(14, 240, 195, 0.15)` | Glow effects |
| `--accent-2` | `#a78bfa` | Secondary accent — Purple (plan mode) |
| `--accent-2-dim` | `rgba(167, 139, 250, 0.10)` | Purple backgrounds |
| `--success` | `#34d399` | Success states, git added |
| `--danger` | `#f87171` | Error states, git deleted |
| `--warning` | `#fbbf24` | Warning, dirty indicators |
| `--info` | `#60a5fa` | Info, thinking state |
| `--border` | `rgba(255, 255, 255, 0.16)` | Default borders |
| `--border-active` | `rgba(255, 255, 255, 0.26)` | Hover/active borders |
| `--border-accent` | `rgba(14, 240, 195, 0.20)` | Accent borders |
| `--code-bg` | `#050505` | Code block background |

#### Landing Page Palette Differences
The landing page has slightly different tokens for web context:
- `--bg-1: #050505` (not pure black)
- `--bg-2: #0a0a0a`
- `--bg-3: #141414`
- `--text-1: #f0f0f0` (slightly warmer)
- `--text-2: #a0a0a0`
- `--text-3: #606060`
- `--border: rgba(255, 255, 255, 0.08)` (more subtle)

**For promotional videos, always use the APP palette (globals.css), not the landing page palette.**

### 2.2 Typography

| Font | Family | Usage |
|------|--------|-------|
| **Sora** | `"Sora", system-ui, -apple-system, sans-serif` | All UI text |
| **JetBrains Mono** | `"JetBrains Mono", ui-monospace, monospace` | Code, terminal, git hashes, file paths |

**Key sizes:**
- Base UI: `13px`
- Small labels: `11px`
- Timestamps: `10px`
- Code blocks: `12.5px`
- Terminal: `12px`
- Editor line numbers: muted, `opacity: 0.35`
- Section headers: `font-weight: 600`, `letter-spacing: 0.06em`, `text-transform: uppercase`

### 2.3 Spacing & Layout

| Token | Value |
|-------|-------|
| `--radius-sm` | `6px` |
| `--radius-md` | `10px` |
| `--radius-lg` | `14px` |
| `--radius-xl` | `20px` |

**Panel header height**: `74px` (38px drag region + 36px controls)

**Three-column layout**:
- Sidebar: 18% default (14%–28% range)
- Center: 56% default (35%–74%)
- Git panel: 26% default (18%–40%)

### 2.4 Animations & Transitions

| Token | Value | Usage |
|-------|-------|-------|
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Standard easing |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Bouncy interactions |
| `--duration-fast` | `120ms` | Quick hover/focus |
| `--duration-normal` | `200ms` | Standard transitions |
| `--duration-slow` | `350ms` | Panel resizes, modals |

**Built-in keyframe animations:**
- `fade-in` — simple opacity 0→1
- `slide-up` — translateY(8px) + opacity
- `slide-in-left` — translateX(-8px) + opacity
- `pulse-soft` — opacity pulsing
- `shimmer` — background position animation
- `glow-pulse` — box-shadow pulse
- `dropdown-in` — scale(0.97) + fade
- `toast-in` / `toast-out` — notification entrance/exit
- `sb-thread-in` — sidebar thread stagger animation
- `thinking-pulse` — AI thinking indicator

### 2.5 Glassmorphism

```css
.glass {
  background: var(--glass-bg);          /* rgba(0, 0, 0, 0.75) */
  backdrop-filter: blur(var(--glass-blur)); /* 20px */
  border: 1px solid var(--glass-border);    /* rgba(255, 255, 255, 0.08) */
}
```

Used for: chat input box, modals, toasts, search overlay.

### 2.6 Syntax Highlighting Colors (Code blocks)

| Element | Color |
|---------|-------|
| Keywords (`import`, `const`, `function`) | `#ff7b72` |
| Strings | `#a5d6ff` |
| Functions / Component names | `#d2a8ff` |
| Numbers | `#79c0ff` / `#ffa657` |
| Comments | `#484f58` italic |
| Default code text | `#c9d1d9` |
| Background | `#050505` |

---

## 3. Brand Identity

### 3.1 Logo

The Panes logo is three overlapping white-stroke squares with a filled teal square at center:

```svg
<svg viewBox="0 0 140 140" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="10" y="36" width="94" height="94" stroke="white" strokeWidth="6"/>
  <rect x="36" y="10" width="94" height="94" stroke="white" strokeWidth="6"/>
  <rect x="23" y="23" width="94" height="94" stroke="white" strokeWidth="6"/>
  <rect x="50" y="50" width="40" height="40" fill="#48F3CD"/>
</svg>
```

- Represents layering, composition, and multi-panel architecture
- The teal square is the brand's signature color `#48F3CD` (slightly different from `--accent: #0ef0c3`)
- Use at `24×24` in the sidebar rail, larger for title cards

### 3.2 App Icon

The app icon is a squircle with:
- Background gradient: `#181818 → #050505`
- Three white stroke rectangles (the logo motif, larger)
- Central `#48F3CD` filled square with cyan glow (`blur(64px)`, `opacity: 0.1`)
- Noise texture overlay
- Rim light gradient for depth
- Drop shadow with cyan tint

### 3.3 Visual Language

- **Pitch black** backgrounds — never use gray backgrounds
- **Electric teal** as the sole hero color — use sparingly for maximum impact
- **Minimal borders** — `rgba(255, 255, 255, 0.16)` barely visible
- **No gradients in the app UI** — gradients are reserved for landing page
- **Monospace for technical content** — JetBrains Mono everywhere code is shown
- **Geometric shapes** — squares, straight lines, grid patterns
- **High contrast** — bright teal/white on pure black
- **Subtle glow effects** — accent glows on hover/focus, never overwhelming

---

## 4. Component Architecture Rules

### 4.1 Strict Visual Fidelity

Every component MUST match the original source exactly. This means:

1. **Use the same CSS classes** — the `globals.css` provides all styling
2. **Match element hierarchy** — same nesting of divs, spans, buttons
3. **Match inline styles exactly** — same pixel values, same properties
4. **Use the correct icons** — same lucide-react icon names and sizes
5. **Match spacing** — same padding, margin, gap values
6. **Match font sizes and weights** — these are carefully calibrated

### 4.2 Component Reference Map

| Remotion Component | Original Source | Key CSS Classes |
|-------------------|----------------|-----------------|
| `PanesSidebar` | `src/components/sidebar/Sidebar.tsx` | `sb-*` classes |
| `PanesSidebarRail` | `src/components/sidebar/Sidebar.tsx` (Sidebar function) | `sb-rail`, `sb-rail-btn` |
| `PanesChatPanel` | `src/components/chat/ChatPanel.tsx` | `chat-*`, `msg-*`, `dropdown-*` |
| `PanesGitPanel` | `src/components/git/GitPanel.tsx` + `GitChangesView.tsx` | `git-*` classes |
| `PanesTerminalPanel` | `src/components/terminal/TerminalPanel.tsx` | `terminal-*` classes |
| `PanesFileEditor` | `src/components/editor/FileEditorPanel.tsx` | `editor-*` classes |
| `PanesApp` | `src/components/layout/ThreeColumnLayout.tsx` | `panel`, `resize-handle` |

### 4.3 Critical Visual Details

**Chat Messages:**
- User messages: **right-aligned** (`alignItems: "flex-end"`), `maxWidth: "75%"`, `background: var(--bg-3)`, `border: 1px solid var(--border)`
- Assistant messages: **full-width**, `background: var(--bg-2)`, `border: 1px solid var(--border)`, engine label header at top
- Stagger animation: `animationDelay: ${Math.min(index * 20, 200)}ms`
- Timestamp below user (right), below assistant (left)

**Sidebar:**
- Header region is 74px total (42px top padding for drag + controls)
- Thread items use `sb-thread-animate` with `animationDelay: ${i * 20}ms`
- Active project shows teal `FolderGit2` icon
- Collapsed projects show `ChevronRight`, expanded show `ChevronDown`

**Git Panel:**
- Header is 74px matching other panels
- Multi-repo bar appears below header when `repos.length > 1`
- File status badges: A (added/green), M (modified/yellow), D (deleted/red)
- Diff viewer uses `git-diff-line`, `git-diff-add`, `git-diff-del`, `git-diff-hunk` classes

**Terminal:**
- Tabs use `<button>` elements with `SquareTerminal` icon (size 12)
- Tab close button is a nested `<button>` with `terminal-tab-close` class
- Action buttons: New tab (`Plus`), Split right (`Columns2`), Split down (`Rows2`)
- Meta bar shows `Folder` icon + cwd path
- Terminal content: JetBrains Mono 12px, line-height 19px, bg `#050505`

**File Editor:**
- Tabs: `editor-tab` class, active tab has `box-shadow: inset 0 1px 0 var(--accent)` at top
- Dirty indicator: orange bullet `●` using `var(--warning)`
- Tab close buttons: hidden by default, visible on hover (opacity transition)
- Code: JetBrains Mono, line numbers in gutter with `opacity: 0.35`

---

## 5. Creating New Compositions

### 5.1 Composition Structure

All compositions are registered in `src/Root.tsx`. Standard settings:

```tsx
<Composition
  id="MyComposition"
  component={MyComponent}
  durationInFrames={150}  // 5 seconds at 30fps
  fps={30}
  width={1920}
  height={1080}
/>
```

### 5.2 Animation Patterns

Use Remotion's `useCurrentFrame()` and `interpolate()` for all animations:

```tsx
import { useCurrentFrame, interpolate, Easing } from "remotion";

const frame = useCurrentFrame();

// Slide in from left
const x = interpolate(frame, [0, 20], [-300, 0], {
  extrapolateRight: "clamp",
  easing: Easing.out(Easing.cubic),
});

// Fade in
const opacity = interpolate(frame, [0, 15], [0, 1], {
  extrapolateRight: "clamp",
});
```

### 5.3 Recommended Composition Types

1. **Static showcase** — Frozen UI state, great for screenshots/thumbnails
2. **Animated intro** — Panels slide in sequentially (sidebar → center → git)
3. **Feature spotlight** — Zoom into one panel with the rest dimmed
4. **Workflow demo** — Messages appearing one by one, simulating real usage
5. **Mode switching** — Transition between chat/editor/split/terminal modes
6. **Multi-repo demo** — Show repo switching in git panel

### 5.4 Timing Guidelines

- Panel entrance: 15–25 frames (0.5–0.8s at 30fps)
- Easing: Always use `Easing.out(Easing.cubic)` for UI entrances
- Stagger: 8–12 frames between sequential panel animations
- Hold time: At least 60 frames (2s) for each composition state
- Message appearance: 10 frames fade+slide per message, 6-frame stagger

---

## 6. Visual Taste Guidelines

### 6.1 DO

- Keep backgrounds **pure black** — the product is intentionally dark
- Use **teal accent sparingly** — it should feel electric and premium
- **Respect whitespace** — the product has generous padding
- Show **realistic content** — real-looking code, meaningful commit messages
- **Match the actual product** — if unsure, read the source component
- Use the **landing page animation patterns** for video intros:
  - Staggered entrance (sidebar → main → git panel)
  - Subtle translateY/translateX with opacity
  - Smooth `cubic-bezier(0.16, 1, 0.3, 1)` easing

### 6.2 DON'T

- Don't use gray backgrounds — only `#000000` and the defined `--bg-*` tokens
- Don't add gradients to the app UI — that's the landing page style
- Don't use bright/saturated colors outside the defined palette
- Don't make borders more visible than `rgba(255, 255, 255, 0.16)`
- Don't use rounded corners larger than `14px` (the largest is `--radius-lg`)
- Don't change font sizes or weights — they are calibrated for hierarchy
- Don't add drop shadows to panels — depth comes from borders and backgrounds
- Don't animate elements with bounce/elastic easing in the UI (spring is reserved for micro-interactions)
- Don't create mockups that show features that don't exist in the product

### 6.3 Landing Page vs App

| Aspect | App | Landing Page |
|--------|-----|-------------|
| Background | `#000000` (pure black) | `#000000` with grid/glow effects |
| Borders | `rgba(255,255,255,0.16)` | `rgba(255,255,255,0.08)` |
| Font sizes | 13px base | 15px base |
| Shadows | Minimal | Layered (0 → 40px → 100px blur) |
| Gradients | None | Text gradients, radial glows |
| Animation | Fast, functional | Cinematic, staggered reveals |
| Noise texture | None | SVG turbulence overlay |
| 3D effects | None | `perspective(2000px)`, `rotateX(2deg)` |

**For product mockup videos**: Use the APP design tokens exactly.
**For marketing title cards/intros**: The landing page aesthetic with gradients, glows, perspective transforms is appropriate.

---

## 7. Mock Data Guidelines

All mock data lives in `src/data/mockData.ts`. When adding new data:

1. **Be realistic** — use plausible project names, commit messages, file paths
2. **Be consistent** — thread titles should relate to the active workspace
3. **Show variety** — mix of file statuses (added, modified, deleted)
4. **Show depth** — multiple workspaces, multiple threads, realistic timestamps
5. **Code content** — must be syntactically valid and show real patterns
6. **Terminal output** — match actual terminal colors and formatting

---

## 8. Running the Project

```bash
cd remotion
npm install
npm run studio    # Opens Remotion Studio at localhost:3000
npm run render    # Renders all compositions
```

### Render a specific composition:
```bash
npx remotion render src/index.ts PanesFullUI --output out/full-ui.mp4
```

### Render a still frame (for screenshots):
```bash
npx remotion still src/index.ts PanesFullUI --output out/full-ui.png --frame=0
```

---

## 9. Checklist for New Compositions

- [ ] Uses `AbsoluteFill` with `background: "#000000"`
- [ ] Imports CSS via composition or global stylesheet
- [ ] All text uses Sora or JetBrains Mono
- [ ] Colors match the design tokens exactly
- [ ] Panel heights use 74px headers
- [ ] Animations use `Easing.out(Easing.cubic)` or `--ease-out`
- [ ] Mock data is realistic and consistent
- [ ] Component structure matches original source files
- [ ] No visual elements that don't exist in the real product
- [ ] Registered in `Root.tsx` with correct dimensions (1920×1080)

---

## 10. File-by-File Reference

When in doubt about any visual detail, consult the original source:

| What | Where |
|------|-------|
| All CSS classes | `src/globals.css` (3211 lines) |
| Layout structure | `src/components/layout/ThreeColumnLayout.tsx` |
| Sidebar full content | `src/components/sidebar/Sidebar.tsx` |
| Chat messages | `src/components/chat/ChatPanel.tsx` |
| Message rendering | `src/components/chat/MessageBlocks.tsx` |
| Markdown content | `src/components/chat/MarkdownContent.tsx` |
| Git panel + views | `src/components/git/GitPanel.tsx` + subviews |
| Terminal chrome | `src/components/terminal/TerminalPanel.tsx` |
| File editor | `src/components/editor/FileEditorPanel.tsx` |
| Code editor | `src/components/editor/CodeMirrorEditor.tsx` |
| Dropdown menu | `src/components/shared/Dropdown.tsx` |
| Toast notifications | `src/components/shared/ToastContainer.tsx` |
| Confirm dialogs | `src/components/shared/ConfirmDialog.tsx` |
| Type definitions | `src/types.ts` |
| Landing page | `landing-page/style.css` + `landing-page/index.html` |
| Logo SVG | `landing-page/logo.svg` |
| App Icon SVG | `landing-page/icon.svg` |
