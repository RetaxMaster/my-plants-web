# Changelog — `my-plants-web`

All notable, user-facing changes to the MyPlants web app. Newest first.

## Unreleased — Nothing left open: the care engine's full story reaches your plants (2026-08-14)

**The app now shows you every task your plant needs in the order it should be done, records watering, repotting, fertilizing, rotating and cleaning leaves only once per day (misting is deliberately exempt — a second misting on a hot day is a genuine second event, not a duplicate), tells you when a measurement failed so you can retry it, and lets you record care actions from days past.**

### Added

- **Task ordering within a plant card — repot first, then water, then fertilize.** Previously all six tasks appeared together; now within a single plant card they are ordered so an answer to *"this plant needs repotting"* appears first, not last. The global plant-list order stays unchanged.
- **Plant registration now asks which soil mix you used.** When adding a new plant, the form offers a choice of common soil types — aroid mix, all-purpose (with or without perlite), cactus & succulent, orchid bark, peat-based, coco coir, semi-hydro — plus an *"I don't know"* that leaves it unrecorded. The choice you make is persisted from the moment of creation and appears on the plant's own page. Omitting the choice or picking *"I don't know"* changes nothing — the app treats a `null` mix exactly as it treats a plant recorded before this field existed.
- **Back-dated care records are now traceable.** The Water row on a plant's page regains its date box and **Hecho** button, so a watering from two days ago (or three weeks) can simply be typed in. The back-dated record clears the date box after it is actually applied, giving clear visual confirmation the action was recorded.
- **The readings dialog states each fault once.** Opening the measuring modal no longer shows redundant error messages — a single clear statement for each problem you encounter, rather than the same reason repeated across different control sections.
- **The readings card now says it couldn't refresh, with a retry button.** Opening the measuring dialog refreshes your plant's soil readings. If that refresh fails, the previous snapshot is restored (correct stale-while-revalidate) — but now the card shows *"No se pudo actualizar · Reintentar"* / *"Couldn't refresh · Retry"* instead of silently showing stale data with nothing to prompt a retry. The failure is reported as a small, non-blocking marker on the card itself.
- **Approving an agent's proposed changes now tells you what actually landed.** When the Plant Doctor or the Gardener asks permission to change something, a proposal can carry several changes at once, and you approve it as a whole. Some of them can quietly do nothing — a watering the plant already had recorded for that day is not written twice. Until now, pressing **Aprobar** looked identical whether every change landed or none of them did: the card simply closed. Now each change that did nothing says so in its own words, in the same wording the rest of the app already uses for that fact — including the fertilizing warning, since a repeat there is a root-burn risk and not merely a duplicate.
- **And, above those, one line saying how much of the proposal landed.** *"Se aplicaron 2 de 4 cambios"* / *"2 of 4 changes were applied"*, so you can see the whole result before reading the reasons underneath it. It appears **only when something did not apply** — when everything landed, the individual confirmations already say so and a line repeating it would be noise on by far the most common outcome.
- **Fertilizing, rotating and cleaning leaves now record once per day, joining watering and repotting, and a repeat tells you so instead of quietly writing a second entry.** Pressing Hecho a second time on the same day for one of these tasks used to genuinely double-record it. The app now recognizes the day already has one and tells you plainly, rather than leaving you with two records and no way to know it happened. Fertilizing gets its own wording, because a repeat there isn't just redundant: *"This plant was already fertilized today. Do not fertilize it again on the same day: the excess salts burn the roots."* Recording a fertilizing onto a past day that already had one gets the softer, factual version — *"That day already had a fertilizing on record. If you really did fertilize twice, keep it in mind: excess salts burn the roots."* — since you may genuinely have done it twice and are only logging history. Rotating and cleaning leaves get the same idea without the health warning: *"That day already had a record, so nothing was added."*

### Changed

- **The Water row clears after a back-dated record is applied.** When you record a watering from a past day, the date box empties immediately after save, eliminating any ambiguity about which day the record was for.

### Fixed

- **Readings that failed to refresh are no longer silent.** Previously an empty catch handler swallowed refresh failures entirely — an owner who had recorded a reading on another device would see a silently stale list with nothing to signal the problem or offer a retry. The failure is now visible and retryable on the card itself.

## Unreleased — Measure your soil moisture, and your plant's care explains itself

**You can now measure how fast your soil dries out and let that estimate guide your watering, and — new — the watering task can ask you first and answer "water today, or hold?" from a single reading. The app also now tells you exactly why each plant's next feeding and repotting dates are what they are.**

### Added

- **The watering task now asks before it advises.** A due WATER task can offer "¿Necesitas regar?" instead of the usual Hecho/Postpone pair. Take one reading and the app answers right away: water it now (which unlocks Done/Postpone, same as before) or hold until a specific day (applied for you automatically — nothing left to confirm). If the app can't honestly answer, it tells you why and offers to save the reading anyway. **This only appears once you've told the app what you measure with in Settings** — until then, the task behaves exactly as it always has.
- **Two free instruments: a wooden stick, and just your finger.** Neither needs anything bought or calibrated. You push the stick to the bottom of the pot (or feel about 3 cm in with a finger) and pick one of three states you recognise — comes out clean, a little dry soil clings to it, or damp soil sticks to it — from a simple choice control, never a number field that would invite an answer these can't give. They're two separate options in Settings, not one, because they reach different depths of the same pot.
- **Measure button on the watering task.** The WATER card on your plant's detail page now has a Measure button beside the watering advice. Tap it to open the measuring modal and record a soil moisture reading — the app then estimates your soil's drying rate and uses that to suggest the watering interval's center. A back-dated reading you take this way now lands directly in the plant's measurement history rather than needing a separate step.
- **The measuring modal: a per-pot protocol.** Tap Measure and you pick which instrument you're using, from the ones you've already added in Settings — if you haven't added any yet, the modal tells you to do that first, rather than adding one from here. It then reminds you exactly where to measure in the pot (how deep, how far from the centre) so every reading of that pot stays consistent with the last. The app normalizes your raw reading for that instrument's scale, builds a drying-rate curve over recent readings, and feeds that estimate into the watering calculation.
- **Instrument settings: picker and comparison table.** A new Settings page lets you see and adjust which instruments you own and measure with, and says in plain words what each rung of the ladder buys you — never a reliability score to chase. A side-by-side comparison table shows each instrument's unit, whether its readings compare between pots, and whether it needs a per-pot calibration setup — so you can decide whether a reading is trustworthy for this particular plant.
- **Your plant's detail page now shows what slowed down its next fertilize date — and what to add if you want to speed it up.** If your plant's feeding date moved further out than usual, the Fertilize card now tells you why: the substrate is still feeding it (with the date that charge runs out), and you can read the estimate. If the app's species average for "first repot" is the only source for a repotting date and you have not recorded an actual repot yet, the Repot card now tells you what specific information you could add to the app — pot size, height, or growth habit — and suggests you log an existing repot if you know when that happened.
- **Changing the soil mix in a plant's profile now asks if you recorded the change.** When you edit a plant's soil mix and the new choice is different from what was recorded, the app asks whether you just changed it or if that was your best guess when you first added the plant. Recording it as a change starts the fertilizer clock over, which is the right call if you really just added fresh substrate.
- **The repot Done form now refuses a future day.** Marking a repot done lets you set the date it happened — it now stops you from entering a day that hasn't occurred yet, and tells you so if you try. This is not a pedantic correction: a future repot date would age your plant backwards in the app's math.
- **The app flags when your soil is drying more slowly than expected — and points at the pot, not your watering.** When a series of readings shows your soil staying wet longer than the app's model predicts, the app shows a finding on your plant's page naming the likely cause — an oversized pot, poor aeration, or tired substrate, not a watering problem — and links you straight to the Repot card, since that's what usually fixes it.
- **A separate finding catches a meter that isn't giving real readings.** When your readings barely move at all, that's usually not your soil — real soil dries steadily — so the app flags it as its own, separate finding pointing at the instrument itself: salt build-up, poor contact with the soil, or measuring at a different depth each time. This finding and the too-slow-drying one above are mutually exclusive: only one shows at a time, since a flat series means the reading itself can't be trusted yet.
- **A back-dated reading taken on a watering day now asks which side of the watering it's on.** If you record a past reading for a day the plant was also watered, the app asks whether you measured before or after — this only appears when it's genuinely relevant, and answering it lets the app use readings from plants you water every few days that it previously had to throw away.
- **Calibrating a kitchen scale is now setup, on a screen of its own.** A scale reads grams, and grams mean nothing about soil until the app knows two reference weights for that particular pot: the pot when the soil is dry, and the pot freshly watered and drained. Those two fields used to sit inside the measuring dialog, which was circular — one of the two anchors *is* the pot freshly watered, and watering the plant is the very decision you had opened the dialog to make. The plant's measuring section now has its own **Calibrate the scale** button, and it appears only when one of your instruments actually needs calibrating. The screen it opens does one job: it explains the two weighings (and says outright that you can do both in one go — weigh it dry, water it, let it drain, weigh it again), it shows the weights the pot is currently calibrated to so a mis-weighed pot can be corrected rather than lived with, and it only ever lets you pick an instrument that has anchors to set — a probe, a wooden stick or a finger can never be chosen here and leave you on a screen with no fields and a dead Save.
- **Your readings are now visible on the plant's page.** Until now a saved reading simply vanished — no confirmation, no list, nothing anywhere — so the only sign it had worked was the modal closing. Your recent measurements now appear under the measuring section, newest first, with the day, which instrument, and — for the stick and the finger — the state you actually picked, never the number it is stored as. A reading you took with an instrument you have since un-ticked in Settings still shows: un-ticking changes what you measure with from now on, it does not erase what you measured before.

### Changed

- **The watering survey stopped asking a question it can answer itself.** When you measured on a day the plant had already been watered, the survey asked which side of that watering your reading fell on. It no longer does — and not because the answer stopped mattering. It matters a great deal: a reading taken on a freshly watered pot, dropped into a drying curve, flattens the whole estimate and skews every prediction after it. It is simply that the app already knows. You are measuring right now, and a watering recorded for today was recorded before this moment, so the order is something the app can read off its own records instead of asking you to remember. The survey now asks you one thing, which is the thing you actually opened it for: should I water?
- **The question survives exactly where it is genuinely unanswerable — and now reads like one.** Recording a reading for a *past* day that also had a watering is something nobody can reconstruct: the app stores the day a watering happened, not the hour. So that is the one place it still asks, and the wording no longer describes the soil ("Before" / "After", under a paragraph about drying cycles). It names what you did: *You also watered this plant that day — did you take this measurement before watering, or after watering?* The old phrasing sat one field away from a box labelled "watered weight", and the two were easy to read as the same question.
- **The survey no longer offers a scale it cannot read.** An uncalibrated scale has no way to turn your weight into anything, so putting it in the picker only led to a control that could not work. If your only instrument for a pot is a scale you have not calibrated, the survey now says so plainly and sends you to the calibration screen, instead of either hiding the problem or asking you to solve it mid-decision. And if a deferred save sits open long enough for the plant's own day to end, the app tells you the day has rolled over and asks for a fresh measurement — a reading dated yesterday cannot be saved as today's no matter how many times you retry it.
- **Repot and fertilize explanations now show their calculated basis.** Where those dates used to just appear, they now state what part of the app's model led to each one: the substrate wearing out, what the app has actually measured about this plant (its size, its pot, and its watering history), or — when there isn't enough of that yet — the usual cadence for the species. An explanation card on your plant's page names that reason and shows the supporting details — not to judge whether the app was right, but so you know what you'd need to change if the timing didn't match your own sense of the plant.

### Fixed

- **Logging a reading no longer takes away the survey.** Two controls take a measurement, and they do opposite jobs: "¿Necesitas regar?" exists to **answer** you, and "Agregar lectura" exists to **store** something you already measured — a back-dated reading, or a raw weight on a pot the app cannot interpret yet. Storing one in the morning used to remove the survey for the rest of the day. You had put in your own data, got no verdict, and lost the only control that could give you one — and readings carry no edit or delete, so there was no undo. A reading that answered nothing now closes nothing: the survey stays exactly where it was, and you can still ask.
- **Opening the dialog for a day you already measured now loads that reading, and says it will replace it.** One reading per pot, per instrument, per day. Pick an instrument and a date and the dialog fills in the value you recorded, and states, above the field, that saving will update that reading rather than add a second one. The before/after-watering answer is deliberately **not** filled in: for most readings the app worked that answer out itself rather than being told it, and showing you a pre-pressed button would be putting words in your mouth — so on the one kind of reading that still asks (a back-dated one), it asks again. Change the instrument or the date and it re-checks and re-loads for the new pair. Measuring the same pot with a **probe and a scale** on the same day is still two separate readings: they measure different things in different ways, and the app keeps their histories apart. And a value you typed yourself is never quietly thrown away when you correct the date — only a value the app loaded for you is.
- **Correcting a reading now corrects what it decided.** Measure a pot, get *no riegues todavía*, and the watering moves out to a date the app picks — then realise you typed `8` where you meant `3`. Until now the number changed and the postponement stood: the reading said the soil was dry and the plant was still pushed a week out, with no way back, because once a reading has answered the day's question the survey stops offering itself. Re-opening **Agregar lectura** on that same reading and changing the number now puts the corrected value back through the same check, tells you the new answer on screen — and lifts the postponement that reading had caused, so the watering returns to whatever your plant is actually on. Only a postponement *that reading itself* set is lifted: one you made by hand afterwards is your decision and stays. This is deliberately narrow, and each limit is there for a reason. A reading that answered nothing — a plain log, a raw weight on an uncalibrated pot — still just records your data, exactly as before; a **back-dated** correction records the number and decides nothing, because *should I water?* is a question about the pot right now and a value from three days ago cannot answer it honestly; and opening the dialog and saving without changing anything changes nothing, rather than quietly nudging your watering date by a day. If the corrected value can't be turned into a moisture reading at all, the app keeps it and says plainly that the previous answer — and the date it set — both still stand.
- **"Water it now" no longer records a watering you have not done.** When the survey concluded a pot needed water, the app wrote a completed watering into the plant's history straight away, as though you had already gone and done it — which reset the drying cycle and moved the schedule. "I should water" and "I watered" are two different statements, and only you can make the second one. The dialog now hands you the plant's ordinary **Hecho** and **Posponer** buttons and waits, which is what it always looked like it was doing.
- **Measuring no longer takes the watering question away for the rest of the day.** Recording any reading dated today made "¿Necesitas regar?" disappear from both the plant's page and its Hoy card — no message, no verdict, nothing in its place — and since readings cannot be edited or deleted, there was no way back. It was worst in exactly the case the app deliberately allows: log a raw weight on a pot whose scale is not calibrated yet, get no moisture value back because none can honestly be computed, and lose the ability to ask as well. What replaces the question is now the *answer's consequence*: told to water now, the card hands you back the ordinary Hecho and Posponer buttons it always had; told to hold, the watering is postponed for you and the card leaves Hoy altogether, because the answer was already delivered in the dialog and there is nothing left to do today.
- **The watering card now reaches you when your own measurement says "water now".** Measure a pot the calendar thought was still nine days away, get told to water it, close the dialog — and nothing happened. The plant's row still read "faltan 9 días", **Posponer** wasn't there (it only shows on a task that's actually due), the day's check was used up, and the plant didn't appear in **Hoy** at all. The app had told you to water it and then left no trace of that anywhere you would look. A "riega ahora" verdict now makes the watering read as due today: the plant shows up in Hoy with the ordinary **Hecho** and **Posponer** buttons, and pressing Hecho records the watering straight away instead of asking why you're watering early — a question the app has no business asking about a watering it just prescribed. Nothing is written to make this happen: your schedule is untouched and no watering is invented; the app simply stops letting a prediction outvote a measurement. The reverse still holds — "no riegues todavía" moves the date out and takes the card off Hoy.
- **A reading is no longer labelled "Regada" on a plant nobody watered.** The little tag beside a reading shows what that reading *concluded*, but it was worded as though you had done something: a reading that said "time to water" was tagged **"Regada"** — on the same screen as "Regada hace 60 días" in the history and a watering still waiting to be done. Both tags now describe the answer instead of an action: "Regar ahora" and "No regar todavía".
- **One of the two measuring dialogs stopped asking a question the other one answers by itself.** On a plant you watered today, "Agregar lectura" made "¿antes o después de regar?" compulsory — starred, with Save disabled until you picked — while "¿Necesitas regar?" never showed it and quietly worked the answer out. Re-opening the log afterwards then showed "Después de regar" already pressed: an answer you never gave. The app *can* work it out for a reading you're taking today (a watering already recorded today happened before you measured), so now both paths do. The question survives exactly where nobody can work it out — a **back-dated** reading, because a watering is recorded as a day with no time of day, so only you know which came first.
- **A raw weight on an uncalibrated pot now says what it's missing, in the log dialog too.** "Agregar lectura" deliberately accepts a raw weight from a scale this pot has no reference weights for — it's your data, and calibrating later fills in the moisture for everything you'd already recorded. But nothing said so: you typed `2400`, saved, and the row read `2400 gramos · Sin lectura de humedad`, with no explanation anywhere and no route to fixing it. The dialog now shows a notice — and the same **calíbrala** link the survey uses — whenever the instrument you've picked is one of those. The instrument is still offered; only the silence is gone.
- **…and that notice no longer contradicts the dialog it's sitting in.** It had borrowed the survey's sentence word for word — *"calíbrala **para poder medir con ella**"* — which is true in the survey, where an uncalibrated scale isn't even in the picker. In the log it was false three lines above a picker offering that very scale and a field that accepts your weight and saves it. The log now says what is actually true there: we'll save the weight, we just can't turn it into a moisture reading until this pot is calibrated.
- **Pressing Hecho on a "riega ahora" card now visibly ends it.** A reading that says "water it now" makes the watering read as due today — but on the plant's own page, answering it changed nothing you could see. Press **Hecho**, and the card came back identical: still "Riega ahora", still both buttons, still there after a full reload. The only sensible reading was that it hadn't worked, and pressing it again did nothing either, because the app had already recorded the watering the first time. Answering the card — with **Hecho** or with **Posponer**, since both are answers — now retires the verdict: the card goes back to reporting the date your plant is actually on. Postponing is deliberately covered too, even though it waters nothing: it still ends the day's question. And a reading taken *after* you postponed still surfaces the card, because a decision made before the measurement existed can't be an answer to it.
- **The plant's Medir button steps aside for the rest of the day once you've watered.** Marking a watering done and then measuring that same pot produced a cheerful success and recorded nothing — the app keeps one watering per plant per day, so the second one was discarded silently. It no longer offers the action at all: once a watering is recorded for today, the **Medir** check disappears from that plant's page and comes back the next day, which is fine, because the watering task already did the measuring. **"Agregar lectura" deliberately stays**: it's the free log, and the only way to correct today's reading if you got it wrong.
- **…and correcting that reading can no longer offer you a watering that would be thrown away.** Because the free log stays open after you water, it left one route back to the same problem: water the plant, then go and fix this morning's reading, and if the corrected number now says the pot is dry, the app answered "riega ahora" and put a **Hecho** button under it — the exact button whose write gets discarded, because the watering for today is already recorded. That button is no longer offered on a plant you have already watered today, and the dialog says why instead of leaving a gap where it used to be. **Posponer stays**, because "water it later" is a real thing to say and it is recorded properly.
- **An instrument you turned on no longer disappears without a word.** If you had both a probe and a kitchen scale enabled, and the scale was not calibrated for that pot, the survey quietly showed only the probe. The scale was simply gone — no reason, no link, nothing acknowledging you had enabled it. The app already had the right sentence for this ("this pot's scale isn't calibrated yet", with a link to fix it); it just never showed it unless *nothing at all* was usable. It now appears whenever an instrument you enabled cannot be used yet, alongside the picker for the ones that can.
- **A dialog opened from another dialog now takes the keyboard with it — and gives it back.** Following "calíbrala" from the measuring dialog opened the calibration screen but left the keyboard behind it: Escape did nothing, and pressing Enter re-opened the measuring dialog *underneath* the one you were looking at, leaving two stacked panels. Focus now stays where the visible dialog is. Closing it puts you back in the page's content rather than at the very top of the document with the whole header to tab through — and, deliberately, **not** back on the button that opens the dialog you just walked away from: escaping the calibration screen and pressing Enter used to throw you straight back into the measuring dialog you had left. A dialog opened from a control that is still on screen (a photo opened from a gallery inside another dialog) still hands the keyboard back to that exact control. The same fix covers a dialog opened directly by a link, which previously appeared on screen while the keyboard was still on the page behind it.
- **"Calíbrala" now actually takes you there.** The link kept its promise and still made you hunt: it dropped you at the top of the plant's page while the calibration button sat two thirds of the way down — over a thousand pixels below the fold on a desktop screen, and more than twice that on a phone. It now opens the calibration screen for you on arrival, which works the same way at every window size — and, when you were already on that plant's page, without costing you a wasted press of the Back button.
- **"Ese día" no longer means today.** When you record a reading for a day the plant was also watered, the app asks which side of that watering it fell on. For a measurement you are taking right now, it phrased that as "*Ese día* también regaste esta planta" — reading as though it meant some other date. A today-dated reading now says "Hoy", and back-dating the reading puts the original wording back.
- **Calibrating a pot now visibly brings its old readings to life.** Calibrating a scale fills in the moisture for every raw weight you had already recorded for that pot — but the list showed the identical thing before and after, so the whole payoff was invisible. Each reading now shows its interpreted moisture beside the raw value, and a reading that still has none says so plainly rather than showing a zero or a gap that looks the same as a real one.
- **Recovering from a refusal now actually works.** The measuring dialog had two ways to rescue a save the server turned down — reveal the "before or after the watering?" question when it turns out the plant was already watered that day, and say plainly when a date is in the future rather than "please try again". Neither had ever run. The app reads the reason out of the wrong part of the failure, so it never matched, and every refusal fell through to the same unhelpful "we couldn't save that reading". Both now work, which is what makes the two rescues below real rather than theoretical.
- **Measuring a plant that was watered from somewhere else no longer dead-ends.** If the plant was watered in another tab, on another device, or from the Today page after you opened its own page, the dialog was still working from the list of watering days it loaded on arrival — so it never asked which side of the watering you measured, the save was refused, and retrying was refused identically, forever. Only a page reload got you out. The list is now refreshed each time the dialog opens, and if it is still behind, the server's refusal now reveals the question instead of a dead end.
- **You can see and correct a pot's reference weights.** The kitchen scale's two anchors were write-once: once set, the fields disappeared and there was no way to see or fix them anywhere in the app. A pot weighed with its saucer on stayed wrong forever, quietly rescaling every reading it ever produced. The fields now always show, filled in with what the pot is actually calibrated to, and are only re-saved if you genuinely change them.
- **A reference weight below zero is refused before you save it.** Typing a negative dry weight was accepted, and from then on a real 1000 g reading reported as 60 % wet. Both anchors are now held to the same scale as a reading.
- **A greyed-out Save button now says why.** Typing `11` into a field labelled "Reading (1–10 index)" — or `0`, `1.5`, `-5` — simply killed the button with nothing beside it. The reason is now printed next to the button, exactly as it already was for a future date.
- **The reason a save is blocked describes the actual problem.** Filling both reference weights the wrong way round (the dry weight higher than the watered one) was reported as "fill in both reference weights first", about two boxes you were looking at, already filled.
- **A dry pot on a day you already watered no longer dead-ends the survey.** Water in the morning, measure in the evening, and the app answered "time to water" — then refused to save it, forever, while your own "before or after?" answer sat selected on screen. Nothing was recorded, so the task went on asking "do you need to water?" after every reload. A wet pot was fine on the same day; only the dry answer was broken.
- **A dropped connection while opening the measuring dialog no longer claims you own no instruments.** The dialog re-checks your readings as it opens; if that check failed, it wiped what the page already had and told you to go add an instrument in Settings — while the card behind it correctly said the load had failed. It now keeps what you already had on screen.
- **Tapping both measuring buttons in quick succession no longer swallows the dialog.** On a slow connection the two entry points stayed live while the app fetched, so a second tap could leave you with no dialog at all — nothing to retry against — or open the flow you did not choose. Only one opens at a time now, and the button says it is working.
- **The reason a save is blocked stays readable on a phone.** Those explanations got longer in this same round, and on a narrow screen they were squeezed into a column a few characters wide beside the buttons. The reason now takes its own line above them.
- **A failed save's error no longer follows you to a different instrument.** Switching instruments clears the reading, as it should — the red "we couldn't save that reading" describing that cleared reading stayed on screen, under a fresh and untouched form.
- **Settings is reachable on a computer.** The instruments screen — the first stop before you can measure anything — was only linked from the mobile "More" tab, and that whole bar is hidden on a desktop-sized window. So the app told you to go to Settings and gave you no way to get there. It now lives in the account menu, which is on every screen at every size. The word "Settings" in the measuring modal's own message is a link too.
- **The measuring instructions match the instrument you picked.** Choosing the kitchen scale still showed "insert to about 8 cm deep, roughly 4 cm from the centre" — in the prominent notice, with the actual weighing instructions in small grey text underneath. A scale is not inserted into anything. Each instrument now states its own protocol, in the prominent notice, and the quiet line beside it says only what it is really about: this pot compares to itself, never to another.
- **A weight below zero is refused before you save.** The kitchen scale had no client-side limit at all, because it has no upper one.
- **"Do you need to water?" no longer asks twice in the same day.** The watering task can now open a quick reading first — you measure, and the app tells you whether to water now, hold off, or that the reading could not be read. Answering "water now" used to leave nothing behind, so the task kept asking the same question after you closed the modal and went to water. That reading is now saved, and once it is, the task shows the usual Done/Postpone instead of the survey — on your plant's own page and on Hoy (Today).
- **The measuring modal answers your question instead of asking you three of its own.** It used to ask what you were doing about the reading — watering now, not watering yet, or just recording — with a note underneath explaining what each choice would and wouldn't do. The app now works that out itself from the reading alone, on the watering task's survey: you measure, it tells you the answer, and there's nothing left to pick.
- **Postponing right after you've measured no longer asks you why.** If you measured, the app already knows the state of the soil — so the only thing left that a postponement can mean is "I ran out of day", and that is what it now records, in one tap. The reason list stays exactly where it is still the only signal the app has: on a watering you haven't measured. This is not just a tap saved. That list still offers "the soil is still moist", which genuinely shifts how often the app waters that plant in future — so leaving it on offer right after a reading let you nudge the schedule with an impression your own measurement, taken a minute earlier, disagreed with.
- **A watering task can no longer be locked up by a failed connection.** If the app couldn't load your instruments for a plant — a dropped request, a moment offline — the measuring modal opened anyway and told you that you own no instruments, which was simply untrue, and Done and Postpone stayed hidden behind a survey you had no way to complete. Going to Settings showed your instruments were right there, and coming back showed the same dead end. A failed load is now told apart from an empty list: the app says it couldn't load them and offers to try again, and the watering task falls back to plain Done and Postpone in the meantime.
- **A reading is dated by the plant's calendar, not your device's.** Around midnight, your phone and the city your plant lives in can disagree about what day it is. The app now stamps a survey's reading with the day the plant is actually having — so a reading can't be filed under yesterday (which made the task ask "do you need to water?" all over again) or under tomorrow (which the server refused outright, leaving the survey stuck on "couldn't save").
- **The wooden stick and the finger were showing a line of raw code instead of a sentence.** Picking either one printed `reading.honesty.wooden-stick` where the explanatory note should be. Nothing was broken underneath — the note simply had never been written for the two newest instruments — but it is the second time this exact thing has reached a screen, so the app now refuses to build at all if any instrument is missing its wording in either language.
- **"Toca regar" now lets you actually do something about it.** The verdict that is the whole point of measuring showed a heading and a Close button. Water it now — and then what? You had to close the dialog and hunt for the Done button behind it. Done and Postpone are now right there, and they are deliberately two different answers: "this plant needs water" is not the same statement as "I have time to water it", and saying you ran out of day should not record a watering that never happened.
- **Measuring a plant you already watered this morning no longer dead-ends.** The app assumed a measurement always comes before that day's watering — true when you measure and then water, false the moment you water early and check in the evening. Saving failed with "please try again", and trying again could never work. It now asks the one question it needs (did you measure before or after you watered?) and saves.
- **A reading your instrument cannot actually give is refused.** A 1–10 probe accepted 5.5 — a level of precision the device does not have — and stored it as though it had been measured. Fractional weights on a kitchen scale are of course still fine: grams really are continuous.
- **Your finger was being given the wooden stick's instructions.** It said to insert about 6 cm — which no finger does, which contradicts what Settings says about the finger, and which describes a completely different part of the pot from the one the app assumes you are feeling. The finger now states its own protocol: the top few centimetres, the same spot each time.
- **A greyed-out button now says what it is waiting for.** Calculate and Save went dead with no explanation, leaving you to guess whether it was the reading, the scale's two reference weights, or an unanswered question further up.
- **You can postpone a watering again without being asked to measure first.** Once you told the app which instrument you own, the watering row offered *"¿Necesitas regar?"* and nothing else — no way to say *not today*. But "I don't have time right now" is about your afternoon, not about your soil, and no measurement can answer it; the only workaround was to switch your instrument off in Settings. **Postpone** is back beside the measure button. **Done** stays away while the question is open, on both screens — recording a watering while the app is still offering to tell you whether to water is the one thing measuring exists to replace.
- **The plant page and the Today list now agree about that row.** The plant page had been offering a **Done** the Today list never did. Both now read the same: measure, or postpone.
- **A "water now" card on a plant you already watered today no longer appears.** Its **Done** button did nothing at all — one watering a day is one watering, so the tap was silently discarded every time. The measuring dialog always got this right and said so; the card and the plant page now agree with it.
- **The measurement date can't be set before you owned the plant.** Dates in the future were already refused with a plain sentence; this end of the window now gets the same treatment, including the little arrows on the date picker.
- **An impossible pot weight is refused with an explanation.** A weight nowhere near your pot's two reference weights used to save, record the pot as 100 % wet and move the watering date. It now says so, and names both reference weights so you can tell a slipped digit from a pot that has genuinely changed and needs re-measuring.
- **The instrument comparison table now shows that it scrolls.** On a phone, two of its columns — including the one telling you a kitchen scale needs setting up per pot — were simply cut off with no shadow or fade, so they read as missing rather than as off-screen.
- **The measurement date is no longer ambiguous.** The date box follows your browser's language, not the app's, so with the app in Spanish it could read `08/10/2026` — which is 10 August to one reader and 8 October to another. The chosen day is now spelled out beside it.
- **The watering row on a plant you already watered today no longer offers a Done that goes nowhere.** Water the plant, and its Regar row falls back to the ordinary date box and **Hecho**. Pressing Hecho with the box empty asked *why are you watering early?* — and then threw your answer away: nothing was recorded, the next watering date didn't move, the history didn't change, and there was no message of any kind. The app had asked you a question and dropped the reply. That row now says plainly that the plant is already watered today, and offers no Hecho to press. **Back-dating still works exactly as before, and this is the point of the change rather than a leftover:** type an earlier day into that same box — the day you actually watered it — and Hecho comes straight back and records it. Watering today doesn't make a past watering unrecordable; it only makes a *second* watering today meaningless.
- **The impossible-weight message now tells you which weights it would accept.** It named your pot's two reference weights — *"it's calibrated 1500 (dry) to 2000 (watered)"* — and stopped there, so a weight of 2900 (perfectly acceptable, and accepted) and one of 3500 (refused) read the same sentence. Both looked like "only 1500–2000 allowed", which is not the rule: a pot really is heavier than its watered weight just after a deep soak, and lighter than its dry weight in a heatwave, and the app allows for that. The message now states the band it will actually take, the way the server already did.
- **The "you got this plant on…" refusal now writes the date like every other date in that dialog.** It printed the raw stored form — `2026-05-13` — three lines under a hint reading `1 jun 2026` and beside a picker showing `Aug 11, 2026`. Same dialog, three date formats, and the raw one was the only date in it you hadn't typed.
- **The instrument comparison table stops claiming there's more to see once you've reached the end.** Its right-edge shading is the hint that the table scrolls; scroll all the way across and it kept drawing, still promising columns that were already on screen. It now goes quiet at the end of the scroll, which is the only thing that makes it worth trusting at the start.
- **…and that table now keeps the instrument names in view while you scroll it.** Scrolled across to the answers you saw `No / Sí / No / No` with nothing saying which instrument each row was — and in Spanish the table's resting position cut exactly on a column edge, so it looked like it genuinely had two columns rather than four. The instrument column now stays pinned while the rest slides under it, the headings wrap instead of forcing the table twice as wide as your screen, and the sentence explaining why a cheap probe is still useful no longer slides off sideways with the table it's explaining — it's a caption, so it stays put.


## Unreleased — Repotting now asks what you can see

**The repot reminder used to give you two buttons — *Done* or *Postpone* — which both asked you to decide
something you could not see.** It now opens a short checklist of things you can actually look for, tells you
whether it is time, and asks again later if it is not. When it *is* time, marking it done asks three quick
questions about the new pot so the schedule keeps up.

### Added

- **The plant's own page keeps a "Done" button beside "Time to evaluate".** If you already repotted a plant
  — because you were repotting anyway, or because you looked and decided for yourself — you can now say so
  straight from that plant's page without first answering a checklist about a pot the plant is no longer in.
  The date box beside it lets you record it on the day it actually happened, and the substrate clock starts
  from that day too. It works even when the app had just told you "not yet, we'll ask again on…": your
  answer wins, and the pending question is closed out with it. The Today page is unchanged — there a repot
  still asks you to look first, and Done only appears once the checklist has decided it is time.
- **When the checklist says "not yet", it now tells you what would settle it.** Ticking a sign that counts
  but isn't conclusive on its own used to end there. The app now names one more specific thing worth going
  to look for on that plant — the most telling sign it knows about that you haven't already reported. It is
  a suggestion of what to check, not a prediction of what you'll find, and it changes nothing about how the
  app decides.
- **The approval card now names a postponement.** The Plant Doctor and the Gardener can now propose putting
  a care task off, so the banner that asks for your approval has wording for it in both English and Spanish,
  and shows both the day the task moves to and — for a repot, which is postponed by reason rather than by
  date — the reason in the same words the app's own Postpone form offers you.

### Fixed

- **A rejected "Done" no longer keeps resending the date you already corrected.** If the app refused a
  repot you were recording — say the date came out wrong — it told you to fix it, let you fix it, and then
  sent the *original* date anyway. Correcting the day on the card and pressing Done again changed nothing:
  the same refusal came back every time, and short of reloading the page there was no way to record the
  repot at all. Now a refused attempt is genuinely started over: whatever you type after it is what gets
  sent, and the repot lands on the day you actually did it — which is also the day the substrate clock
  starts from.
- **When the checklist says "not yet", it no longer denies what you told it.** Checking off signs and still
  getting "wait and check again later" answered you with *"Nothing you saw says it needs repotting yet"* —
  said to someone who had just told the app exactly what they saw. It now has its own wording for that
  case: what you noticed was recorded and counts towards the next call, it just isn't conclusive on its
  own. The verdict itself was always right, and nothing about how the app decides has changed — only what
  it says back to you.
- **The repot form now lets you say you don't know the new pot's size.** "Mark as repotted" stayed greyed
  out until you typed a diameter, with no way out — and on a plant you had never filled in details for,
  "same as before" was greyed out too, so a repot you had just finished could not be recorded without
  inventing a measurement. There is now an "I don't know" beside it, exactly like the soil and substrate
  questions already have.
- **Checkboxes that can't be ticked now look like it.** Choosing "no signs yet" or "I couldn't check it"
  switches the list of signs off, but the rows still looked and felt tappable and simply did nothing when
  you tapped them. They now dim and show a blocked cursor, so it's clear the two answers are alternatives
  and that you need to clear one before ticking the other.
- **The "Was it fresh substrate?" question is a labelled field again.** When that question moved from a
  dropdown to a row of buttons, its heading quietly stopped being attached to anything: tapping the words
  did nothing, and a screen reader read out three unexplained buttons with no idea what they were answering.
  Tapping the heading now moves to the answer you already have selected — it never changes your answer — and
  the group is announced with the question it belongs to. The same repair applies to the identical question
  in the "mark as repotted" form.
- **The "mark as repotted" form now tells you which day it will record.** While a submission was still
  outstanding the form froze — correctly — but it never showed the date it was going to send, while the
  date box on the card behind it stayed editable. The two could disagree without either one saying so, on
  the one field that decides what day the repot is recorded on. The frozen form now states it outright.
- **The date box beside "Done" no longer keeps yesterday's answer.** Once you back-dated a task, that date
  stayed in the box and quietly rode along on the next thing you marked done from that plant's page. It now
  clears itself as soon as the task has been recorded and the schedule has moved on.
- **The close buttons in every dialog now have distinct names for screen readers.** The "×" in the corner
  and a "Close" button at the bottom both announced as just "Close"; the "×" now says what it closes. The
  same fix was applied to the repot checklist's per-sign "What am I looking for?" links, which all announced
  identically, and each now names its own sign. Nothing visible changed.
- **The repot checklist now tells you how often this species is usually repotted**, right above the
  questions, so you have a reference point while deciding what you can see. It is context only — it does
  not change the verdict — and it simply does not appear for a species we have no figure for.
- **"Was it fresh substrate?" is now asked the same way everywhere.** Registering a plant used a dropdown
  while marking a repot done used a row of buttons, for the identical question with the identical answers.
  Both are now the row of buttons.

### Added

- **The Repot card now opens a checklist instead of asking you to decide blind.** Tap it and you get a short
  list of things to look for on the plant — roots at the drainage holes, roots circling the surface, water
  running straight through, a cracked or deformed pot, that kind of thing — instead of two buttons asking you
  to already know whether it's time.
- **The checklist tells you the verdict, not just a form to fill in.** Check off what you actually see and
  the app tells you plainly whether it's time to repot or whether it's better to wait and check again later.
  Only once the verdict is "time to repot" do Done and Postpone appear.
- **Marking it done now asks three quick questions about the new pot** — its size, whether the substrate is
  fresh, and the soil mix — so the next schedule is based on what actually changed, not a guess.
- **The checklist and its questions are fully translated**, so switching to Spanish shows the same signs and
  verdict in Spanish, not just the surrounding screen.

## Unreleased — The app now treats a young plant differently from a mature one

**A young plant needs different care than an adult of the same species, and the app now shows you that.**
The growth-habit field explains where its value came from, and the Fertilize task now warns you when a
plant is too young for a full-strength dose.

### Added

- **The growth-habit field now shows the value inherited from the species, and what "trailing" means.**
  When you haven't set a growth habit for a plant yourself, the Add Missing Info form now shows the habit
  the app inherited from the species instead of leaving the field looking unanswered, with a note under it
  explaining where that value came from. Picking "trailing" now explains up front that it turns off the
  height-based crowding signal for that plant, instead of you discovering it later by its absence.
- **The Fertilize task now warns about diluted dose for a young plant.** When a plant is juvenile, its task
  info modal shows a dedicated warning that label doses are formulated for mature plants and can burn a
  young plant's delicate roots — the feeding schedule itself doesn't change, only the warning. The plant's
  juvenile state is also shown as its own chip on the plant detail page, next to Age.

## Unreleased — Your plant's soil now has a story, and the app tells it

**The app now keeps track of your plant's substrate over time, not just its watering.** Repotting a
plant, registering a new one, and the care cards themselves all know when the soil itself — not just
crowding or the calendar — is the reason for a date.

### Added

- **Marking "Repot" as done now asks about the new pot** — its size, the soil mix, and whether the substrate
  is fresh — using the three-question Done form described in the "Repotting now asks what you can see"
  section above.
- **Registering a new plant lets you say when its substrate was last renewed, and whether it was fresh —
  both optional.** Leave them blank and the app assumes the soil still holds some charge and holds off on
  the first feeding, which is the safe assumption.
- **A new soil mix option in the plant profile form: "All-purpose with perlite."**
- **The care cards now explain themselves.** When a plant's next feeding is scheduled further out than
  usual, the Fertilize card says why — the substrate is still feeding it, with the date that estimate runs
  out. And the Repot card now tells you which of two reasons put it on your list: the plant outgrowing its
  pot, or the soil itself wearing out.

## Unreleased — Your chat photos come back for 48 hours; the cover photo opens full screen

**When you send a photo to the Plant Doctor or Gardener, you can see it again in that conversation — and now the plant cover photo opens full screen too.** A photo stays visible for 48 hours after you upload it; after that the conversation shows a note where the image was, which is expected, not a fault.

### Added

- **Photos you attach in a chat are now visible again while the conversation is fresh.** When you send a photo to the Plant Doctor or Gardener and scroll up to see what you sent, the photo loads in the conversation just as it does in the message composer. Tap it to open it full screen in the same lightbox your plant photo gallery uses. After 48 hours the engine's disk space reclaims the file; the conversation shows an honest "no longer available" note in its place.
- **The cover photo on any plant now opens full screen.** Whether you are viewing an active plant, a memorialized one, or a plant you gifted away, the cover photo taps open in the same photo viewer the gallery below uses.

### Changed

- **The "Check the roots" task is now called "Repot"**, matching the label on the card and in garden-wide search. The info modal still explains when and why to repot, so the shorter label stays clear and actionable.

### Fixed

- **A message typed the instant a reply starts is now queued, not lost.** If you send a message at exactly the moment the agent begins its response, it no longer races with the incoming turn — it queues with a "pending" indicator and sends automatically the instant the agent finishes.
- **A message typed while the agent is thinking is now sent exactly as you typed it.** Leading spaces that used to disappear in the send path now survive, so a space-padded emphasis or carefully-indented note keeps its spacing. Only trailing empty content is trimmed; spaces within the message are always preserved.

## Unreleased — Two new sections for your garden: the pantheon and gifted plants

**Two new sections in your account menu — "Pantheon" and "Gifted" — hold the plants that have moved on from
your active garden**, each with its own quiet, distinct look, so they read as a place apart rather than just
another list.

### Added

- **Adding a plant no longer risks creating a duplicate on a bad connection.** If you tap "add plant" and the
  connection drops before it confirms, retrying the same submit now returns the plant that was already
  created instead of adding a second one. Every save the app sends also carries a safety token so the server
  can spot and ignore an accidental repeat.
- **"Move to pantheon" and "Mark as gifted" on any active plant's page**, each behind a confirmation that
  explains exactly what's about to happen — the pantheon move is spelled out as permanent, since there's no
  undo for it; marking a plant as gifted is not, because you can bring it back later.
- **A "Revive" button on a gifted plant**, which asks you to pick a place for it and returns it to your
  active garden, watering schedule and all.
- **A read-only view for a plant in either section.** Its page still shows its whole history, its photos,
  and lets you consult the Plant Doctor about it, but every editing action is hidden — there's nothing left
  to change on a plant that's moved on.
- **A dedicated look for each section.** The pantheon uses a muted, serif, sage-stone palette; gifted uses a
  warmer honeyed-amber one — both quiet and restrained, distinct from the everyday care-status colors used
  everywhere else in the app.
- **Register a plant you've already lost or given away**, with a size that lets it start directly in the
  pantheon or as gifted, without needing a place, and optionally upload up to 50 photos afterward in one
  guided flow — retried uploads never create duplicates.
- **Your history timeline now shows when a plant was memorialized, gifted, or revived**, alongside its
  progress entries, moves, and notes.
- **When the Plant Doctor or the Gardener asks to memorialize or gift a plant**, the approval banner labels
  the request clearly, in both English and Spanish, exactly like every other kind of change they can propose.

### Changed

- **The plant card used across the active, pantheon, and gifted lists is now one shared component**, so a
  future visual change to how a plant is shown in a list applies everywhere at once instead of needing to be
  repeated per section.

### Fixed

- **The pantheon and gifted section headers no longer show a stray colored band behind their titles.** The
  green/honey wash that used to sit behind "Pantheon" and "Gifted" is gone; each title now sits on the clean
  page background, while the section's distinct color still lives in its cards and header.
- **The button that brings a gifted plant back reads correctly now.** A gifted plant was never dead, so it no
  longer says "Revive" — it now says "Return to my garden," with matching wording throughout the flow.
- **Uploading an image in the admin media library now compresses it on your device first**, like every other
  upload in the app, so it sends faster on a slow connection (and tells you how much it saved).
- **The photo previews when logging progress no longer overlap.** The HD badge, the "saved X MB" note, and
  the helper text under the picker now lay out cleanly instead of colliding on top of each other.

## Unreleased — See when a plant moved, and leave it a note

**A plant's history timeline now shows when it moved and any note you've left on it.** A new "Agregar
nota" button on the plant detail page lets you jot down a free-text note at any time — right alongside its
progress entries, care actions, and clinical records.

### Added

- **Move entries in the history timeline.** When you relocate a plant — or a scheduled city-wide move
  relocates it for you — the timeline now shows where it moved from and to, including whether it moved to
  a different city.
- **A note modal, reachable from "Agregar nota" on the plant detail page.** Write a free-text note, and
  edit or delete any note you wrote later, all from the same timeline.
- **A label for agent-proposed notes.** When the Plant Doctor or the Gardener proposes leaving a note on a
  plant, the approval banner now shows what that operation is, in both English and Spanish, exactly like
  every other kind of proposed change.

**Uploading a photo now uses much less data and finishes faster, especially on a mobile connection.**
Every photo you send — a progress-entry photo or a plant's cover photo — is compressed right on your
phone before it leaves, instead of uploading the full file straight from your camera.

### Added

- **A per-photo HD toggle.** When a photo needs to stay at its original size and detail — a plant label
  you'll want to zoom into later, or a symptom you want examined at full resolution — a switch on that
  photo sends it exactly as your camera captured it, uncompressed.
- **A savings indicator.** Once you pick a photo, you see how much smaller the version about to be
  uploaded is compared to the original, before you confirm the upload.

### Changed

- **This applies everywhere you upload a photo:** adding or editing a progress entry and setting a
  plant's cover photo all go through the same compression, not just one screen.

## Unreleased — Fixed an intermittent empty "Hoy" and a forced logout; heavy pages load faster

**Two related, intermittent problems tied to the session quietly refreshing in the background are
fixed** — an occasional empty "Hoy" list when tasks were actually due, and getting logged out just
from navigating to another page. Both used to resurface roughly every two weeks per session. Your
plants and their details also show up sooner now, especially on mobile data.

### Fixed

- **"Hoy" could show nothing pending even when a task was actually due.** Right around the moment
  your session's token silently refreshed in the background, the page's other data requests — which
  were still using the same, now-outdated token — could be rejected immediately afterward, and that
  rejection was silently swallowed instead of shown, so the page looked emptier than it really was.
  This is fixed: the app now refreshes the token once per page load and reuses the result for every
  request on that page, instead of letting each one refresh independently and race the others.
- **Navigating to another page could unexpectedly sign you out.** The same race was the cause: a
  request retried with a token that had just been superseded looked like an invalid session and
  triggered a logout, even though nothing you did had actually ended it. The app now only signs you
  out when your session has genuinely expired — never on a passing hiccup right after a background
  refresh.

### Changed

- **"Hoy", your plant list, and a plant's own page now show their main content sooner.** Each of
  these pages used to wait on several data requests firing at once before showing anything at all.
  Now each shows its essential content first — today's tasks, your plant list, or a plant's identity
  and care status — while secondary details, like a plant's care history and photo gallery, load in
  just behind it. The difference is most noticeable on a slower mobile connection.

## Unreleased — Approving what your agents want to change, and meeting your gardener

**The doctor now asks before it changes anything.** Its diagnosis is unchanged; what changed is that
every edit it wants to make to a plant arrives as a request you approve, and this release is the screen
where you do that. **This release also introduces the gardener** — a second advisor that looks at your
whole garden rather than one plant, reached from a single action in your plants header.

### Fixed

- **A conversation's narration used to arrive broken into pieces, with a helper's work dropped into the
  middle of an unfinished sentence and shown as if it were a separate step of its own.** Reading what the
  Plant Doctor was doing meant watching its explanation get interrupted mid-word by a helper's card, then
  resume in another bubble as if it were a new thought — and that helper's work sat at the top level of
  the transcript instead of tucked under the step that actually asked for it. Both are fixed: an
  explanation now reads as one continuous piece, and every helper's work is nested under the step that
  started it — confirmed live on a fresh conversation, including after reloading the page.
  **Conversations recorded before this release keep their old, fragmented look forever.** Each turn was
  written down as it happened and that record is never rewritten, so reopening an older conversation will
  still show the old splitting. That is expected, not a bug worth reporting.

### Changed

- **The "Talk to your gardener" action moved below your plants.** It used to sit in the plants-page
  header; it now lives as a single action beneath the garden, on the trailing edge. It is still one
  garden-wide entry point, never one per plant card.
- **The clinical-record window is wider and roomier.** A plant's clinical record — long-form Markdown the
  Plant Doctor writes — opens in a noticeably wider panel with more interior padding, so headings stop
  wrapping and the text reads comfortably instead of cramped in a narrow column.
- **Photos you attach in a chat now shrink before they leave your device.** A JPEG or WebP photo whose
  long edge is over 2576 px is resized to that ceiling and re-encoded at high quality before it is
  uploaded, so a full-resolution phone photo reaches the agent far smaller and faster. A per-photo switch
  lets you send the file exactly as picked when you need the original — which is also the only path that
  keeps a photo's embedded metadata such as GPS location; the shrunk default drops it, a privacy gain. PNG
  and GIF attachments are untouched. Delivered by upgrading the chat client to `3.2.0`.
- **The raw token/tool counts under a helper's result in a conversation are gone.** They were technical
  plumbing shown for want of a better home; the card now ends with the helper's answer and nothing else.

### Added

- **Meet your gardener.** A new "Talk to your gardener" action in the header of your plants list opens a
  chat with an advisor scoped to your whole garden — placement, the spaces your plants live in, and the
  cities that give them their weather — rather than to a single plant. It is deliberately one action in
  the header and never a button on each plant card: a per-plant button would read as "the gardener *of
  this plant*", which is the Plant Doctor's job, and the two roles are kept apart on purpose. The doctor
  diagnoses one plant; the gardener places, groups and equips the whole garden.
- **The gardener asks before it changes anything, exactly like the doctor.** It never edits your garden
  itself: everything it wants to do — add or update a place or a city, add a plant, set or clear a care
  interval, mark a task done, or adjust a plant's profile — arrives as a request you approve in the same
  banner, with the same field-by-field before-and-after list built and labelled by the server. Approve,
  Decline and "Not now" all work just as they do for the doctor, and the per-conversation "dangerously
  skip permissions" switch is available here too.
- **A place edit tells you how far it reaches before you approve it.** Because every plant standing in a
  place draws its light, humidity and airflow from that place, changing the place recomputes the care of
  *all* of them. When the gardener proposes a place edit, the banner now states how many plants that one
  change would affect — a count computed by the server from the edit itself, never taken from the
  gardener's own description of what it is doing. A change with no place edit says nothing extra.
- **Approve what the Plant Doctor wants to change.** When the doctor wants to update the care profile,
  add or edit a progress entry, change a task's frequency or mark a task done, a banner
  appears under the conversation listing every change it proposes — the exact field, its current value
  and the value it wants to set. You approve the change itself, not the doctor's description of it: the
  list is built and labelled by the server, and the doctor's own note is shown separately as a caption.
  Approve applies everything at once, Decline tells the doctor no, and **"Not now"** simply closes the
  banner so you can ask a question first — it is not a refusal, and the doctor is not told anything.
- **Deletions are called out where they happen.** Removing a progress entry also removes its photos and
  cannot be undone. The warning sits on that specific change rather than on the whole request, so it
  still means something when a proposal only edits a field or two.
- **Changes made since the doctor looked are disclosed.** If you edited a field yourself after the doctor
  proposed a change to it, the banner shows your current value and, separately, what the doctor
  originally saw — instead of quietly presenting stale information as current.
- **Dangerously skip permissions.** A per-conversation switch above the chat that lets the doctor apply
  its changes immediately without asking. It is off by default, only you can turn it on, and while it is
  on a warning stays on screen for the whole conversation with no way to dismiss it.
- **The chat is never blocked.** You can keep typing and send messages with a banner open.
- **Attach photos to a message.** Both the admin knowledge-engine chat and the per-plant diagnosis chat can
  now attach images to what you send — up to 6 photos per message, 10 MiB each and 20 MiB total, in PNG,
  JPEG, GIF or WebP.
- **Keep typing while the agent is busy.** Sending a message mid-turn no longer refuses it: it queues, with
  its own indicator in the composer, and is sent automatically the instant the current turn ends. You can
  cancel it or pull it back into the composer to edit it, any time before that happens.
- **System notices get their own bubble.** A platform notice to the agent — such as telling it you declined
  a proposal — now shows in its own labelled bubble instead of arriving glued to the front of whatever you
  typed next.

### Changed

- The approval banner appears when you open the page and when a diagnosis finishes — the page never
  polls, so it does not sit there re-asking the server for something that has not happened. Because the
  request lives on the server, it survives a reload, a closed laptop or a switch to another device.
- Approving a request that is no longer live now tells you *which* thing happened, instead of appearing
  to do nothing: either it expired because you sent another message — in which case you are invited to
  ask the doctor to propose it again — or it had already been answered somewhere else, in which case
  nothing was applied now.
- If a request cannot be sent at all, the failure is shown on screen rather than silently dropped.
- **A queued message returns to you if its turn doesn't end cleanly.** If the run it was waiting on fails
  or is cancelled, the message is not lost — it reappears in the composer so you can send it again.
- **Leaving a conversation discards its queued message, silently.** Opening a different conversation,
  starting a new chat, or deleting the one you currently have open all drop whatever was still queued —
  with no confirmation and no way to get it back. This is deliberate: without it, a message queued in one
  conversation could resurface and be sent into a *different* one you open within the queue's one-hour
  window — on the doctor surface, that would mean one plant's draft leaking into another plant's chat.
  Two things do **not** count as leaving and never touch your queued message: deleting a *different*
  conversation from the list while yours stays open, and simply re-clicking the conversation you already
  have open.
- **Sending a queued message starts a fresh turn, and a fresh turn always clears whatever proposal was
  still waiting on you.** If an approval banner is on screen when your queued message goes out, it will
  disappear — not because anyone approved or declined it behind your back (nothing is ever applied
  automatically), but because your own message started a new turn, and the doctor can only have one
  proposal pending at a time. Ask it again if you still want that change.
- **After a reload, or when you reopen an older conversation, an attached image shows as a filename with a
  document icon instead of the picture itself.** This is expected, not a bug: your browser has the
  message's text but never kept the image bytes or a link to them (attachments live for 24 hours on the
  engine and are never part of the conversation's permanent record), so showing a broken image in their
  place would be worse. There is no setting to change this.
- **Internal only — no user-visible change.** The proposal type family (`DoctorProposal`,
  `DoctorProposalOperationType`) is renamed to `AgentProposal` / `AgentProposalOperationType` in
  `types/api.ts`, matching the API's own rename of its underlying tables to a per-agent-role shape. The
  approval banner and everything else on this page behave exactly as before.
- **Clinical records show up in your plant's history.** When the doctor leaves a case note after a
  consultation, it appears as its own row in the history timeline — tap it to read the full note in a
  dialog, rendered the same safely-sanitized way as everything else you read in the app.
- **Removed the temporary care-basis reference dots.** The small dev-only dots that used to mark whether a
  measurement was actually feeding the watering calculation are gone from every screen that showed them —
  a leftover debugging aid with no place in the shipped app.
