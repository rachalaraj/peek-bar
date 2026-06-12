import Clutter from 'gi://Clutter'
import GLib from 'gi://GLib'
import Meta from 'gi://Meta'
import Mtk from 'gi://Mtk'
import Shell from 'gi://Shell'

import * as Layout from 'resource:///org/gnome/shell/ui/layout.js'
import { InjectionManager } from 'resource:///org/gnome/shell/extensions/extension.js'

import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as OverviewControls from 'resource:///org/gnome/shell/ui/overviewControls.js'
import * as PointerWatcher from 'resource:///org/gnome/shell/ui/pointerWatcher.js'

import * as Proximity from './proximity.js'
import * as Utils from './utils.js'

let SETTINGS;

export const setSettings = (settings) => {
  SETTINGS = settings;
};

//timeout intervals
const CHECK_POINTER_MS = 200
const CHECK_GRAB_MS = 400
const POST_ANIMATE_MS = 50
const MIN_UPDATE_MS = 250

//timeout names
const T1 = 'checkGrabTimeout'
const T2 = 'limitUpdateTimeout'
const T3 = 'postAnimateTimeout'
const T4 = 'enableStartTimeout'

const SIDE_CONTROLS_ANIMATION_TIME =
  OverviewControls.SIDE_CONTROLS_ANIMATION_TIME /
  (OverviewControls.SIDE_CONTROLS_ANIMATION_TIME > 1 ? 1000 : 1)

export const Hold = {
  NONE: 0,
  TEMPORARY: 1,
  PERMANENT: 2,
  NOTIFY: 4,
}

export const Intellihide = class {
  constructor(proximityManager) {
    this._panelBox = Main.layoutManager.panelBox
    this._proximityManager = proximityManager
    this._holdStatus = Hold.NONE

    this._signalsHandler = new Utils.GlobalSignalsHandler()
    this._timeoutsHandler = new Utils.TimeoutsHandler()
    this._injectionManager = new InjectionManager()

    this._intellihideChangedId = 0;
    this.enabled = false
  }

  init() {
    this.enable()
  }

  enable() {
    this.enabled = true
    this._overviewVisible = Main.overview.visible || false
    this._monitor = Main.layoutManager.primaryMonitor
    this._animationDestination = -1
    this._pendingUpdate = false
    this._hover = false
    this._hoveredOut = false
    this._windowOverlap = false
    this._translationProp = 'translation_y'
    this._stageReleaseEventId = 0
    this._hoverOutTimeoutId = 0

    this._panelBox.translation_y = 0
    this._panelBox.translation_x = 0

    this._setTrackPanel(true)
    this._bindGeneralSignals()

    // Override vfunc_allocate to smoothly interpolate the layout bounds during overview transitions.
    // This perfectly centers the AppGrid and Workspaces without any sudden layout snaps or stuttering.
    let overviewControls = Main.overview._overview._controls
    this._injectionManager.overrideMethod(
      Object.getPrototypeOf(overviewControls),
      'vfunc_allocate',
      (originalAllocate) => (box) => {
        if (this.enabled && overviewControls._stateAdjustment) {
          // Smoothly scale the offset based on the overview state (0 = Desktop, 1 = Overview, 2 = AppGrid)
          let scale = Math.min(overviewControls._stateAdjustment.value, 1)
          let offset = Main.layoutManager.panelBox.height * scale

          box.y1 += offset
          originalAllocate.call(overviewControls, box)
          box.y1 -= offset // Revert to prevent cumulative state leakage
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
        height: this._panelBox.get_height() || 27,
      })

      this._proximityWatchId = this._proximityManager.createWatch(
        watched,
        this._monitor.index,
        0, // Mode.ALL_WINDOWS
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

    let lastState = SETTINGS.get_int('intellihide-persisted-state')

    if (lastState > -1) {
      this._holdStatus = lastState

      if (lastState == Hold.NONE && Main.layoutManager._startingUp)
        this._signalsHandler.add([
          this._panelBox,
          'notify::mapped',
          () => this._hidePanel(true),
        ])
      else this._queueUpdatePanelPosition()
    } else
      // -1 means that the option to persist hold isn't activated, so normal start
      this._timeoutsHandler.add([
        T4,
        SETTINGS.get_int('intellihide-enable-start-delay'),
        () => this._queueUpdatePanelPosition(),
      ])
  }

  disable(reset) {
    this.enabled = false
    this._hover = false

    if (this._proximityWatchId) {
      this._proximityManager.removeWatch(this._proximityWatchId)
    }

    this._setTrackPanel(false)
    this._removeRevealMechanism()

    if (this._hoverOutTimeoutId) {
      GLib.source_remove(this._hoverOutTimeoutId)
      this._hoverOutTimeoutId = 0
    }

    if (this._stageReleaseEventId) {
      global.stage.disconnect(this._stageReleaseEventId)
      this._stageReleaseEventId = 0
    }

    this._revealPanel(!reset)
    Utils.setDisplayUnredirect(true)

    this._signalsHandler.destroy()
    this._timeoutsHandler.destroy()
    this._injectionManager.clear()
  }

  destroy() {
    SETTINGS.disconnect(this._intellihideChangedId)

    if (this.enabled) {
      this.disable()
    }
  }

  toggle() {
    this[this._holdStatus & Hold.PERMANENT ? 'release' : 'revealAndHold'](
      Hold.PERMANENT,
    )
  }

  revealAndHold(holdStatus, immediate) {
    if (!this.enabled) return

    if (!this._holdStatus) this._revealPanel(immediate)

    this._holdStatus |= holdStatus

    this._maybePersistHoldStatus()
  }

  release(holdStatus) {
    if (!this.enabled) return

    if (this._holdStatus & holdStatus) this._holdStatus -= holdStatus

    if (!this._holdStatus) {
      this._maybePersistHoldStatus()
      this._queueUpdatePanelPosition()
    }
  }

  reset() {
    this.disable(true)
    this.enable()
  }

  _hidesFromWindows() {
    return SETTINGS.get_boolean('intellihide-hide-from-windows')
  }

  _changeEnabledStatus() {
    // Intentionally left empty as we are always enabled when the extension is active
  }

  _maybePersistHoldStatus() {
    if (SETTINGS.get_int('intellihide-persisted-state') > -1)
      SETTINGS.set_int(
        'intellihide-persisted-state',
        this._holdStatus & Hold.PERMANENT ? Hold.PERMANENT : Hold.NONE,
      )
  }

  _bindGeneralSignals() {
    this._signalsHandler.add(
      [
        SETTINGS,
        [
          'changed::intellihide-use-pointer',
          'changed::intellihide-use-pressure',
          'changed::intellihide-hide-from-windows',
          'changed::intellihide-hide-from-monitor-windows',
          'changed::intellihide-behaviour',
          'changed::intellihide-pressure-threshold',
          'changed::intellihide-pressure-time',
        ],
        () => this.reset(),
      ],
      [
        Main.overview,
        ['showing'],
        () => {
          this._overviewVisible = true
          if (this._checkIfShouldBeVisible()) {
            this._revealPanel(false, true); // Smooth reveal perfectly synced with no delay
          }
        },
      ],
      [
        Main.overview,
        ['hiding'],
        () => {
          this._overviewVisible = false
          if (this._checkIfShouldBeVisible()) {
            this._revealPanel();
          } else {
            this._hidePanel(false, true); // Smooth hide perfectly synced with no delay
          }
        },
      ],
      [
        this._panelBox,
        'notify::visible',
        () => Utils.setDisplayUnredirect(!this._panelBox.visible),
      ]
    )


  }

  _setTrackPanel(enable) {
    let actorData = Utils.getTrackedActorData(this._panelBox)
    if (actorData) {
      actorData.affectsStruts = !enable
      actorData.trackFullscreen = !enable
    }

    if (!enable) {
      this._panelBox.visible = true
    }

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
      this._signalsHandler.add([
        this._pressureBarrier,
        'trigger',
        () => {
          let [x, y] = global.get_pointer()

          if (this._pointerIn(x, y, 1))
            this._queueUpdatePanelPosition(true)
          else this._pressureBarrier._isTriggered = false
        },
      ])
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
      this._pressureBarrier.destroy()
      this._edgeBarrier.destroy()

      this._pressureBarrier = 0
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
      this._pointerIn(x, y, 1)
    ) {
      this._hover = true
      this._queueUpdatePanelPosition(true)
    } else if (this._hover || this._panelBox.visible) {
      let keepRevealedOnHover = SETTINGS.get_boolean(
        'intellihide-revealed-hover',
      )
      let fixedOffset = keepRevealedOnHover
        ? this._panelBox.get_height() || 27
        : 1
      let hover = this._pointerIn(
        x,
        y,
        fixedOffset,
      )

      if (hover == this._hover) {
        if (this._hover && this._hoverOutTimeoutId) {
          GLib.source_remove(this._hoverOutTimeoutId)
          this._hoverOutTimeoutId = 0
        }
        return
      }

      if (!hover) {
        if (!this._hoverOutTimeoutId) {
          this._hoverOutTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            this._hoverOutTimeoutId = 0
            this._hoveredOut = true
            this._hover = false
            this._queueUpdatePanelPosition()
            return GLib.SOURCE_REMOVE
          })
        }
      } else {
        if (this._hoverOutTimeoutId) {
          GLib.source_remove(this._hoverOutTimeoutId)
          this._hoverOutTimeoutId = 0
        }
        this._hoveredOut = false
        this._hover = true
        this._queueUpdatePanelPosition()
      }
    }
  }

  _pointerIn(x, y, fixedOffset) {
    let varCoordX1 = this._monitor.x
    let varCoordY1 = this._monitor.y

    return (
      (y <= this._monitor.y + fixedOffset) &&
      x >= varCoordX1 &&
      x < varCoordX1 + this._monitor.width &&
      y >= varCoordY1 &&
      y < varCoordY1 + this._monitor.height
    )
  }

  _queueUpdatePanelPosition(fromRevealMechanism) {
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
    // 1. Overview, Menus, and Manual Hold take absolute precedence
    if (this._overviewVisible || this._checkIfMenuOpenOrGrab() || this._holdStatus) {
      return true
    }

    // 2. If an app is fullscreen, and the setting to show in fullscreen is disabled,
    //    absolutely forbid revealing the panel.
    if (this._monitor.inFullscreen && !SETTINGS.get_boolean('intellihide-show-in-fullscreen')) {
      return false
    }

    // 3. If we are actively hovering the panel edge
    if (this._hover) {
      return true
    }

    // 4. If triggered by pressure/reveal mechanism, ensure no mouse buttons are pressed
    if (fromRevealMechanism) {
      let mouseBtnIsPressed =
        global.get_pointer()[2] & Clutter.ModifierType.BUTTON1_MASK

      return !mouseBtnIsPressed
    }

    // 5. If we don't hide from overlapping windows, we would only show on hover (handled above)
    if (!this._hidesFromWindows()) {
      return false
    }

    // 6. Otherwise, show the panel if no windows are overlapping it
    return !this._windowOverlap
  }

  _checkIfMenuOpenOrGrab() {
    let grabActor = global.stage.get_grab_actor()
    let sourceActor = grabActor?._sourceActor || grabActor
    let isGrab =
      sourceActor &&
      (sourceActor == Main.layoutManager.dummyCursor ||
        this._panelBox.contains(sourceActor))

    let isMenuOpen = Main.panel.menuManager && Main.panel.menuManager.activeMenu != null
    let shouldKeepOpen = isGrab || isMenuOpen

    if (shouldKeepOpen)
      this._timeoutsHandler.add([
        T1,
        CHECK_GRAB_MS,
        () => this._queueUpdatePanelPosition(),
      ])

    return shouldKeepOpen
  }

  _revealPanel(immediate, noDelay = false) {
    if (!this._panelBox.visible) {
      this._panelBox.visible = true
    }
    this._animatePanel(0, immediate, null, noDelay)
  }

  _hidePanel(immediate, noDelay = false) {
    let size = this._panelBox.get_height() || 27
    let coefficient = -1

    this._animatePanel(size * coefficient, immediate, null, noDelay)
  }

  _animatePanel(destination, immediate, onComplete, noDelay = false) {
    if (destination === this._animationDestination) return

    this._panelBox.remove_all_transitions()
    this._animationDestination = destination

    let update = () =>
      this._timeoutsHandler.add([
        T3,
        POST_ANIMATE_MS,
        () => {
          this._queueUpdatePanelPosition()
        },
      ])

    if (immediate) {
      this._panelBox[this._translationProp] = destination
      this._panelBox.visible = destination === 0
      update()
    } else if (destination !== this._panelBox[this._translationProp]) {
      let delay = 0

      if (destination != 0 && this._hoveredOut && !noDelay)
        delay = SETTINGS.get_int('intellihide-close-delay')
      else if (destination == 0 && !noDelay)
        delay = SETTINGS.get_int('intellihide-reveal-delay')

      let tweenOpts = {
        [this._translationProp]: destination,
        duration: SETTINGS.get_int('intellihide-animation-time'),
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        delay,
        onComplete: () => {
          this._panelBox.visible = destination === 0
          this._animationDestination = null
          if (onComplete) onComplete()
          update()
        },
      }

      this._panelBox.ease(tweenOpts)
    }

    this._hoveredOut = false
  }
}
