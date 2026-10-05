# OpenAI directory submission checklist

The repository package is prepared for OpenAI's **With MCP** submission path. This
file is operational guidance only. It contains no credentials, legal declarations,
domain challenge, or claim that the plugin has been submitted or approved.

## Included in the package

- Portable `plugin.json` and `mcp.json` for `https://microstock.plus/mcp`.
- Three starter prompts, the maximum allowed for final submission.
- Existing public Microstock+ pages:
  - website and support: `https://microstock.plus/ai-agent-skills`;
  - privacy: `https://stocksubmitter.com/html/privacy.htm`;
  - terms: `https://stocksubmitter.com/html/termsofuse.htm`.
- Owner-source 192×192 PNG used for both `logo` and `composerIcon`.
- Exactly five positive and three negative review cases.
- Release notes and a `commerce: false` declaration.

The privacy policy explicitly covers `microstock.plus`, its storage service and
files/content stored in Microstock+ systems. The terms page explicitly includes
`www.microstock.plus`. These existing owner pages are referenced unchanged; this
package does not create or reinterpret legal text.

## Owner portal work still required

1. Choose the verified OpenAI developer identity and owning organization/project.
   The operator must be an organization owner or have Apps Management Write.
2. Upload the current plugin ZIP as a new **With MCP** draft.
3. Complete the portal-generated domain challenge by serving its exact token at
   the requested `/.well-known/openai-apps-challenge` URL. The token cannot be
   prepared before the portal generates it.
4. Connect and authorize the production MCP server, wait for the tool and skill
   scans, and resolve every required finding. Confirm all eleven production tools
   and their annotations match the package.
5. Create a dedicated reviewer account with safe sample portfolio data and all
   scopes needed by the positive cases. Enter credentials and sign-in instructions
   only in the portal's secure Review details fields. Do not put them in this repo.
6. Provision the dedicated `/MCPReview` fixture and run all five positive and three
   negative cases against that reviewer account. Cases discover iids from
   `mplus_list_files`; never substitute a real user's file id.
7. Record the required reviewer-accessible video showing the main flows and cases,
   then set `extensions.com.openai.review.demo_recording_url` or enter it in the
   portal. No placeholder URL is included here.
8. Review country availability and listing text in the portal.
9. The owner must personally review and complete the required policy attestations,
   submit the draft, respond to review feedback, and publish only after approval.

Official specification:
https://developers.openai.com/plugins/deploy/submission
