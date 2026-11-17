import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import * as vscode from 'vscode'
import { CompareWithSelectedCommand } from '../commands/compareWithSelected.js'
import {
  COMPARE_SELECTION_CONTEXT_KEY,
  CompareSelection,
} from '../features/diff/compareSelection.js'
import { AsciidocDiffManager } from '../features/diff/diffManager.js'

function fakeManager() {
  const opened: Array<[vscode.Uri, vscode.Uri]> = []
  const manager = {
    open: async (left: vscode.Uri, right: vscode.Uri) => {
      opened.push([left, right])
    },
  } as unknown as AsciidocDiffManager
  return { manager, opened }
}

describe('CompareSelection', () => {
  test('decorates the selected file and only it', () => {
    const selection = new CompareSelection()
    try {
      const selected = vscode.Uri.file('/workspace/old.adoc')
      const other = vscode.Uri.file('/workspace/new.adoc')
      selection.select(selected)
      assert.equal(selection.hasSelection, true)
      assert.equal(selection.selected?.toString(), selected.toString())
      const decoration = selection.provideFileDecoration(selected)
      assert.equal(decoration?.badge, '⇄')
      // The badge uses the blue chart color; VS Code itself grays it out while
      // the Explorer row is selected and focused.
      assert.equal(decoration?.color?.id, 'charts.blue')
      assert.equal(selection.provideFileDecoration(other), undefined)
    } finally {
      selection.dispose()
    }
  })

  test('re-selecting replaces the previous selection', () => {
    const selection = new CompareSelection()
    try {
      const first = vscode.Uri.file('/workspace/a.adoc')
      const second = vscode.Uri.file('/workspace/b.adoc')
      selection.select(first)
      selection.select(second)
      assert.equal(selection.selected?.toString(), second.toString())
      assert.equal(selection.provideFileDecoration(first), undefined)
      assert.equal(selection.provideFileDecoration(second)?.badge, '⇄')
    } finally {
      selection.dispose()
    }
  })

  test('decorates both files of a pair', () => {
    const selection = new CompareSelection()
    try {
      const left = vscode.Uri.file('/workspace/old.adoc')
      const right = vscode.Uri.file('/workspace/new.adoc')
      selection.selectPair(left, right)
      assert.equal(selection.hasSelection, true)
      assert.equal(selection.left?.toString(), left.toString())
      assert.equal(selection.right?.toString(), right.toString())
      assert.equal(selection.pair?.left.toString(), left.toString())
      assert.equal(selection.pair?.right.toString(), right.toString())
      assert.equal(selection.provideFileDecoration(left)?.badge, '⇄')
      assert.equal(selection.provideFileDecoration(right)?.badge, '⇄')
    } finally {
      selection.dispose()
    }
  })

  test('clear removes the decoration', () => {
    const selection = new CompareSelection()
    try {
      const uri = vscode.Uri.file('/workspace/a.adoc')
      selection.select(uri)
      selection.clear()
      assert.equal(selection.hasSelection, false)
      assert.equal(selection.selected, undefined)
      assert.equal(selection.provideFileDecoration(uri), undefined)
    } finally {
      selection.dispose()
    }
  })

  test('exposes the selection state through a context key', () => {
    // The context key gates the Explorer menu items; `setContext` is fire-and-
    // forget, so only assert that the constant stays stable.
    assert.equal(COMPARE_SELECTION_CONTEXT_KEY, 'asciidoc.compare.hasSelection')
  })
})

describe('restoreAfterComparison', () => {
  const left = vscode.Uri.file('/workspace/old.adoc')
  const right = vscode.Uri.file('/workspace/new.adoc')

  test('none clears the selection', () => {
    const selection = new CompareSelection()
    try {
      selection.select(left)
      selection.restoreAfterComparison(left, right, 'none')
      assert.equal(selection.hasSelection, false)
    } finally {
      selection.dispose()
    }
  })

  test('both keeps the pair', () => {
    const selection = new CompareSelection()
    try {
      selection.restoreAfterComparison(left, right, 'both')
      assert.equal(selection.left?.toString(), left.toString())
      assert.equal(selection.right?.toString(), right.toString())
      assert.equal(selection.provideFileDecoration(left)?.badge, '⇄')
      assert.equal(selection.provideFileDecoration(right)?.badge, '⇄')
    } finally {
      selection.dispose()
    }
  })

  test('first keeps only the old side', () => {
    const selection = new CompareSelection()
    try {
      selection.restoreAfterComparison(left, right, 'first')
      assert.equal(selection.selected?.toString(), left.toString())
      assert.equal(selection.right, undefined)
      assert.equal(selection.provideFileDecoration(right), undefined)
    } finally {
      selection.dispose()
    }
  })

  test('second keeps only the new side, used as the next old side', () => {
    const selection = new CompareSelection()
    try {
      selection.restoreAfterComparison(left, right, 'second')
      assert.equal(selection.selected?.toString(), right.toString())
      // A single selection is always consumed as the old/left side, so the kept
      // second file moves into that slot.
      assert.equal(selection.left?.toString(), right.toString())
      assert.equal(selection.right, undefined)
      assert.equal(selection.provideFileDecoration(left), undefined)
      assert.equal(selection.provideFileDecoration(right)?.badge, '⇄')
    } finally {
      selection.dispose()
    }
  })
})

describe('CompareWithSelectedCommand', () => {
  test('opens the comparison with the selected file as the old side', async () => {
    const selection = new CompareSelection()
    try {
      const { manager, opened } = fakeManager()
      const selected = vscode.Uri.file('/workspace/old.adoc')
      const target = vscode.Uri.file('/workspace/new.adoc')
      selection.select(selected)

      const command = new CompareWithSelectedCommand(manager, selection)
      await command.execute(target)

      assert.equal(opened.length, 1)
      assert.equal(opened[0][0].toString(), selected.toString())
      assert.equal(opened[0][1].toString(), target.toString())
      // The selection stays until the comparison panel closes; the close event
      // then applies `asciidoc.diff.preserveSelection`.
      assert.equal(selection.selected?.toString(), selected.toString())
    } finally {
      selection.dispose()
    }
  })

  test('reopens a saved pair from either side', async () => {
    const selection = new CompareSelection()
    try {
      const left = vscode.Uri.file('/workspace/old.adoc')
      const right = vscode.Uri.file('/workspace/new.adoc')
      selection.selectPair(left, right)

      for (const side of [left, right]) {
        const { manager, opened } = fakeManager()
        const command = new CompareWithSelectedCommand(manager, selection)
        await command.execute(side)

        assert.equal(opened.length, 1)
        assert.equal(opened[0][0].toString(), left.toString())
        assert.equal(opened[0][1].toString(), right.toString())
      }
    } finally {
      selection.dispose()
    }
  })

  test('compares a third file with the old side of a saved pair', async () => {
    const selection = new CompareSelection()
    try {
      const { manager, opened } = fakeManager()
      const left = vscode.Uri.file('/workspace/old.adoc')
      const right = vscode.Uri.file('/workspace/new.adoc')
      const third = vscode.Uri.file('/workspace/other.adoc')
      selection.selectPair(left, right)

      const command = new CompareWithSelectedCommand(manager, selection)
      await command.execute(third)

      assert.equal(opened.length, 1)
      assert.equal(opened[0][0].toString(), left.toString())
      assert.equal(opened[0][1].toString(), third.toString())
    } finally {
      selection.dispose()
    }
  })

  test('uses a kept second side as the old side', async () => {
    const selection = new CompareSelection()
    try {
      const { manager, opened } = fakeManager()
      const left = vscode.Uri.file('/workspace/old.adoc')
      const right = vscode.Uri.file('/workspace/new.adoc')
      const third = vscode.Uri.file('/workspace/other.adoc')
      selection.restoreAfterComparison(left, right, 'second')

      const command = new CompareWithSelectedCommand(manager, selection)
      await command.execute(third)

      assert.equal(opened.length, 1)
      assert.equal(opened[0][0].toString(), right.toString())
      assert.equal(opened[0][1].toString(), third.toString())
    } finally {
      selection.dispose()
    }
  })

  test('refuses to compare the selected file with itself', async () => {
    const selection = new CompareSelection()
    try {
      const { manager, opened } = fakeManager()
      const selected = vscode.Uri.file('/workspace/old.adoc')
      selection.select(selected)

      const command = new CompareWithSelectedCommand(manager, selection)
      await command.execute(selected)

      assert.equal(opened.length, 0)
      // The selection is kept so the user can pick another file.
      assert.equal(selection.hasSelection, true)
    } finally {
      selection.dispose()
    }
  })

  test('does nothing without a selection', async () => {
    const selection = new CompareSelection()
    try {
      const { manager, opened } = fakeManager()
      const command = new CompareWithSelectedCommand(manager, selection)
      await command.execute(vscode.Uri.file('/workspace/new.adoc'))
      assert.equal(opened.length, 0)
    } finally {
      selection.dispose()
    }
  })
})
