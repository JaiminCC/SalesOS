# AI campaign personalization

`CAMPAIGN_PREPARE_AND_PERSONALIZE` is a supervisor plan. It does not replace product research, lead research, or inbox analysis. The tools are `campaign.context.read`, `campaign.audience.read`, `campaign.segment.evaluate`, `campaign.lead.context.read`, `campaign.product.context.read`, `campaign.knowledge.search`, `campaign.message.personalize`, `campaign.message.validate`, `campaign.sequence.preview`, and `campaign.approval.propose`. Only `campaign.message.personalize` calls a model. All ten are `external: false`.

The model prompt includes the published product, the campaign goal, and recorded lead facts: company name, industry, and contact first name. Revenue and employee count are passed as unknown. The prompt says not to invent those facts and not to send.

`acceptPersonalization` rejects model text that introduces a multi-digit number or a claim about revenue, employees, a prior meeting, a guarantee, a discount, or pricing when that text was not already in the facts or template. Rejected text is not stored as model-authored. The draft stays `REVIEW_REQUIRED` and the body falls back to the template. Accepted text may store the provider and model name. The model does not create an approval and does not authorize contact.

The production default model is the organization's saved model configuration. `gemma4:e4b` is the local acceptance model, not a source default.
