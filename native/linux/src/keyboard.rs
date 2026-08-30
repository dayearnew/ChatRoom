use x11rb::connection::Connection;
use x11rb::protocol::xproto::ConnectionExt as _;
use x11rb::rust_connection::RustConnection;

use crate::models::NativeError;

pub(crate) struct KeyboardMap {
    min_keycode: u8,
    keysyms_per_keycode: usize,
    keysyms: Vec<u32>,
}

impl KeyboardMap {
    pub(crate) fn load(conn: &RustConnection) -> Result<Self, NativeError> {
        let setup = conn.setup();
        let count = setup.max_keycode.saturating_sub(setup.min_keycode) + 1;
        let reply = conn
            .get_keyboard_mapping(setup.min_keycode, count)?
            .reply()?;
        Ok(Self {
            min_keycode: setup.min_keycode,
            keysyms_per_keycode: usize::from(reply.keysyms_per_keycode),
            keysyms: reply.keysyms,
        })
    }

    pub(crate) fn keycode_for(&self, keysym: u32) -> Result<(u8, bool), NativeError> {
        if self.keysyms_per_keycode == 0 {
            return Err(NativeError::internal("X11 keyboard mapping is empty"));
        }
        for (index, value) in self.keysyms.iter().enumerate() {
            if *value != keysym {
                continue;
            }
            let key_offset = index / self.keysyms_per_keycode;
            let level = index % self.keysyms_per_keycode;
            if level > 1 {
                continue;
            }
            let keycode = self
                .min_keycode
                .checked_add(key_offset as u8)
                .ok_or_else(|| NativeError::internal("X11 keycode overflow"))?;
            return Ok((keycode, level == 1));
        }
        Err(NativeError::invalid(format!(
            "Character or key is not present in the X11 keyboard map: 0x{keysym:x}",
        )))
    }
}

pub(crate) fn modifier_keysym(raw: &str) -> Option<u32> {
    match raw.to_ascii_uppercase().as_str() {
        "CTRL" | "CONTROL" => Some(0xffe3),
        "ALT" | "OPTION" => Some(0xffe9),
        "SHIFT" => Some(0xffe1),
        "META" | "CMD" | "COMMAND" | "WIN" | "SUPER" => Some(0xffeb),
        _ => None,
    }
}

pub(crate) fn named_keysym(raw: &str) -> Option<u32> {
    match raw.to_ascii_uppercase().as_str() {
        "ENTER" | "RETURN" => Some(0xff0d),
        "TAB" => Some(0xff09),
        "SPACE" => Some(0x20),
        "ESC" | "ESCAPE" => Some(0xff1b),
        "BACKSPACE" => Some(0xff08),
        "DELETE" | "FORWARD_DELETE" => Some(0xffff),
        "HOME" => Some(0xff50),
        "LEFT" => Some(0xff51),
        "UP" => Some(0xff52),
        "RIGHT" => Some(0xff53),
        "DOWN" => Some(0xff54),
        "PAGEUP" => Some(0xff55),
        "PAGEDOWN" => Some(0xff56),
        "END" => Some(0xff57),
        "F1" => Some(0xffbe),
        "F2" => Some(0xffbf),
        "F3" => Some(0xffc0),
        "F4" => Some(0xffc1),
        "F5" => Some(0xffc2),
        "F6" => Some(0xffc3),
        "F7" => Some(0xffc4),
        "F8" => Some(0xffc5),
        "F9" => Some(0xffc6),
        "F10" => Some(0xffc7),
        "F11" => Some(0xffc8),
        "F12" => Some(0xffc9),
        "MINUS" => Some(u32::from(b'-')),
        "EQUAL" => Some(u32::from(b'=')),
        "LEFT_BRACKET" => Some(u32::from(b'[')),
        "RIGHT_BRACKET" => Some(u32::from(b']')),
        "SEMICOLON" => Some(u32::from(b';')),
        "QUOTE" => Some(u32::from(b'\'')),
        "COMMA" => Some(u32::from(b',')),
        "PERIOD" => Some(u32::from(b'.')),
        "SLASH" => Some(u32::from(b'/')),
        "BACKSLASH" => Some(u32::from(b'\\')),
        "GRAVE" => Some(u32::from(b'`')),
        value if value.chars().count() == 1 => value
            .chars()
            .next()
            .map(|character| unicode_keysym(character.to_ascii_lowercase())),
        _ => None,
    }
}

pub(crate) fn unicode_keysym(character: char) -> u32 {
    let value = character as u32;
    if value <= 0xff {
        value
    } else {
        0x0100_0000 | value
    }
}
