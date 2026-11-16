# Changelog

## 1.0.0

First public release as **smartVISU Toolkit** (`dasax.smartvisu-toolkit`). Uninstall earlier test versions under other
names; settings (`smartvisu.*`), commands and keyboard shortcuts stay the same.

- **smartVISU guide** in the Explorer: widgets and code blocks with previews, inserted with ➕, Enter or drag & drop
- **Completion** for widgets (Ctrl+Space), parameter values and SmartHomeNG items, with help for every widget and
  parameter, hover with docs, checks for unknown widgets and items, folding for Twig
- Widgets of smartVISU 2.9 – 3.6, custom widgets from dropins and macro files; docs links lead to the documentation
  of your own installation

## 0.3.8

- Docs links go to the documentation that comes with your smartVISU installation (`index.php?pages=docu`) – exactly
  your version, also 3.6 (docu.smartvisu.de ends at 3.5). Used when it can be reached on the network and matches the
  chosen version, otherwise docu.smartvisu.de as before.
- New setting `smartvisu.url` (web address of the installation); empty: derived from the network path
  (`\\server\smartvisu` → `http://server/smartvisu`). `smartvisu.docuUrl` is now empty by default and accepts `{base}`.
- README: intro with the key features, section "In the editor" with a screenshot

## 0.3.7

- License changed from MIT to GPL v3 or later, the same license as smartVISU, whose logo, widget data and
  preview images the extension contains

## 0.3.6

- Folding for Twig: `{% block %}`, `{% if %}` (with `{% else %}`/`{% elseif %}` as separate sections), `{% for %}`,
  `{% macro %}` and the other paired tags, multi-line `{# … #}` comments and `/** … */` docblocks, consecutive
  `{% import %}` lines and widget calls spread over several lines – in addition to the HTML tags VS Code folds itself

## 0.3.5

- New extension ID (previously `dasax.smartvisu-widgets`). Settings (`smartvisu.*`), commands and keyboard shortcuts
  stay the same; uninstall the old extension.

## 0.3.4

- README: own section on the guide with a screenshot and an explanation of what it shows

## 0.3.3

- Icon: smartVISU logo (by Björn Bertschy, from smartVISU, GPL v3); third-party notices in `NOTICE.md`,
  README marks the extension as unofficial

## 0.3.2

- Code blocks (`sv:…`) show a picture of how the block looks with sample content – in the guide tooltip and in the
  suggestion list docs (new tool `tools/generate-block-previews.js`)

## 0.3.1

- Guide: a click only selects an entry; inserting is done with the ➕ button on the entry, Enter or Shift+drag

## 0.3.0

- **smartVISU guide** in the Explorer (below the folder tree): search, frequently used widgets, code blocks by purpose,
  smartVISU widgets by package and custom widgets by file. Hover shows the help, click/Enter inserts at the cursor
  (adds a missing `{% import %}` for custom widgets), Shift+drag drops into the editor, **Ctrl+Shift+Alt+G** focuses it

## 0.2.4

- Suggestion list: **→** opens the full help of the selected entry (widget docs with preview, item details) and focuses it,
  **↑/↓** scroll the help, **←** or **Esc** closes it again (setting `smartvisu.suggestDetailsKeys`)

## 0.2.3

- Parameter hints in two lines: "item — required" and "types: bool, num, str" (plus default); a meaningful description
  follows below. Hovering over a parameter shows the same

## 0.2.2

- Item suggestions are filtered by item type (new setting `smartvisu.items.typeFilter`): by default only the types you
  use for this widget parameter on your pages (e.g. `basic.flip` → only `bool` items), otherwise the types the widget accepts

## 0.2.1

- Preview images also for quad, weather, status, popup and the widgets new in 3.4–3.6 (rendered from the smartVISU 3.6 docs)

## 0.2.0

- Ctrl+Space in a widget parameter also opens the parameter hints above the suggestions
- Widget hover (and docs in the suggestion list) shows a preview image of the widget from the smartVISU docs
- Parameter hints show only the current parameter: name, type, required/optional, default, and below it the
  description (unless it only repeats the type, like "an item"), valid values and range. Hovering over a parameter
  shows the same view; the suggestion list shows only the item details

## 0.1.0

First version.

- Widgets of smartVISU 2.9, 3.0 – 3.6 (from the docblocks of the smartVISU repository, with examples from the docs),
  version detected from the installation or set in `smartvisu.version`; `installed` reads the widgets from the installation
- Custom widgets from `dropins/`, `pages/<pages>/widgets` and `{% import %}`
- Completion for widgets, structure snippets, SmartHomeNG items (from the SmartHomeNG directory, the extension
  *SmartHomeNG Items* or `masteritem.json`), parameter values, IDs, icons, formats, durations, pages and templates
- Learns from the existing pages: usual parameters and values, item endings per widget parameter, templates, header
- Parameter hints, hover with docs and examples, go to widget definition
- Checks: removed/unknown/deprecated widgets, parameter count, items, item types, value lists, ranges, duplicate IDs, imports
- Status bar with version and item count; commands to insert widgets and items via quick pick
