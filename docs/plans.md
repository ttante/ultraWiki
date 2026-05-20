# Wikipedia Topic to Learning Tools Website

## One-line idea
Build a web app where a user enters a Wikipedia topic and gets an interactive learning system (not just a summary): concept map, timeline, relationship graph, flashcards, quizzes, and level-based explanations.

## Problem
Wikipedia pages are valuable but often dense and hard to study from directly. Learners need structure, chunking, and active recall tools.

## Core value proposition
Convert one Wikipedia page into multiple learning modalities so users can understand faster, retain more, and know what to learn next.

## Target users
- Students preparing for classes or exams
- Self-learners exploring new topics
- Teachers/tutors building study materials quickly

## Key outputs per topic
- Structured summary (`beginner`, `intermediate`, `advanced`)
- Concept map (main ideas and dependencies)
- Relationship graph (people, events, organizations, concepts)
- Timeline (for events/history/biographies)
- Glossary (key terms + short definitions)
- Flashcards (Q/A)
- Multiple-choice quiz + misconception checks
- "What to learn next" recommendations

## MVP scope (first version)
- Input: Wikipedia URL or page title
- Parse + extract clean article sections
- Generate:
  - concise summary by level
  - 15-25 flashcards
  - 10-15 quiz questions
  - basic concept list + simple graph JSON
- UI tabs:
  - `Overview`
  - `Concepts`
  - `Flashcards`
  - `Quiz`
- Save study set locally/user account

## Differentiator
Most tools stop at summarization. This product turns a single article into a complete study workflow with active learning artifacts.

## Suggested system design
- Ingestion layer: fetch Wikipedia content and normalize text
- Extraction layer: identify entities, dates, and section hierarchy
- Generation layer: LLM prompts for summaries, cards, and quizzes
- Validation layer: detect hallucinations and unsupported claims by grounding to source text
- Delivery layer: web UI rendering graphs, timelines, and study tools

## Risks and mitigations
- Hallucinations -> require source-grounded generation + quote-backed facts
- Poor quiz quality -> add rubric checks (clarity, difficulty, single correct answer)
- Topic variance -> use topic-aware templates (history vs science vs biography)
- Wikipedia format noise -> robust parser and section filtering

## Success metrics
- Time-to-first-study-pack (target: <30 seconds)
- Flashcard completion rate
- Quiz accuracy improvement over repeated attempts
- Return rate for new topics

## Execution plan for an implementation agent
1. Build ingestion pipeline for Wikipedia URL/title input.
2. Implement source-grounded summarization by level.
3. Add flashcard and quiz generation with quality checks.
4. Create basic UI with tabbed study experience.
5. Add concept graph/timeline rendering.
6. Add persistence and history.
7. Instrument analytics for learning outcomes and iteration.
