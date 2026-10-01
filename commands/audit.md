---
description: Audit a Microstock+ folder for missing or weak titles, descriptions and keywords, without changing anything
argument-hint: <folder path, e.g. /foto/2026> [agency ids]
---

Audit the metadata of this Microstock+ folder and change nothing: $ARGUMENTS

Follow the `mplus-portfolio-management` skill:

1. Call `mplus_get_account` for the connected agencies. If no folder was given, list folders with `mplus_list_folders` and ask which one to audit. If agency ids were given, audit only those agencies.
2. With `mplus_list_files` on the folder, `recursive: true`, paging through `next_cursor`, count the files with a missing title, description or keywords, the files with fewer than 7 keywords, and the files that are `notready` on each audited agency.
3. Read the worst files with `mplus_get_file` to see their validation messages.
4. Report a short table of problems with file counts, then the worst files (name, iid, what is wrong), and the fixes you propose. Offer to write the missing metadata with `/microstock-plus:keywords`, but don't change anything now.
