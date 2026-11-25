import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import * as vscode from 'vscode'
import { createFile, removeFiles } from './workspaceHelper.js'

function tick(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor<T>(
  predicate: () => T | undefined,
  message: string,
  timeout = 4000,
): Promise<T> {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = predicate()
    if (value !== undefined) {
      return value
    }
    if (Date.now() > deadline) {
      throw new Error(message)
    }
    await tick(50)
  }
}

function allTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all.flatMap((group) => group.tabs)
}

function describeTabs(): string {
  return JSON.stringify(
    vscode.window.tabGroups.all.map((group) => ({
      column: group.viewColumn,
      active: group.activeTab?.label,
      tabs: group.tabs.map((tab) => ({
        label: tab.label,
        dirty: tab.isDirty,
        input: tab.input?.constructor?.name,
        viewType:
          tab.input instanceof vscode.TabInputWebview
            ? tab.input.viewType
            : undefined,
        uri:
          tab.input instanceof vscode.TabInputText
            ? tab.input.uri.toString()
            : undefined,
      })),
    })),
  )
}

function findTextTab(resource: vscode.Uri): vscode.Tab | undefined {
  return allTabs().find(
    (tab) =>
      tab.input instanceof vscode.TabInputText &&
      tab.input.uri.toString() === resource.toString(),
  )
}

function findPreviewTabs(label: string): vscode.Tab[] {
  return allTabs().filter(
    (tab) =>
      tab.input instanceof vscode.TabInputWebview &&
      tab.input.viewType.endsWith('asciidoc.preview') &&
      tab.label.includes(label),
  )
}

function findPreviewTab(label: string): vscode.Tab | undefined {
  return findPreviewTabs(label)[0]
}

async function closeTabs(tabs: (vscode.Tab | undefined)[]) {
  for (const tab of tabs) {
    if (tab) {
      await vscode.window.tabGroups.close(tab)
    }
  }
}

async function setOpenInPreview(value: boolean) {
  await vscode.commands.executeCommand(
    value ? 'asciidoc.enableOpenInPreview' : 'asciidoc.disableOpenInPreview',
  )
}

describe('Preview-first mode', () => {
  let resourceA: vscode.Uri
  let resourceB: vscode.Uri
  let nameA: string
  let nameB: string

  before(async () => {
    const stamp = Date.now()
    nameA = `open-in-preview-a-${stamp}.adoc`
    nameB = `open-in-preview-b-${stamp}.adoc`
    resourceA = await createFile('= A\n\nfirst document\n', nameA)
    resourceB = await createFile('= B\n\nsecond document\n', nameB)
  })

  after(async () => {
    await setOpenInPreview(false)
    await closeTabs([
      ...findPreviewTabs(nameA),
      ...findPreviewTabs(nameB),
      findTextTab(resourceA),
      findTextTab(resourceB),
    ])
    await removeFiles([resourceA, resourceB])
  })

  test('the command toggles asciidoc.preview.openInPreview', async () => {
    await setOpenInPreview(true)
    assert.equal(
      vscode.workspace
        .getConfiguration('asciidoc')
        .get<boolean>('preview.openInPreview'),
      true,
    )

    await setOpenInPreview(false)
    assert.equal(
      vscode.workspace
        .getConfiguration('asciidoc')
        .get<boolean>('preview.openInPreview'),
      false,
    )
  })

  test('opens an AsciiDoc file in the preview and closes its source tab', async () => {
    await setOpenInPreview(true)
    try {
      await vscode.commands.executeCommand('vscode.open', resourceA)

      const preview = await waitFor(
        () => findPreviewTab(nameA),
        `the preview tab was not opened: ${describeTabs()}`,
      )
      await waitFor(
        () => (findTextTab(resourceA) === undefined ? true : undefined),
        'the source tab was not closed',
      )
      assert.ok(preview)
    } finally {
      await setOpenInPreview(false)
      await closeTabs([findPreviewTab(nameA), findTextTab(resourceA)])
    }
  })

  test('opens a second rendered file as a tab of the same group and switches between them', async () => {
    await setOpenInPreview(true)
    try {
      await vscode.commands.executeCommand('vscode.open', resourceA)
      const previewA = await waitFor(
        () => findPreviewTab(nameA),
        `the first preview tab was not opened: ${describeTabs()}`,
      )

      await vscode.commands.executeCommand('vscode.open', resourceB)
      const previewB = await waitFor(
        () => findPreviewTab(nameB),
        `the second preview tab was not opened: ${describeTabs()}`,
      )
      await waitFor(
        () => (findTextTab(resourceB) === undefined ? true : undefined),
        'the second source tab was not closed',
      )

      // Both files are rendered in the same editor group, as separate tabs:
      // neither one replaced the other.
      assert.notEqual(previewA, previewB)
      assert.equal(
        previewA.group.viewColumn,
        previewB.group.viewColumn,
        'both previews must be tabs of the same editor group',
      )
      assert.equal(findPreviewTabs(nameA).length, 1)
      assert.equal(findPreviewTabs(nameB).length, 1)

      // Switch tabs the way the editor does it: the previews are ordinary
      // tabs of the group, so the "Open Editor at Index" commands swap them.
      const groupTabs = previewB.group.tabs
      const indexA = groupTabs.indexOf(previewA) + 1
      const indexB = groupTabs.indexOf(previewB) + 1
      assert.ok(indexA > 0 && indexB > 0)

      await vscode.commands.executeCommand(
        `workbench.action.openEditorAtIndex${indexA}`,
      )
      await waitFor(
        () =>
          vscode.window.tabGroups.activeTabGroup.activeTab?.label.includes(
            nameA,
          )
            ? true
            : undefined,
        `the first preview tab was not activated: ${describeTabs()}`,
      )

      await vscode.commands.executeCommand(
        `workbench.action.openEditorAtIndex${indexB}`,
      )
      await waitFor(
        () =>
          vscode.window.tabGroups.activeTabGroup.activeTab?.label.includes(
            nameB,
          )
            ? true
            : undefined,
        `the second preview tab was not activated: ${describeTabs()}`,
      )
    } finally {
      await setOpenInPreview(false)
      await closeTabs([
        ...findPreviewTabs(nameA),
        ...findPreviewTabs(nameB),
        findTextTab(resourceA),
        findTextTab(resourceB),
      ])
    }
  })

  test('keeps the source tab when the setting is disabled', async () => {
    await setOpenInPreview(false)
    try {
      await vscode.commands.executeCommand('vscode.open', resourceB)

      await waitFor(
        () => findTextTab(resourceB),
        'the source tab was not opened',
      )
      // Give a potential (wrong) redirect the chance to happen.
      await tick(500)
      assert.equal(findPreviewTab(nameB), undefined)
    } finally {
      await closeTabs([findTextTab(resourceB), findPreviewTab(nameB)])
    }
  })

  test('keeps rendered files in one panel when the source panel is open, and reuses it', async () => {
    await setOpenInPreview(true)
    try {
      await vscode.commands.executeCommand('vscode.open', resourceA)
      await waitFor(
        () => findPreviewTab(nameA),
        `the preview tab was not opened: ${describeTabs()}`,
      )
      await waitFor(
        () => (findTextTab(resourceA) === undefined ? true : undefined),
        'the source tab was not closed',
      )

      await vscode.commands.executeCommand('asciidoc.viewSource', resourceA)
      const sourceA = await waitFor(
        () => findTextTab(resourceA),
        'the first source editor was not opened',
      )
      const previewA = findPreviewTab(nameA)
      assert.ok(previewA)

      // Open a second file while the first source editor is active: its source
      // tab is created in the source panel, but the rendered tab must still
      // join the existing preview panel.
      await vscode.commands.executeCommand('vscode.open', resourceB)
      const previewB = await waitFor(
        () => findPreviewTab(nameB),
        `the second preview tab was not opened: ${describeTabs()}`,
      )
      await waitFor(
        () => (findTextTab(resourceB) === undefined ? true : undefined),
        'the second source tab was not closed',
      )
      assert.equal(
        previewB.group.viewColumn,
        previewA.group.viewColumn,
        'both rendered files must stay in the same panel',
      )
      assert.ok(findTextTab(resourceA), 'the first source tab must stay open')

      // The source of the second file joins the source panel created for the
      // first one, instead of opening a third editor group.
      await vscode.commands.executeCommand('asciidoc.viewSource', resourceB)
      const sourceB = await waitFor(
        () => findTextTab(resourceB),
        'the second source editor was not opened',
      )
      assert.equal(
        sourceB.group.viewColumn,
        sourceA.group.viewColumn,
        'the sources must share one panel',
      )
      assert.ok(
        sourceB.group.viewColumn < previewB.group.viewColumn,
        'the source panel must stay to the left of the previews',
      )
    } finally {
      await setOpenInPreview(false)
      await closeTabs([
        ...findPreviewTabs(nameA),
        ...findPreviewTabs(nameB),
        findTextTab(resourceA),
        findTextTab(resourceB),
      ])
    }
  })

  test('View Source Code opens the source to the left of the preview', async () => {
    await setOpenInPreview(true)
    try {
      await vscode.commands.executeCommand('vscode.open', resourceA)
      await waitFor(
        () => findPreviewTab(nameA),
        `the preview tab was not opened: ${describeTabs()}`,
      )
      await waitFor(
        () => (findTextTab(resourceA) === undefined ? true : undefined),
        'the source tab was not closed',
      )

      await vscode.commands.executeCommand('asciidoc.viewSource', resourceA)

      await waitFor(
        () => findTextTab(resourceA),
        'the source editor was not opened',
      )
      const preview = findPreviewTab(nameA)
      const source = findTextTab(resourceA)
      assert.ok(preview, 'the preview tab must stay open')
      assert.ok(source)
      assert.ok(
        source.group.viewColumn < preview.group.viewColumn,
        `the source must open to the left of the preview (source ${source.group.viewColumn}, preview ${preview.group.viewColumn})`,
      )
    } finally {
      await setOpenInPreview(false)
      await closeTabs([findTextTab(resourceA), findPreviewTab(nameA)])
    }
  })
})
