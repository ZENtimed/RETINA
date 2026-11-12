# Build prompt: RETINA apps 1–3 (Call Intake, Dispatch, Ambulance Copilot)

Copy everything below the line into your AI coding tool (Claude Code, Cursor, etc.) as the first message of a new project.

---

You are building the first working version of **RETINA**, an emergency medical response system for Bangkok's 1669 EMS service. Build three connected web apps that share one live **Case**:

1. **EMS Call Intake**: a desktop app (1440×900) where the call-taker records the facts of an emergency call.
2. **Dispatch**: a desktop app (1440×900). The dispatcher sees every open Case on a **Case Board**, then works one Case in the **Command Center** (triage code → destination hospital → send an ambulance → track it).
3. **Ambulance Copilot**: a tablet app (1024×768, landscape, mounted in the ambulance). The crew accepts or declines a Case and navigates to the scene and then to the hospital.

The Traffic Police app and the Hospital ER app are **out of scope**. Where apps 1–3 send something to them, write it as an event on the Case (see "Stubs").

## The rule that shapes everything

**AI may suggest facts. People make every decision.**

- At Intake, the system may propose keywords from the call transcript. They appear as **dashed chips** and become case data only when the operator taps one to accept it.
- Nothing in the product ranks, scores or pre-selects a triage code, ambulance or hospital.
- Lists are sorted by a plain fact (drive ETA, distance), and every choice starts empty.
- If you find yourself adding a "recommended" badge, a probability or a default selection, stop and remove it.

## Vocabulary

Use these words in code, UI copy and database names exactly as written.

| Term | Meaning |
|---|---|
| **Case** | One emergency incident with an ID like `EM-104`. All three apps work on the same Case record. |
| **Case Type** | Exactly one of **Mechanism of Injury (MOI)** or **Nature of Illness (NOI)**. Required before Intake can submit. |
| **MOI / NOI chips** | Keyword chips under the Case Type (e.g. "Motorcycle vs pole", "No helmet" / "Chest pain"). All chips on a Case belong to its one Case Type. |
| **U / D** | Underlying Disease: optional free text, written with spaces as "U / D". |
| **AI suggestion** | A dashed keyword chip proposed from the transcript. It is not case data until accepted. |
| **Triage Code** | Red, Yellow, Green, White or Black. Set **only** by the dispatcher. A new Case has none. |
| **Destination Hospital** | The one hospital the patient goes to. Chosen **only** by the dispatcher, **before** a unit can be sent. The crew has no hospital picker. |
| **Assigned Unit** | The one ambulance the dispatcher sends. |
| **Auto-Arrival** | The system detects arrival at the scene or the hospital from GPS alone. The crew has **no** "Arrived" button. |
| **Patient Onboard** | The crew's tap confirming the patient is in the ambulance. It starts navigation to the Destination Hospital. |
| **No Transport** | The crew's outcome when nobody is carried (Deceased on scene / Refused transport / Treated on scene). It ends the mission. |
| **Handover** | The crew's tap confirming the ER has taken the patient. It ends the mission. It is never automatic. |
| **Incoming Notice** | The alert sent to the Destination Hospital when a unit is dispatched. Patient Onboard upgrades it to a **Pre-Arrival**. No Transport cancels it. |

## Case lifecycle (state machine)

Enforce these statuses and transitions on the **server**, not just in the UI:

```
Draft (Intake)                                  ── Submit (Case Type set) ─▶  Awaiting triage
Awaiting triage   ── dispatcher sets Triage Code + Destination Hospital + Assigned Unit ─▶  Dispatched / En route
Dispatched        ── crew Declines (with reason) ─▶  Unit declined  (Assigned Unit cleared, hospital kept)
Unit declined     ── dispatcher picks another unit ─▶  Dispatched / En route
Dispatched        ── crew Accepts ─▶ En route ── Auto-Arrival at scene ─▶ At scene
At scene          ── Patient Onboard ─▶  Patient onboard  (navigation to hospital starts)
At scene          ── No Transport + reason ─▶  Closed (No Transport)
Patient onboard   ── Auto-Arrival at hospital ─▶  At hospital
At hospital       ── crew taps Handover ─▶  Handed over
```

Invariants:

- A Case has at most one Triage Code, one Destination Hospital and one Assigned Unit.
- A unit can't be dispatched until the Destination Hospital is set, and the hospital can't be set until the Triage Code is set.
- Only Intake edits the Case Type, chips and symptom facts. Dispatch and the Copilot show them read-only.
- Changing the Case Type deletes the existing chips, after the operator confirms.
- Every transition records who did it and when (an append-only `case_events` table). This is the audit trail.

## App 1: EMS Call Intake (1440×900)

**App bar:** "EMS 1669 Call Intake", the draft case ID, the operator, a live call timer and a "System Live" status.

**Three columns:**

1. **Live Voice Transcript Log** (left, ~296px):
   - Timestamped lines labelled Operator / Caller, with a live waveform.
   - Each line has a copy button.
   - Detected keywords inside the lines are highlighted.
2. **Patient & Incident Intake** (center):
   - **AI suggested keywords** appear as dashed chips. Tapping one accepts it, and the operator can dismiss false positives.
   - Fields: Caller Name, Contact Number, Patient Demographics, **U / D** (marked Optional), and Symptom Description (multi-line).
   - **Case Type** is a required radio pair, MOI or NOI, with nothing selected at the start.
     - After one is picked, a chip input appears (type and press Enter, plus suggestions for that type).
     - Before a Type is picked, the chip input is disabled and says "Pick Mechanism of Injury or Nature of Illness to add keywords".
     - Switching Type when chips exist opens a confirm dialog: "Switch to … ? N keywords will be removed: …" with **Cancel** and **Switch & Remove Keywords**.
   - Subtitle: "facts only, triage is set by Dispatch". There is **no** triage field on this screen.
3. **Location Lock** (right, ~336px):
   - An address/landmark search with suggestions and the distance from the caller's GPS.
   - A map with the caller GPS pin and zoom controls. Coordinates are shown on the map.
   - "Two-step verification": (1) the caller confirms the landmark, then (2) the operator taps **Confirm Location**. The pin then locks and the status reads "Verified & Locked". **Unlock to Edit Coordinates** reverses the lock.

**Footer:**

- **Cancel Incident** (danger outline).
- A hint line that changes with state: "Pick a Case Type before submitting." / "Confirm the location…" / "All required fields complete. Location locked."
- **Submit Case to Dispatch Central**: disabled until a Case Type is set. On success it reads "Sent to Dispatch Central · #EM-104", and the Case appears on the Dispatch Case Board instantly.

## App 2: Dispatch (1440×900)

**App bar:** "Dispatch · Case Board" or "Dispatch Command Center", Available Units (e.g. 12/15), Dispatcher name with presence, and the local time.

### Case Board (start screen)

- **Left:** every open Case **grouped by status** in this order: Awaiting triage, Unit declined, Dispatched / En route, Patient onboard, At hospital.
  - Each row shows the ID, received time, "patient · first chip", a note or address, and either the Triage Code badge or "No code yet".
  - New Cases are highlighted.
- **Right:** the selected Case's read-only facts: patient, received time and operator, address, symptoms, MOI/NOI chips and a locked-location mini map.
  - The Triage Code badge or "Awaiting triage" sits in the header.
  - Footer: **Open in Command Center**.

### Command Center (one Case)

Top row:

- A **← Case Board** button.
- An incident strip with the ID, short address, Triage Code (empty until set) and unit status ("Not dispatched" / "ALS-04 (awaiting crew)").

Below it are four tabs, in this order:

1. **Patient Triage:**
   - **Caller Symptom Log**: the transcript lines from Intake.
   - **Case Details**: read-only, with a "Location locked" tag.
   - **Triage Decision**: five option cards with **nothing pre-selected**:
     - Code Red: 4 / 8 min response target, sirens.
     - Code Yellow: 8 / 15 min, sirens. Yellow is shown in amber.
     - Code Green: standard traffic, no sirens.
     - Code White: tele-advice / police request, no unit.
     - Code Black: deceased / no response, coroner.
   - Button: **Confirm & Choose Destination Hospital** (disabled until a code is picked).
2. **Destination Hospital:**
   - **Map:** routes from the scene to every hospital, with live traffic and congestion, and a route preview for the hospital being viewed.
   - **List:** search by name or specialty. The list is sorted by **drive ETA from the scene** and labelled "sorted by drive ETA from the scene". Each row shows the name, capability note, ETA, distance and ER status (Ready / Moderate / Full).
   - **Nothing is pre-selected.**
   - Button: **Confirm & Go to Fleet Dispatch**.
   - After dispatch, this tab becomes "change destination" mode. The button reads **Update Destination & Notify ER** and moves the hospital alert.
   - If no Triage Code is set yet, show a warning that sends the dispatcher back to Patient Triage.
3. **Fleet Dispatch:**
   - **Map:** the incident, available units, the selected unit's route and busy units in grey.
   - **Panel:** a "Destination: Hospital A" pill with a **Change** link. If no hospital is set, a warning blocks dispatch.
   - "Available units · sorted by ETA" unit cards show unit, base, equipment (BLS/ALS), distance and ETA, with no pre-selection. Busy units can't be picked.
   - Button: **Dispatch ALS-04 & Notify ER**. After dispatch the unit shows "Awaiting crew" until it accepts. Dispatching sends the Incoming Notice.
4. **Tracking & Handover:**
   - **Live telemetry:** speed, distance to scene, ETA countdown, and a stepper (Accepted, En route, On scene, Patient onboard, At hospital).
   - **Tracking map:** the vehicle pin, its route and an alternative route.
   - **Destination Hospital card:** the hospital with a **Change** link, "Chosen by: dispatcher · crew requests changes by radio", and the ER alert status.
   - **Traffic Clearance card:** a stub (see below).
   - **Case Ownership card:** dispatcher → monitoring team, with **Handover & Return to Case Board**.

When a crew declines, the Case moves to **Unit declined** on the Case Board, with a note such as "ALS-02 declined · Vehicle fault · Hospital A kept".

## App 3: Ambulance Copilot (1024×768, touch, in a moving vehicle)

**Design for gloved hands at speed:** primary buttons are at least 64px tall (the Accept/Decline row is 80px), text is large, and each screen has one primary action.

**Persistent red banner (top):**

- "Code Red", the patient summary and critical chips (e.g. Unconscious, No Pulse, Head Trauma).
- On the right: "ETA to Scene / At scene / ETA to Hospital / At hospital" with the value.
- White text on the red fill.

**Screens by stage:**

1. **Accept Case:**
   - A "New case assigned by Dispatch · 14:22:31" pulse, the Case ID, Distance and ETA to scene.
   - Patient, address, symptoms, MOI/NOI chips, and **Destination Hospital · set by Dispatch** (read-only).
   - Buttons: **Decline** and **Accept Case & Start Navigation**.
   - **Decline** opens "Why are you declining?" with these reasons: Vehicle fault / Crew unavailable / Already on a case. The buttons there are Back and **Send Decline to Dispatch** (disabled until a reason is picked). Then the screen shows "Case returned to Dispatch" with **Undo decline**.
2. **En route (navigation):**
   - A full-screen map with a turn-by-turn card (e.g. "In 300 m · Turn left onto Lat Phrao Rd · Fastest route · avoids congestion").
   - The bottom bar shows "Arrival at the scene is detected automatically · N m to go". There is **no arrival button**.
   - On the right are a large flashing **Request Traffic Assist** button and a round **Direct Voice Call** button.
3. **At scene:** Auto-Arrival shows a "You have arrived · Scene · address · Detected automatically · time" card. The buttons are **No Transport** and **Confirm Patient Onboard**.
   - **No Transport** opens a dialog: "The mission ends here and the hospital's Incoming Notice is cancelled. Pick the outcome", with Deceased on scene / Refused transport / Treated on scene. The buttons are Cancel and **Close Mission**. The result is a "Mission closed · No Transport" banner with Undo.
4. **Transport:** navigation to the Destination Hospital starts **by itself**. The bar reads "Navigating to Hospital A · Pre-Arrival sent".
5. **At hospital:** Auto-Arrival shows "Arrived at Hospital A · Resus Bay 2" and the **Confirm Handover to ER** button.
6. **Complete:** "Handover complete · Unit available for the next case".

A 5-segment stepper is always at the bottom: Accepted, On Scene, Patient Onboard, At Hospital, Handover.

## Real-time sync

All three apps show the same Case live. Push changes over WebSockets or a realtime database subscription: no polling, no page refresh. Use these checks:

- When Intake taps Submit, the Case appears on the Case Board within about 1 second.
- When Dispatch sends a unit, that unit's Copilot shows Accept Case.
- When the crew taps Decline, the Case moves to "Unit declined" on the Case Board.
- Ambulance GPS updates (every 5 s) move the vehicle pin and ETA on the Dispatch Tracking tab.

## Stubs (make them real interfaces with fake implementations)

Hide each one behind an interface so a real provider can replace it later:

- **Speech-to-text and keyword suggestion:** replay a scripted transcript, using the EM-104 call below, and emit suggestions from a keyword list.
- **GPS / Auto-Arrival:** a simulator that drives the unit along its route. Auto-Arrival fires when the unit is within a set radius (e.g. 50 m) of the scene or hospital. Keep the radius configurable.
- **Routing and ETA:** use a real routing API if you have one (OSRM, Google, Longdo for Thailand). Otherwise use straight-line distance ÷ an average speed.
- **Hospital ER (Incoming Notice / Pre-Arrival / cancel):** write a `case_events` row and log it.
- **Traffic Police (Request Traffic Assist, Green corridor):** write a `case_events` row. The Dispatch "Traffic Clearance" card reads its status from there.
- **Maps:** MapLibre GL or Leaflet with OpenStreetMap tiles.

## Seed data (the demo case)

- **Case EM-104:**
  - Patient: male, ~30 years. Address: Building A, Soi Lat Phrao 1, Chatuchak, Bangkok 10900.
  - Case Type: MOI, with chips "Motorcycle vs pole" and "No helmet". Symptoms: unconscious, not breathing, heavy bleeding from the head, bystander CPR.
  - Operator #CT-102. Dispatcher: Navin.
  - Transcript: "There is an accident in front of Building A, Soi Lat Phrao 1." / "Motorcycle hit a pole." / "The victim is unconscious and not breathing." / "A man is starting CPR now. There is a lot of bleeding from his head." / "He is about thirty. No helmet."
- **Other open Cases:**
  - EM-105: female ~70, fall, Awaiting triage.
  - EM-103: male ~45, chest pain, Yellow, Unit declined.
  - EM-101: child ~8, food allergy, Yellow, En route.
  - EM-099: male ~25, low-speed collision, Green, Patient onboard.
  - EM-097: female ~55, stroke signs, Red, At hospital.
- **Hospitals:**

  | Hospital | Distance | ETA | ER status | Capabilities |
  |---|---|---|---|---|
  | Hospital A | 3.2 km | 6 min | Ready | Level 1 trauma, neurosurgery on call, CT |
  | Hospital B | 5.0 km | 10 min | Moderate | General ER, no on-site neurosurgery |
  | Hospital C | 6.1 km | 12 min | Full | Level 2 trauma, CT |
  | Hospital D (Neurological Institute) | 8.4 km | 15 min | Ready | Neurosurgery, stroke unit, CT |
  | Hospital E (Children's) | 9.0 km | 16 min | Ready | Paediatric ER only |

- **Units:**

  | Unit | Base | Distance | ETA |
  |---|---|---|---|
  | BLS-01 | (default base) | 2.1 km | 3 min |
  | ALS-04 | Chok Chai | 5.4 km | 7 min |
  | BLS-07 | Phahonyothin | 6.8 km | 9 min |
  | ALS-02 | | | busy (can't be picked) |

## Visual design

Light theme in the colours of niems.go.th: white, cyan `#2596BE` and yellow `#E6E246`. The font is **Inter**. Use tabular numbers for times, ETAs and IDs.

- **App bar:** cyan with white text.
- **Yellow** is a fill-only accent (the app-bar icon tile and the current step), never text on white.
- **Triage colours keep their clinical meaning.** Code Yellow is shown in **amber**, not the brand yellow.

```css
:root {
  --bg-base:#F3F8FB; --bg-surface:#FFFFFF; --bg-raised:#E3F6FD; --bg-overlay:#10182866;
  --border-default:#D5E6EF; --border-strong:#7A97A8;
  --text-primary:#101828; --text-muted:#5B6472;
  --action:#2596BE; --action-hover:#1E7FA3; --action-ink:#FFFFFF; --action-soft:#E3F6FD; --action-line:#B7E8FB;
  --accent:#E6E246; --accent-ink:#1C1A00;
  --triage-red:#EF4444; --triage-yellow:#F59E0B; --triage-green:#10B981; --triage-white:#E2E8F0; --triage-black:#1F2937;
  --triage-red-ink:#B91C1C; --triage-yellow-ink:#92400E; --triage-green-ink:#047857;
  --triage-red-soft:#FEE2E2; --triage-yellow-soft:#FEF3C7; --triage-green-soft:#D1FAE5;
  --triage-red-line:#FCA5A5; --triage-yellow-line:#FCD34D; --triage-green-line:#6EE7B7;
  --danger-fill:#DC2626; --danger-hover:#B91C1C; --on-danger:#FFFFFF; --on-success:#022C22; --on-warning:#1C1003;
  --map-land:#D3E2EB; --map-block:#F7FAFC; --map-road-major:#B9CCD8; --map-water:#BEE3F3; --map-park:#D5EFDD;
  --space-4:4px; --space-8:8px; --space-16:16px; --space-24:24px; --space-32:32px; --space-48:48px; --space-64:64px;
  --radius-sm:6px; --radius-md:8px; --radius-lg:12px; --radius-xl:16px; --radius-full:9999px;
  --control-sm:32px; --control-md:40px; --control-lg:48px; --control-touch:64px;
  --shadow-float:0 8px 24px #1018281f; --shadow-modal:0 24px 64px #10182833;
  --font-sans:Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
}
```

Build shared components once and reuse them in every app:

AppBar, MetaItem, StatusPill, TriageBadge, TriageOptionCard, KeywordChip (with solid / suggested-dashed / on-danger tones), ChipInput, Field, Card, Button (primary / secondary / outline / ghost / success / danger / danger-outline / warning, sizes sm–xl), SegmentedTabs, Stepper (dots and segments), CaseRow, UnitCard, HospitalOption, ReasonOption, Modal, AlertBanner, MapView with pins, Metric, TranscriptLine, Waveform.

**Ask the project owner for view access** to the RETINA Figma file (`oLhd7VqtFiFiZOvJe73JPk`) and the Design System artifact. They are the pixel reference for every screen above.

## Recommended stack (change it if your team prefers another)

- **Monorepo:** `apps/intake`, `apps/dispatch`, `apps/copilot` and `packages/ui` (tokens + components), with a shared `packages/domain` for the Case types, statuses and the transition function.
- **Front end:** React + TypeScript + Vite (or Next.js). Make the Copilot a PWA so it runs full-screen on a tablet.
- **Back end:** Supabase (Postgres + Auth + Realtime), or Node + PostgreSQL + Socket.IO.
- **Roles:** three logins (operator, dispatcher, crew) that can only see and do what their app needs.
- **Tests:** unit-test every legal and illegal transition of the Case state machine. Add one end-to-end test (Playwright) that runs EM-104 from Submit to Handover across all three apps.
- **Copy:** UI copy is English. Keep strings in one file per app so Thai can be added.

## Build order (finish each before starting the next)

1. **Domain and database:** Case, case_events, units, hospitals, the state machine and the seed data. **Done when** the transition tests pass, including the illegal transitions.
2. **packages/ui:** tokens and the shared components on one demo page. **Done when** every component listed above renders in all its variants.
3. **Intake.** **Done when** Submit is blocked without a Case Type, the Type switch confirms and clears chips, and AI suggestions become chips only when tapped.
4. **Dispatch.** **Done when** the four tabs enforce the order (code → hospital → unit), nothing is pre-selected anywhere, and the Case Board regroups live.
5. **Copilot.** **Done when** Accept/Decline, Auto-Arrival from the GPS simulator, No Transport and Handover all write the right status and event, and the Case Board reflects each one.
6. **End-to-end:** EM-104 runs from Intake Submit to Copilot Handover with all three apps open side by side, with no refresh.

## Before real-world use

This is a life-safety system that stores patient health data. Before it touches real calls, it needs:

- Thai PDPA-compliant storage and access logging.
- Hosting with high availability.
- Fail-safes: the Copilot must keep working if the network drops, and radio remains the backup.
- Sign-off from NIEMS / 1669 operations.

Treat this build as a pilot until then.
