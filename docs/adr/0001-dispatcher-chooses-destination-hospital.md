---
status: accepted
---

# The dispatcher chooses the Destination Hospital, before a unit is sent

The crew used to pick the hospital in the Copilot after **Patient Onboard**. Now the dispatcher chooses the **Destination Hospital** in the Command Center, on its own tab between Patient Triage and Fleet Dispatch, and a unit can't be dispatched until it is set. Only the dispatcher can change it: the crew asks Dispatch by radio, and the dispatcher updates it in Tracking & Handover. We made this change so that one person owns the destination, the crew keeps their hands on the patient instead of a picker in a moving vehicle, and the ER hears about the case at dispatch (the **Incoming Notice**) rather than only once the patient is loaded.

## Considered Options

- **The crew picks after Patient Onboard** (the previous design). This choice is clinically the best informed, because the crew has seen the patient. But the ER gets no warning before the patient is loaded, and the choice falls to someone who is busy treating the patient.
- **The crew can request a change through the Copilot, and the dispatcher approves it.** This option was more structured, but it adds a new flow and a screen. A radio call covers the rare case.

## Consequences

- The choice is made before anyone has seen the patient. If the crew finds something different on scene (for example, a stroke rather than head trauma), the destination is correct only if the crew radios Dispatch and the dispatcher changes it.
- Every Case that reaches Fleet Dispatch has a Destination Hospital, including Cases that end in **No Transport**. That outcome cancels the Incoming Notice.
- When the ER declines because it is at capacity, Dispatch is told and the dispatcher picks another hospital. The ER no longer reroutes the ambulance itself.
- The hospital list stays facts-only (drive ETA from the scene, capability notes, search, nothing pre-selected), following the rule that people make every decision.
