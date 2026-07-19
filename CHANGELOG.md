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

### Changed

- The approval banner appears when you open the page and when a diagnosis finishes — the page never
  polls, so it does not sit there re-asking the server for something that has not happened. Because the
  request lives on the server, it survives a reload, a closed laptop or a switch to another device.
- Approving a request that is no longer live now tells you *which* thing happened, instead of appearing
  to do nothing: either it expired because you sent another message — in which case you are invited to
  ask the doctor to propose it again — or it had already been answered somewhere else, in which case
  nothing was applied now.
- If a request cannot be sent at all, the failure is shown on screen rather than silently dropped.
