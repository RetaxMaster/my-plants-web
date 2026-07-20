# Changelog — `my-plants-web`

All notable, user-facing changes to the MyPlants web app. Newest first.

## Unreleased — Approving what the Plant Doctor wants to change

**The doctor now asks before it changes anything.** Its diagnosis is unchanged; what changed is that
every edit it wants to make to a plant arrives as a request you approve, and this release is the screen
where you do that.

### Added

- **Approve what the Plant Doctor wants to change.** When the doctor wants to update the care profile,
  move the plant, add or edit a progress entry, change a task's frequency or mark a task done, a banner
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
