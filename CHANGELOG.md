# Changelog — `my-plants-web`

All notable, user-facing changes to the MyPlants web app. Newest first.

## Unreleased — Your plant's soil now has a story, and the app tells it

**The app now keeps track of your plant's substrate over time, not just its watering.** Repotting a
plant, registering a new one, and the care cards themselves all know when the soil itself — not just
crowding or the calendar — is the reason for a date.

### Added

- **Marking "Repot" as done now asks one quick question: was it fresh substrate?** Answer yes, no, or "I
  don't know" — and "I don't know" is a perfectly fine answer, since the app can work it out from the soil
  mix you've already recorded instead of guessing.
- **Registering a new plant lets you say when its substrate was last renewed, and whether it was fresh —
  both optional.** Leave them blank and nothing changes: the app assumes the soil is already spent, which
  is the safe assumption.
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
