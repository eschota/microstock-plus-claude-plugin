---
description: Write or improve titles, descriptions and keywords of Microstock+ files, with a preview before anything is saved
argument-hint: <folder path or iids> [instructions, e.g. "for Adobe Stock and Shutterstock, at most 40 keywords"]
---

Write or improve the metadata of these Microstock+ files: $ARGUMENTS

Follow the `mplus-keywording` skill:

1. Call `mplus_get_account` for the connected agencies. Find the files: for a folder, `mplus_list_files` with `expand_metadata: true` (subfolders are included by default; follow `next_cursor`); for iids, `mplus_get_file`. Load images through `mplus_get_previews` in batches of up to 8. Note each file's `metaver`. If nothing was given, ask which folder or files to work on.
2. Write titles, descriptions and keywords to the agency rules in the skill and to the user's instructions. Describe only what is visible, and set `ai_generated` for AI-made content.
3. Preview with `mplus_update_metadata_batch` and `dry_run: true`, in batches of at most 100 files. Show the old and new metadata and the validation that remains.
4. Only after the user approves, apply the same items with `dry_run: false`. Resolve each `metadata_conflict` by re-reading the file and merging.
5. Report what changed. Sending files to agencies and Microstock+ AI keywording are not available through the tools yet, so don't offer them; the user sends the files from My Files.
