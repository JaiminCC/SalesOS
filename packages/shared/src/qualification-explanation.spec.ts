import { describe, expect, it } from 'vitest';
import { acceptLeadExplanation, deterministicQualificationText, officialFromPrompt, type OfficialBreakdown } from './qualification-explanation';

const official: OfficialBreakdown = {
  score: 65,
  grade: 'B',
  evidence: [],
  dimensions: [
    { name: 'industry', fit: 'MATCH' },
    { name: 'size', fit: 'MATCH' },
    { name: 'geography', fit: 'MATCH' },
    { name: 'buyer', fit: 'UNKNOWN' },
    { name: 'need', fit: 'MATCH' },
    { name: 'trigger', fit: 'UNKNOWN' },
    { name: 'technology', fit: 'UNKNOWN' },
  ],
};

describe('qualification explanations', () => {
  it('rejects a score restatement and keeps the deterministic breakdown', () => {
    const decision = acceptLeadExplanation({
      officialScore: 65,
      officialGrade: 'B',
      matched: ['industry', 'size', 'geography', 'need'],
      partial: [],
      unmatched: [],
      unknown: ['buyer', 'trigger', 'technology'],
      evidence: [],
      strengths: ['The official score is 65, grade B'],
      concerns: [],
      researchQuestions: ['The score is 65'],
      limitations: ['Grade B'],
    }, official);
    expect(decision).toEqual({ quality: 'INSUFFICIENT_EXPLANATION' });
    const text = deterministicQualificationText(official);
    expect(text).toContain('INSUFFICIENT_EXPLANATION');
    expect(text).toContain('Unknown: buyer, trigger, technology');
    expect(text).not.toMatch(/@/);
  });

  it('rejects a model score or a match the scorer did not record', () => {
    expect(acceptLeadExplanation({ officialScore: 90, officialGrade: 'A', matched: [], partial: [], unmatched: [], unknown: [], evidence: [], strengths: [], concerns: [], researchQuestions: [], limitations: ['none'] }, official)).toBeNull();
    expect(acceptLeadExplanation({
      officialScore: 65,
      officialGrade: 'B',
      matched: ['industry', 'size', 'geography', 'need', 'buyer'],
      partial: [],
      unmatched: [],
      unknown: ['trigger', 'technology'],
      evidence: [],
      strengths: ['industry matches'],
      concerns: [],
      researchQuestions: ['What is trigger?'],
      limitations: ['technology was not verified'],
    }, official)).toBeNull();
  });

  it('accepts an explanation that stays inside the official breakdown', () => {
    const decision = acceptLeadExplanation({
      officialScore: 65,
      officialGrade: 'B',
      matched: ['industry', 'size', 'geography', 'need'],
      partial: [],
      unmatched: [],
      unknown: ['buyer', 'trigger', 'technology'],
      evidence: [],
      strengths: ['industry matches the ICP', 'size matches the ICP', 'geography matches the ICP', 'need matches the description'],
      concerns: ['buyer is unknown'],
      researchQuestions: ['What recorded evidence would classify buyer?', 'What recorded evidence would classify trigger?', 'What recorded evidence would classify technology?'],
      limitations: ['Unknown dimensions were not treated as matches'],
    }, official);
    expect(decision?.quality).toBe('MODEL');
    if (decision?.quality === 'MODEL') expect(decision.text).toContain('Official score 65/100');
  });

  it('reads the official breakdown from the prompt', () => {
    const parsed = officialFromPrompt([{ content: 'OFFICIAL_SCORE: 65\nOFFICIAL_GRADE: B\nDIMENSIONS: industry=MATCH;size=MATCH;geography=MATCH;buyer=UNKNOWN;need=MATCH;trigger=UNKNOWN;technology=UNKNOWN\nEVIDENCE_IDS: \n' }]);
    expect(parsed?.score).toBe(65);
    expect(parsed?.dimensions.find((item) => item.name === 'buyer')?.fit).toBe('UNKNOWN');
  });
});
