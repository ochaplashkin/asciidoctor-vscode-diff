/**
 * Human-readable names of the two compared files.
 *
 * The main scenario is comparing two versions of the same document, so both
 * sides are almost always named `index.adoc`: `OLD index.adoc` / `NEW index.adoc`
 * does not tell which version is which. When the basenames collide, the parent
 * directory is added (`v1/index.adoc`, `v2/index.adoc`); the full path stays
 * available for the tooltip.
 *
 * This module only uses `node:path`, like the rest of the extension host; it is
 * pure so it can be unit tested.
 */

import * as path from 'node:path'

export interface DiffTitles {
  /** Short label of the old side. */
  readonly left: string
  /** Short label of the new side. */
  readonly right: string
  /** Full path of the old side, for the tooltip. */
  readonly leftFullPath: string
  /** Full path of the new side, for the tooltip. */
  readonly rightFullPath: string
}

export function diffTitles(leftPath: string, rightPath: string): DiffTitles {
  const leftBase = path.basename(leftPath)
  const rightBase = path.basename(rightPath)
  if (leftBase !== rightBase) {
    return {
      left: leftBase,
      right: rightBase,
      leftFullPath: leftPath,
      rightFullPath: rightPath,
    }
  }
  const leftParent = path.basename(path.dirname(leftPath))
  const rightParent = path.basename(path.dirname(rightPath))
  if (leftParent !== rightParent) {
    return {
      left: joinLabel(leftParent, leftBase),
      right: joinLabel(rightParent, rightBase),
      leftFullPath: leftPath,
      rightFullPath: rightPath,
    }
  }
  // Same file name in directories that are named the same too: two parent names
  // cannot disambiguate them, so fall back to the full paths.
  return {
    left: leftPath,
    right: rightPath,
    leftFullPath: leftPath,
    rightFullPath: rightPath,
  }
}

function joinLabel(parent: string, base: string): string {
  return parent !== '' ? `${parent}/${base}` : base
}
