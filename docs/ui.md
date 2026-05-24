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
- Center workspace: topic hero, tabs, summaries, learn-next paths, concept map, flashcards, and quiz.
- Right rail: generation progress, queue capacity, citation stream, cache provenance, and AI ops metadata.

On narrow screens the columns collapse into a single stacked layout.

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

Resume jobs preserve completed artifacts and fill only missing groups. For example, if summaries already exist, the resume job keeps those summaries and continues with graph, flashcards, and quiz.

## Navigation Tabs
Tabs are disabled until a study pack is loaded.

Current tabs:

- `Overview`
- `Concepts`
- `Flashcards`
- `Quiz`

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
- Counts for summaries, concept nodes, relationships, flashcards, and quiz items.

Use `Exact revision` when you need to verify the precise source version used to generate the pack.

## Right Rail
The right rail is operational context for the generated pack.

### Generation
Shows the progress bar and stage states.

### Capacity
Shows current queue and concurrency state from `/api/queue/status`.

Rows include:

- State: `Open`, `Queue full`, `Workers full`, or `Session full`.
- Queue count versus `MAX_QUEUE_DEPTH`.
- Running worker count versus `JOB_CONCURRENCY_LIMIT`.
- This browser session's in-flight count versus `SESSION_CONCURRENCY_LIMIT`.

### Citation Stream
Shows deduplicated citations pulled from summaries, flashcards, quiz items, timeline events, and graph nodes. This is intended as a quick source-audit surface.

### AI Ops
Shows prompt version and model metadata retained per generated artifact. This supports prompt versioning, traceability, and future cost/model debugging.

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

### Concept Graph Filter
Use the filter buttons to change visible node types:

- `all`
- `person`
- `organization`
- `event`
- `concept`
- `place`
- `work`

The visible node count updates based on the selected filter. Relationship count remains the full edge count.

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
The timeline panel shows up to the first `14` events.

Each event includes:

- Date label.
- Event description.
- Source citation snippet.

Select a timeline event to load its event evidence into the `Evidence` panel.

## Flashcards Tab
The Flashcards tab shows generated question/answer cards.

The first card is displayed as a large featured recall card. Remaining cards appear in a scrollable stack.

Each card includes:

- Question.
- Answer.
- Citation snippet.
- Prompt version and model metadata where available.

The current generator produces `15` flashcards in normal successful runs.

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

Quiz grading is persisted through `/api/quiz-attempts`. The UI submits selected answer indices to the API, displays the saved attempt ID, then shows the score and per-question explanations. If the server rejects the submission, the quiz panel shows the error and does not reveal local feedback.

If a partial pack does not have quiz questions yet, the Quiz tab shows a not-ready message instead of a grade bar.

## Session Behavior
The UI stores a generated session ID in browser `localStorage` under:

```text
ultrawiki_session_id
```

That session ID is sent as `x-session-id` when creating a study pack. The API uses it for session-level admission and concurrency checks.

Each Generate action uses a new idempotency key generated in the browser. Re-clicking Generate creates a fresh request rather than intentionally reusing a prior idempotency key.

The same session ID is also sent when checking queue capacity and when resuming missing artifacts.

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
The current UI does not yet include:

- Timeline navigation controls beyond the current event list.
- User accounts or saved history views.

These are tracked in the product tickets and planned follow-on work.
