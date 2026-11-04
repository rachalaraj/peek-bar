import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as WorkspacesView from 'resource:///org/gnome/shell/ui/workspacesView.js'
import { InjectionManager } from 'resource:///org/gnome/shell/extensions/extension.js'

import { Hold, Intellihide } from './intellihide.js'

const PANEL_BOX_NAME = 'panelBox'

export const IntellihideManager = class {
  constructor(proximityManager) {
    this._proximityManager = proximityManager
    this._secondaries = new Map()
    this._injectionManager = new InjectionManager()
    this._enabled = false
  }

  enable() {
    if (this._enabled) return
    this._enabled = true

    this._primary = this._createIntellihide(Main.layoutManager.panelBox)
    this._primary.enable()

    this._overrideOverviewLayout()

    global.display.connectObject(
      'workareas-changed', () => this._adoptSecondaryPanels(),
      this
    )
    Main.layoutManager.connectObject(
      'monitors-changed', () => this._removeSecondaryPanels(),
      this
    )

    this._adoptSecondaryPanels()
  }

  disable() {
    if (!this._enabled) return
    this._enabled = false

    global.display.disconnectObject(this)
    Main.layoutManager.disconnectObject(this)

    this._removeSecondaryPanels()

    this._primary.destroy()
    this._primary = null

    this._injectionManager.clear()
  }

  destroy() {
    this.disable()
    this.onStateChanged = null
  }

  isEnabled() {
    return this._enabled
  }

  isHeld() {
    return this._primary?.isHeld() ?? false
  }

  toggleExtension() {
    if (this._enabled)
      this.disable()
    else
      this.enable()
    this.onStateChanged?.()
  }

  toggle() {
    if (!this._enabled) return

    let held = this.isHeld()

    for (let intellihide of this._all()) {
      if (held)
        intellihide.release(Hold.PERMANENT)
      else
        intellihide.revealAndHold(Hold.PERMANENT)
    }
    this.onStateChanged?.()
  }

  _all() {
    return [this._primary, ...this._secondaries.values()]
  }

  _createIntellihide(panelBox) {
    let intellihide = new Intellihide(this._proximityManager, panelBox)
    intellihide.onStateChanged = () => this.onStateChanged?.()
    return intellihide
  }

  _findSecondaryPanelBoxes() {
    let layoutManager = Main.layoutManager

    return layoutManager._trackedActors
      .map((actorData) => actorData.actor)
      .filter((actor) =>
        actor !== layoutManager.panelBox &&
        actor.get_name() === PANEL_BOX_NAME &&
        layoutManager.findMonitorForActor(actor)?.index !== layoutManager.primaryIndex
      )
  }

  _adoptSecondaryPanels() {
    for (let panelBox of this._findSecondaryPanelBoxes()) {
      if (this._secondaries.has(panelBox))
        continue

      let intellihide = this._createIntellihide(panelBox)
      this._secondaries.set(panelBox, intellihide)

      panelBox.connectObject(
        'destroy', () => this._removeSecondaryPanel(panelBox, true),
        this
      )

      intellihide.enable()

      if (this.isHeld() && !intellihide.isHeld())
        intellihide.revealAndHold(Hold.PERMANENT, true)
    }
  }

  _removeSecondaryPanel(panelBox, actorGone = false) {
    let intellihide = this._secondaries.get(panelBox)
    if (!intellihide) return

    this._secondaries.delete(panelBox)
    panelBox.disconnectObject(this)
    intellihide.destroy(actorGone)
  }

  _removeSecondaryPanels() {
    for (let panelBox of [...this._secondaries.keys()])
      this._removeSecondaryPanel(panelBox)
  }

  _getPanelHeightForMonitor(monitorIndex) {
    for (let [panelBox, intellihide] of this._secondaries) {
      if (intellihide.monitorIndex === monitorIndex)
        return panelBox.height
    }
    return 0
  }

  _overrideOverviewLayout() {
    let overviewControls = Main.overview._overview._controls
    this._injectionManager.overrideMethod(
      Object.getPrototypeOf(overviewControls),
      'vfunc_allocate',
      (originalAllocate) => (box) => {
        if (overviewControls._stateAdjustment) {
          let scale = Math.min(overviewControls._stateAdjustment.value, 1)
          let offset = Main.layoutManager.panelBox.height * scale
          box.y1 += offset
          originalAllocate.call(overviewControls, box)
          box.y1 -= offset
        } else {
          originalAllocate.call(overviewControls, box)
        }
      }
    )

    let manager = this
    this._injectionManager.overrideMethod(
      WorkspacesView.SecondaryMonitorDisplay.prototype,
      'vfunc_allocate',
      (originalAllocate) => function (box) {
        let panelHeight = manager._getPanelHeightForMonitor(this._monitorIndex)
        let scale = Math.min(this._overviewAdjustment?.value ?? 0, 1)
        let offset = panelHeight * scale
        box.y1 += offset
        originalAllocate.call(this, box)
        box.y1 -= offset
      }
    )
  }
}
