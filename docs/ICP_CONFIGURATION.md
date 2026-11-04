# ICP configuration

An ideal customer profile is a structured object inside the product version snapshot. A product may have up to 30. Nothing in the schema or the API names an industry, a company, or a buyer that the organization did not enter.

## Fields

Required: `name` (1–160) and `priority` (integer 1–100). The server assigns `id` and defaults `archived` to false.

Controlled lists, each item 1–240 characters, at most 40 items unless noted:

- `industries`, `companySizes`, `revenueRanges`
- `geographicMarkets`, `regions`
- `businessModels`, `technologyStack`
- `buyerTitles`, `decisionMakerRoles`, `departments`
- `painPoints`, `buyingTriggers`
- `budgetCharacteristics`, `urgencySignals`
- `qualificationRequirements`, `exclusionCriteria`, `negativeSignals`

`countries` is at most 80 values matching `^[A-Z]{2}$`. `languages` is at most 40 values matching `^[a-z]{2}(-[A-Z]{2})?$`. `customAttributes` is a record whose keys are 1–80 characters and whose values are a string up to 240 characters, a number, or a boolean. Unknown keys are rejected.

## Operations

All of these require `products.write` and an open draft. Readers with only `products.read` can list ICPs from a published version.

| Action | Route |
|---|---|
| List | `GET /api/v1/products/:id/icps?versionId=` |
| Create | `POST /api/v1/products/:id/icps` |
| Edit | `PATCH /api/v1/products/:id/icps/:icpId` |
| Duplicate | `POST /api/v1/products/:id/icps/:icpId/duplicate` |
| Archive | `POST /api/v1/products/:id/icps/:icpId/archive` |

Archive sets `archived: true`. It does not remove the object from history. Duplicate appends ` copy` to the name and keeps the same priority. Preview and live agent context omit archived ICPs and sort the rest by priority, then name.

Invalid ICPs return `400` `VALIDATION_ERROR` with the first Zod message. A second organization cannot read or write the draft.

## Version consistency

ICP edits change the draft snapshot and increment `revision`. Submit, approve, and publish carry that snapshot forward. A published version keeps the ICP list from the moment of publication. Later draft edits do not change it. Restoring a published version copies its ICPs into a new draft.

## Example

```json
{
  "name": "Regional operators",
  "priority": 1,
  "industries": ["Logistics"],
  "companySizes": ["50-200"],
  "countries": ["US"],
  "buyerTitles": ["Operations lead"],
  "painPoints": ["Paper installation notes"],
  "languages": ["en"],
  "customAttributes": { "shiftWork": true }
}
```

The response `data` is the saved ICP, including the server `id`.
