import Adw from 'gi://Adw'
import Gio from 'gi://Gio'
import Gtk from 'gi://Gtk'
import Gdk from 'gi://Gdk'

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js'

export default class PeekBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(800, 600)

        const settings = this.getSettings()
        const builder = new Gtk.Builder()

        const uiPath = this.dir.get_child('ui/BoxIntellihideOptions.ui').get_path()
        builder.add_from_file(uiPath)

        const page = builder.get_object('page')
        window.add(page)

        this._bindSettings(window, builder, settings, this.dir)
    }

    _bindSettings(window, builder, settings, dir) {
        // Bind all the intellihide settings
        this._bindSwitch(builder, settings, 'intellihide_window_hide_button', 'intellihide-hide-from-windows')
        // Removed monitor and behavior combos

        this._bindSwitch(builder, settings, 'intellihide_use_pointer_switch', 'intellihide-use-pointer')
        this._bindSwitch(builder, settings, 'intellihide_use_pointer_limit_button', 'intellihide-use-pointer-limit-size')
        this._bindSwitch(builder, settings, 'intellihide_revealed_hover_switch', 'intellihide-revealed-hover')
        this._bindSwitch(builder, settings, 'intellihide_revealed_hover_limit_button', 'intellihide-revealed-hover-limit-size')
        this._bindSwitch(builder, settings, 'intellihide_use_pressure_switch', 'intellihide-use-pressure')
        
        this._bindSpinButton(builder, settings, 'intellihide_pressure_threshold_spinbutton', 'intellihide-pressure-threshold')
        this._bindSpinButton(builder, settings, 'intellihide_pressure_time_spinbutton', 'intellihide-pressure-time')
        
        this._bindSwitch(builder, settings, 'intellihide_show_in_fullscreen_switch', 'intellihide-show-in-fullscreen')
        this._bindSwitch(builder, settings, 'intellihide_only_secondary_switch', 'intellihide-only-secondary')
        
        this._bindSpinButton(builder, settings, 'intellihide_animation_time_spinbutton', 'intellihide-animation-time')
        this._bindSpinButton(builder, settings, 'intellihide_close_delay_spinbutton', 'intellihide-close-delay')
        this._bindSpinButton(builder, settings, 'intellihide_reveal_delay_spinbutton', 'intellihide-reveal-delay')
        this._bindSpinButton(builder, settings, 'intellihide_enable_start_delay_spinbutton', 'intellihide-enable-start-delay')

        
        this._bindShortcutDialog(window, builder, settings, 'intellihide_toggle_row', 'intellihide_toggle_shortcut', 'intellihide-key-toggle-text')


    }

    _bindSwitch(builder, settings, uiId, key) {
        let widget = builder.get_object(uiId)
        if (widget) {
            settings.bind(key, widget, 'active', Gio.SettingsBindFlags.DEFAULT)
        }
    }

    _bindSpinButton(builder, settings, uiId, key) {
        let widget = builder.get_object(uiId)
        if (widget) {
            settings.bind(key, widget, 'value', Gio.SettingsBindFlags.DEFAULT)
        }
    }

    _bindShortcutDialog(window, builder, settings, rowId, shortcutId, key) {
        let row = builder.get_object(rowId)
        let shortcutLabel = builder.get_object(shortcutId)

        if (!row || !shortcutLabel) return

        let updateShortcutLabel = () => {
            let shortcut_text = settings.get_string(key)
            if (shortcut_text) {
                shortcutLabel.set_accelerator(shortcut_text)
            } else {
                shortcutLabel.set_accelerator('')
            }
        }

        updateShortcutLabel()
        settings.connect(`changed::${key}`, () => {
            updateShortcutLabel()
            let shortcut_text = settings.get_string(key)
            let [success, accel_key, mods] = Gtk.accelerator_parse(shortcut_text)
            if (success && Gtk.accelerator_valid(accel_key, mods)) {
                let shortcut = Gtk.accelerator_name(accel_key, mods)
                settings.set_strv('intellihide-key-toggle', [shortcut])
            } else {
                settings.set_strv('intellihide-key-toggle', [])
            }
        })

        row.activatable_widget = shortcutLabel

        row.connect('activated', () => {
            const dialog = new Adw.Window({
                modal: true,
                transient_for: window,
                default_width: 450,
                default_height: 350,
                hide_on_close: true,
            })

            const mainBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })
            
            const headerBar = new Adw.HeaderBar({
                title_widget: new Gtk.Label({ label: '<b>Add Custom Shortcut</b>', use_markup: true }),
                show_end_title_buttons: false,
                show_start_title_buttons: false
            })

            const cancelBtn = new Gtk.Button({ label: 'Cancel' })
            cancelBtn.connect('clicked', () => dialog.close())
            headerBar.pack_start(cancelBtn)
            
            const setBtn = new Gtk.Button({ label: 'Set' })
            setBtn.add_css_class('suggested-action')
            setBtn.set_sensitive(false)
            headerBar.pack_end(setBtn)
            
            mainBox.append(headerBar)

            const box = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 24,
                margin_top: 32,
                margin_bottom: 32,
                margin_start: 32,
                margin_end: 32,
                valign: Gtk.Align.CENTER,
                vexpand: true
            })

            const title = new Gtk.Label({
                label: '<b>Enter the new shortcut</b>',
                use_markup: true,
            })
            box.append(title)

            const icon = new Gtk.Image({
                icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
                pixel_size: 128,
            })
            box.append(icon)

            const previewShortcut = new Gtk.ShortcutLabel({
                halign: Gtk.Align.CENTER,
                visible: false
            })
            box.append(previewShortcut)

            const descLabel = new Gtk.Label({
                label: 'Press Esc to cancel or Backspace to disable the keyboard shortcut',
                wrap: true,
                justify: Gtk.Justification.CENTER,
            })
            box.append(descLabel)
            
            mainBox.append(box)

            let currentParsedShortcut = ''

            setBtn.connect('clicked', () => {
                if (currentParsedShortcut !== '') {
                    settings.set_string(key, currentParsedShortcut)
                }
                dialog.close()
            })

            const controller = new Gtk.EventControllerKey()
            dialog.add_controller(controller)

            controller.connect('key-pressed', (ctrl, keyval, keycode, state) => {
                let mask = state & Gtk.accelerator_get_default_mod_mask()

                let isModifier = false
                switch (keyval) {
                    case Gdk.KEY_Alt_L: case Gdk.KEY_Alt_R:
                    case Gdk.KEY_Control_L: case Gdk.KEY_Control_R:
                    case Gdk.KEY_Shift_L: case Gdk.KEY_Shift_R:
                    case Gdk.KEY_Super_L: case Gdk.KEY_Super_R:
                    case Gdk.KEY_Meta_L: case Gdk.KEY_Meta_R:
                        isModifier = true
                        break
                }
                if (isModifier) return Gdk.EVENT_PROPAGATE

                if (state === 0) {
                    if (keyval === Gdk.KEY_Escape) {
                        dialog.close()
                        return Gdk.EVENT_STOP
                    }
                    if (keyval === Gdk.KEY_BackSpace) {
                        settings.set_string(key, '')
                        dialog.close()
                        return Gdk.EVENT_STOP
                    }
                }

                const accelerator = Gtk.accelerator_name(keyval, mask)
                if (accelerator && Gtk.accelerator_valid(keyval, mask)) {
                    currentParsedShortcut = accelerator
                    previewShortcut.set_accelerator(accelerator)
                    previewShortcut.set_visible(true)
                    setBtn.set_sensitive(true)
                    return Gdk.EVENT_STOP
                }

                return Gdk.EVENT_PROPAGATE
            })

            dialog.set_content(mainBox)
            dialog.present()
        })
    }

    _bindEntry(builder, settings, uiId, key) {
        let widget = builder.get_object(uiId)
        if (widget) {
            settings.bind(key, widget, 'text', Gio.SettingsBindFlags.DEFAULT)
        }
    }
}
