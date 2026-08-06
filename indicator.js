import GObject from 'gi://GObject'
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'

export const PeekBarIndicator = GObject.registerClass(
class PeekBarIndicator extends QuickSettings.SystemIndicator {
    _init(extension, intellihide, settings) {
        super._init()

        this._extension = extension
        this._intellihide = intellihide
        this._settings = settings

        this._toggle = new QuickSettings.QuickMenuToggle({
            title: 'Peek Bar',
            subtitle: 'Active',
            iconName: 'focus-top-bar-symbolic',
            toggleMode: true,
        })

        this._toggle.menu.setHeader('focus-top-bar-symbolic', 'Peek Bar')

        let settingsItem = new PopupMenu.PopupMenuItem('Peek Bar Settings')
        settingsItem.connect('activate', () => {
            Main.panel.closeQuickSettings()
            this._extension.openPreferences()
        })
        this._toggle.menu.addMenuItem(settingsItem)

        this.quickSettingsItems.push(this._toggle)

        this._toggle.connect('clicked', () => {
            if (this._intellihide) {
                this._intellihide.toggleExtension()
                this.updateState()
            }
        })

        if (this._intellihide) {
            this._intellihide.onStateChanged = () => this.updateState()
        }

        this.updateState()
    }

    updateState() {
        if (!this._intellihide) return

        let enabled = !!this._intellihide._enabled
        let isHeld = (this._intellihide._holdStatus & 2) !== 0
        this._toggle.checked = enabled
        if (!enabled)
            this._toggle.subtitle = 'Disabled'
        else if (isHeld)
            this._toggle.subtitle = 'Pinned'
        else
            this._toggle.subtitle = 'Active'
    }

    destroy() {
        if (this._intellihide)
            this._intellihide.onStateChanged = null
        this.quickSettingsItems.forEach(item => item.destroy())
        super.destroy()
    }
})
