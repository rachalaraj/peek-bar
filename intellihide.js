import Clutter from 'gi://Clutter'
import GLib from 'gi://GLib'
import Meta from 'gi://Meta'
import Mtk from 'gi://Mtk'
import Shell from 'gi://Shell'
import St from 'gi://St'

import * as Layout from 'resource:///org/gnome/shell/ui/layout.js'
import { InjectionManager } from 'resource:///org/gnome/shell/extensions/extension.js'

import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as PointerWatcher from 'resource:///org/gnome/shell/ui/pointerWatcher.js'

import * as Utils from './utils.js'

let SETTINGS;

export const setSettings = (settings) => {
  SETTINGS = settings;
};

const CHECK_POINTER_MS = 200
const CHECK_GRAB_MS = 400
const POST_ANIMATE_MS = 50
const MIN_UPDATE_MS = 250
const HOVER_OUT_MS = 250

const T1 = 'checkGrabTimeout'
const T2 = 'limitUpdateTimeout'
const T3 = 'postAnimateTimeout'
const T4 = 'enableStartTimeout'
const T5 = 'hoverOutTimeout'
const T7 = 'notifyTimeout'

export const Hold = {
  NONE: 0,
  PERMANENT: 2,
  NOTIFY_PEEK: 32,
}



export const Intellihide = class {
  constructor(proximityManager) {
    this._panelBox = Main.layoutManager.panelBox
    this._proximityManager = proximityManager
    this._holdStatus = Hold.NONE
    this._enabled = false

    this._timeoutsHandler = new Utils.TimeoutsHandler()
    this._injectionManager = new InjectionManager()
  }

  init() {
    this.enable()
  }

  enable() {
    if (this._enabled) return
    this._enabled = true

    if (!this._timeoutsHandler)
      this._timeoutsHandler = new Utils.TimeoutsHandler()

    this._overviewVisible = Main.overview.visible || false
    this._monitor = Main.layoutManager.primaryMonitor
    this._panelHeight = this._panelBox.get_height() || 27
    this._animationDestination = -1
    this._pendingUpdate = false
    this._hover = false
    this._hoveredOut = false
    this._windowOverlap = false
    this._fullscreenIdleId = 0
    this._startupMappedId = 0

    this._panelBox.translation_y = 0
    this._panelBox.translation_x = 0

    this._setTrackPanel(true)
    this._bindGeneralSignals()

    let overviewControls = Main.overview._overview._controls
    this._injectionManager.overrideMethod(
      Object.getPrototypeOf(overviewControls),
      'vfunc_allocate',
      (originalAllocate) => (box) => {
        if (overviewControls._stateAdjustment) {
          let scale = Math.min(overviewControls._stateAdjustment.value, 1)
          let offset = Main.layoutManager.panelBox.height * scale
          box.y1 += offset
          try {
            originalAllocate.call(overviewControls, box)
          } finally {
            box.y1 -= offset
          }
        } else {
          originalAllocate.call(overviewControls, box)
        }
      }
    )

    if (this._hidesFromWindows()) {
      let watched = new Mtk.Rectangle({
        x: this._monitor.x,
        y: this._monitor.y,
        width: this._monitor.width,
        height: this._panelHeight,
      })

      this._proximityWatchId = this._proximityManager.createWatch(
        watched,
        this._monitor.index,
        0,
        0,
        (overlap) => {
          this._windowOverlap = overlap
          this._queueUpdatePanelPosition()
        },
      )
    }

    if (SETTINGS.get_boolean('intellihide-use-pointer'))
      this._setRevealMechanism()

    if (SETTINGS.get_boolean('intellihide-notify-reveal'))
      this._connectNotifications()

    let lastState = SETTINGS.get_int('intellihide-persisted-state')

    if (lastState > -1) {
      this._holdStatus = lastState

      if (lastState == Hold.NONE && Main.layoutManager._startingUp) {
        this._startupMappedId = this._panelBox.connect('notify::mapped', () => {
          if (this._startupMappedId) {
            this._panelBox.disconnect(this._startupMappedId)
            this._startupMappedId = 0
          }
          let immediate = !SETTINGS.get_boolean('intellihide-startup-animation')
          this._hidePanel(immediate)
        })
      } else this._queueUpdatePanelPosition()
    } else
      this._timeoutsHandler.add([
        T4,
        SETTINGS.get_int('intellihide-enable-start-delay'),
        () => this._queueUpdatePanelPosition(),
      ])
  }

  disable(reset) {
    if (!this._enabled) return
    this._enabled = false

    this._hover = false

    if (this._proximityWatchId) {
      this._proximityManager.removeWatch(this._proximityWatchId)
      this._proximityWatchId = 0
    }

    this._setTrackPanel(false)
    this._removeRevealMechanism()
    this._disconnectNotifications()

    if (this._fullscreenIdleId) {
      GLib.Source.remove(this._fullscreenIdleId)
      this._fullscreenIdleId = 0
    }

    if (this._startupMappedId) {
      this._panelBox.disconnect(this._startupMappedId)
      this._startupMappedId = 0
    }

    this._revealPanel(!reset)
    Utils.setDisplayUnredirect(true)

    SETTINGS.disconnectObject(this)
    Main.overview.disconnectObject(this)
    Main.layoutManager.disconnectObject(this)
    global.display.disconnectObject(this)
    this._panelBox.disconnectObject(this)

    if (this._timeoutsHandler) {
      this._timeoutsHandler.destroy()
      this._timeoutsHandler = null
    }
    this._injectionManager.clear()
  }

  destroy() {
    this.disable()
  }

  toggleExtension() {
    if (this._enabled)
      this.disable()
    else
      this.enable()
    this.onStateChanged?.()
  }

  toggle() {
    this[this._holdStatus & Hold.PERMANENT ? 'release' : 'revealAndHold'](
      Hold.PERMANENT,
    )
    this.onStateChanged?.()
  }

  revealAndHold(holdStatus, immediate) {
    this._revealPanel(immediate)

    this._holdStatus |= holdStatus

    this._maybePersistHoldStatus()
    this.onStateChanged?.()
  }

  release(holdStatus) {
    this._holdStatus &= ~holdStatus

    if (!this._holdStatus) {
      this._maybePersistHoldStatus()
      this._queueUpdatePanelPosition()
    }
    this.onStateChanged?.()
  }

  reset() {
    this.disable(true)
    this.enable()
  }

  _hidesFromWindows() {
    return SETTINGS.get_boolean('intellihide-hide-from-windows')
  }

  _maybePersistHoldStatus() {
    if (SETTINGS.get_int('intellihide-persisted-state') > -1)
      SETTINGS.set_int(
        'intellihide-persisted-state',
        this._holdStatus & Hold.PERMANENT ? Hold.PERMANENT : Hold.NONE,
      )
  }

  _bindGeneralSignals() {
    SETTINGS.connectObject(
      'changed::intellihide-use-pointer', () => this.reset(),
      'changed::intellihide-use-pressure', () => this.reset(),
      'changed::intellihide-hide-from-windows', () => this.reset(),
      'changed::intellihide-pressure-threshold', () => this.reset(),
      'changed::intellihide-pressure-time', () => this.reset(),
      'changed::intellihide-notify-reveal', () => this.reset(),
      this
    )

    Main.overview.connectObject(
      'showing', () => {
        this._overviewVisible = true
        if (this._checkIfShouldBeVisible())
          this._revealPanel(false, true)
      },
      'hiding', () => {
        this._overviewVisible = false
        if (this._checkIfShouldBeVisible())
          this._revealPanel()
        else
          this._hidePanel(false, true)
      },
      this
    )

    this._panelBox.connectObject(
      'notify::visible', () => Utils.setDisplayUnredirect(!this._panelBox.visible),
      this
    )

    global.display.connectObject(
      'in-fullscreen-changed', () => {
        if (this._fullscreenIdleId)
          GLib.Source.remove(this._fullscreenIdleId)
        this._fullscreenIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
          this._fullscreenIdleId = 0
          this._queueUpdatePanelPosition()
          return GLib.SOURCE_REMOVE
        })
      },
      this
    )

    Main.layoutManager.connectObject(
      'monitors-changed', () => this.reset(),
      this
    )
  }

  _connectNotifications() {
    if (!Main.messageTray) return

    Main.messageTray.connectObject(
      'source-added', (_tray, source) => {
        this._onNotification()
        if (source) {
          try {
            source.connectObject('notification-added', () => this._onNotification(), this)
          } catch (_) {}
        }
      },
      this
    )

    if (Main.messageTray.getSources) {
      try {
        let sources = Main.messageTray.getSources()
        sources.forEach(source => {
          source.connectObject('notification-added', () => this._onNotification(), this)
        })
      } catch (_) {}
    }
  }

  _disconnectNotifications() {
    if (Main.messageTray) {
      Main.messageTray.disconnectObject(this)
      if (Main.messageTray.getSources) {
        try {
          let sources = Main.messageTray.getSources()
          sources.forEach(source => source.disconnectObject(this))
        } catch (_) {}
      }
    }
  }

  _onNotification() {
    if (!SETTINGS.get_boolean('intellihide-notify-reveal')) return

    if (this._holdStatus & Hold.NOTIFY_PEEK) {
      this._timeoutsHandler.remove(T7)
    } else {
      this.revealAndHold(Hold.NOTIFY_PEEK)
    }

    this._timeoutsHandler.add([T7, SETTINGS.get_int('intellihide-notify-duration'), () => {
      this.release(Hold.NOTIFY_PEEK)
    }])
  }

  _setTrackPanel(enable) {
    let actorData = Utils.getTrackedActorData(this._panelBox)
    if (actorData) {
      actorData.affectsStruts = !enable
      actorData.trackFullscreen = !enable
    }

    if (!enable)
      this._panelBox.visible = true

    Main.layoutManager._queueUpdateRegions()
  }

  _setRevealMechanism() {
    let barriers = Meta.BackendCapabilities.BARRIERS

    if (
      (global.backend.capabilities & barriers) === barriers &&
      SETTINGS.get_boolean('intellihide-use-pressure')
    ) {
      this._edgeBarrier = this._createBarrier()
      this._pressureBarrier = new Layout.PressureBarrier(
        SETTINGS.get_int('intellihide-pressure-threshold'),
        SETTINGS.get_int('intellihide-pressure-time'),
        Shell.ActionMode.NORMAL,
      )
      this._pressureBarrier.addBarrier(this._edgeBarrier)
      this._pressureBarrier.connectObject(
        'trigger',
        () => {
          let [x, y] = global.get_pointer()
          if (this._pointerIn(x, y, 1))
            this._queueUpdatePanelPosition(true)
          else this._pressureBarrier._isTriggered = false
        },
        this
      )
    }

    this._pointerWatch = PointerWatcher.getPointerWatcher().addWatch(
      CHECK_POINTER_MS,
      (x, y) => this._checkMousePointer(x, y),
    )
  }

  _removeRevealMechanism() {
    if (this._pointerWatch) {
      PointerWatcher.getPointerWatcher()._removeWatch(this._pointerWatch)
      this._pointerWatch = 0
    }

    if (this._pressureBarrier) {
      this._pressureBarrier.disconnectObject(this)
      this._pressureBarrier.destroy()
      this._edgeBarrier.destroy()

      this._pressureBarrier = 0
      this._edgeBarrier = 0
    }
  }

  _createBarrier() {
    let opts = { backend: global.backend }

    opts.x1 = this._monitor.x
    opts.x2 = this._monitor.x + this._monitor.width
    opts.y1 = opts.y2 = this._monitor.y
    opts.directions = Meta.BarrierDirection.POSITIVE_Y

    return new Meta.Barrier(opts)
  }

  _checkMousePointer(x, y) {
    if (
      !this._pressureBarrier &&
      !this._hover &&
      !Main.overview.visible &&
      this._pointerIn(x, y, 1, SETTINGS.get_boolean('intellihide-use-pointer-limit-size'))
    ) {
      this._hover = true
      this._queueUpdatePanelPosition(true)
    } else if (this._hover || this._panelBox.visible) {
      let keepRevealedOnHover = SETTINGS.get_boolean('intellihide-revealed-hover')
      let fixedOffset = keepRevealedOnHover ? this._panelHeight : 1
      let hover = this._pointerIn(
        x,
        y,
        fixedOffset,
        keepRevealedOnHover && SETTINGS.get_boolean('intellihide-revealed-hover-limit-size'),
      )

      if (hover == this._hover) {
        if (this._hover && this._timeoutsHandler?.getId(T5))
          this._timeoutsHandler.remove(T5)
        return
      }

      if (!hover) {
        if (!this._timeoutsHandler?.getId(T5)) {
          this._timeoutsHandler?.add([T5, HOVER_OUT_MS, () => {
            this._hoveredOut = true
            this._hover = false
            this._queueUpdatePanelPosition()
          }])
        }
      } else {
        if (this._timeoutsHandler?.getId(T5))
          this._timeoutsHandler.remove(T5)
        this._hoveredOut = false
        this._hover = true
        this._queueUpdatePanelPosition()
      }
    }
  }

  _pointerIn(x, y, fixedOffset, limitToPanel = false) {
    let monitorX = this._monitor.x
    let monitorY = this._monitor.y
    let monitorW = this._monitor.width

    let zoneX, zoneWidth
    if (limitToPanel) {
      zoneX = this._panelBox.x
      zoneWidth = this._panelBox.width
    } else {
      zoneX = monitorX
      zoneWidth = monitorW
    }

    return (
      y <= monitorY + fixedOffset &&
      x >= zoneX &&
      x < zoneX + zoneWidth &&
      y >= monitorY &&
      y < monitorY + this._monitor.height
    )
  }

  _queueUpdatePanelPosition(fromRevealMechanism) {
    if (!this._enabled || !this._timeoutsHandler) return

    if (
      !fromRevealMechanism &&
      this._timeoutsHandler.getId(T2) &&
      !Main.overview.visible
    ) {
      this._pendingUpdate = true
    } else if (!this._holdStatus) {
      this._checkIfShouldBeVisible(fromRevealMechanism)
        ? this._revealPanel()
        : this._hidePanel()
      this._timeoutsHandler.add([
        T2,
        MIN_UPDATE_MS,
        () => this._endLimitUpdate(),
      ])
    }
  }

  _endLimitUpdate() {
    if (this._pendingUpdate) {
      this._pendingUpdate = false
      this._queueUpdatePanelPosition()
    }
  }

  _checkIfShouldBeVisible(fromRevealMechanism) {
    if (this._overviewVisible || this._checkIfMenuOpenOrGrab() || this._holdStatus)
      return true

    let inFullscreen = this._monitor.inFullscreen

    if (inFullscreen) {
      let activeWorkspace = Utils.getCurrentWorkspace()
      let hasFullscreen = activeWorkspace.list_windows().some(w =>
        w.is_fullscreen() && w.get_monitor() === this._monitor.index
      )
      if (!hasFullscreen) inFullscreen = false
    }

    if (inFullscreen && !SETTINGS.get_boolean('intellihide-show-in-fullscreen'))
      return false

    if (this._hover)
      return true

    if (fromRevealMechanism) {
      let mouseBtnIsPressed =
        global.get_pointer()[2] & Clutter.ModifierType.BUTTON1_MASK
      return !mouseBtnIsPressed
    }

    if (!this._hidesFromWindows())
      return false

    return !this._windowOverlap
  }

  _checkIfMenuOpenOrGrab() {
    let isGrab = false
    let actor = global.stage.get_grab_actor()

    while (actor && actor !== global.stage) {
      if (actor === Main.layoutManager.dummyCursor || this._panelBox.contains(actor)) {
        isGrab = true
        break
      }

      let nextActor = actor._sourceActor || actor.sourceActor ||
                      actor._delegate?._sourceActor || actor._delegate?.sourceActor

      if (nextActor && nextActor !== actor) {
        actor = nextActor
        continue
      }

      if (typeof actor.get_parent === 'function')
        actor = actor.get_parent()
      else
        break
    }

    let isMenuOpen = Main.panel.menuManager && Main.panel.menuManager.activeMenu != null
    let shouldKeepOpen = isGrab || isMenuOpen

    if (shouldKeepOpen && this._timeoutsHandler)
      this._timeoutsHandler.add([
        T1,
        CHECK_GRAB_MS,
        () => this._queueUpdatePanelPosition(),
      ])

    return shouldKeepOpen
  }

  _revealPanel(immediate, noDelay = false) {
    if (!this._panelBox.visible)
      this._panelBox.visible = true
    this._animatePanel(0, immediate, noDelay)
  }

  _hidePanel(immediate, noDelay = false) {
    this._animatePanel(-this._panelHeight, immediate, noDelay)
  }

  _animatePanel(destination, immediate, noDelay = false) {
    if (destination === this._animationDestination) return

    this._panelBox.remove_all_transitions()
    this._animationDestination = destination

    let update = () => {
      if (this._timeoutsHandler) {
        this._timeoutsHandler.add([
          T3,
          POST_ANIMATE_MS,
          () => this._queueUpdatePanelPosition(),
        ])
      }
    }

    if (St.Settings.get().enable_animations === false) immediate = true

    if (immediate) {
      this._panelBox.translation_y = destination
      this._panelBox.visible = destination === 0
      this._animationDestination = null
      update()
    } else if (destination !== this._panelBox.translation_y) {
      let delay = 0

      if (destination != 0 && this._hoveredOut && !noDelay)
        delay = SETTINGS.get_int('intellihide-close-delay')
      else if (destination == 0 && !noDelay)
        delay = SETTINGS.get_int('intellihide-reveal-delay')

      let animMode = Clutter.AnimationMode.EASE_OUT_QUAD

      this._panelBox.ease({
        translation_y: destination,
        duration: SETTINGS.get_int('intellihide-animation-time'),
        mode: animMode,
        delay,
        onComplete: () => {
          this._panelBox.visible = destination === 0
          this._animationDestination = null
          this._updateAccessibleName(destination === 0)
          update()
        },
      })
    } else {
      this._animationDestination = null
    }

    this._hoveredOut = false
  }

  _updateAccessibleName(revealed) {
    try {
      let accessible = this._panelBox.get_accessible()
      if (accessible)
        accessible.accessible_name = revealed ? 'Top panel (visible)' : 'Top panel (hidden)'
    } catch (_) {}
  }
}
