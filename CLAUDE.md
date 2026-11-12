# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this folder is

RETINA is the UI/UX design for a Smart Emergency Medical Response & AI Traffic Routing System. It has five apps that share one case (#EM-104: male, about 30, severe head trauma, apnea, Code Red) and one light token set (namespace `EMS`, Inter) in the white / cyan `#2596be` / yellow `#e6e246` of niems.go.th. The cyan app bar carries white type, and yellow is a fill-only accent: the app-bar tile and the current step. Triage colours keep their clinical meaning, and Code Yellow stays amber:

1. EMS Call Intake (1440×900)
2. Dispatch (1440×900): a Case Board start screen, then the Command Center with 3 tabs
3. Ambulance Copilot (1024×768)
4. Traffic Police Control Hub (phone, 390×844 portrait)
5. Hospital ER Pre-Arrival (1440×900)

Design rule: AI may suggest facts (dashed keyword chips at Intake), but people make every decision. There is no AI triage probability, unit ranking, hospital ranking or pre-selection. Domain terms are in `CONTEXT.md`.

The design lives in two places outside this folder. Treat them as the source of truth:

- **Design System artifact:** https://claude.ai/artifact/U2YowM3zMU6B6UbQyPC5Ca
  - Contains tokens.json, design-system.json, `components/bundle.js` + `bundle.css` (React 18 UMD, exposes `window.EMS` and `EMS.Screens`), per-component previews, and one page per app plus an Ecosystem page.
  - To change it, read it with the Artifact tool, edit the returned files, and republish to the same URL.
- **Figma file `oLhd7VqtFiFiZOvJe73JPk`:** an Apps page and a components page with variables, text styles, and component sets.
  - App frames: 8:166 Intake, 40:1718 Dispatch 2a (Case Board), 9:482 Dispatch (Patient Triage), 60:2302 Dispatch 2b0 (Destination Hospital), 11:660 Dispatch 2b (fleet), 11:981 Dispatch 2c (tracking), 41:1936 Copilot 3a (Accept Case), 46:2112 Copilot 3a2 (Decline Reason), 41:2090 Copilot 3b (At Scene, Auto-Arrival panel), 46:2218 Copilot 3b2 (No Transport), 44:2107 Traffic (phone), 60:3199 Hospital 5a (Incoming Notice), 13:1467 Hospital (Pre-Arrival). The crew has no hospital picker; the old 3c Select Hospital frame is deleted.
  - Library additions for this flow: `CaseRow` set 39:1876, `ReasonOption` set 46:2111, `KeywordChip` Tone=suggested, `UnitCard` Type=selectable/selected, `Icon/arrow-left` 39:1843.
  - Variables: one mode, "Light (NIEMS)". Retheme by changing variable values. Text on red or black fills uses `color/on/danger`, and the yellow accent is `color/accent/default` with `color/accent/ink`.
  - 33 prototype links. Decline → Decline Reason → Case Board (or Back); No Transport → dialog → Case Board (or Cancel). The main path starts at 8:166: Intake → Case Board → Triage → Destination Hospital → Fleet → Copilot Accept → At Scene → (Confirm Patient Onboard) Hospital Pre-Arrival. Each Command Center tab's Case Board button leads back to 40:1718.
  - Call `create_session` with this key before using any Figma tool.

## preview-harness.html

`preview-harness.html` is a single self-contained test page for viewing the screens locally. It is generated: it inlines the tokens CSS, bundle.css and bundle.js, and loads React 18.3.1 from jsDelivr, so it needs internet access. Don't hand-edit the inlined bundle. Instead, read the artifact's `project/` files into a folder and run:

```bash
python scripts/build-preview-harness.py <folder holding project/> preview-harness.html
```

The page renders exactly one screen, `EMS.Screens[location.hash.slice(1) || 'Intake']`, and reads the hash only at load. To view a different screen, set the hash (`#Dispatch`, `#Copilot`, `#Traffic`, `#Hospital`, `#Ecosystem`) and reload. Dispatch opens on the Case Board, the Copilot opens on Accept Case, and Hospital opens on the Incoming Notice. The Copilot's arrivals and the Hospital's switch to Pre-Arrival run on short timers that simulate location and the crew. The buttons inside each screen change that screen's local state only. Navigation between apps exists only in the Figma prototype.

## Figma Plugin API gotchas hit on this file

- `resize()` resets sizing modes to FIXED, so set hug/AUTO again after resizing.
- A component set's hug height applies only when set in a separate `use_figma` call.
- An empty auto-layout frame defaults to 100px tall. Collapse spacer frames explicitly.
- Variable scopes must be unique, so de-duplicate them before calling `setVariableScopes`.
- `fontFeatures` is unsupported, and arbitrary custom properties cannot be set on nodes.
- Measure layout-dependent sizes, such as probability bar fills, after layout settles, not before.
