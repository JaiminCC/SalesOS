# Lead qualification explanations

The official score and grade come from `scoreIcp`. `lead.qualification.explain` may describe that result. It does not replace it.

The model must return one object:

- `officialScore` and `officialGrade`, equal to the scorer
- `matched`, `partial`, `unmatched`, and `unknown`, equal to the scorer's dimension fits
- `evidence`, containing only citation ids the run was given
- `strengths`, naming every matched dimension
- `concerns`
- `researchQuestions`, naming every unknown dimension
- `limitations`

`acceptLeadExplanation` rejects a different score, a match the scorer did not record, an evidence id that was not supplied, an email address, or a phone number. The supervisor asks the model once more when the payload does not match. If the second payload still does not explain the dimensions, the result is `INSUFFICIENT_EXPLANATION`.

Propose then stores `deterministicQualificationText`. That text lists the official score and grade, the four fit groups, evidence ids, strengths taken from the matches, concerns for unknown and unmatched dimensions, a research question for each unknown dimension, and the limitation that unknown dimensions do not add points. The qualification row's `modelProvider` and `modelName` stay empty. The qualify response sets `explanationSource` to `deterministic`, and the lead screen titles the section "Stored explanation", so the text is not presented as a model analysis.

A sentence such as "The official lead qualification score is 65, corresponding to a grade of B." is `INSUFFICIENT_EXPLANATION` even when the score and the dimension arrays are copied correctly.

The fake provider used by `pnpm test` does not satisfy the schema. The lead run still succeeds, the fixture stays 65 / B, and buyer, trigger, and technology stay `UNKNOWN`.

The real-model command is:

```bash
pnpm --filter @salesos/api exec vitest run --config vitest.acceptance.config.ts src/crm/lead-model.acceptance.ts
```

It reads the saved enabled Ollama configuration. It does not fall back to the fake provider.

On 5 November 2026 that command exited 0. The saved `gemma4:e4b` model was called. Its explanation was not accepted after one repair. The stored text is the deterministic breakdown, score 65, grade B, with buyer, trigger, and technology `UNKNOWN`. Usage stays on the Ollama run. The qualification row does not name a model.
