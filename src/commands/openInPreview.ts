import { Command } from '../core/commandManager.js'
import { PreviewOnOpenManager } from '../features/preview/openInPreview.js'

export class EnableOpenInPreviewCommand implements Command {
  public readonly id = 'asciidoc.enableOpenInPreview'

  public constructor(private readonly manager: PreviewOnOpenManager) {}

  public execute() {
    return this.manager.setEnabled(true)
  }
}

export class DisableOpenInPreviewCommand implements Command {
  public readonly id = 'asciidoc.disableOpenInPreview'

  public constructor(private readonly manager: PreviewOnOpenManager) {}

  public execute() {
    return this.manager.setEnabled(false)
  }
}
