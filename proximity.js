import Meta from 'gi://Meta'
import Mtk from 'gi://Mtk'

import * as Main from 'resource:///org/gnome/shell/ui/main.js'

import * as Utils from './utils.js'

//timeout intervals
const MIN_UPDATE_MS = 200

//timeout names
const T1 = 'limitUpdateTimeout'

export const Mode = {
  ALL_WINDOWS: 0,
  FOCUSED_WINDOWS: 1,
}

class ProximityRectWatch {
  constructor(rect, monitorIndex, mode, xThreshold, yThreshold, handler) {
    this.rect = rect
    this.monitorIndex = monitorIndex
    this.overlap = false
    this.mode = mode
    this.threshold = [xThreshold, yThreshold]
    this.handler = handler
  }

  destroy() { }
}

class ProximityActorWatch extends ProximityRectWatch {
  constructor(actor, monitorIndex, mode, xThreshold, yThreshold, handler) {
    super(null, monitorIndex, mode, xThreshold, yThreshold, handler)
    this.actor = actor

    this.actor.connectObject('notify::allocation', () =>
      this._updateWatchRect(),
      this
    )

    this._updateWatchRect()
  }

  destroy() {
    this.actor.disconnectObject(this)
  }

  _updateWatchRect() {
    let [actorX, actorY] = this.actor.get_position()

    this.rect = new Mtk.Rectangle({
      x: actorX - this.threshold[0],
      y: actorY - this.threshold[1],
      width: this.actor.width + this.threshold[0] * 2,
      height: this.actor.height + this.threshold[1] * 2,
    })
  }
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

  createWatch(watched, monitorIndex, mode, xThreshold, yThreshold, handler) {
    let constr =
      watched instanceof Mtk.Rectangle
        ? ProximityRectWatch
        : ProximityActorWatch

    let watch = new constr(
      watched,
      monitorIndex,
      mode,
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
          'destroy', () => this._disconnectFocusedWindow(true),
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

  _disconnectFocusedWindow(destroy) {
    // !destroy safely prevents manually calling disconnectObject on a window that is actively finalizing/dead
    if (this._focusedWindowInfo && !destroy) {
      this._focusedWindowInfo.window.disconnectObject(this)
    }

    this._focusedWindowInfo = null
  }

  _getHandledWindows() {
    return Utils.getCurrentWorkspace()
      .list_windows()
      .filter((mw) => this._checkIfHandledWindow(mw))
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

    //https://www.roojs.org/seed/gir-1.2-gtk-3.0/seed/Meta.WindowType.html
    return (
      metaWindowType <= Meta.WindowType.SPLASHSCREEN &&
      metaWindowType != Meta.WindowType.DESKTOP
    )
  }

  _queueUpdate(noDelay) {
    if (!noDelay && this._timeoutsHandler.getId(T1)) {
      //limit the number of updates
      this._pendingUpdate = true
      return
    }

    this._timeoutsHandler.add([T1, MIN_UPDATE_MS, () => this._endLimitUpdate()])

    let metaWindows = this._getHandledWindows()

    Object.keys(this._watches).forEach((id) => {
      let watch = this._watches[id]
      let overlap = !!this._update(watch, metaWindows)

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

  _update(watch, metaWindows) {
    // Force ALL_WINDOWS mode as requested
    return metaWindows.some((mw) => this._checkProximity(mw, watch))
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
