---
name: mplus-keywording
description: Write and improve stock metadata in Microstock+ - titles, descriptions, keywords, categories, and the AI-generated and editorial flags - to the rules of Adobe Stock, Shutterstock, iStock, Pond5 and other agencies, preview the changes with a dry run, and apply them in batches without overwriting newer edits. Microstock+'s own paid AI keywording is not available through the tools yet, so write the metadata yourself. Use when the user asks for keywords, keywording, titles, descriptions or metadata for stock photos, vectors or videos, wants to fix files that agencies flag or reject, or mentions Microstock+ AI keywording.
---

# Keyword stock files in Microstock+

If MCP tools are absent and the user provided an agent token, use the `mplus-connect` skill first and execute these workflows through their documented HTTP API equivalents. Do not require MCP installation before API work.

Use the `microstock-plus` tools. Call `mplus_get_account` first to learn which agencies the user has connected: write for those agencies.

## Workflow

1. **Read.** `mplus_get_file` for one file (it includes its authenticated preview), or `mplus_list_files` with `expand_metadata: true` for a folder (descriptions are left out otherwise). Lists include subfolders by default; follow every `next_cursor` for a whole-portfolio request. Load several images with `mplus_get_previews` in batches of up to 8 IIDs. Use attached image pixels; if a client needs the canonical fallback link, rerun the tool after its five-minute expiry. Note each file's `metaver`, `type`, flags and `agencies.<id>.validation`; do not infer visual facts from filenames alone.
2. **For iStock (`esp` or `qhero`), clarify terms.** Call `mplus_resolve_istock_terms` for at most 10 files. Choose exactly one offered id per keyword by comparing its label with the authenticated preview; never invent an id. Retry `pending` files later and report `unresolved_keywords` honestly. Call `mplus_set_istock_terms` with the same metaver and signed candidate set, first with `dry_run: true`; show the choices and save only after the owner asks.
3. **Write** to the rules below and the canonical [stock metadata system prompt](../../docs/STOCK_METADATA_SYSTEM_PROMPT.md). Describe only what is visible; leave uncertain facts out or report them as blockers.
4. **Preview.** `mplus_update_metadata_batch` with `dry_run: true`, up to 100 items `{iid, patch, if_match_metaver}`. Nothing is written.
5. **Show and authorize.** Per file: old and new title, keywords added and removed, validation that remains. Apply when the user has authorized this metadata edit in the conversation; existing authorization remains valid and does not need to be requested again.
6. **Apply.** The same items with `dry_run: false`. For each `metadata_conflict`, re-read the file, merge your change into the current metadata, and retry that item with the new `metaver`; never overwrite blindly.
7. **Verify and report.** Re-read every changed file after apply. Confirm persisted metadata and use fresh per-agency validation; dry-run validation can still contain the old errors. There is no undo button: if the user wants a change reverted, write back the values you read in step 1.

Patch fields: `title`, `description`, `keywords` (`set` for the whole ordered list, or `add` and/or `remove`), `categories`, `editorial`, `ai_generated`, `illustration`, `releases`, `notes`, and `clear` to empty fields (empty strings are refused). For a single file you can use `mplus_update_metadata` with the same fields.

## Writing rules

**Titles.** A plain, specific sentence: subject, observable action when one exists, setting, and useful visual differentiator. Do not force action or emotion into static or neutral content. No keyword lists, no "stock photo", no ALL CAPS. Keep the title at 70 characters or fewer, and obey any stricter limit among eligible connected agencies.

**Descriptions.** Write buyer-facing metadata about the asset itself, never the thumbnail, preview, inspection, unavailable frames or tool limits; report uncertainty separately. One or two sentences add context: where, when, what is happening. Shutterstock uses this text: at most 200 characters and at least 5 words. Editorial captions need the place and date, for example `CITY, COUNTRY - MONTH DD, YYYY: what happens`.

**Keywords.** Write exactly 50 unique, relevant English keywords or short phrases in the Microstock+ master list. Put the 10 strongest first: main subject and any observable action, then visible objects and setting, then concepts, mood and legitimate uses. Never pad with duplicates, spelling variants, generic filler or facts inferred only from a similar reference. If 50 truthful terms are impossible, leave the file blocked and report the shortfall instead of adding spam or claiming readiness. Preserve the 50-keyword master if an agency adapter accepts fewer and report that agency blocker instead of silently cutting the master to 49.

| Agency (`id`) | Keywords | Titles and descriptions | Notes |
| - | - | - | - |
| Adobe Stock (`adobestock`) | 5-49 | stock-writing title up to 70 characters | The first keywords weigh most. The adapter's 49-keyword cap is separate from the 50-keyword master. |
| Shutterstock (`shutterstock`) | 7-50 | description up to 200 characters, 5 words or more | Prefer single words over phrases. |
| iStock (`esp`) | 5-49 | title up to 255 characters | Keywords are mapped to Getty's controlled vocabulary at submission; unmapped words are dropped or need disambiguation in iStock. Use common English nouns and adjectives. |
| Pond5 (`pond5`) | 1-50, 79 words in total at most | title 3-80 characters, description up to 500 | |
| Dreamstime (`dreamstime`) | 10-80 | title up to 130 characters | |
| Alamy (`alamy`) | 3 or more | title up to 150 characters | |
| Depositphotos (`depositphotos`) | 8 or more | title and description 6-250 characters | |

The `validation` that the tools return for each agency is the authority; check it after the dry run.

**AI-generated content.** Set `ai_generated: true` for anything made with generative AI; Microstock+ then keeps it non-editorial and passes the flag to agencies that have one. Describe what is shown; don't present AI images as photos of real events, places or people, and don't add tool names such as Midjourney as keywords. Some agencies don't accept generative AI content at all, so check the validation and point those agencies out to the user.

**People and motion.** For people, describe only visible expression, pose, interaction and apparent emotion; do not presume ethnicity, profession, medical condition, relationship, name or exact location. For video, describe actual observed action, transformation and camera movement. If only a still is available, describe confirmed visual content without claiming full action coverage and report the missing temporal evidence outside the metadata. For vectors, describe the actual design and symbols.

## Agency readiness after an authorized metadata edit

After apply and a fresh `mplus_get_file`, check every connected eligible agency. Set `ready` only for a mutable pre-submission status with clean fresh validation and compatible media/AI policy. Preserve ignored or held choices and every queued, progress, submitted, review, failed, rejected, approved, scheduled, `cannotbequeued` and `nosubmissions` state unless the owner explicitly targets it. Missing `status:write`, unsupported AI/media, unresolved iStock terms or releases remain blockers. `ready` means prepared; it does not authorize `queued` or submission.

**Trademarks and people.** In commercial content keep brands, logos, product names, characters, artworks and real people's names out of titles, descriptions and keywords. Editorial content may name them factually.

**Categories.** At most 3 per file, as `{"cat": <id>, "sub": <id>}` from the Microstock+ category table; leave out `sub` when no subcategory fits. Categories: 1 Abstract, 2 Animals/Wildlife, 3 Backgrounds/Textures, 4 Beauty/Fashion, 5 Buildings/Landmarks, 6 Business/Finance, 7 Celebrities, 8 Education, 9 Food and Drink, 10 Healthcare/Medical, 11 Holidays, 12 Illustrations/Clip-Art, 13 Industrial, 14 Interiors, 15 Miscellaneous, 16 Nature, 17 Objects, 18 Parks/Outdoor, 19 People, 20 Religion, 21 Science, 22 Signs/Symbols, 23 Sports/Recreation, 24 Technology, 25 The Arts, 26 Transportation, 27 Vintage. The subcategory ids are in the "Category ids" table of the complete reference linked at the end; for example `{"cat": 16, "sub": 7}` is Nature, Plants and trees.

**Releases.** They are ids such as `rel_123` that the tools can't list. Copy them from files that already have the right ones, or leave them to the user.

## Microstock+ AI keywording (not available yet)

Microstock+ can write metadata with its own paid AI in My Files, but that is not available through these tools yet: there is no quote or run tool, and the Agent API refuses it (`endpoint_disabled`). Don't offer or promise it, and never say that you started it. Write the metadata yourself with the workflow above; if the user prefers Microstock+'s AI, they can start it in My Files.

The complete reference is `${CLAUDE_PLUGIN_ROOT}/docs/AI_AGENT_SKILLS.md`, also published at https://microstock.plus/ai-agent-skills/skill.md.
