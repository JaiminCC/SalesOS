# START HERE — SalesOS Figma Design (Corrected)

## Which version?
- **Code_Colonies_SalesOS_Enterprise_Interactive_Prototype_v2_1.zip:** latest runnable Next.js application, not a Figma design.
- **Code_Colonies_SalesOS_Figma_End_to_End_Design_FIXED.zip:** latest Figma design generator for the v2.1 prototype. Use this to create editable designs in Figma.
- Older `Code_Colonies_SalesOS_Interactive_Prototype.zip` and design concept boards are superseded for new work.

## Plugin installation
1. Extract the full design ZIP; do not open the manifest from inside the ZIP preview.
2. In Figma desktop: Plugins → Development → Import plugin from manifest…
3. Select `SalesOS_Figma_Design/figma-plugin/manifest.json` (the corrected file is **not empty**).
4. Open a blank Figma Design file and run the imported plugin under Development.
5. It should generate multiple pages of editable frames. First run can take time due to many screens.

## Troubleshooting
- If the file looks empty, open it with VS Code or another text editor rather than Finder/ZIP preview. It is UTF-8 JSON.
- Check that `code.js` and `manifest.json` are in the **same** folder.
- If plugin import fails, drag the SVG artboards from `svg-artboards/` into Figma instead.
- These are editable design drafts, not a published `.fig` file or a verified Figma-hosted prototype.
