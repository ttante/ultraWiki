# UltraWiki UI Guide

This guide explains how to use the current UltraWiki web interface.

## Open the App
Start the local stack, then open:

```text
http://localhost:3000
```

The UI talks to the API through Next.js proxy routes under `/api/*`.

## App Layout
The app uses a three-column study workspace:

- Left rail: source, grounding, and artifact counts after generation.
- Center workspace: topic hero, tabs, summaries, glossary, learn-next paths, concept map, flashcards, quiz, and the Ops dashboard.
- Right rail: generation progress, export/share actions, queue capacity, citation stream, cache provenance, and AI ops metadata.

On narrow screens the columns collapse into a single stacked layout.

## Responsive Layout Checklist
Current mobile layout guardrails:

- The top bar becomes a single-column command surface, and the left rail, workspace, and right rail stack with tighter page padding.
- Study tabs remain horizontally scrollable with stable tab sizing.
- Concept graph controls wrap, graph labels can break onto multiple lines, and the graph canvas uses a shorter viewport-bounded height.
- Flashcard side stacks become normal document flow instead of nested scroll regions.
- Quiz grading controls stop sticking to the viewport and stack above the result copy.
- Saved-library rows can wrap long titles/revision IDs, and Ops dashboard rows/drilldown tables collapse to one-column scan rows.

## Visual Smoke Coverage
Run `npm run gate:visual-smoke` after UI layout changes. The gate renders the empty workspace and generated workspace, then checks visual landmarks for overview, graph empty state, flashcards, quiz, learning dashboard, Ops dashboard, and the right-rail panels.

Run `npm run gate:critical-flow-smoke` after workflow changes that touch generation, saved library, sharing, flashcard review, quiz attempts, or Ops loading. The gate exercises the API route flow and the web app shell flow for those product-critical actions.

## Empty, Loading, Error, And Offline States
The workspace keeps each rail explicit about data availability:

- Empty states explain what will appear before a pack, session history, saved library, capacity snapshot, citations, cache, learning analytics, or ops metrics exists.
- Loading states appear for recent packs, saved library, capacity, learning dashboard, ops dashboard, learning sessions, and generation jobs.
- Retryable fetch failures in the recent-pack rail, saved-library rail, capacity panel, learning dashboard, ops dashboard, share management, quiz submission, and generation flow show an inline error plus a retry or repeated action where applicable.
- Browser offline detection shows an `Offline mode` status banner. Already loaded pack data stays visible, while network-backed actions continue to use their normal error or retry states.

## Accessibility Checklist
Current accessibility guardrails:

- Keyboard users can skip directly to the study workspace with `Skip to study workspace`.
- The study tabs expose `tablist`, `tab`, and `tabpanel` semantics with selected-state and panel relationships.
- Interactive controls use visible focus indicators, and focused panels are outlined when reached from skip navigation or tab navigation.
- Status changes such as generation readiness use polite live regions.
- Reduced-motion preferences disable UI transitions and animation timing.
- Small metadata text uses the higher-contrast `--faint` token and should remain readable against dark panels.

Manual checks before release:

1. Tab from the top of the page through the skip link, command input, rails, tabs, tab panels, and primary actions without losing visible focus.
2. Switch browser or OS reduced-motion mode on and confirm progress, graph, and skip-link transitions no longer animate.
3. Check the empty workspace, generated pack, partial pack, offline banner, learning dashboard, and Ops dashboard at mobile and desktop widths for readable labels and non-overlapping focus outlines.

## Keyboard Shortcuts
Shortcuts are ignored while text inputs, textareas, selects, or editable regions are focused.

- `Ctrl+K` or `Cmd+K`: focus the Wikipedia topic/search input.
- `Alt+1` through `Alt+6`: switch to Overview, Concepts, Flashcards, Quiz, Learning, or Ops.
- Concepts tab: `Ctrl+Alt+F` focuses graph search; `Ctrl+Alt+=` and `Ctrl+Alt+-` zoom; `Ctrl+Alt+[` and `Ctrl+Alt+]` pan; `Ctrl+Alt+0` resets graph search, filters, zoom, and pan.
- Flashcards tab: `Ctrl+Alt+1`, `Ctrl+Alt+2`, `Ctrl+Alt+3`, and `Ctrl+Alt+4` rate the active card Again, Hard, Good, or Easy.
- Quiz tab: `Ctrl+Enter` or `Cmd+Enter` saves/grades the current quiz attempt.

## Create a Study Pack
1. Use the command input in the sticky top bar.
2. Enter either an English Wikipedia title or an English Wikipedia URL.
3. Select `Generate`, or press `Enter` while focused in the input.

Good examples:

```text
Alan Turing
https://en.wikipedia.org/wiki/Ada_Lovelace
```

The empty state also provides example topic pills. Selecting a pill fills the input; it does not start generation until you select `Generate`.

Unsupported or non-English URLs are rejected by the API. Plain titles are treated as English Wikipedia titles.

## Generation Status
After submission, the right rail shows the generation progress bar and stage list.

Possible stages:

- `Ingestion`
- `Summaries`
- `Knowledge`
- `Recall`
- `Done`

The top bar also shows a status pill, such as `Generating`, `Completed`, or an error state. The UI polls the job endpoint roughly every `800ms`. When the job completes, it automatically loads the study pack.

Queued jobs show a waiting-for-capacity message. Retrying jobs show the retry state and attempt count when the API provides it. If `degradation_state` is `partial`, the generation panel explains that completed artifacts remain usable instead of hiding partial work.

If the job fails or is quarantined, an error message appears in the generation panel.

## Partial Packs and Resume
UltraWiki can complete a job as a partial pack if generation hits the configured token or latency budget after a useful artifact boundary.

Fallback order is:

- Summaries
- Concept graph and timeline
- Flashcards
- Quiz

When a partial pack loads, the center workspace shows a `Partial pack` action banner. The banner lists missing artifacts and exposes:

- `Resume missing artifacts`: starts a resume job for the same pack.
- `View available outputs`: returns to the Overview tab so you can use the artifacts that already exist.

Resume jobs preserve completed artifacts and fill only missing groups. For example, if summaries already exist, the resume job keeps those summaries and continues with graph, glossary, flashcards, and quiz.

## Navigation Tabs
Tabs are disabled until a study pack is loaded.

Current tabs:

- `Overview`
- `Concepts`
- `Flashcards`
- `Quiz`
- `Ops`

Starting a new generation resets the active tab to `Overview`.

## Left Rail
Before generation, the left rail explains what the workspace will contain.

After generation, it shows:

- Source revision ID.
- `Canonical article` link.
- `Exact revision` link.
- License label: `CC BY-SA 4.0`.
- Citation rate.
- Unsupported claim count.
- Counts for summaries, glossary terms, concept nodes, relationships, flashcards, and quiz items.

Use `Exact revision` when you need to verify the precise source version used to generate the pack.

## Right Rail
The right rail is operational context for the generated pack.

### Generation
Shows the progress bar and stage states.

### Export and Sharing
After a pack is loaded, the right rail shows export links, the share-link action, and owner share management.

Available export formats are documented in [Exports](#exports).

`Create share link` creates a `viewer` share for the current pack. The action uses the active account as the share owner: a signed OIDC/OAuth session when present, otherwise the local library key. When creation succeeds, the UI displays a viewer URL based on:

```text
/shared/<share-id>
```

That URL opens a read-only shared pack page with missing/expired states and a save-to-library action for the viewer's active account.

The `Managed Share Links` panel lists the owner's active share links for the loaded pack. Owners can refresh the list, copy the frontend viewer URL, inspect share metadata, and revoke a share link. Revocation removes the link from the active list and the shared page returns a missing state for that share ID.

### Capacity
Shows current queue and concurrency state from `/api/queue/status`.

Rows include:

- State: `Open`, `Queue full`, `Workers full`, or `Session full`.
- Queue count versus `MAX_QUEUE_DEPTH`.
- Running worker count versus `JOB_CONCURRENCY_LIMIT`.
- This browser session's in-flight count versus `SESSION_CONCURRENCY_LIMIT`.

### Citation Stream
Shows deduplicated citations pulled from summaries, glossary terms, flashcards, quiz items, timeline events, graph nodes, and graph relationships. This is intended as a quick source-audit surface.

Use `Search citations` to filter by artifact type, source label, or citation snippet. Use the artifact filters to narrow the stream to summaries, glossary, flashcards, quiz, timeline, or concept graph evidence. Matching citations stay grouped by artifact type so source-audit context remains visible while filtering.

### AI Ops
Shows prompt version and model metadata retained per generated artifact. This supports prompt versioning, traceability, and future cost/model debugging.

When `LLM_PROVIDER=openai_compatible`, successful real-model artifacts show the configured model ID, for example `qwen2.5-14b-instruct-q4_k_m`. If the model is unavailable or returns malformed JSON, the API falls back to `local-rule-based`; that fallback model ID is visible here so support can distinguish resilient fallback from real-model output.

### Cache
Shows cache provenance for the loaded pack.

Each row includes:

- Stage name.
- `hit` or `miss`.
- Source revision ID tied to the cached content or artifacts.

Cache entries are invalidated by TTL, parser version, prompt version, taxonomy version, and source revision. This lets repeated generations reuse safe artifacts while keeping provenance visible for support/debugging.

## Overview Tab
The Overview tab renders the generated summary levels:

- `beginner`
- `intermediate`
- `advanced`

Each summary card includes:

- Level pill.
- Prompt version and model ID.
- Summary text.
- Citation chips.

Grounding and source attribution live in the left rail so they remain visible while moving through the study pack.

### Learn Next
The Overview tab also includes `Learn Next` recommendations.

Each recommendation includes:

- Adjacent topic title.
- Relevance score.
- Source heading that produced the recommendation.
- Rationale for why it is connected.
- `Open source` link to the Wikipedia page.
- `Study this next` button.

Selecting `Study this next` starts a new study-pack generation for that recommended topic and updates the top-bar input to the selected title.

## Concepts Tab
The Concepts tab shows graph, relationship, and timeline artifacts.

### Concept Graph Search and Filters
Use `Graph search` to find matching entities, relationship labels, and citation snippets. Search results keep directly connected nodes visible when a relationship matches.

Use the node-type filter buttons to change visible node types:

- `all`
- `person`
- `organization`
- `event`
- `concept`
- `place`
- `work`

Use the relationship filter buttons to narrow the graph by relation type. The visible node count and relationship count update based on the active search and filters.

### Interactive Graph
The graph canvas shows up to the first `42` matching nodes with relationship lines when both endpoints are visible.

Available controls:

- `Zoom in`
- `Zoom out`
- `Pan left`
- `Pan right`
- `Reset view`

The current zoom level is shown as a percentage.

Select any node to load its source evidence in the `Evidence` panel. The panel shows the selected item type, title, explanation, and citation snippet.

The `Path Inspector` panel shows up to `6` direct connections for the selected node. Select a connected neighbor to move through the graph and inspect the relationship evidence.

### Relationships
The relationships panel shows up to the first `16` graph edges.

Each edge is displayed as:

```text
source
Relation -> target
citation snippet
```

Select a relationship to load its relationship evidence into the `Evidence` panel.

Current relation types include:

- `influenced`
- `founded`
- `member_of`
- `occurred_in`
- `related_to`
- `precedes`

### Timeline
The timeline panel is now a navigator. It shows a scrubber, year clusters, a selected-event detail card, and up to the first `14` events.

Each event includes:

- Date label.
- Event description.
- Source citation snippet.
- Exact source revision link when provenance is available.

Use the `Timeline year scrubber` to move across years. Select a year cluster or event to update the selected detail card and load its event evidence into the `Evidence` panel.

## Flashcards Tab
The Flashcards tab shows generated question/answer cards.

The top of the tab shows per-library-key progress:

- `Reviewed`: cards that have at least one saved review.
- `Due now`: new or scheduled cards due for review.
- `Mastery`: weighted score from the latest saved rating for each card.

The `Learning Session` panel starts a persisted ordered due-card queue for the active account. Reviewed overdue cards are ordered by oldest due timestamp before new cards, then by card index for deterministic ties. During a session it shows completed and remaining due cards, the current mastery trend from the session baseline, the active card, and the remaining queue. Session records keep started/completed timestamps, reviewed counts, and the latest outcome snapshot. When all due cards in the baseline queue are reviewed, the panel switches to a complete state.

The Learning tab uses `GET /api/learning/analytics` to show per-user analytics across the active account's saved packs. It includes total due cards and due pack count, review streak, daily goal progress, reviewed-card retention, average mastery, mastery and accuracy trend charts, quiz attempt and retake counts, per-pack review history, and weak-area rows for packs with due cards or low mastery.

The `Study Goal` panel stores an optional daily review target for the active account through `PUT /api/learning/goal` with `{ "daily_target_reviews": number }`. A target of `0` disables the goal. Goal progress is intentionally non-blocking: the dashboard shows today's review count, remaining reviews, and the existing streak, but it does not prevent review or quiz workflows.

The `Due Reminder` panel uses `GET /api/learning/reminders` to show local due-card reminder status for the active account. The hook reports due cards, due packs, next due time, and a polling interval; external notifications remain off.

Review ratings use fixed scheduling transitions: `again` is due in 10 minutes, `hard` in 1 day, `good` in 3 days, and `easy` in 7 days. Mastery uses the latest rating weights `again` 0, `hard` 0.4, `good` 0.75, and `easy` 1.

The first card is displayed as a large featured recall card. Remaining cards appear in a scrollable stack.

Each card includes:

- Question.
- Answer.
- Citation snippet.
- Prompt version and model metadata where available.
- Review buttons: `Again`, `Hard`, `Good`, and `Easy`.

The current generator produces `15` flashcards in normal successful runs.

Review ratings are persisted through `/api/study-packs/:id/flashcards/:cardIndex/reviews` with the session cookie or local `x-user-id`. The current deterministic intervals are:

- `Again`: due immediately.
- `Hard`: due in `1` hour.
- `Good`: due in `1` day.
- `Easy`: due in `4` days.

If no active account is available, progress metrics show unsaved defaults and the review buttons do not persist a rating.

## Quiz Tab
The Quiz tab shows multiple-choice questions.

To use it:

1. Pick one answer for each question.
2. Select `Grade Quiz` in the sticky grade bar.
3. Review the score and per-question feedback.

After grading, each question shows:

- `Correct.` or `Incorrect.`
- Explanation text.

The score appears at the bottom as:

```text
Score: <correct>/<total>
```

Quiz grading is persisted through `/api/quiz-attempts` with the session cookie or local `x-user-id`. The UI submits selected answer indices to the API, displays the saved attempt number, then shows the score, accuracy trend, mastery trend, per-question explanations, and option-level misconception checks. Use `Retake Quiz` to clear the current answers and save another attempt for the same pack; recent attempts appear in the `Retake Trend` panel with accuracy and combined card/quiz mastery signals. If the server rejects the submission, the quiz panel shows the error and does not reveal local feedback.

If a partial pack does not have quiz questions yet, the Quiz tab shows a not-ready message instead of a grade bar.

## Session Behavior
The UI stores a generated session ID in browser `localStorage` under:

```text
ultrawiki_session_id
```

That session ID is sent as `x-session-id` when creating a study pack. The API uses it for session-level admission and concurrency checks.

Each Generate action uses a new idempotency key generated in the browser. Re-clicking Generate creates a fresh request rather than intentionally reusing a prior idempotency key.

The same session ID is also sent when checking queue capacity, importing a batch topic list, and resuming missing artifacts. The right rail `Batch Generation` panel accepts newline- or comma-separated Wikipedia topics, sends at most 12 normalized topics to `POST /api/study-packs/batch`, and shows per-topic `accepted`, `reused`, `deferred`, or `rejected` results alongside the post-request capacity state. The API admits only topics that fit current queue and session limits; overflow topics are returned as deferred with a backpressure reason such as `session_limit` or `queue_full`.

## Account, Profile, and Saved Library
The left rail includes `Account` and `Saved Library`.

The UI stores a cross-device library key in browser `localStorage` under:

```text
ultrawiki_user_id
```

Use the same key on another browser or device to retrieve saved packs and flashcard progress when not using OIDC/OAuth login. New generated packs are saved automatically when an active account is present. For loaded historical packs, select `Save current pack` to add the pack to the current library.

The saved library can be searched by pack title, pack ID, source revision, tag, or collection. Readiness, progress, tag, and collection filters narrow the list to full/partial packs, due packs, reviewed packs, packs with no review progress, or a chosen organization bucket. The sort menu supports saved date, title, due-card count, and mastery score. Facet chips summarize the current search window so users can see readiness, progress, tag, and collection distribution before opening a pack. When a saved pack is loaded, the library panel lets the active account set comma-separated tags and one collection for that pack, and shows version history for saved regenerations with the same topic input so source revision and artifact-count changes are visible before opening an older version.

The `Account` panel shows the active account source, active user ID, display name setting, login link, logout control, user-data export, and a confirmed data-delete flow. OIDC/OAuth-backed sessions use the HttpOnly `ultrawiki_auth_session` cookie and take precedence over the local library key. When no signed session is active, the UI falls back to the local library key and sends it as `x-user-id`; that header path remains a development compatibility mode controlled by `AUTH_ALLOW_HEADER_USER`. Production mode defaults legacy header auth off when that variable is unset.

The library calls:

- `GET /api/library?limit=8` with the session cookie or `x-user-id`; optional query params include `q`, `readiness=all|full|partial`, `progress=all|due|reviewed|not_started`, `tag`, `collection`, and `sort=saved_desc|saved_asc|title_asc|title_desc|due_desc|mastery_desc`.
- `POST /api/study-packs/:id/save` with the session cookie or `x-user-id`.
- `PATCH /api/library/:packId/organization` with `{ "tags": ["math"], "collection": "STEM" }` to replace a saved pack's tags and collection for the active account.
- `GET /api/library/:packId/versions?limit=8` with the session cookie or `x-user-id` returns saved versions with the same topic input, source revision change flags, artifact counts, and a current-versus-baseline comparison.

Profile calls:

- `GET /api/me` with the session cookie or `x-user-id`.
- `POST /api/me` with the session cookie or `x-user-id` and `{ "display_name": "..." }`.
- `GET /api/me/export` with the session cookie or `x-user-id` returns profile, library, share, flashcard review, learning session, quiz attempt, and study-goal data for the active account. Share URL tokens and token hashes are not included.
- `DELETE /api/me` with the session cookie or `x-user-id` removes profile, saved library membership, owned shares, flashcard reviews, learning sessions, quiz attempts, and study goals for the active account. Generated study-pack artifacts remain available for other owners and future saves.

Auth/session API calls:

- `GET /api/auth/login?redirect_path=/`: redirects to the configured OIDC/OAuth provider.
- `GET /api/auth/callback`: exchanges the provider code and sets `ultrawiki_auth_session`.
- `GET /api/auth/session`: returns the active account and auth source.
- `POST /api/auth/logout`: clears the session cookie.

## Exports
The right rail includes export links after a pack is loaded.

Available formats:

- `Markdown`: cited study-pack document for reading or sharing.
- `JSON`: full normalized study-pack payload.
- `Anki CSV`: flashcard rows for import into Anki-compatible tools.

When the export request includes an active account that has saved the pack, exports include learning progress. Markdown adds a `Learning Progress` section and per-card progress notes, JSON adds `learning_progress`, and Anki CSV adds reviewed/due/rating/date columns. Anonymous exports still contain only the study-pack content.

Export URLs use:

```text
/api/study-packs/<pack-id>/export?format=markdown
/api/study-packs/<pack-id>/export?format=json
/api/study-packs/<pack-id>/export?format=anki_csv
```

## Shared Pack API
Share links are created and managed from the right rail after a pack is loaded.

The create-share call is:

```text
POST /api/study-packs/<pack-id>/share
Header: cookie session or x-user-id: <library-key>
Body: { "role": "viewer" }
```

Share creation is owner-only. The current account must have the pack saved in its library before the API will create a link.

The response includes `share.share_id`, `share.role`, `share.owner_user_id`, `share.expires_at`, and `share_path`. `share.share_id` is the public URL token; persistence stores only the token hash. The web UI converts the API payload path into the read-only page:

```text
GET /shared/<share-id>
```

The page calls the shared API payload route:

```text
GET /api/shared/<share-id>
```

The shared response includes the share metadata and full study-pack payload. Expired, revoked, malformed, or tampered share tokens return the missing state; repeated failed shared-link probes are rate limited and audited without logging raw share tokens. Generation, auth session, share-read, and Ops analytics route limits return `429` with `Retry-After` and surface through the security/rate-limit Ops metrics.

Owners can list and revoke share links through:

```text
GET /api/study-packs/<pack-id>/shares?limit=10
DELETE /api/study-packs/<pack-id>/shares/<share-id>
Header: cookie session or x-user-id: <library-key>
```

The management response includes each active `share` and its API `share_path`; the web UI derives `/shared/<share-id>` for copy and inspection. Share revocation is durable: the persisted row receives `revoked_at`, disappears from active owner lists, and no longer resolves through the shared read route.

## Ops Tab
The `Ops` tab loads operational snapshots on first open. It calls:

- `GET /api/analytics/outcomes?window_hours=<1|24|168|720>`
- `GET /api/analytics/costs?window_hours=<1|24|168|720>`; add `format=csv` to export the Ops cost summary, model-call, fallback, and error tables.
- `GET /api/runtime/llm/health`
- `GET /api/runtime/llm/presets`
- `GET /api/evaluation/prompts`
- `GET /api/analytics/slo?window_hours=<1|24|168|720>`
- `GET /api/admin/cache`
- `POST /api/admin/cache/invalidate`
- `POST /api/study-packs/<pack-id>/feedback`

The API also exposes `GET /api/analytics/costs/drilldown?window_hours=<hours>&pack_id=<id>&prompt_version=<version>&model=<model>&stage=<stage>&limit=<n>` for dedicated cost rows grouped by pack, prompt version, model, and stage; add `format=csv` to export the active filtered drilldown rows.

Generation feedback is stored as untrusted user signal data with `trusted_artifact=false` and `eval_candidate=true`. It is summarized in `GET /api/evaluation/prompts` for review but does not mutate checked-in golden-set or prompt-regression artifacts.

The dashboard shows:

- Job success and citation coverage.
- Estimated total and average pack cost.
- Quiz-attempt count and average accuracy.
- LLM fallback count and attempted model-call count.
- Time-window controls for 1h, 24h, 7d, and 30d snapshots.
- SLO pass/fail badges, explicit target comparison, and `x` error-budget burn indicators.
- Cost drilldowns by pack and prompt/model, filtered drilldown rows for pack/prompt/model/stage/limit, and CSV export links for cost summary and active drilldown tables.
- Local LLM runtime health with configured provider, model, runtime preset, latency, fallback count, timeout status, and per-stage model-call rows.
- Read-only Qwen 2.5 14B / RTX 4080 preset visibility, including the selected preset, validated preset matrix, and fallback mode.
- User feedback eval-candidate counts by artifact and signal, kept separate from trusted prompt evaluation fixtures.
- Prompt evaluation results from the checked-in golden-set and prompt-regression harness, including baseline/candidate prompt versions, pass/fail status, failed topic counts, and topic-level regression drops.
- LLM fallback and error tables.
- Security and rate-limit event counters, category breakdowns, and rate-limit source lists.
- Cache invalidation observability for stale source/artifact entries plus an authenticated Ops repair action for expired cache records.
- Reliability inputs such as completed jobs, failed jobs, timeout rate, and successful model calls.
- Runbook deep links from Ops overview, SLO, cost, fallback/error, security/rate-limit, and reliability panels to `/runbooks/outcomes-slo-alerts`, rendered from `infra/monitoring/runbooks/outcomes-slo-alerts.md`.

Select `Refresh ops` to reload all operational snapshots. If any snapshot fails, the tab shows an error and a retry action.

## Error States
Errors appear in the right rail generation panel.

Backpressure and admission errors are translated into user-facing messages:

- `queue_full`: the generation queue is full; wait and retry.
- `session_limit`: this browser already has a running pack; wait for it to finish.
- `global_limit`: all workers are busy; wait and retry.

Other common causes:

- Unsupported URL domain.
- Non-English Wikipedia URL.
- Budget limit rejection.
- Job failure during ingestion or generation.
- Partial completion after a token or latency budget boundary. This is not treated as lost work; use the resume banner to continue.

If an error appears, try a plain English Wikipedia title first, such as:

```text
Alan Turing
```

## Current UI Limitations
The account panel exposes login/logout and display-name controls, but local browser flows still create a key-based compatibility account when no OIDC/OAuth session is active. Share management supports owner list/copy/inspect/revoke with expiring hashed share tokens and durable revocation. Treat the library key like a share token unless OIDC login is configured and used through the account panel.
