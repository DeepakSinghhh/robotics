# DRONA — Solution Plan

**Drone Recognition, Observation & Neutralisation Academy**
SIH Problem Statement **26247**: AI-Enabled Drone & Counter-Drone Threat Simulation Trainer
Ministry of Defence, Defence Services Staff College · Theme: Robotics and Drones

> Named after Dronacharya, the teacher. DRONA is a software counter-UAS (C-UAS) operator trainer. It runs on any
> unit laptop in a browser, needs no internet, and can be used in VR. Each sortie is new, every
> decision is scored against a doctrinal decision tree, and every session goes into a unit-level after-action
> review.

---

## 1. Problem → requirement mapping

| PS expectation | How DRONA meets it |
| --- | --- |
| Desktop **or VR-capable** simulator | Three.js/WebGL simulator in a 6-panel C-UAS operator console. WebXR "Enter VR" puts the trainee on the sensor mast with controller-based designation. Installs as a desktop app (PWA). |
| **Scripted** and **procedurally generated** scenarios | 8 doctrinal vignettes plus an Instructor Scenario Builder (JSON, waves on a map). A seeded procedural generator and an AI Director build new sorties on demand. |
| Day / night, degraded sensors, urban / rural, single and swarm | Environment matrix: 3 terrains × 4 times of day × 4 weather states × EW/jamming level. Night switches the EO camera to thermal (white-hot). Swarms use boids with tactics (saturation, decoy-screen, split-axis). |
| **Decision-tree scoring**: detection time, classification accuracy, engagement decisions | A machine-readable C-UAS doctrine tree (UAS? → IFF → hostile intent → WCS → time-to-impact → RF link → GNSS → collateral → weather → swarm). Each track is scored on detection latency, classification, identification, decision quality and outcome. The tree is run **twice**, on ground truth and on what the trainee perceived, so every error is traced to a root cause (*classification*, *identification*, *doctrine* or *timing*). |
| **AAR dashboard** for individuals and units over repeated sessions | Tactical replay with a timeline scrubber, the decision-path tree for each track, an AI Coach debrief, mastery radar, trend lines, a confusion matrix, a unit heat-map, a readiness gauge, certification levels and CSV export. |
| Adjustable difficulty and randomisation against rote learning | 4 difficulty tiers plus **Adaptive**. The generator is seeded with forked RNG streams. The scenario fingerprint is checked against the trainee's history so the same sortie is never repeated. The live director can inject pop-up waves. |
| Unit-level use with minimal hardware | Zero-dependency Node server (one laptop) with trainees joining over the LAN from any browser. It also runs fully offline with on-device storage. No GPU workstation, HMD or internet needed. |

## 2. What makes DRONA different

1. **Root-cause scoring (dual-path decision tree).** Most trainers only say right or wrong. DRONA separates *"you
   didn't know doctrine"* from *"you knew doctrine but misidentified the target"*. For example, a trainee who jams a
   fiber-optic FPV made a **classification** error, not a doctrine error, because jamming is correct for the FPV they
   thought they saw.
2. **Human–AI teaming (trust-calibration) training.** An on-screen ATR "AI decision aid" proposes a class and a
   confidence. As difficulty rises it gets less reliable and can be fooled by decoys, as real systems can. DRONA scores
   *appropriate reliance*: it rewards correct overrides and penalises blind acceptance.
3. **Adaptive Red-Force AI Director.** Bayesian Knowledge Tracing keeps a mastery estimate for 19 skills per trainee.
   The director weights the next sortie towards the weakest skills (for example, a trainee weak at night or
   fiber-optic FPV identification gets more of those). It aims for a challenge zone of about 70% success.
4. **Multi-sensor cueing like a real C-UAS cell.** Radar PPI (RCS/R⁴, terrain masking, clutter, birds), passive RF
   detector with a spectrum waterfall (OcuSync, ELRS, analogue video, military datalink), acoustic array with
   synthesised signatures you can listen to, and an EO/IR gimbal with 60°–0.7° zoom.
5. **Realistic current threat set.** Commercial quads, FPV, **fiber-optic FPV (immune to jamming)**, heavy hexacopter
   bombers, fixed-wing ISR spotters, Shahed-class loitering munitions, Gerbera-class decoys, birds, and own-force
   tactical UAVs that need IFF/ATO deconfliction.
6. **Effector trade-offs.** RF jam, GNSS spoof, AD gun, interceptor drone and laser (DEW). Each has its own range,
   Pk model, dwell time, ammunition, weather sensitivity and collateral or fratricide side-effects.
7. **Exemplar mode.** A doctrine-driven AI operator can play any scenario so trainees can watch a model run. The same
   bot is used in automated tests to check that the scoring is consistent.
8. **Recognition Drill.** Rapid flash-ID drill on 3D models at random aspect, range, light, thermal and fog, with
   optional acoustic/RF cues. It gives many repetitions in a short time, and the sampling is adaptive.

## 3. Architecture

```
┌──────────────────────────── Browser (any laptop / VR headset) ─────────────────────────────┐
│  UI layer         Console (PPI, RF waterfall, acoustic, EO/IR, track table, track card)       │
│                   AAR dashboard · Recognition Drill · Scenario Builder · Trainee/Unit pages  │
│  Render layer     Three.js world (terrain, buildings, drones, FX, thermal, weather, WebXR)   │
│                   Canvas 2D: radar PPI, waterfall, replay map · SVG charts                    │
│  AI layer         Director (adaptive scenario spec) · Live director (intensity)               │
│                   Doctrine decision tree · Scorer · Coach (NLG) · Mastery (BKT) · ATR aid    │
│  Sim core (pure)  Deterministic fixed-step engine: entities, flight profiles, swarm boids,   │
│                   sensors, tracker/fusion, effectors, events, replay recorder                │
│  Store            REST client → falls back to localStorage when offline                      │
└───────────────────────────────────────────────▲──────────────────────────────────────────────┘
                                                │ HTTP/JSON (LAN)
┌───────────────────────────────────────────────┴──────────────────────────────────────────────┐
│  DRONA server (Node.js, zero dependencies): static hosting + /api (units, trainees, sessions,  │
│  scenarios, CSV export) · JSON-file datastore with atomic writes · replays stored per-session  │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

* The **sim core and AI layer are pure ES modules** with no DOM. They run headless in Node for tests and the exemplar
  bot, and in the browser for training.
* **Determinism.** One seed produces the same world. Forked RNG streams (`rng.fork('radar')`) mean that adding a
  feature does not change other streams.
* **Fixed 20 Hz simulation step**, separate from the render loop. Pause and time compression do not affect scoring.

## 4. Doctrine decision tree (scoring core)

```
D1 Is it a UAS? ──no──► DISMISS (non-UAS: bird/clutter)          engage = waste
 └yes► D2 Friendly? (valid IFF / ATO + corridor) ──yes──► HOLD   engage = FRATRICIDE
        └no► D3 Hostile act/intent? (weaponised class, closing on DA, inside restricted zone)
               ├no──► MONITOR + REPORT (neutral)                 kinetic = prohibited
               └yes► D4 WCS permits? (HOLD → self-defence only if TTI < 25 s)
                      └yes► D5 Imminent? (TTI < 20 s) ──yes──► HARD-KILL now (gun/laser) + WARN
                             └no► D6 RF-controlled? ──yes──► D7 Collateral/urban? → RF JAM ≻ interceptor ≻ …
                                  └no──► D8 GNSS-guided & time? ──yes──► GNSS SPOOF (+ hard-kill backup)
                                         └no──► D9 Collateral? urban → INTERCEPTOR/LASER · rural → GUN/LASER
               Modifiers: fog/rain/dust → laser degraded; swarm ≥5 → area soft-kill, TTI-priority;
                          decoy → cheapest effector; interceptor on decoy = poor.
```

Each leaf rates every possible action as **OPTIMAL / ACCEPTABLE / POOR / WRONG / PROHIBITED**.

**Per-track score** = detection (latency vs first detectable) + classification + identification + decision (tree
rating × timeliness) + outcome. Tracks are weighted by threat level. Session penalties cover fratricide, collateral,
asset damage and wasted munitions.

## 5. AI components

| Component | Technique | Why it fits |
| --- | --- | --- |
| Mastery model | Bayesian Knowledge Tracing per skill (19 skills) | Explainable, small-data, standard in intelligent tutoring |
| Director | Weakness-weighted sampling + challenge targeting + fingerprint de-duplication | Prevents rote learning and targets weaknesses |
| Live director | Stress estimate (open hostile tracks, near-misses, idle time) → pop-up waves | Keeps intensity right during a sortie |
| Swarm AI | Boids (separation/alignment/cohesion) + tactic state machine, reacts to jamming | Realistic saturation and decoy tactics |
| ATR decision aid | Simulated classifier with a confusion model that depends on conditions and adversarial decoys | Trains trust calibration |
| AI Coach | Rule-driven natural-language generation over decision traces | Offline, deterministic, auditable (no cloud LLM in a defence setting) |
| Exemplar operator | Doctrine-tree policy + sensor-driven classification | Demonstration and regression testing |

## 6. Delivery phases (hackathon)

| Phase | Output |
| --- | --- |
| P0 Core | RNG, catalog, engine, sensors, effectors, tracker, scoring tree, tests |
| P1 Console | 3D world, PPI, waterfall, track table/card, effectors, brief/debrief |
| P2 AI | Director, mastery, coach, ATR aid, live director, exemplar bot |
| P3 AAR | Replay, decision-path visual, trainee and unit dashboards, CSV export |
| P4 Extras | Recognition drill, scenario builder, WebXR, PWA/offline |

## 7. Roadmap after the hackathon

* Multi-operator crew mode (sensor operator + fire controller + commander) over WebSocket.
* Import DEM/GIS tiles for real training areas. Imagery-based ATR model (ONNX in-browser) for the EO feed.
* Integration with real C-UAS hardware consoles (radar/RF emulators) for hybrid training. Electron/Tauri packaging.
* Role-based access, SSO with Army LAN identity, and an encrypted datastore.
