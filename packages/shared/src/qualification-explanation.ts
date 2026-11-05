export const LEAD_EXPLANATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['officialScore', 'officialGrade', 'matched', 'partial', 'unmatched', 'unknown', 'evidence', 'strengths', 'concerns', 'researchQuestions', 'limitations'],
  properties: {
    officialScore: { type: 'number' },
    officialGrade: { type: 'string' },
    matched: { type: 'array', items: { type: 'string' } },
    partial: { type: 'array', items: { type: 'string' } },
    unmatched: { type: 'array', items: { type: 'string' } },
    unknown: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'array', items: { type: 'string' } },
    strengths: { type: 'array', items: { type: 'string' } },
    concerns: { type: 'array', items: { type: 'string' } },
    researchQuestions: { type: 'array', items: { type: 'string' } },
    limitations: { type: 'array', items: { type: 'string' } },
  },
} as const;

export type OfficialBreakdown = {
  score: number;
  grade: string;
  dimensions: Array<{ name: string; fit: string }>;
  evidence: string[];
};

export type ExplanationDecision = { quality: 'MODEL'; text: string } | { quality: 'INSUFFICIENT_EXPLANATION' };

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(?:\+\d|\(\d{3}\)|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b)/;

export function deterministicQualificationText(official: OfficialBreakdown): string {
  const groups = grouped(official);
  const unknown = groups.UNKNOWN;
  const matched = groups.MATCH;
  const missed = groups.MISS;
  return [
    'INSUFFICIENT_EXPLANATION',
    `Official score ${official.score}/100, grade ${official.grade}. The deterministic scorer produced this result. A model explanation was not accepted.`,
    `Matched: ${shown(matched)}`,
    `Partially matched: ${shown(groups.PARTIAL)}`,
    `Unmatched: ${shown(missed)}`,
    `Unknown: ${shown(unknown)}`,
    `Evidence: ${shown(official.evidence)}`,
    `Strengths: ${matched.length ? matched.map((name) => `${name} matches the published criteria`).join('; ') : 'none'}`,
    `Concerns: ${unknown.concat(missed).map((name) => `${name} is ${unknown.includes(name) ? 'unknown' : 'unmatched'}`).join('; ') || 'none'}`,
    `Research questions: ${unknown.length ? unknown.map((name) => `What recorded evidence would classify ${name}?`).join(' ') : 'none'}`,
    'Limitations: Unknown dimensions stay UNKNOWN and do not add points. This text does not add facts beyond the stored account, contact, and published ICP.',
  ].join('\n');
}

export function acceptLeadExplanation(value: unknown, official: OfficialBreakdown): ExplanationDecision | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.explanationQuality === 'INSUFFICIENT_EXPLANATION') return { quality: 'INSUFFICIENT_EXPLANATION' };
  if (typeof row.officialScore !== 'number' || row.officialScore !== official.score) return null;
  if (typeof row.officialGrade !== 'string' || row.officialGrade !== official.grade) return null;
  const matched = stringList(row.matched);
  const partial = stringList(row.partial);
  const unmatched = stringList(row.unmatched);
  const unknown = stringList(row.unknown);
  const evidence = stringList(row.evidence);
  const strengths = stringList(row.strengths);
  const concerns = stringList(row.concerns);
  const questions = stringList(row.researchQuestions);
  const limitations = stringList(row.limitations);
  if (!matched || !partial || !unmatched || !unknown || !evidence || !strengths || !concerns || !questions || !limitations) return null;
  const groups = grouped(official);
  if (!sameSet(matched, groups.MATCH) || !sameSet(partial, groups.PARTIAL) || !sameSet(unmatched, groups.MISS) || !sameSet(unknown, groups.UNKNOWN)) return null;
  if (evidence.some((id) => !official.evidence.includes(id))) return null;
  const prose = [...strengths, ...concerns, ...questions, ...limitations].join('\n');
  if (EMAIL.test(prose) || PHONE.test(prose)) return null;
  const covers = (names: string[], lines: string[]) => names.every((name) => lines.some((line) => line.toLowerCase().includes(name.toLowerCase()) && !restatesScore(line)));
  if (!covers(groups.MATCH, strengths) || !covers(groups.UNKNOWN, questions) || limitations.length === 0 || limitations.every(restatesScore)) {
    return { quality: 'INSUFFICIENT_EXPLANATION' };
  }
  return {
    quality: 'MODEL',
    text: [
      `Official score ${official.score}/100, grade ${official.grade}.`,
      `Matched: ${shown(matched)}`,
      `Partially matched: ${shown(partial)}`,
      `Unmatched: ${shown(unmatched)}`,
      `Unknown: ${shown(unknown)}`,
      `Evidence: ${shown(evidence)}`,
      `Strengths: ${strengths.join('; ')}`,
      `Concerns: ${concerns.join('; ') || 'none'}`,
      `Research questions: ${questions.join(' ')}`,
      `Limitations: ${limitations.join('; ')}`,
    ].join('\n'),
  };
}

export function officialFromPrompt(messages: Array<{ content: string }>): OfficialBreakdown | null {
  const text = messages.map((message) => message.content).join('\n');
  const score = Number(/OFFICIAL_SCORE:\s*(\d+)/.exec(text)?.[1]);
  const grade = /OFFICIAL_GRADE:\s*([A-D]|UNRATED)/.exec(text)?.[1];
  const raw = /DIMENSIONS:\s*([^\n]+)/.exec(text)?.[1];
  if (!Number.isInteger(score) || !grade || !raw) return null;
  const dimensions = raw.split(';').map((part) => {
    const [name, fit] = part.split('=').map((item) => item.trim());
    return { name: name ?? '', fit: fit ?? '' };
  }).filter((item) => item.name && item.fit);
  if (dimensions.length < 7) return null;
  const evidence = (/EVIDENCE_IDS:\s*([^\n]*)/.exec(text)?.[1] ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  return { score, grade, dimensions, evidence };
}

function grouped(official: OfficialBreakdown): Record<'MATCH' | 'PARTIAL' | 'MISS' | 'UNKNOWN', string[]> {
  const groups = { MATCH: [] as string[], PARTIAL: [] as string[], MISS: [] as string[], UNKNOWN: [] as string[] };
  for (const item of official.dimensions) {
    const fit = item.fit === 'MATCH' || item.fit === 'PARTIAL' || item.fit === 'MISS' || item.fit === 'UNKNOWN' ? item.fit : 'UNKNOWN';
    groups[fit].push(item.name);
  }
  return groups;
}

function shown(values: string[]): string {
  return values.length ? values.join(', ') : 'none';
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null;
  return value.map((item) => item.trim()).filter(Boolean);
}

function sameSet(left: string[], right: string[]): boolean {
  const a = [...left].map((item) => item.toLowerCase()).sort();
  const b = [...right].map((item) => item.toLowerCase()).sort();
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function restatesScore(line: string): boolean {
  const words = line.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((word) => word && !['official', 'score', 'grade', 'point', 'points', 'the', 'is', 'a', 'of', 'and'].includes(word));
  return words.length < 2;
}
