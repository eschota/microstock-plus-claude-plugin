---
name: mplus-keywording
description: Write and improve stock metadata in Microstock+ - titles, descriptions, keywords, and the AI-generated and editorial flags - to the rules of Adobe Stock, Shutterstock, iStock, Pond5 and other agencies, preview the changes with a dry run, apply them in batches without overwriting newer edits, and run paid Microstock+ AI keywording only after the user confirms the quoted price. Use when the user asks for keywords, keywording, titles, descriptions or metadata for stock photos, vectors or videos, wants to fix files that agencies flag or reject, or mentions Microstock+ AI keywording.
---

# Keyword stock files in Microstock+

Use the `microstock-plus` tools. Call `mplus_get_account` first to learn which agencies the user has connected: write for those agencies.

## Workflow

1. **Read.** `mplus_get_file` for one file, or `mplus_list_files` with `expand_metadata: true` for a folder (descriptions are left out otherwise). Note each file's `metaver`, `type`, flags and `agencies.<id>.validation`. Look at the previews when you can see images.
2. **Write** to the rules below. Describe only what is visible; ask the user about places, dates, species or names you can't confirm.
3. **Preview.** `mplus_update_metadata_batch` with `dry_run: true`, up to 100 items `{iid, patch, if_match_metaver}`. Nothing is written.
4. **Show and ask.** Per file: old and new title, keywords added and removed, validation that remains. Apply only after the user agrees.
5. **Apply.** The same items with `dry_run: false`. For each `metadata_conflict`, re-read the file, merge your change into the current metadata, and retry that item with the new `metaver`; never overwrite blindly.
6. **Report** what changed, with counts. The user can undo changes from the metadata history in My Files.

Patch fields: `title`, `description`, `keywords` (`set` for the whole ordered list, or `add` and/or `remove`), `categories`, `editorial`, `ai_generated`, `illustration`, `releases`, `notes`, and `clear` to empty fields (empty strings are refused). For a single file you can use `mplus_update_metadata` with the same fields.

## Writing rules

**Titles.** A plain, specific sentence: subject, action, setting, and mood or time when it matters, for example "Empty road through a golden autumn forest at sunrise". No keyword lists, no "stock photo", no ALL CAPS. At most 200 characters in Microstock+; shorter for some agencies (table below).

**Descriptions.** One or two sentences that add context: where, when, what is happening. Shutterstock uses this text: at most 200 characters and at least 5 words. Editorial captions need the place and date, for example `CITY, COUNTRY - MONTH DD, YYYY: what happens`.

**Keywords.** In English, one word or short phrase each, most important first: main subject, then what is visible (objects, people, actions, setting), then concepts (mood, season, use). No commas inside a keyword, no repeats, nothing irrelevant or misleading: keyword spam gets files rejected. At most 50 per file in Microstock+.

| Agency (`id`) | Keywords | Titles and descriptions | Notes |
| - | - | - | - |
| Adobe Stock (`adobestock`) | 5-49 | title up to 200 characters | The first keywords weigh most: put the 10 most important first. |
| Shutterstock (`shutterstock`) | 7-50 | description up to 200 characters, 5 words or more | Prefer single words over phrases. |
| iStock (`esp`) | 5-49 | title up to 255 characters | Keywords are mapped to Getty's controlled vocabulary at submission; unmapped words are dropped or need disambiguation in iStock. Use common English nouns and adjectives. |
| Pond5 (`pond5`) | 1-50, 79 words in total at most | title 3-80 characters, description up to 500 | |
| Dreamstime (`dreamstime`) | 10-80 | title up to 130 characters | |
| Alamy (`alamy`) | 3 or more | title up to 150 characters | |
| Depositphotos (`depositphotos`) | 8 or more | title and description 6-250 characters | |

The `validation` that the tools return for each agency is the authority; check it after the dry run.

**AI-generated content.** Set `ai_generated: true` for anything made with generative AI; Microstock+ then keeps it non-editorial and passes the flag to agencies that have one. Describe what is shown; don't present AI images as photos of real events, places or people, and don't add tool names such as Midjourney as keywords. Some agencies don't accept generative AI content at all, so check the validation and ask the user before queueing it.

**Trademarks and people.** In commercial content keep brands, logos, product names, characters, artworks and real people's names out of titles, descriptions and keywords. Editorial content may name them factually.

**Categories and releases.** They are ids (`{"cat": 12, "sub": 3}`, `rel_123`) that the tools can't list. Copy them from files that already have the right ones, or leave them to the user.

## Paid AI keywording

Microstock+ can write titles, descriptions and keywords with its own AI, for money from the user's balance.

1. **Quote, free:** `mplus_quote_ai_keywording` with the iids and `mode` (`skip` leaves files that already have metadata unchanged and doesn't bill them; `replace` rewrites all). It returns `quote_id`, the number of billable `files`, `amount_eur` and `expires_at`.
2. **Ask:** tell the user the exact amount, the number of files and the mode, and ask for explicit confirmation of that amount. An earlier general "go ahead" is not a confirmation of this price.
3. **Run, paid:** only after the user confirms, call `mplus_run_ai_keywording` with `quote_id` and `confirm_charge_eur` equal to `amount_eur`. Only files that succeed are charged; repeating the call returns the same job and never charges twice.
4. **Follow:** `mplus_get_job`, or `mplus_wait_for_events` with `types: ["ai.job.completed", "ai.job.failed"]`. Then show the new metadata and the amount charged, and offer to review it.

If `mplus_run_ai_keywording` is missing or answers `scope_required`, the key has no `ai:run` scope (it is off by default): the user can create a key with it at https://microstock.plus/ai-agent-skills, or start AI keywording in the web interface. An expired quote (`quote_expired`) needs a new quote and a new confirmation.

The complete reference is `${CLAUDE_PLUGIN_ROOT}/docs/AI_AGENT_SKILLS.md`, also published at https://microstock.plus/ai-agent-skills/skill.md.
