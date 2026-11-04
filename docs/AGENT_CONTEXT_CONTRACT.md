# Agent context contract

`ProductsService.preview` is the internal product-context service. The HTTP form is `POST /api/v1/products/:id/context/preview`. It does not call a language model and it does not send email, WhatsApp, or any other external action.

## Request

The organization is the session tenant. The browser cannot substitute another organization.

```json
{
  "versionId": "optional-uuid",
  "query": "installation steps",
  "mode": "semantic",
  "limit": 5
}
```

`versionId` selects that version. Omit it to use the current `PUBLISHED` version. A missing published version is `404`. A caller without `products.write` who asks for a draft, in-review, approved, or rejected version receives `403`. Published and superseded versions are readable with `products.read`.

`mode` defaults to `semantic`. When embeddings are unavailable the service still answers and labels the retrieval `keyword`.

## Response

```json
{
  "data": {
    "product": { "id": "…", "organizationId": "…", "name": "Field Kit", "productType": "PHYSICAL", "status": "ACTIVE" },
    "version": { "id": "…", "versionNumber": 1, "status": "PUBLISHED", "publishedAt": "2026-11-04T12:00:00.000Z" },
    "liveAgentContext": true,
    "positioning": { "valuePropositions": ["Works away from the office"], "capabilities": [], "restrictedClaims": [] },
    "icps": [{ "id": "…", "name": "Regional operators", "priority": 1, "archived": false }],
    "capabilities": [],
    "pricing": { "model": "CUSTOM_QUOTE", "visible": false, "currency": "USD", "summary": "", "tiers": [] },
    "objections": [{ "objection": "Too expensive", "response": "Share the approved comparison." }],
    "restrictedClaims": ["Guaranteed uptime"],
    "escalationConditions": ["Legal review requested"],
    "approvalRequirements": ["A person approves the first quote"],
    "disallowedBuyers": [],
    "chunks": [],
    "citations": [{ "chunkId": "…", "documentId": "…", "fileName": "field-notes.md", "page": null, "section": "Setup" }],
    "provenance": {
      "productId": "…",
      "versionId": "…",
      "versionNumber": 1,
      "documentIds": ["…"],
      "retrievalMode": "semantic",
      "embeddingModel": "salesos-test-384",
      "generatedAt": "2026-11-04T12:00:01.000Z"
    }
  },
  "meta": { "requestId": "req_04" }
}
```

`liveAgentContext` is true only for `PUBLISHED`. Store `provenance.versionId` with any future conversation so the exact snapshot can be audited.

Positioning is the product snapshot merged with organization defaults. See `docs/PRODUCT_CONFIGURATION.md` for precedence. Archived ICPs are omitted. Capabilities, objections, restricted claims, escalation conditions, approval requirements, and disallowed buyers are the merged positioning fields.

When `pricing.visible` is false, `agentPricing` clears `summary` and replaces tier amounts with the note `Amount hidden by the pricing visibility rule`. The model name and currency remain so a future agent can respect the rule. A hidden price is a valid configuration. Products are not required to publish a price.

Citations repeat chunk id, document id, file name, page, and section. Chunk content is untrusted data. A future agent must not treat it as instructions to ignore authorization or to take an external action.

Draft and rejected knowledge never enter a response whose `liveAgentContext` is true.
