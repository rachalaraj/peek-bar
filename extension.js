import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import Meta from 'gi://Meta'
import Shell from 'gi://Shell'
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'
import * as Intellihide from './intellihide.js'
import * as Proximity from './proximity.js'
import { PeekBarIndicator } from './indicator.js'

export default class PeekBarExtension extends Extension {
    enable() {
        this._settings = this.getSettings()
        Intellihide.setSettings(this._settings)

        this._proximityManager = new Proximity.ProximityManager()
        this._intellihide = new Intellihide.Intellihide(this._proximityManager)

        this._intellihide.init()

        Main.wm.addKeybinding(
            'intellihide-key-toggle',
            this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => {
                if (this._intellihide)
                    this._intellihide.toggle()
            }
        )

        this._settings.connectObject(
            'changed::show-quick-settings-toggle',
            () => this._updateQuickSettingsIndicator(),
            this
        )

        this._updateQuickSettingsIndicator()
    }

    _updateQuickSettingsIndicator() {
        let show = this._settings.get_boolean('show-quick-settings-toggle')

        if (show && !this._indicator) {
            this._indicator = new PeekBarIndicator(this, this._intellihide, this._settings)
            Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator)
        } else if (!show && this._indicator) {
            this._indicator.destroy()
            this._indicator = null
        }
    }

    disable() {
        Main.wm.removeKeybinding('intellihide-key-toggle')

        if (this._indicator) {
            this._indicator.destroy()
            this._indicator = null
        }

        if (this._intellihide) {
            this._intellihide.destroy()
            this._intellihide = null
        }

        if (this._proximityManager) {
            this._proximityManager.destroy()
            this._proximityManager = null
        }

        if (this._settings) {
            this._settings.disconnectObject(this)
            this._settings = null
        }
        Intellihide.setSettings(null)
    }
}
