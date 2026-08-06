import Adw from 'gi://Adw'
import Gio from 'gi://Gio'
import Gtk from 'gi://Gtk'
import Gdk from 'gi://Gdk'

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js'

export default class PeekBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(800, 680)

        const settings = this.getSettings()
        const builder = new Gtk.Builder()

        const uiPath = this.dir.get_child('ui/BoxIntellihideOptions.ui').get_path()
        builder.add_from_file(uiPath)

        const page = builder.get_object('page')
        window.add(page)

        this._bindSettings(window, builder, settings)
    }

    _bindSettings(window, builder, settings) {
        this._bindSwitch(builder, settings, 'intellihide_window_hide_button', 'intellihide-hide-from-windows')

        this._bindSwitch(builder, settings, 'intellihide_use_pressure_switch', 'intellihide-use-pressure')
        this._bindSpinButton(builder, settings, 'intellihide_pressure_threshold_spinbutton', 'intellihide-pressure-threshold')
        this._bindSpinButton(builder, settings, 'intellihide_pressure_time_spinbutton', 'intellihide-pressure-time')
        this._bindSwitch(builder, settings, 'intellihide_use_pointer_limit_size_switch', 'intellihide-use-pointer-limit-size')
        this._bindSwitch(builder, settings, 'intellihide_revealed_hover_switch', 'intellihide-revealed-hover')
        this._bindSwitch(builder, settings, 'intellihide_revealed_hover_limit_size_switch', 'intellihide-revealed-hover-limit-size')

        this._bindSwitch(builder, settings, 'intellihide_notify_reveal_switch', 'intellihide-notify-reveal')
        this._bindSpinButton(builder, settings, 'intellihide_notify_duration_spinbutton', 'intellihide-notify-duration')

        this._bindSwitch(builder, settings, 'intellihide_show_in_fullscreen_switch', 'intellihide-show-in-fullscreen')
        this._bindShortcutDialog(window, builder, settings, 'intellihide_toggle_row', 'intellihide_toggle_shortcut', 'intellihide-key-toggle-text', 'intellihide-key-toggle')

        this._bindSwitch(builder, settings, 'show_quick_settings_toggle_switch', 'show-quick-settings-toggle')

        this._bindSpinButton(builder, settings, 'intellihide_animation_time_spinbutton', 'intellihide-animation-time')
        this._bindSpinButton(builder, settings, 'intellihide_close_delay_spinbutton', 'intellihide-close-delay')
        this._bindSpinButton(builder, settings, 'intellihide_reveal_delay_spinbutton', 'intellihide-reveal-delay')

        this._bindSwitch(builder, settings, 'intellihide_startup_animation_switch', 'intellihide-startup-animation')
        this._bindSpinButton(builder, settings, 'intellihide_enable_start_delay_spinbutton', 'intellihide-enable-start-delay')

        let resetBtn = builder.get_object('reset_defaults_button')
        if (resetBtn) {
            resetBtn.connect('clicked', () => {
                let keys = settings.settings_schema.list_keys()
                for (let key of keys) {
                    settings.reset(key)
                }
            })
        }
    }

    _bindSwitch(builder, settings, uiId, key) {
        let widget = builder.get_object(uiId)
        if (widget)
            settings.bind(key, widget, 'active', Gio.SettingsBindFlags.DEFAULT)
    }

    _bindSpinButton(builder, settings, uiId, key) {
        let widget = builder.get_object(uiId)
        if (widget)
            settings.bind(key, widget, 'value', Gio.SettingsBindFlags.DEFAULT)
    }

    // strvKey is the companion as[] key that GNOME Shell's wm.addKeybinding reads
    _bindShortcutDialog(window, builder, settings, rowId, shortcutId, textKey, strvKey) {
        let row = builder.get_object(rowId)
        let shortcutLabel = builder.get_object(shortcutId)

        if (!row || !shortcutLabel) return

        const syncLabel = () => {
            let text = settings.get_string(textKey)
            shortcutLabel.set_accelerator(text || '')
            if (text) {
                settings.set_strv(strvKey, [text])
            } else {
                settings.set_strv(strvKey, [])
            }
        }

        syncLabel()

        settings.connect(`changed::${textKey}`, () => {
            syncLabel()
        })

        row.activatable_widget = shortcutLabel

        row.connect('activated', () => {
            const dialog = new Adw.Window({
                modal: true,
                transient_for: window,
                default_width: 460,
                default_height: 360,
                hide_on_close: true,
            })

            const mainBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })

            const headerBar = new Adw.HeaderBar({
                title_widget: new Gtk.Label({ label: '<b>Set Shortcut</b>', use_markup: true }),
                show_end_title_buttons: false,
                show_start_title_buttons: false,
            })

            const cancelBtn = new Gtk.Button({ label: 'Cancel' })
            cancelBtn.connect('clicked', () => dialog.close())
            headerBar.pack_start(cancelBtn)

            const setBtn = new Gtk.Button({ label: 'Set' })
            setBtn.add_css_class('suggested-action')
            setBtn.set_sensitive(false)
            setBtn.set_receives_default(true)
            headerBar.pack_end(setBtn)

            mainBox.append(headerBar)

            const box = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 20,
                margin_top: 32,
                margin_bottom: 32,
                margin_start: 32,
                margin_end: 32,
                valign: Gtk.Align.CENTER,
                vexpand: true,
            })

            box.append(new Gtk.Label({
                label: '<b>Press a key combination</b>',
                use_markup: true,
            }))

            box.append(new Gtk.Image({
                icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
                pixel_size: 96,
            }))

            const previewShortcut = new Gtk.ShortcutLabel({
                halign: Gtk.Align.CENTER,
                visible: false,
            })
            box.append(previewShortcut)

            const hintLabel = new Gtk.Label({
                label: 'A modifier key (Ctrl, Alt, Super, Shift) is required.\nBackspace to clear · Esc to cancel.',
                wrap: true,
                justify: Gtk.Justification.CENTER,
            })
            hintLabel.add_css_class('dim-label')
            box.append(hintLabel)

            mainBox.append(box)

            let pendingShortcut = ''

            const commit = () => {
                if (pendingShortcut) {
                    settings.set_string(textKey, pendingShortcut)
                    settings.set_strv(strvKey, [pendingShortcut])
                }
                dialog.close()
            }

            setBtn.connect('clicked', commit)

            const controller = new Gtk.EventControllerKey({
                propagation_phase: Gtk.PropagationPhase.CAPTURE,
            })
            dialog.add_controller(controller)

            controller.connect('key-pressed', (_ctrl, keyval, _keycode, state) => {
                switch (keyval) {
                    case Gdk.KEY_Alt_L: case Gdk.KEY_Alt_R:
                    case Gdk.KEY_Control_L: case Gdk.KEY_Control_R:
                    case Gdk.KEY_Shift_L: case Gdk.KEY_Shift_R:
                    case Gdk.KEY_Super_L: case Gdk.KEY_Super_R:
                    case Gdk.KEY_Meta_L: case Gdk.KEY_Meta_R:
                        return Gdk.EVENT_PROPAGATE
                }

                let mask = state & Gtk.accelerator_get_default_mod_mask()

                if (keyval === Gdk.KEY_Escape && mask === 0) {
                    dialog.close()
                    return Gdk.EVENT_STOP
                }

                if (keyval === Gdk.KEY_BackSpace && mask === 0) {
                    settings.set_string(textKey, '')
                    settings.set_strv(strvKey, [])
                    dialog.close()
                    return Gdk.EVENT_STOP
                }

                if ((keyval === Gdk.KEY_Return || keyval === Gdk.KEY_KP_Enter) && mask === 0) {
                    if (pendingShortcut) commit()
                    return Gdk.EVENT_STOP
                }

                if (mask === 0) {
                    hintLabel.set_text('A modifier key (Ctrl, Alt, Super, Shift) is required.\nBackspace to clear · Esc to cancel.')
                    return Gdk.EVENT_STOP
                }

                let keyvalLower = Gdk.keyval_to_lower(keyval)
                const accel = Gtk.accelerator_name(keyvalLower, mask)
                if (accel) {
                    pendingShortcut = accel
                    previewShortcut.set_accelerator(accel)
                    previewShortcut.set_visible(true)
                    setBtn.set_sensitive(true)
                    dialog.set_default_widget(setBtn)
                    hintLabel.set_text('Backspace to clear · Esc to cancel · Enter or Set to confirm.')
                }

                return Gdk.EVENT_STOP
            })

            dialog.set_content(mainBox)
            dialog.present()
        })
    }
}
