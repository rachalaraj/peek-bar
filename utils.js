import GLib from 'gi://GLib'
import Meta from 'gi://Meta'
import * as Config from 'resource:///org/gnome/shell/misc/config.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
export const TimeoutsHandler = class {
  constructor() {
    this._timeouts = {}
  }

  add(item) {
    let name = item[0]
    let delay = item[1]
    let timeoutHandler = item[2]

    this._remove(name)

    this._timeouts[name] = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
      this._timeouts[name] = 0
      timeoutHandler()

      return GLib.SOURCE_REMOVE
    })
  }

  remove(name) {
    this._remove(name)
  }

  _remove(name) {
    if (this._timeouts[name]) {
      GLib.Source.remove(this._timeouts[name])
      this._timeouts[name] = 0
    }
  }

  getId(name) {
    return this._timeouts[name] ? this._timeouts[name] : 0
  }

  destroy() {
    for (let name in this._timeouts) {
      this._remove(name)
    }
  }
}

let unredirectEnabled = true
export const setDisplayUnredirect = (enable) => {
  let gsVersion = Config.PACKAGE_VERSION

  if (gsVersion < '50' && !Meta.is_wayland_compositor()) return

  let v48 = gsVersion >= '48'

  if (enable && !unredirectEnabled)
    v48
      ? global.compositor.enable_unredirect()
      : Meta.enable_unredirect_for_display(global.display)
  else if (!enable && unredirectEnabled)
    v48
      ? global.compositor.disable_unredirect()
      : Meta.disable_unredirect_for_display(global.display)

  unredirectEnabled = enable
}

export const getCurrentWorkspace = function () {
  return global.workspace_manager.get_active_workspace()
}

export const getTrackedActorData = (actor) => {
  let trackedIndex = Main.layoutManager._findActor(actor)

  if (trackedIndex >= 0) return Main.layoutManager._trackedActors[trackedIndex]
}
