---
name: mplus-keywording
description: Write and improve stock metadata in Microstock+ - titles, descriptions, keywords, categories, and the AI-generated and editorial flags - to the rules of Adobe Stock, Shutterstock, iStock, Pond5 and other agencies, preview the changes with a dry run, and apply them in batches without overwriting newer edits. Microstock+'s own paid AI keywording is not available through the tools yet, so write the metadata yourself. Use when the user asks for keywords, keywording, titles, descriptions or metadata for stock photos, vectors or videos, wants to fix files that agencies flag or reject, or mentions Microstock+ AI keywording.
---

# Keyword stock files in Microstock+

Use the `microstock-plus` tools. Call `mplus_get_account` first to learn which agencies the user has connected: write for those agencies.

## Workflow

1. **Read.** `mplus_get_file` for one file (it includes its authenticated preview), or `mplus_list_files` with `expand_metadata: true` for a folder (descriptions are left out otherwise). Lists include subfolders by default; follow every `next_cursor` for a whole-portfolio request. Load several images with `mplus_get_previews` in batches of up to 8 IIDs. Use attached image pixels; if a client needs the canonical fallback link, rerun the tool after its five-minute expiry. Note each file's `metaver`, `type`, flags and `agencies.<id>.validation`; do not infer visual facts from filenames alone.
2. **For iStock (`esp` or `qhero`), clarify terms.** Call `mplus_resolve_istock_terms` for at most 10 files. Choose exactly one offered id per keyword by comparing its label with the authenticated preview; never invent an id. Retry `pending` files later and report `unresolved_keywords` honestly. Call `mplus_set_istock_terms` with the same metaver and signed candidate set, first with `dry_run: true`; show the choices and save only after the owner asks.
3. **Write** to the rules below. Describe only what is visible; ask the user about places, dates, species or names you can't confirm.
4. **Preview.** `mplus_update_metadata_batch` with `dry_run: true`, up to 100 items `{iid, patch, if_match_metaver}`. Nothing is written.
5. **Show and ask.** Per file: old and new title, keywords added and removed, validation that remains. Apply only after the user agrees.
6. **Apply.** The same items with `dry_run: false`. For each `metadata_conflict`, re-read the file, merge your change into the current metadata, and retry that item with the new `metaver`; never overwrite blindly.
7. **Report** what changed, with counts. There is no undo button: if the user wants a change reverted, write back the values you read in step 1.

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

**AI-generated content.** Set `ai_generated: true` for anything made with generative AI; Microstock+ then keeps it non-editorial and passes the flag to agencies that have one. Describe what is shown; don't present AI images as photos of real events, places or people, and don't add tool names such as Midjourney as keywords. Some agencies don't accept generative AI content at all, so check the validation and point those agencies out to the user.

**Trademarks and people.** In commercial content keep brands, logos, product names, characters, artworks and real people's names out of titles, descriptions and keywords. Editorial content may name them factually.

**Categories.** At most 3 per file, as `{"cat": <id>, "sub": <id>}` from the Microstock+ category table; leave out `sub` when no subcategory fits. Categories: 1 Abstract, 2 Animals/Wildlife, 3 Backgrounds/Textures, 4 Beauty/Fashion, 5 Buildings/Landmarks, 6 Business/Finance, 7 Celebrities, 8 Education, 9 Food and Drink, 10 Healthcare/Medical, 11 Holidays, 12 Illustrations/Clip-Art, 13 Industrial, 14 Interiors, 15 Miscellaneous, 16 Nature, 17 Objects, 18 Parks/Outdoor, 19 People, 20 Religion, 21 Science, 22 Signs/Symbols, 23 Sports/Recreation, 24 Technology, 25 The Arts, 26 Transportation, 27 Vintage. The subcategory ids are in the "Category ids" table of the complete reference linked at the end; for example `{"cat": 16, "sub": 7}` is Nature, Plants and trees.

**Releases.** They are ids such as `rel_123` that the tools can't list. Copy them from files that already have the right ones, or leave them to the user.

## Microstock+ AI keywording (not available yet)

Microstock+ can write metadata with its own paid AI in My Files, but that is not available through these tools yet: there is no quote or run tool, and the Agent API refuses it (`endpoint_disabled`). Don't offer or promise it, and never say that you started it. Write the metadata yourself with the workflow above; if the user prefers Microstock+'s AI, they can start it in My Files.

The complete reference is `${CLAUDE_PLUGIN_ROOT}/docs/AI_AGENT_SKILLS.md`, also published at https://microstock.plus/ai-agent-skills/skill.md.
