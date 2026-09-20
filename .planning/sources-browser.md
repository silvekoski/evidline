# Sources browser and document viewer

Date: 2026-09-20

## Goal

Make the Sources screen work like a file browser (Google Drive pattern) and give each source a document viewer.

## Sources screen

- One primary "New" menu: upload files, record a voice note, copy an upload link, import a tag list.
- A toolbar with a search field, kind and status filters, and a list or grid view switch.
- The six stat cards become one muted summary line with links.
- The attention banner stays. It filters the list with one click.
- The whole content area accepts a file drop and shows an overlay while a file is over it.
- List view: name with a kind icon, kind, date, status, chunks, claims, size, and a row menu. A click on the row opens the viewer.
- Grid view: a card per source. A PDF card shows its first page. Other kinds show the kind icon.
- The recorder logic moves to `use-voice-recorder.ts`. The `VoiceRecorder` component stays for the public upload screen.

## Viewer

- Toolbar: back link, kind icon, title, status, find field, original, external link, run, process again, delete, details switch.
- PDF: thumbnail rail, page image with zoom, page input, keyboard arrows, page text next to the image.
- Transcript: speaker groups with a clock and an initial.
- Rows (CSV, XLSX): a table with the row number.
- Text and email: a reading column with a gutter label.
- Details panel: kind, date, size, pages, hash, processing steps, OCR note, error, claims.
- Find: the matches become the highlight target. Enter moves to the next match and changes the page when needed.
