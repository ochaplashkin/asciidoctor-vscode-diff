# AsciiDoc Diff for Visual Studio Code

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.97-007ACC?logo=visualstudiocode&logoColor=white)
![Maintained with AI assistance](https://img.shields.io/badge/maintained%20with-AI%20assistance-blueviolet)

> **This is a fork.** AsciiDoc Diff is a community fork of the
> [AsciiDoc extension for Visual Studio Code](https://github.com/asciidoctor/asciidoctor-vscode)
> by the Asciidoctor project. It is **not** the official extension and is not affiliated with
> the Asciidoctor project.

**Only the rendered diff is developed in this fork.** Everything else — syntax
highlighting, preview, editing helpers, export, diagrams, Antora support, and so on — comes
from the upstream project and is maintained there. If you only need the base AsciiDoc
features, use the official extension instead.

The fork adds a side-by-side comparison of the **rendered output** of two AsciiDoc files:
old document on the left, new document on the right, with changes highlighted in the
result rather than in the source text.

![Side-by-side comparison of two rendered AsciiDoc documents](images/diff.gif)

## What this fork adds

- Rendered comparison with word-, block-, table-, and code-level highlighting.
- Aligned panes, synchronized scrolling, collapsible deletions, and a change summary.
- A **Swap** button to reverse the two sides.
- Live updates while either document is edited or saved.
- A small set of `asciidoc.diff.*` settings.

Everything else is inherited from upstream. See the
[upstream documentation](https://docs.asciidoctor.org/vscode-extension/) for the full
AsciiDoc feature set.

## Installation

From the VS Code Marketplace:

```text
ext install adoc-diff.asciidoc-vscode-diff
```

Or install a `.vsix` file through **Extensions → `…` → Install from VSIX…**.

Marketplace page:
[adoc-diff.asciidoc-vscode-diff](https://marketplace.visualstudio.com/items?itemName=adoc-diff.asciidoc-vscode-diff)

> Do not enable this extension together with the official
> `asciidoctor.asciidoctor-vscode`: both register the same `asciidoc.*` commands and
> settings. Disable or uninstall one of them.

## Comparing two documents

1. In the Explorer, right-click the **old** file and choose
   **AsciiDoc → Select for Comparison**.
2. Right-click the **new** file and choose **AsciiDoc → Compare**.
3. Use **Swap** in the comparison header to reverse the sides.

You can also open an AsciiDoc file and run **AsciiDoc: Compare AsciiDoc Files** from the
Command Palette, then pick the second file. To clear a selection, click the status bar
entry or choose **AsciiDoc → Clear Comparison Selection**.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `asciidoc.diff.align` | `true` | Reserve space for added/removed blocks so the panes stay aligned. |
| `asciidoc.diff.deletedBlocks` | `collapse` | Collapse long deleted blocks into a `−N` strip, or keep them expanded. |
| `asciidoc.diff.codeBlocks` | `line` | Compare code blocks line by line or as a whole block. |
| `asciidoc.diff.collapseLines` | `5` | Threshold for collapsing a deleted block. |
| `asciidoc.diff.showStats` | `true` | Show the `+added −removed ~changed` summary. |

## What comes from upstream

All non-diff functionality — preview, syntax highlighting, outline, completion,
diagnostics, snippets, PDF/HTML/DocBook export, diagrams, Antora, `.asciidoctorconfig`,
and the rest — is inherited from the upstream
[AsciiDoc extension](https://github.com/asciidoctor/asciidoctor-vscode) and is documented
[upstream](https://docs.asciidoctor.org/vscode-extension/). This fork does not change it.

Please report diff-related issues here:
<https://github.com/ochaplashkin/asciidoctor-vscode-diff/issues>

Report issues in upstream features to the
[upstream issue tracker](https://github.com/asciidoctor/asciidoctor-vscode/issues).

## Requirements

- Visual Studio Code **1.97** or newer.
- Desktop or VS Code for the Web.
- Requirements of non-diff features (for example a PDF engine) are described in the
  [upstream documentation](https://docs.asciidoctor.org/vscode-extension/).

## Development

```bash
npm ci --foreground-scripts
npm run build
npm run package
```

Press `F5` in VS Code to start an Extension Development Host. See
[CONTRIBUTING.adoc](CONTRIBUTING.adoc) for details.

## License

MIT. AsciiDoc Diff is based on the
[AsciiDoc extension for VS Code](https://github.com/asciidoctor/asciidoctor-vscode) by
João Pinto, Guillaume Grossetie, and the Asciidoctor contributors. See [LICENSE](LICENSE).
