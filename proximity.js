import Meta from 'gi://Meta'
import Mtk from 'gi://Mtk'

import * as Main from 'resource:///org/gnome/shell/ui/main.js'

import * as Utils from './utils.js'

const MIN_UPDATE_MS = 200
const T1 = 'limitUpdateTimeout'

class ProximityRectWatch {
  constructor(rect, monitorIndex, xThreshold, yThreshold, handler) {
    this.rect = rect
    this.monitorIndex = monitorIndex
    this.overlap = false
    this.threshold = [xThreshold, yThreshold]
    this.handler = handler
  }

  destroy() { }
}

export const ProximityManager = class {
  constructor() {
    this._counter = 1
    this._watches = {}
    this._focusedWindowInfo = null

    this._timeoutsHandler = new Utils.TimeoutsHandler()

    this._bindSignals()
    this._setFocusedWindow()
  }

  createWatch(watched, monitorIndex, xThreshold, yThreshold, handler) {
    let watch = new ProximityRectWatch(
      watched,
      monitorIndex,
      xThreshold,
      yThreshold,
      handler,
    )

    this._watches[this._counter] = watch
    this.update()

    return this._counter++
  }

  removeWatch(id) {
    if (this._watches[id]) {
      this._watches[id].destroy()
      delete this._watches[id]
    }
  }

  update() {
    this._queueUpdate(true)
  }

  destroy() {
    global.window_manager.disconnectObject(this)
    Main.overview.disconnectObject(this)
    global.display.disconnectObject(this)

    this._timeoutsHandler.destroy()
    this._disconnectFocusedWindow()
    Object.keys(this._watches).forEach((id) => this.removeWatch(id))
  }

  _bindSignals() {
    global.window_manager.connectObject('switch-workspace', () => this._queueUpdate(), this)
    Main.overview.connectObject('hidden', () => this._queueUpdate(), this)
    global.display.connectObject(
      'notify::focus-window',
      () => {
        this._setFocusedWindow()
        this._queueUpdate()
      },
      'restacked', () => this._queueUpdate(),
      this
    )
  }

  _setFocusedWindow() {
    this._disconnectFocusedWindow()

    let focusedWindow = global.display.focus_window

    if (focusedWindow) {
      let focusedWindowInfo = this._getFocusedWindowInfo(focusedWindow)

      if (
        focusedWindowInfo &&
        this._checkIfHandledWindowType(focusedWindowInfo.metaWindow)
      ) {
        focusedWindowInfo.window.connectObject(
          'notify::allocation', () => this._queueUpdate(),
          'destroy', () => this._disconnectFocusedWindow(),
          this
        )
        focusedWindowInfo.metaWindow.connectObject(
          'position-changed', () => this._queueUpdate(),
          'size-changed', () => this._queueUpdate(),
          this
        )

        this._focusedWindowInfo = focusedWindowInfo
      }
    }
  }

  _getFocusedWindowInfo(focusedWindow) {
    let window = focusedWindow.get_compositor_private()
    let focusedWindowInfo

    if (window) {
      focusedWindowInfo = { window: window }
      focusedWindowInfo.metaWindow = focusedWindow

      if (focusedWindow.is_attached_dialog()) {
        let mainMetaWindow = focusedWindow.get_transient_for()

        if (
          focusedWindowInfo.metaWindow.get_frame_rect().height <
          mainMetaWindow.get_frame_rect().height
        ) {
          focusedWindowInfo.window = mainMetaWindow.get_compositor_private()
          focusedWindowInfo.metaWindow = mainMetaWindow
        }
      }
    }

    return focusedWindowInfo
  }

  _disconnectFocusedWindow() {
    if (this._focusedWindowInfo) {
      this._focusedWindowInfo.window.disconnectObject(this)
      this._focusedWindowInfo.metaWindow.disconnectObject(this)
      this._focusedWindowInfo = null
    }
  }

  _getHandledWindows() {
    let focusedWindow = global.display.focus_window
    if (!focusedWindow)
      return []

    let info = this._getFocusedWindowInfo(focusedWindow)
    let metaWindow = info ? info.metaWindow : focusedWindow

    if (this._checkIfHandledWindow(metaWindow))
      return [metaWindow]

    return []
  }

  _checkIfHandledWindow(metaWindow) {
    return (
      metaWindow &&
      !metaWindow.minimized &&
      !metaWindow.customJS_ding &&
      this._checkIfHandledWindowType(metaWindow)
    )
  }

  _checkIfHandledWindowType(metaWindow) {
    let metaWindowType = metaWindow.get_window_type()

    return (
      metaWindowType <= Meta.WindowType.SPLASHSCREEN &&
      metaWindowType != Meta.WindowType.DESKTOP
    )
  }

  _queueUpdate(noDelay) {
    if (!noDelay && this._timeoutsHandler.getId(T1)) {
      this._pendingUpdate = true
      return
    }

    this._timeoutsHandler.add([T1, MIN_UPDATE_MS, () => this._endLimitUpdate()])

    let metaWindows = this._getHandledWindows()

    Object.keys(this._watches).forEach((id) => {
      let watch = this._watches[id]
      let overlap = metaWindows.some((mw) => this._checkProximity(mw, watch))

      if (overlap !== watch.overlap) {
        watch.handler(overlap)
        watch.overlap = overlap
      }
    })
  }

  _endLimitUpdate() {
    if (this._pendingUpdate) {
      this._pendingUpdate = false
      this._queueUpdate()
    }
  }

  _checkProximity(metaWindow, watch) {
    let windowRect = metaWindow.get_frame_rect()

    return (
      windowRect.overlap(watch.rect) &&
      ((!watch.threshold[0] && !watch.threshold[1]) ||
        metaWindow.get_monitor() == watch.monitorIndex ||
        windowRect.overlap(
          global.display.get_monitor_geometry(watch.monitorIndex),
        ))
    )
  }
}
