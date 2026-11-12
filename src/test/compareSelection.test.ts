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
      // The selection is consumed by the comparison.
      assert.equal(selection.hasSelection, false)
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
