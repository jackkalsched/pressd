# Codebase notes

Working notes from the September 2026 audit — the long-form evidence behind
[`CLAUDE.md`](../../CLAUDE.md), kept because the reasoning and the rejected
alternatives are the useful part.

**These are a snapshot of the tree at commit `d8a76fc`, not a living document.**
`CLAUDE.md` is the one that is kept current (see its §12). Where a note and
`CLAUDE.md` disagree, `CLAUDE.md` wins. In particular these notes still describe code
that the post-audit cleanup removed: the ChromaDB/Ollama v1 theme pipeline,
`theme_predictor/predictor.py`, `POST /util/predict-themes`, `RatingReport.tsx`, and
the unused client exports.

| Note | Covers |
|---|---|
| `00-repo-map.md` | stack, deployables, import graph, audit order |
| `01-foundation-auth-data.md` | 22 tables, auth invariant, migrations, the auth-coverage audit |
| `02-scoring.md` | the three scoring frameworks and where they disagree |
| `03-external-data.md` | search, the release-feed chain, artist photos, import |
| `06-ml-pipeline.md` | song model, cold-start ramp, clusters, personalization |
| `07-llm.md` | the four Claude call sites, prompt design, cost posture |
| `08-clients.md` | routes, parity, share cards, error handling |
| `10-performance.md` | P1–P12 findings: current → risk → cheapest fix |
