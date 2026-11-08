# Audience segmentation

A segment is `DYNAMIC` or `SNAPSHOT`. Dynamic preview and a new enrollment batch evaluate the current filter. A snapshot stores members on a version and then freezes that version. A second materialize of a frozen version inserts nothing. Editing the filter creates a new version and leaves the frozen members in place.

The filter is a tree of `and` and `or` groups. Nesting stops at depth 3. A filter may contain 40 conditions. An `in` list may contain 20 values. Fields and operators are allowlists in `SEGMENT_FIELDS`. A field that is not on the list, including a string that looks like SQL, is rejected before any lead is read. Matching is done in process. If the organization has more than 500 active leads, preview and snapshot materialization stop with `AUDIENCE_LIMIT`. They do not keep the newest 500 and present that slice as the audience. Archived leads are not counted.

Supported fields include product, ICP name, score, grade, stage, industry, size, country, region, business model, source, account status, contact role, job title, seniority, verification, consent, suppression, human takeover, owner, last activity, last research, and completeness. A high score does not override suppression, takeover, unknown consent, or an unknown time zone.
