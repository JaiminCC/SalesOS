# Code Colonies SalesOS — End-to-End Figma-Ready Design Package

## What is delivered
- **48 native-Figma editable artboards**, generated using a local Figma development plugin (frames, text, shapes, layer names; not flattened screenshots).
- **1 native component starter page** containing buttons, success badges and design-system colors/type examples.
- **48 vector SVG artboards** individually importable into Figma.
- **48 PNG previews** and category contact sheets for review.
- **Offline gallery (`index.html`)** for navigating every artboard.
- **UX flow handoff**, screen register, developer handoff and token definitions.

This is a Figma-ready import package, not a hosted Figma URL or proprietary `.fig` file. There is no connected Figma account in this session.

## Import into Figma as fully editable frames
1. Extract the ZIP.
2. Open the Figma **desktop application** (or editor with development plugins available).
3. In Figma, go to **Plugins → Development → Import plugin from manifest…**
4. Select `figma-plugin/manifest.json`.
5. Run **Code Colonies SalesOS — Editable Design Generator** from development plugins in an empty Figma design file.
6. Wait for the generation completion notification. The plugin creates separate Figma pages for Identity & Access, Core Sales, Agent Operations, Enterprise Administration, Mobile Views, User Flows, and a Design System page.
7. Review the generated layers, style tokens and screen-to-screen flows; save your design file normally in Figma.

The generated frames, text and cards are native editable Figma layers. The plugin does **not** automatically wire live API-backed interaction or create a clickable prototype link; use `docs/UX_FLOWS.md` to connect relevant frames with Figma prototype interactions.

### Alternative
Drag any `.svg` in `svg-artboards/` onto the Figma canvas. Imported elements remain editable vector/text where Figma's SVG conversion allows. For maximum text editability and layer organization, use the plugin.

## Screen size and fidelity
- Desktop: 1440 × 900 (42 screens including 6 auth)
- Mobile: 390 × 844 (6 screens)
- Native components use Inter and generated geometry; if the font is unavailable, install/use an alternative and re-run.
- The design is a coherent **v2.1 product design interpretation** derived from the previous Next.js prototype, enterprise requirements and visual references—not a pixel-for-pixel capture of the running application.
- All example companies, numbers and security states are illustrative.

## Scope boundary
Figma assets do not provide functioning SSO, email delivery, AI, meeting recording, WhatsApp messaging, billing, or security guarantees. Those are backend/connector workstreams.

## Acceptance checklist
- [ ] 48 artboards generated across seven pages including design system.
- [ ] Authentication screens include login, recovery, reset, MFA, SSO, onboarding.
- [ ] Eight specialist agents and Supervisor have dedicated views.
- [ ] Execution Inspector and approval surfaces show policy decisions, not fake confirmations.
- [ ] Core flow has lead discovery, research, campaigns, inbox, qualification, meetings, notes, pipeline, analytics, products.
- [ ] Enterprise flow has preferences, security, SSO, users/roles, connectors, WhatsApp bot, templates, webhooks, audit and tenant settings.
- [ ] Mobile overview/inbox/approvals/meeting brief screens exist.
- [ ] Technical team validates details and connects real Figma prototype hotspots as required.
