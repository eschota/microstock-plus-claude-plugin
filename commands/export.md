---
description: Export Microstock+ metadata as a CSV file for stock agency upload forms or Excel
argument-hint: <folder path or iids> [default|with_title|importable|with_release_names|without_categories|nimia|alamy] [comma|semicolon]
---

Export this Microstock+ metadata as CSV: $ARGUMENTS

Follow the export section of the `mplus-portfolio-management` skill:

1. If no format was given, choose it from the user's purpose and say which one you chose: `default` for agency upload forms, `with_title` when titles are needed, `importable` to re-import into Microstock+, `nimia` or `alamy` for those templates. Use `semicolon` only for Excel. If no folder or iids were given, ask.
2. Call `mplus_export_csv` with `include_csv: true` and the folder (with `recursive: true` if subfolders count) or the iids. One export holds at most 500 files; split bigger sets by subfolder.
3. If you can write files, save the CSV text unchanged to a file named after the folder and format, for example `foto-2026-with_title.csv`, in the current directory unless the user named another path. Tell the user the path and the number of rows.
4. If the CSV was too large to return inline, export smaller parts. Mention that the `download_url` works with the agent key until `expires_at`.
