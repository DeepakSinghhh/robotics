# DRONA: 5-minute demo script (SIH judging)

**Setup (once):** on the hosted site click **Load demo unit** on the home page. On a laptop, run `npm run seed-demo` with the server stopped, then `npm start`, then open `http://localhost:8080`.
Select **Hav Arjun Mehta** from the trainee chip (top right).

| Time | Show | Say |
| --- | --- | --- |
| 0:00 | **Home** | "DRONA is a counter-drone operator trainer. It runs in a browser on any unit laptop with no internet and no special hardware, and it supports VR through WebXR." |
| 0:20 | **Missions → OP SHIELD WALL → Brief & fly** | Point out the brief: ROE/WCS, effectors, air tasking order and the intelligence estimate. "Timings and axes are randomised every run, so the mission cannot be memorised." |
| 0:40 | **Console** (press 2× speed) | Radar PPI with sweep, plots and clutter; the RF waterfall showing an FPV's analogue video carrier; the EO/IR gimbal. Press **Tab** to select a track, **1–9** to classify, **H** for hostile, **J** to jam. Show the **AI aid** suggestion and its confidence. |
| 1:30 | The **fiber-optic FPV** appears | "RF is silent on its bearing, so jamming will fail. The trainee must recognise this and use the gun or the laser." Press **W** for the air-sentry warning. |
| 2:10 | **End → debrief → Open full AAR** | Score, grade and penalties. **AI coach** strengths and improvements. **Tactical replay** with the timeline scrubber. |
| 2:50 | Click a track row marked *classification* | "This is our differentiator. The decision tree is run twice, once on ground truth and once on what the trainee believed. The green path is doctrine and the amber path is theirs. So we know the error was in classification, not in doctrine." |
| 3:30 | **My AAR** | Mastery from Bayesian Knowledge Tracing over 19 skills, the qualification ladder, trend lines and the recognition **confusion matrix**. "The AI Director reads this and builds the next sortie around the weakest skills." |
| 4:10 | **Unit** | Readiness, weekly trend, the **skill heat-map** across trainees, training priorities and CSV export for the commander. |
| 4:40 | **Builder → Load OP AGNI VARSHA → Validate** | "Instructors author scenarios, and the doctrinal exemplar validates them headlessly. It scores about 100 while an idle operator scores 0, so the scenario discriminates skill." |
| 4:55 | **Home → Watch the exemplar** (optional) | "A doctrine-driven AI flies the mission as a model run." |

**Backup talking points**

* Tested: 37 automated tests, including determinism, root-cause attribution, the adaptive director, fratricide and ROE
  handling, and the REST API.
* Scales to a unit: one laptop runs the server and trainees join over the LAN. It also runs fully offline on a single device.
* The AI is explainable and offline (BKT, rule-based coach, simulated ATR), which suits a defence network. The roadmap
  adds an imagery-based ONNX ATR and multi-operator crew mode.
