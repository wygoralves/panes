---
target: Panes product-room landing page
total_score: 21
p0_count: 0
p1_count: 3
timestamp: 2026-07-11T16-16-54Z
slug: landing-page-product-room-index-html
---
## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 2/4 | Locale and preview states are visible, but download compatibility and transition feedback are absent. |
| 2 | Match System / Real World | 3/4 | The language fits experienced engineers, but terms such as CLI harness, worktrees, backoff, and local-first assume familiarity. |
| 3 | User Control and Freedom | 2/4 | Anchor navigation and locale switching are reversible. Mobile loses navigation, and preview modes are mouse-only divs. |
| 4 | Consistency and Standards | 3/4 | The visual system is cohesive, but desktop interaction becomes a static mobile mock and navigation disappears. |
| 5 | Error Prevention | 2/4 | Platform labels are inferred while every platform uses the same generic latest-release destination. |
| 6 | Recognition Rather Than Recall | 2/4 | Main actions are labeled, but the four preview modes use unlabeled icons and mobile loses the section map. |
| 7 | Flexibility and Efficiency | 2/4 | Anchors, locale persistence, and product shortcuts help. The preview has no keyboard path or mobile handoff. |
| 8 | Aesthetic and Minimalist Design | 3/4 | Hierarchy and spacing are strong, but the workspace, workflow, and cockpit sections repeat similar proof. |
| 9 | Error Recovery | 1/4 | No visible recovery path exists for an incompatible download, unavailable release, or failed external asset. |
| 10 | Help and Documentation | 1/4 | GitHub is the only help route. Requirements, installation, security, and task-focused documentation are absent. |
| **Total** |  | **21/40** | **Acceptable. Significant conversion and accessibility improvements remain.** |

## Anti-Patterns Verdict

**Does this look AI-generated? Borderline pass.** The page avoids several obvious tells. There are no gradient headlines, repeated eyebrows, arbitrary numbered section labels, giant card radii, or decorative stat grids. The detailed Panes workspace, prompt-to-review narrative, worktree references, and believable git state keep it grounded in the product.

The remaining category-reflex tells are visible: Geist and Geist Mono, near-black violet surfaces, a coral accent, blurred glows, floating provider pills, an oversized app mock, and neutral display headings. Remove the Panes logo and name and parts of the page could belong to several agent IDE products. The orbiting provider pills are the strongest generic visual trope.

**Deterministic scan:** One advisory finding was reported for `numbered-section-markers` in `landing-page/product-room/index.html`, with the snippet `Sequence: 10, 11, 12`. This is a confirmed false positive. Those numbers are editor line numbers inside the hidden editor view at source lines 405 to 407, not section markers. The detector found no real prohibited scaffold in the visible page.

**Visual overlays:** No reliable user-visible overlay was created. The assessment could not establish a mutable in-app Browser tab, and the available Playwright evaluation surface is read-only. Browser evidence instead came from full-page desktop and mobile screenshots, DOM snapshots, layout metrics, and clean console logs.

## Overall Impression

The page now has a strong opening, a credible product mock, and a deliberate mobile composition. Its biggest weakness is not finish quality. It repeats the happy path while leaving the core trust questions behind “stay in control” unanswered. The next pass should show how Panes contains risk, handles failure, isolates work, and gets safely onto a user’s machine.

## What’s Working

1. **The story is product-specific.** Prompt, agent activity, terminal results, diff, tests, branch, and review state form one believable workflow. This is much stronger than generic feature claims.
2. **Responsive composition is deliberate.** Mobile receives a purpose-built task preview instead of a scaled desktop screenshot. Headings, CTA stacking, and section layouts are intentionally adapted.
3. **Localization and motion preferences are treated seriously.** EN and PT update the document language, metadata, ARIA labels, and visible copy. Focus rules and reduced-motion fallbacks are present.

## Cognitive Load

**Moderate, with 2 of 8 checklist failures.**

- **Chunking fails in the agent section:** seven providers appear as one orbiting field. Native chat agents and terminal agents are explained in copy but not grouped visually.
- **Minimal choices fails in the desktop header:** Product, Workflow, Agents, Download anchor, EN, PT, GitHub, and the Download CTA create eight visible options in one region.

The broader sequence, page hierarchy, grouping, working-memory support, and progressive disclosure pass. The dense desktop product mock adds local scanning pressure, but it works as evidence rather than as a required task.

## Emotional Journey

- **Opening:** Confident and direct. The promise is understood quickly, and the product mock makes it tangible.
- **First peak:** The desktop workspace is the strongest moment because it looks like a real working environment.
- **Valley:** The white three-step workflow section drops into a familiar landing-page pattern after the richer product scene.
- **Second peak:** The integration roster provides reassurance, although the orbit treatment reads as decorative rather than operational.
- **Reassurance:** The cockpit section’s tests, file counts, branch, and review state reinforce control.
- **Ending:** The final CTA repeats the original promise but does not answer version, OS support, signing, privacy, architecture, or what happens after download. Mobile has no useful desktop handoff.

## Priority Issues

### [P1] Mobile acquisition becomes a dead end

**Why it matters:** Navigation disappears below 1060px, while the persistent primary action remains a desktop download. A phone visitor cannot jump between proof sections and cannot complete the main action on the current device.

**Fix:** Add compact mobile navigation. On phones, change the primary path to an actionable handoff such as viewing releases, copying the desktop link, sending it to a computer, or opening installation instructions.

**Suggested command:** `$impeccable adapt`

### [P1] The interactive preview excludes keyboard and touch users

**Why it matters:** The four layout controls are clickable `div` elements, approximately 26 by 24 pixels, with icons only. They lack button semantics, accessible names, keyboard activation, selected-state announcement, and adequate touch targets.

**Fix:** Use real buttons with visible focus, labels or tooltips, `aria-pressed`, and at least 44 by 44 pixel targets. Announce the selected view.

**Suggested command:** `$impeccable audit`

### [P1] Download confidence is missing at the highest-stakes moment

**Why it matters:** The script infers macOS, Windows, or Linux, but every CTA links to the same latest-release page. Visitors see no minimum OS, architecture, package type, version, signing status, file size, or installation steps.

**Fix:** Link to verified platform artifacts or use the honest label “View latest release.” Add a compact requirements and trust block near the final CTA.

**Suggested command:** `$impeccable harden`

### [P2] The middle repeats the happy path and stays visually hard to read

**Why it matters:** The workspace, workflow cards, and cockpit all restage prompt, terminal, tests, diff, and review. On mobile, internal mock text becomes too small to function as proof. The long journey delays new information.

**Fix:** Keep the strongest end-to-end demonstration. Reassign later sections to distinct evidence such as parallel worktrees, permission boundaries, failed-command recovery, and review controls. Increase the scale and contrast of the few details that remain.

**Suggested command:** `$impeccable distill`

### [P2] The brand language is still close to the agent-tool default

**Why it matters:** The page explains Panes but does not yet create a visual memory owned by Panes. The orbiting chip galaxy and blurred dark glows are familiar category signals.

**Fix:** Build the identity around Panes’ pane geometry, rounded separators, workspace continuity, and visible relationships between agent, repository, worktree, and review state. Replace the provider orbit with a product-native composition.

**Suggested command:** `$impeccable bolder`

## Persona Red Flags

### Jordan, first-time visitor

- CLI harness, worktrees, backoff, and local-first are not explained.
- The preview’s four layout icons have no visible labels or tooltips.
- GitHub is the only help route. There is no install guide, requirements link, or “How Panes works” path.
- “Run every agent” sounds broader than the seven named integrations and may create a literal expectation the product cannot meet.

### Riley, stress tester

- The platform label changes, but the destination remains one generic release URL.
- The page does not prove permission boundaries, local storage, worktree isolation, crash recovery, or failed-command handling.
- The Antigravity icon is fetched from a third-party URL, so blocking that request can damage the integration proof.
- No version or dated release proof ties the mockups and claims to current product behavior.

### Casey, mobile visitor

- Section navigation disappears, making interruption recovery harder.
- The main action asks a phone user to download a desktop app without a handoff.
- The mobile preview is static, so the page’s strongest interactive proof is unavailable.
- Seven agent chips, three workflow blocks, and the stacked cockpit make the mobile path long before the final CTA.

## Minor Observations

- Download appears twice in the desktop header, once as navigation and once as the primary button.
- The final headline repeats “under control” rather than advancing the decision.
- Infinite drifting panels add energy but slightly conflict with the promise of control.
- PT copy mixes translated prose with prompt, diff, stage, commit, branch, and local-first. The terminology needs one explicit localization policy.
- The white workflow section creates useful rhythm but also feels like a different template lane from the dark product sections.
- Several mock labels use 7 to 9 pixel type. They communicate density more than readable product detail.
- External Lucide and Antigravity assets create avoidable reliability dependencies.

## Questions to Consider

- If “stay in control” is the central promise, where is the proof of permissions, undo, rollback, worktree isolation, and failed-command recovery?
- Could someone recognize this as Panes with the logo and product name removed?
- Why does the page repeat the happy path three times instead of showing one uncomfortable edge case that Panes handles well?
- What should a phone visitor do when they want Panes but cannot install it on the current device?
- Is “Run every agent” an intentional universal claim, or should it be narrowed to supported integrations?
