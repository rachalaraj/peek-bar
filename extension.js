/*
 * Credit: This extension and the underlying proximity logic are built upon
 * the excellent groundwork established by the Dash to Panel extension.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import Meta from 'gi://Meta'
import Shell from 'gi://Shell'
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'
import * as Intellihide from './intellihide.js'
import * as Proximity from './proximity.js'

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
                if (this._intellihide) {
                    this._intellihide.toggle()
                }
            }
        )
    }

    disable() {
        Main.wm.removeKeybinding('intellihide-key-toggle')

        if (this._intellihide) {
            this._intellihide.destroy()
            this._intellihide = null
        }

        if (this._proximityManager) {
            this._proximityManager.destroy()
            this._proximityManager = null
        }

        this._settings = null
        Intellihide.setSettings(null)
    }
}
