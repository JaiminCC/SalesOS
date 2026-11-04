import { z } from 'zod';

export const PRODUCT_TYPES = [
  'SOFTWARE',
  'PHYSICAL',
  'PROFESSIONAL_SERVICE',
  'SUBSCRIPTION',
  'DIGITAL',
  'CUSTOM',
  'OTHER',
] as const;

export const PRODUCT_VERSION_STATUSES = [
  'DRAFT',
  'IN_REVIEW',
  'APPROVED',
  'REJECTED',
  'PUBLISHED',
  'SUPERSEDED',
  'ARCHIVED',
] as const;

export const PRICING_MODELS = ['FIXED', 'SUBSCRIPTION', 'TIERED', 'CUSTOM_QUOTE', 'USAGE', 'NEGOTIATED'] as const;

export type ProductType = (typeof PRODUCT_TYPES)[number];
export type ProductVersionStatus = (typeof PRODUCT_VERSION_STATUSES)[number];
export type PricingModel = (typeof PRICING_MODELS)[number];

const label = z.string().trim().min(1).max(240);
const labels = z.array(label).max(40);
const language = z.string().trim().regex(/^[a-z]{2}(-[A-Z]{2})?$/);
const country = z.string().trim().regex(/^[A-Z]{2}$/);

export const icpSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    priority: z.number().int().min(1).max(100),
    archived: z.boolean().default(false),
    industries: labels.default([]),
    companySizes: labels.default([]),
    revenueRanges: labels.default([]),
    geographicMarkets: labels.default([]),
    countries: z.array(country).max(80).default([]),
    regions: labels.default([]),
    businessModels: labels.default([]),
    technologyStack: labels.default([]),
    buyerTitles: labels.default([]),
    decisionMakerRoles: labels.default([]),
    departments: labels.default([]),
    painPoints: labels.default([]),
    buyingTriggers: labels.default([]),
    budgetCharacteristics: labels.default([]),
    urgencySignals: labels.default([]),
    qualificationRequirements: labels.default([]),
    exclusionCriteria: labels.default([]),
    negativeSignals: labels.default([]),
    languages: z.array(language).max(40).default([]),
    customAttributes: z.record(z.string().trim().min(1).max(80), z.union([z.string().max(240), z.number(), z.boolean()])).default({}),
  })
  .strict();

export type IcpDefinition = z.infer<typeof icpSchema>;

const objectionSchema = z
  .object({
    objection: z.string().trim().min(1).max(500),
    response: z.string().trim().min(1).max(2000),
  })
  .strict();

const faqSchema = z
  .object({
    question: z.string().trim().min(1).max(500),
    answer: z.string().trim().min(1).max(2000),
  })
  .strict();

const proofSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(2000),
  })
  .strict();

export const positioningSchema = z
  .object({
    valuePropositions: labels.default([]),
    differentiators: labels.default([]),
    capabilities: labels.default([]),
    competitivePositioning: z.string().trim().max(4000).default(''),
    painPoints: labels.default([]),
    outcomes: labels.default([]),
    objections: z.array(objectionSchema).max(40).default([]),
    faqs: z.array(faqSchema).max(40).default([]),
    proofPoints: z.array(proofSchema).max(20).default([]),
    qualificationQuestions: labels.default([]),
    discoveryQuestions: labels.default([]),
    tone: z.string().trim().max(240).default(''),
    brandVoice: z.string().trim().max(2000).default(''),
    languages: z.array(language).max(40).default([]),
    restrictedClaims: labels.default([]),
    disallowedBuyers: labels.default([]),
    complianceNotes: z.string().trim().max(4000).default(''),
    escalationConditions: labels.default([]),
    approvalRequirements: labels.default([]),
  })
  .strict();

export type Positioning = z.infer<typeof positioningSchema>;

const tierSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    amount: z.string().trim().max(40).optional(),
    unit: z.string().trim().max(40).optional(),
    notes: z.string().trim().max(400).optional(),
  })
  .strict();

export const pricingSchema = z
  .object({
    model: z.enum(PRICING_MODELS).default('CUSTOM_QUOTE'),
    visible: z.boolean().default(false),
    currency: z.string().trim().regex(/^[A-Z]{3}$/).default('USD'),
    summary: z.string().trim().max(2000).default(''),
    tiers: z.array(tierSchema).max(20).default([]),
  })
  .strict();

export type Pricing = z.infer<typeof pricingSchema>;

export const snapshotSchema = z
  .object({
    icps: z.array(icpSchema).max(30).default([]),
    positioning: positioningSchema.default({
      valuePropositions: [],
      differentiators: [],
      capabilities: [],
      competitivePositioning: '',
      painPoints: [],
      outcomes: [],
      objections: [],
      faqs: [],
      proofPoints: [],
      qualificationQuestions: [],
      discoveryQuestions: [],
      tone: '',
      brandVoice: '',
      languages: [],
      restrictedClaims: [],
      disallowedBuyers: [],
      complianceNotes: '',
      escalationConditions: [],
      approvalRequirements: [],
    }),
    pricing: pricingSchema.default({ model: 'CUSTOM_QUOTE', visible: false, currency: 'USD', summary: '', tiers: [] }),
    knowledgeDocumentIds: z.array(z.string().uuid()).max(200).default([]),
  })
  .strict();

export type ProductSnapshot = z.infer<typeof snapshotSchema>;

const transitions: Record<ProductVersionStatus, readonly ProductVersionStatus[]> = {
  DRAFT: ['IN_REVIEW', 'ARCHIVED'],
  IN_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: ['PUBLISHED'],
  REJECTED: [],
  PUBLISHED: ['SUPERSEDED'],
  SUPERSEDED: [],
  ARCHIVED: [],
};

export function canTransitionVersion(from: ProductVersionStatus, to: ProductVersionStatus): boolean {
  return transitions[from].includes(to);
}

export function emptySnapshot(currency = 'USD'): ProductSnapshot {
  return snapshotSchema.parse({ pricing: { currency } });
}

export function parseSnapshot(value: unknown): ProductSnapshot {
  return snapshotSchema.parse(value);
}

function filledText(value: string | undefined): boolean {
  return Boolean(value && value.trim());
}

function preferText(product: string, fallback: string | undefined): string {
  return filledText(product) ? product : fallback?.trim() || '';
}

function preferList<T>(product: T[], fallback: T[] | undefined): T[] {
  return product.length ? product : fallback ?? [];
}

function untouchedPricing(pricing: Pricing): boolean {
  return pricing.model === 'CUSTOM_QUOTE' && !pricing.visible && !pricing.summary.trim() && pricing.tiers.length === 0;
}

export function mergeProductContext(
  snapshot: ProductSnapshot,
  defaults: { positioning?: Partial<Positioning>; pricing?: Partial<Pricing> },
): { positioning: Positioning; pricing: Pricing } {
  const fallbackPositioning = positioningSchema.partial().parse(defaults.positioning ?? {});
  const fallbackPricing = pricingSchema.partial().parse(defaults.pricing ?? {});
  const product = snapshot.positioning;
  const positioning = positioningSchema.parse({
    valuePropositions: preferList(product.valuePropositions, fallbackPositioning.valuePropositions),
    differentiators: preferList(product.differentiators, fallbackPositioning.differentiators),
    capabilities: preferList(product.capabilities, fallbackPositioning.capabilities),
    competitivePositioning: preferText(product.competitivePositioning, fallbackPositioning.competitivePositioning),
    painPoints: preferList(product.painPoints, fallbackPositioning.painPoints),
    outcomes: preferList(product.outcomes, fallbackPositioning.outcomes),
    objections: preferList(product.objections, fallbackPositioning.objections),
    faqs: preferList(product.faqs, fallbackPositioning.faqs),
    proofPoints: preferList(product.proofPoints, fallbackPositioning.proofPoints),
    qualificationQuestions: preferList(product.qualificationQuestions, fallbackPositioning.qualificationQuestions),
    discoveryQuestions: preferList(product.discoveryQuestions, fallbackPositioning.discoveryQuestions),
    tone: preferText(product.tone, fallbackPositioning.tone),
    brandVoice: preferText(product.brandVoice, fallbackPositioning.brandVoice),
    languages: preferList(product.languages, fallbackPositioning.languages),
    restrictedClaims: preferList(product.restrictedClaims, fallbackPositioning.restrictedClaims),
    disallowedBuyers: preferList(product.disallowedBuyers, fallbackPositioning.disallowedBuyers),
    complianceNotes: preferText(product.complianceNotes, fallbackPositioning.complianceNotes),
    escalationConditions: preferList(product.escalationConditions, fallbackPositioning.escalationConditions),
    approvalRequirements: preferList(product.approvalRequirements, fallbackPositioning.approvalRequirements),
  });
  const pricing = untouchedPricing(snapshot.pricing) && fallbackPricing.model
    ? pricingSchema.parse({ ...snapshot.pricing, ...fallbackPricing })
    : snapshot.pricing;
  return { positioning, pricing };
}

export function agentPricing(pricing: Pricing): Pricing {
  if (pricing.visible) return pricing;
  return {
    ...pricing,
    summary: '',
    tiers: pricing.tiers.map((tier) => ({ name: tier.name, unit: tier.unit, notes: 'Amount hidden by the pricing visibility rule' })),
  };
}

export function changedSnapshotKeys(left: ProductSnapshot, right: ProductSnapshot): string[] {
  const keys = ['icps', 'positioning', 'pricing', 'knowledgeDocumentIds'] as const;
  return keys.filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]));
}
