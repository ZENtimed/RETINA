# RETINA — Emergency Medical Response

One emergency case moving from the 1669 call through dispatch, ambulance, traffic police and hospital ER. This glossary fixes the words the five apps use for that case.

## Language

### Case details

**Case**:
One emergency incident, identified by an ID such as #EM-104, that every app works on.
_Avoid_: Incident record, ticket, job

**Case Type**:
Whether a Case is an injury or an illness, either Mechanism of Injury or Nature of Illness. Exactly one is chosen at Intake.
_Avoid_: Category, call type, trauma/medical flag

**Mechanism of Injury (MOI)**:
How an injury happened, recorded as one or more keyword chips (e.g. "Motorcycle vs pole", "No helmet"). Used when the Case Type is Mechanism of Injury.
_Avoid_: Mechanism (on its own), cause, accident type

**Nature of Illness (NOI)**:
The medical complaint behind a non-injury Case, recorded as one or more keyword chips (e.g. "Chest pain", "Food allergy"). Used when the Case Type is Nature of Illness.
_Avoid_: "No trauma · medical", diagnosis

**U / D (Underlying Disease)**:
The patient's known long-term conditions, recorded at Intake as an optional free-text field (e.g. "Diabetes", "Hypertension"). It replaces the old Allergies field. It is written "U / D", with spaces.
_Avoid_: UD, Allergies, medical history, comorbidity

**Call Transcript**:
The live text of the 1669 call at Intake, one line per utterance labelled Operator or Caller, written in whichever language was spoken (Thai or English).
_Avoid_: Voice log, recording, captions

**AI suggestion**:
A keyword the system proposes from the Call Transcript, shown as a dashed chip, that counts as case data only after an operator taps to accept it.
_Avoid_: AI tag, auto-keyword

### Dispatch

**Case Board**:
The dispatcher's start screen, which lists every open Case grouped by Case Status.
_Avoid_: Dashboard, queue, inbox

**Case Status**:
Where a Case is in its lifecycle: Awaiting triage, Unit declined, Dispatched / En route, Patient onboard, At hospital, Closed (No Transport), or Handed over.
_Avoid_: State, stage

**Command Center**:
The per-Case dispatch workspace with Patient Triage, Destination Hospital, Fleet Dispatch and Tracking & Handover tabs, in that order, opened from the Case Board.
_Avoid_: Dispatch page, operations hub

**Destination Hospital**:
The single hospital a Case's patient will be taken to. The dispatcher chooses it after setting the Triage Code and before sending a unit.
_Avoid_: Recommended hospital, selected hospital, receiving facility

**Assigned Unit**:
The single ambulance the dispatcher sends to a Case.
_Avoid_: Recommended unit, primary unit, backup unit

### Ambulance

**Auto-Arrival**:
The system's detection that the Assigned Unit has reached the scene or the Destination Hospital, based on its location alone, with no tap from the crew.
_Avoid_: Arrived button, check-in

**Handover**:
The crew's confirmation that the ER has taken over the patient, which ends the mission. Always tapped by the crew, never detected automatically.
_Avoid_: Complete Mission, drop-off

**Patient Onboard**:
The crew's confirmation that the patient is in the ambulance, which starts transport to the Destination Hospital.
_Avoid_: Pickup, loaded

**No Transport**:
The crew's outcome when no patient is carried (Deceased on scene, Refused transport, or Treated on scene), which ends the mission without a hospital.
_Avoid_: Cancelled, aborted

### Hospital

**Incoming Notice**:
The first alert the Destination Hospital's ER receives, sent when the unit is dispatched. It carries the Triage Code, Case Type and the unit's ETA to the scene, and the patient is not yet onboard.
_Avoid_: Pre-alert, heads-up

**Pre-Arrival**:
The live alert that replaces the Incoming Notice at Patient Onboard, carrying the patient's details and the ETA to the hospital.
_Avoid_: Handover (that happens at the door)

### Decisions

**Triage Code**:
The response priority of a Case (Red, Yellow, Green, White or Black), chosen only by the dispatcher.
_Avoid_: Pre-triage, AI triage, severity

## Relationships

- A **Case** has exactly one **Case Type**, and its keyword chips are all **MOI** or all **NOI**, never both
- A mixed situation (e.g. a seizure that causes a crash) is recorded under the **Case Type** that drives the response, and the rest goes in the symptom notes
- A new **Case** has no **Case Type**, and the operator must choose one before submitting to dispatch
- Changing the **Case Type** removes the existing chips, after the operator confirms
- An **AI suggestion** becomes an **MOI** or **NOI** chip only when an operator accepts it
- The **Call Transcript** may be in Thai or English, and the language is detected without the operator choosing it; **MOI** and **NOI** chips, including **AI suggestions**, are always English words from one fixed keyword list, whatever language the call was in
- A **Call Transcript** line shows while the person is still speaking, but only a finished line can produce an **AI suggestion**
- Only the Intake operator changes a **Case**'s **Case Type**, its chips and its symptom facts; the dispatcher reads them
- A **Case** has no **Triage Code** until the dispatcher sets exactly one
- The **Case Board** lists many **Cases**, and the **Command Center** works on exactly one
- A **Case** in Awaiting triage has no **Triage Code**
- A **Case** has at most one **Assigned Unit**, chosen by the dispatcher
- An **Assigned Unit** accepts or declines the **Case**; a decline carries a reason and puts the **Case** in Unit declined, with no **Assigned Unit**, until the dispatcher picks another
- A **Case** has at most one **Destination Hospital**, chosen and changed only by the dispatcher; the crew asks Dispatch by radio if it should change
- The dispatcher must choose the **Destination Hospital** before choosing the **Assigned Unit**
- Dispatching a unit sends the **Destination Hospital** an **Incoming Notice**; **Patient Onboard** turns it into a **Pre-Arrival**; **No Transport** cancels it
- **Auto-Arrival** at the scene is the only way a unit reaches the scene stage; the crew has no manual arrival control
- After **Patient Onboard**, navigation to the **Destination Hospital** starts by itself, and **Auto-Arrival** there puts the Case At hospital; only the crew's **Handover** makes it Handed over
- After arriving at the scene, the crew records exactly one of **Patient Onboard** or **No Transport**; only **Patient Onboard** leads to transport to the **Destination Hospital**

## Example dialogue

> **Designer:** "The transcript says 'motorcycle hit a pole', so is 'Motorcycle vs pole' already the **MOI**?"
> **Operator:** "No. It's an **AI suggestion** until I tap it. Once I do, it's an **MOI** chip on the **Case**, exactly like one I typed myself."

## Flagged ambiguities

- "Hospital selection" was the crew's step after **Patient Onboard**. Resolved: it is now the dispatcher's **Destination Hospital**, chosen before a unit is sent, and the crew has no hospital picker.
- "Arrived at Scene" was a button the crew tapped. Resolved: arrival is **Auto-Arrival**, with no manual control.
- "Hazard" (scene dangers such as "Live traffic") was a separate Intake field. Resolved: removed. Intake no longer records scene dangers, and the crew judges scene safety on arrival.
- "AI pre-triage: Code Red" on Intake gave a Case a **Triage Code** before the dispatcher had chosen one. Resolved: Intake records facts only, and the **Triage Code** belongs to the dispatcher.
