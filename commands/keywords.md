---
description: Write or improve titles, descriptions and keywords of Microstock+ files, with a preview before anything is saved
argument-hint: <folder path or iids> [instructions, e.g. "for Adobe Stock and Shutterstock, at most 40 keywords"]
---

Write or improve the metadata of these Microstock+ files: $ARGUMENTS

Follow the `mplus-keywording` skill:

1. Call `mplus_get_account` for the connected agencies. Find the files: for a folder, `mplus_list_files` with `expand_metadata: true` (subfolders are included by default; follow `next_cursor`); for iids, `mplus_get_file`. Load images through `mplus_get_previews` in batches of up to 8. Note each file's `metaver`. If nothing was given, ask which folder or files to work on.
2. Follow the skill's canonical stock metadata system prompt. Inspect every preview. Write a natural title of at most 70 characters, an accurate media-specific description, and exactly 50 unique relevant English master keywords with the strongest 10 first. Never invent action, emotion or filler; if 50 truthful terms are impossible, report the file as blocked. Set `ai_generated: true`, `editorial: false` for generative content.
3. Preview with `mplus_update_metadata_batch` and `dry_run: true`, in batches of at most 100 files. Show the old and new metadata and the validation that remains.
4. Apply the same items with `dry_run: false` when this metadata edit is authorized; do not ask again when the conversation already contains that authorization. Resolve each `metadata_conflict` by re-reading the file and merging.
5. Freshly read every changed file. Confirm the persisted metadata and fresh validation. For every connected eligible agency, set `ready` only when its current status is mutable and pre-submission and fresh validation is clean; preserve all ignored/held, queue/progress, review, failure and terminal states. Report exact blockers. Ready is not submission, and metadata authorization never authorizes `queued`.
