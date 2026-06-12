import Clutter from 'gi://Clutter'
import GLib from 'gi://GLib'
import Meta from 'gi://Meta'
import St from 'gi://St'
import * as Config from 'resource:///org/gnome/shell/misc/config.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'

// simplify global signals and function injections handling
// abstract class
export const BasicHandler = class {
  constructor() {
    this._storage = new Object()
  }

  add(/*unlimited 3-long array arguments*/) {
    // convert arguments object to array, concatenate with generic
    let args = [].concat('generic', [].slice.call(arguments))
    // call addWithLabel with ags as if they were passed arguments
    this.addWithLabel.apply(this, args)
  }

  destroy() {
    for (let label in this._storage) this.removeWithLabel(label)
  }

  addWithLabel(label /* plus unlimited 3-long array arguments*/) {
    if (this._storage[label] == undefined) this._storage[label] = new Array()

    // skip first element of the arguments
    for (let i = 1; i < arguments.length; i++) {
      let item = this._storage[label]
      let handlers = this._create(arguments[i])

      for (let j = 0, l = handlers.length; j < l; ++j) {
        item.push(handlers[j])
      }
    }
  }

  removeWithLabel(label) {
    if (this._storage[label]) {
      for (let i = 0; i < this._storage[label].length; i++) {
        this._remove(this._storage[label][i])
      }

      delete this._storage[label]
    }
  }

  hasLabel(label) {
    return !!this._storage[label]
  }

  /* Virtual methods to be implemented by subclass */
  // create single element to be stored in the storage structure
  _create() {
    throw new Error('no implementation of _create in ' + this)
  }

  // correctly delete single element
  _remove() {
    throw new Error('no implementation of _remove in ' + this)
  }
}



/**
 * Manage timeouts: the added timeouts have their id reset on completion
 */
export const TimeoutsHandler = class extends BasicHandler {
  _create(item) {
    let name = item[0]
    let delay = item[1]
    let timeoutHandler = item[2]

    this._remove(item)

    this[name] = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
      this[name] = 0
      timeoutHandler()

      return GLib.SOURCE_REMOVE
    })

    return [[name]]
  }

  remove(name) {
    this._remove([name])
  }

  _remove(item) {
    let name = item[0]

    if (this[name]) {
      GLib.Source.remove(this[name])
      this[name] = 0
    }
  }

  getId(name) {
    return this[name] ? this[name] : 0
  }
}

export const DisplayWrapper = {
  getWorkspaceManager() {
    return global.screen || global.workspace_manager
  },
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
  return DisplayWrapper.getWorkspaceManager().get_active_workspace()
}

export const getTrackedActorData = (actor) => {
  let trackedIndex = Main.layoutManager._findActor(actor)

  if (trackedIndex >= 0) return Main.layoutManager._trackedActors[trackedIndex]
}

export const animate = function (actor, options) {
  if (options.delay) {
    options.delay = options.delay * 1000
  }

  options.duration = options.time * 1000
  delete options.time

  if (options.transition) {
    //map Tweener easing equations to Clutter animation modes
    options.mode =
      {
        easeInCubic: Clutter.AnimationMode.EASE_IN_CUBIC,
        easeInOutCubic: Clutter.AnimationMode.EASE_IN_OUT_CUBIC,
        easeInOutQuad: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
        easeOutQuad: Clutter.AnimationMode.EASE_OUT_QUAD,
      }[options.transition] || Clutter.AnimationMode.LINEAR

    delete options.transition
  }

  let params = [options]

  if ('value' in options && actor instanceof St.Adjustment) {
    params.unshift(options.value)
    delete options.value
  }

  actor.ease.apply(actor, params)
}

export const stopAnimations = function (actor) {
  actor.remove_all_transitions()
}
