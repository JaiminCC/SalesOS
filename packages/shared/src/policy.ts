export const POLICY_VERSION = 'mvp-1';

export type PolicyDecision = 'ALLOW' | 'REQUIRE_APPROVAL' | 'BLOCK';

export type PolicyAction = {
  actionType: string;
  external: boolean;
  firstOutbound?: boolean;
  commercialCommitment?: boolean;
  modelRequiresApproval?: boolean;
};

export type PolicyContext = {
  autonomyLevel: 'A0' | 'A1' | 'A2' | 'A3' | 'A4';
  suppressed: boolean;
  humanOwned: boolean;
  killSwitch: boolean;
  /** False when no lead or conversation record has established suppression or ownership. */
  audienceKnown?: boolean;
};

export type PolicyResult = {
  decision: PolicyDecision;
  reason: string;
  policyVersion: string;
};

const COMMERCIAL = /\b(price guarantee|discount|contract|legal assurance|warranty of outcome)\b/i;

export function textHasCommercialCommitment(value: string): boolean {
  return COMMERCIAL.test(value);
}

export function decide(action: PolicyAction, context: PolicyContext, policyVersion = POLICY_VERSION): PolicyResult {
  if (context.suppressed && action.external) {
    return { decision: 'BLOCK', reason: 'OPT_OUT', policyVersion };
  }
  if (context.humanOwned && action.external) {
    return { decision: 'BLOCK', reason: 'HUMAN_OWNED', policyVersion };
  }
  if (context.killSwitch && action.external) {
    return { decision: 'BLOCK', reason: 'KILL_SWITCH', policyVersion };
  }
  if (action.commercialCommitment) {
    return { decision: 'REQUIRE_APPROVAL', reason: 'COMMERCIAL_COMMITMENT', policyVersion };
  }
  if (action.external && context.audienceKnown !== true) {
    return { decision: 'REQUIRE_APPROVAL', reason: 'UNKNOWN_AUDIENCE', policyVersion };
  }
  if (!action.external) {
    return { decision: 'ALLOW', reason: 'INTERNAL', policyVersion };
  }
  if (action.firstOutbound || context.autonomyLevel === 'A0' || context.autonomyLevel === 'A4') {
    return { decision: 'REQUIRE_APPROVAL', reason: 'FIRST_CONTACT', policyVersion };
  }
  return { decision: 'REQUIRE_APPROVAL', reason: 'EXTERNAL_WRITE', policyVersion };
}

export function budgetStop(spentMinor: number, limitMinor: number): boolean {
  return spentMinor >= limitMinor;
}
