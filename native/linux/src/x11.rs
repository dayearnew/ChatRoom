use std::collections::HashSet;
use std::fs;
use std::thread::sleep;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine};
use x11rb::connection::Connection;
use x11rb::image::{Image, PixelLayout};
use x11rb::protocol::randr::ConnectionExt as _;
use x11rb::protocol::xproto::{
    Atom, AtomEnum, ClientMessageEvent, ConfigureWindowAux, ConnectionExt as _, EventMask,
    InputFocus, Window, BUTTON_PRESS_EVENT, BUTTON_RELEASE_EVENT, KEY_PRESS_EVENT,
    KEY_RELEASE_EVENT, MOTION_NOTIFY_EVENT,
};
use x11rb::protocol::xtest::ConnectionExt as _;
use x11rb::rust_connection::RustConnection;
use x11rb::{CURRENT_TIME, NONE};

use crate::keyboard::{modifier_keysym, named_keysym, unicode_keysym, KeyboardMap};
use crate::models::{DisplayInfo, NativeError, PointValue, RectValue, ScreenshotPayload};

#[derive(Clone, Debug)]
pub struct DisplayTarget {
    pub info: DisplayInfo,
    pub rect: RectValue,
}

#[derive(Clone, Debug)]
pub struct WindowTarget {
    pub id: Window,
    pub rect: RectValue,
    pub pid: Option<u32>,
}

pub struct X11Controller {
    conn: RustConnection,
    screen_num: usize,
    root: Window,
    atoms: Atoms,
}

impl X11Controller {
    pub fn new() -> Result<Self, NativeError> {
        if std::env::var("XDG_SESSION_TYPE")
            .ok()
            .is_some_and(|value| value.eq_ignore_ascii_case("wayland"))
        {
            return Err(NativeError::unsupported(
                "Wayland sessions are not supported; start ChatRoom inside an X11 session",
            ));
        }
        if std::env::var_os("DISPLAY").is_none() {
            return Err(NativeError::unsupported(
                "Linux Computer Use requires an X11 DISPLAY",
            ));
        }

        let (conn, screen_num) = x11rb::connect(None)?;
        let root = conn
            .setup()
            .roots
            .get(screen_num)
            .ok_or_else(|| NativeError::internal("X11 screen is unavailable"))?
            .root;
        let atoms = Atoms::new(&conn)?;
        Ok(Self {
            conn,
            screen_num,
            root,
            atoms,
        })
    }

    pub fn displays(&self) -> Result<Vec<DisplayInfo>, NativeError> {
        Ok(self
            .display_targets()?
            .into_iter()
            .map(|target| target.info)
            .collect())
    }

    pub fn display_targets(&self) -> Result<Vec<DisplayTarget>, NativeError> {
        if let Ok(cookie) = self.conn.randr_get_monitors(self.root, true) {
            if let Ok(reply) = cookie.reply() {
                if !reply.monitors.is_empty() {
                    let mut displays = Vec::with_capacity(reply.monitors.len());
                    for monitor in reply.monitors {
                        if monitor.width == 0 || monitor.height == 0 {
                            continue;
                        }
                        let name = self
                            .conn
                            .get_atom_name(monitor.name)?
                            .reply()
                            .map(|reply| String::from_utf8_lossy(&reply.name).into_owned())
                            .unwrap_or_else(|_| format!("Display {}", monitor.name));
                        displays.push(DisplayTarget {
                            info: DisplayInfo {
                                id: monitor.name.to_string(),
                                name,
                                width: f64::from(monitor.width),
                                height: f64::from(monitor.height),
                                scale: 1.0,
                                primary: monitor.primary,
                            },
                            rect: RectValue {
                                x: i32::from(monitor.x),
                                y: i32::from(monitor.y),
                                width: i32::from(monitor.width),
                                height: i32::from(monitor.height),
                            },
                        });
                    }
                    if !displays.is_empty() {
                        return Ok(displays);
                    }
                }
            }
        }

        let crtcs = self.crtc_display_targets()?;
        if !crtcs.is_empty() {
            return Ok(crtcs);
        }

        let rect = self.virtual_screen();
        Ok(vec![DisplayTarget {
            info: DisplayInfo {
                id: "root".to_owned(),
                name: "X11 Screen".to_owned(),
                width: rect.width as f64,
                height: rect.height as f64,
                scale: 1.0,
                primary: true,
            },
            rect,
        }])
    }

    fn crtc_display_targets(&self) -> Result<Vec<DisplayTarget>, NativeError> {
        let resources = match self.conn.randr_get_screen_resources_current(self.root) {
            Ok(cookie) => match cookie.reply() {
                Ok(reply) => reply,
                Err(_) => return Ok(Vec::new()),
            },
            Err(_) => return Ok(Vec::new()),
        };
        let primary = self
            .conn
            .randr_get_output_primary(self.root)
            .ok()
            .and_then(|cookie| cookie.reply().ok())
            .map(|reply| reply.output)
            .unwrap_or(NONE);
        let mut displays = Vec::new();
        for crtc in resources.crtcs {
            let info = match self
                .conn
                .randr_get_crtc_info(crtc, resources.config_timestamp)
            {
                Ok(cookie) => match cookie.reply() {
                    Ok(reply) => reply,
                    Err(_) => continue,
                },
                Err(_) => continue,
            };
            if info.width == 0 || info.height == 0 {
                continue;
            }

            let output = info.outputs.first().copied();
            let name = output
                .and_then(|output| {
                    self.conn
                        .randr_get_output_info(output, resources.config_timestamp)
                        .ok()?
                        .reply()
                        .ok()
                        .map(|reply| String::from_utf8_lossy(&reply.name).into_owned())
                })
                .filter(|name| !name.is_empty())
                .unwrap_or_else(|| format!("Display {crtc}"));
            let id = output.unwrap_or(crtc).to_string();
            displays.push(DisplayTarget {
                info: DisplayInfo {
                    id,
                    name,
                    width: f64::from(info.width),
                    height: f64::from(info.height),
                    scale: 1.0,
                    primary: output.is_some_and(|output| output == primary),
                },
                rect: RectValue {
                    x: i32::from(info.x),
                    y: i32::from(info.y),
                    width: i32::from(info.width),
                    height: i32::from(info.height),
                },
            });
        }
        if !displays.is_empty() && !displays.iter().any(|display| display.info.primary) {
            displays[0].info.primary = true;
        }
        Ok(displays)
    }

    pub fn virtual_screen(&self) -> RectValue {
        let screen = &self.conn.setup().roots[self.screen_num];
        RectValue {
            x: 0,
            y: 0,
            width: i32::from(screen.width_in_pixels),
            height: i32::from(screen.height_in_pixels),
        }
    }

    pub fn display(&self, id: Option<&str>) -> Result<DisplayTarget, NativeError> {
        let displays = self.display_targets()?;
        if let Some(id) = id {
            return displays
                .into_iter()
                .find(|display| display.info.id == id)
                .ok_or_else(|| NativeError::not_found("Display not found"));
        }
        displays
            .iter()
            .find(|display| display.info.primary)
            .cloned()
            .or_else(|| displays.into_iter().next())
            .ok_or_else(|| NativeError::not_found("No X11 displays are available"))
    }

    pub fn display_for_rect(&self, rect: RectValue) -> Result<DisplayInfo, NativeError> {
        let center_x = rect.x + rect.width / 2;
        let center_y = rect.y + rect.height / 2;
        let displays = self.display_targets()?;
        displays
            .iter()
            .find(|display| {
                center_x >= display.rect.x
                    && center_x < display.rect.right()
                    && center_y >= display.rect.y
                    && center_y < display.rect.bottom()
            })
            .map(|display| display.info.clone())
            .or_else(|| {
                displays
                    .iter()
                    .find(|display| display.info.primary)
                    .map(|display| display.info.clone())
            })
            .or_else(|| displays.first().map(|display| display.info.clone()))
            .ok_or_else(|| NativeError::not_found("No X11 displays are available"))
    }

    pub fn screenshot(&self, rect: RectValue) -> Result<ScreenshotPayload, NativeError> {
        if rect.width <= 0 || rect.height <= 0 {
            return Err(NativeError::invalid("Invalid screenshot region"));
        }
        let x = i16::try_from(rect.x)
            .map_err(|_| NativeError::invalid("Screenshot x coordinate is outside X11 range"))?;
        let y = i16::try_from(rect.y)
            .map_err(|_| NativeError::invalid("Screenshot y coordinate is outside X11 range"))?;
        let width = u16::try_from(rect.width)
            .map_err(|_| NativeError::invalid("Screenshot width is outside X11 range"))?;
        let height = u16::try_from(rect.height)
            .map_err(|_| NativeError::invalid("Screenshot height is outside X11 range"))?;

        let (image, visual_id) = Image::get(&self.conn, self.root, x, y, width, height)?;
        let screen = &self.conn.setup().roots[self.screen_num];
        let visual = screen
            .allowed_depths
            .iter()
            .flat_map(|depth| depth.visuals.iter())
            .find(|visual| visual.visual_id == visual_id)
            .copied()
            .ok_or_else(|| NativeError::internal("Unable to resolve X11 root visual"))?;
        let layout = PixelLayout::from_visual_type(visual)?;

        let mut rgba = Vec::with_capacity(width as usize * height as usize * 4);
        for py in 0..height {
            for px in 0..width {
                let (red, green, blue) = layout.decode(image.get_pixel(px, py));
                rgba.extend_from_slice(&[
                    (red >> 8) as u8,
                    (green >> 8) as u8,
                    (blue >> 8) as u8,
                    255,
                ]);
            }
        }

        let mut encoded = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut encoded, width.into(), height.into());
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder
                .write_header()
                .map_err(|error| NativeError::internal(error.to_string()))?;
            writer
                .write_image_data(&rgba)
                .map_err(|error| NativeError::internal(error.to_string()))?;
        }
        Ok(ScreenshotPayload {
            mime_type: "image/png",
            data: STANDARD.encode(encoded),
        })
    }

    pub fn cursor(&self) -> Option<PointValue> {
        let reply = self.conn.query_pointer(self.root).ok()?.reply().ok()?;
        Some(PointValue {
            x: f64::from(reply.root_x),
            y: f64::from(reply.root_y),
        })
    }

    pub fn active_context(&self) -> (Option<String>, Option<String>) {
        let window = self.active_window().ok().flatten();
        match window {
            Some(window) => (
                self.window_app(window).ok().flatten(),
                self.window_title(window).ok().flatten(),
            ),
            None => (None, None),
        }
    }

    pub fn current_window_pids(&self) -> Result<HashSet<u32>, NativeError> {
        let mut pids = HashSet::new();
        for window in self.current_client_windows()? {
            if let Some(pid) = self.window_pid(window)? {
                add_process_tree(pid, &mut pids);
            }
        }
        Ok(pids)
    }

    pub fn process_tree_pids(&self, pid: u32) -> HashSet<u32> {
        let mut pids = HashSet::new();
        add_process_tree(pid, &mut pids);
        pids
    }

    pub fn find_window(&self, query: &str) -> Result<WindowTarget, NativeError> {
        let query = query.to_lowercase();
        for window in self.current_client_windows()? {
            let title = self.window_title(window)?.unwrap_or_default();
            let app = self.window_app(window)?.unwrap_or_default();
            if title.to_lowercase().contains(&query) || app.to_lowercase().contains(&query) {
                return Ok(WindowTarget {
                    id: window,
                    rect: self.window_rect(window)?,
                    pid: self.window_pid(window)?,
                });
            }
        }
        Err(NativeError::not_found(
            "Target application is not running on the current workspace",
        ))
    }

    pub fn window_for_rect(&self, rect: RectValue) -> Result<Option<WindowTarget>, NativeError> {
        self.window_for_rect_matching(rect, None)
    }

    pub fn window_for_rect_and_pid(
        &self,
        rect: RectValue,
        pid: u32,
    ) -> Result<Option<WindowTarget>, NativeError> {
        self.window_for_rect_matching(rect, Some(pid))
    }

    fn window_for_rect_matching(
        &self,
        rect: RectValue,
        element_pid: Option<u32>,
    ) -> Result<Option<WindowTarget>, NativeError> {
        let element_tree = element_pid.map(|pid| self.process_tree_pids(pid));
        let mut best: Option<(f64, WindowTarget)> = None;
        for window in self.current_client_windows()? {
            let window_pid = self.window_pid(window)?;
            if let Some(element_pid) = element_pid {
                let Some(window_pid) = window_pid else {
                    continue;
                };
                let window_tree = self.process_tree_pids(window_pid);
                if window_pid != element_pid
                    && !window_tree.contains(&element_pid)
                    && !element_tree
                        .as_ref()
                        .is_some_and(|tree| tree.contains(&window_pid))
                {
                    continue;
                }
            }
            let Ok(window_rect) = self.window_rect(window) else {
                continue;
            };
            let score = overlap_ratio(rect, window_rect);
            if score < 0.5 {
                continue;
            }
            if best.as_ref().is_none_or(|(current, _)| score > *current) {
                best = Some((
                    score,
                    WindowTarget {
                        id: window,
                        rect: window_rect,
                        pid: window_pid,
                    },
                ));
            }
        }
        Ok(best.map(|(_, target)| target))
    }

    pub fn activate_application(&self, query: &str) -> Result<(), NativeError> {
        let target = self.find_window(query)?;
        self.activate_window(target.id)
    }

    pub fn activate_window(&self, window: Window) -> Result<(), NativeError> {
        if !self.window_on_current_desktop(window)? {
            return Err(NativeError::invalid(
                "Target window is on another workspace",
            ));
        }
        let message = ClientMessageEvent::new(
            32,
            window,
            self.atoms.net_active_window,
            [1, CURRENT_TIME, 0, 0, 0],
        );
        self.conn
            .send_event(
                false,
                self.root,
                EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY,
                message,
            )?
            .check()?;
        let _ = self
            .conn
            .set_input_focus(InputFocus::POINTER_ROOT, window, CURRENT_TIME)?
            .check();
        self.conn.flush()?;
        Ok(())
    }

    pub fn move_window(&self, window: Window, x: f64, y: f64) -> Result<(), NativeError> {
        self.conn
            .configure_window(
                window,
                &ConfigureWindowAux::new()
                    .x(x.round() as i32)
                    .y(y.round() as i32),
            )?
            .check()?;
        self.conn.flush()?;
        Ok(())
    }

    pub fn resize_window(
        &self,
        window: Window,
        width: f64,
        height: f64,
    ) -> Result<(), NativeError> {
        if width <= 0.0 || height <= 0.0 {
            return Err(NativeError::invalid(
                "Window width and height must be positive",
            ));
        }
        self.conn
            .configure_window(
                window,
                &ConfigureWindowAux::new()
                    .width(width.round().max(1.0) as u32)
                    .height(height.round().max(1.0) as u32),
            )?
            .check()?;
        self.conn.flush()?;
        Ok(())
    }

    pub fn move_pointer(&self, point: PointValue) -> Result<(), NativeError> {
        let x = clamp_i16(point.x);
        let y = clamp_i16(point.y);
        self.conn
            .xtest_fake_input(MOTION_NOTIFY_EVENT, 0, CURRENT_TIME, self.root, x, y, 0)?
            .check()?;
        self.conn.flush()?;
        Ok(())
    }

    pub fn click(&self, point: PointValue, button: u8, count: usize) -> Result<(), NativeError> {
        self.move_pointer(point)?;
        for _ in 0..count {
            self.button(button, true)?;
            self.button(button, false)?;
        }
        self.conn.flush()?;
        Ok(())
    }

    pub fn drag(
        &self,
        from: PointValue,
        to: PointValue,
        duration_ms: u64,
    ) -> Result<(), NativeError> {
        self.move_pointer(from)?;
        self.button(1, true)?;
        let steps = if duration_ms == 0 {
            1
        } else {
            ((duration_ms / 16).clamp(2, 60)) as usize
        };
        for step in 1..=steps {
            let progress = step as f64 / steps as f64;
            self.move_pointer(PointValue {
                x: from.x + (to.x - from.x) * progress,
                y: from.y + (to.y - from.y) * progress,
            })?;
            if duration_ms > 0 {
                sleep(Duration::from_millis(duration_ms / steps as u64));
            }
        }
        self.button(1, false)?;
        self.conn.flush()?;
        Ok(())
    }

    pub fn scroll(&self, delta_x: f64, delta_y: f64) -> Result<(), NativeError> {
        self.scroll_axis(delta_y, 4, 5)?;
        self.scroll_axis(delta_x, 7, 6)?;
        self.conn.flush()?;
        Ok(())
    }

    pub fn keypress(&self, keys: &[String]) -> Result<(), NativeError> {
        if keys.is_empty() {
            return Err(NativeError::invalid("Keypress requires at least one key"));
        }
        let map = KeyboardMap::load(&self.conn)?;
        let mut modifiers = Vec::new();
        let mut main = None;
        for key in keys {
            if let Some(keysym) = modifier_keysym(key) {
                modifiers.push(map.keycode_for(keysym)?.0);
            } else if main.is_none() {
                let keysym = named_keysym(key)
                    .ok_or_else(|| NativeError::invalid(format!("Unsupported key: {key}")))?;
                main = Some(map.keycode_for(keysym)?.0);
            } else {
                return Err(NativeError::invalid(
                    "Keypress supports one non-modifier key",
                ));
            }
        }
        let main = main.ok_or_else(|| NativeError::invalid("Unsupported key combination"))?;
        for code in &modifiers {
            self.key(*code, true)?;
        }
        self.key(main, true)?;
        self.key(main, false)?;
        for code in modifiers.iter().rev() {
            self.key(*code, false)?;
        }
        self.conn.flush()?;
        Ok(())
    }

    pub fn type_text(&self, text: &str) -> Result<(), NativeError> {
        if text.is_empty() {
            return Ok(());
        }
        let map = KeyboardMap::load(&self.conn)?;
        let shift = map.keycode_for(0xffe1)?.0;
        for character in text.chars() {
            if character == '\n' {
                let enter = map.keycode_for(0xff0d)?.0;
                self.key(enter, true)?;
                self.key(enter, false)?;
                continue;
            }
            if character == '\t' {
                let tab = map.keycode_for(0xff09)?.0;
                self.key(tab, true)?;
                self.key(tab, false)?;
                continue;
            }
            let keysym = unicode_keysym(character);
            match map.keycode_for(keysym) {
                Ok((code, shifted)) => {
                    if shifted {
                        self.key(shift, true)?;
                    }
                    self.key(code, true)?;
                    self.key(code, false)?;
                    if shifted {
                        self.key(shift, false)?;
                    }
                }
                Err(_) => self.type_unicode_hex(character, &map)?,
            }
        }
        self.conn.flush()?;
        Ok(())
    }

    fn type_unicode_hex(&self, character: char, map: &KeyboardMap) -> Result<(), NativeError> {
        let control = map.keycode_for(0xffe3)?.0;
        let shift = map.keycode_for(0xffe1)?.0;
        let u = map.keycode_for(u32::from(b'u'))?.0;
        self.key(control, true)?;
        self.key(shift, true)?;
        self.key(u, true)?;
        self.key(u, false)?;
        self.key(shift, false)?;
        self.key(control, false)?;
        for digit in format!("{:x}", character as u32).chars() {
            let (code, shifted) = map.keycode_for(unicode_keysym(digit))?;
            if shifted {
                self.key(shift, true)?;
            }
            self.key(code, true)?;
            self.key(code, false)?;
            if shifted {
                self.key(shift, false)?;
            }
        }
        let enter = map.keycode_for(0xff0d)?.0;
        self.key(enter, true)?;
        self.key(enter, false)?;
        Ok(())
    }

    fn button(&self, button: u8, down: bool) -> Result<(), NativeError> {
        self.conn
            .xtest_fake_input(
                if down {
                    BUTTON_PRESS_EVENT
                } else {
                    BUTTON_RELEASE_EVENT
                },
                button,
                CURRENT_TIME,
                self.root,
                0,
                0,
                0,
            )?
            .check()?;
        Ok(())
    }

    fn key(&self, keycode: u8, down: bool) -> Result<(), NativeError> {
        self.conn
            .xtest_fake_input(
                if down {
                    KEY_PRESS_EVENT
                } else {
                    KEY_RELEASE_EVENT
                },
                keycode,
                CURRENT_TIME,
                self.root,
                0,
                0,
                0,
            )?
            .check()?;
        Ok(())
    }

    fn scroll_axis(
        &self,
        delta: f64,
        positive_button: u8,
        negative_button: u8,
    ) -> Result<(), NativeError> {
        if delta == 0.0 {
            return Ok(());
        }
        let button = if delta > 0.0 {
            positive_button
        } else {
            negative_button
        };
        let count = ((delta.abs() / 100.0).ceil() as usize).clamp(1, 20);
        for _ in 0..count {
            self.button(button, true)?;
            self.button(button, false)?;
        }
        Ok(())
    }

    fn active_window(&self) -> Result<Option<Window>, NativeError> {
        let reply = self
            .conn
            .get_property(
                false,
                self.root,
                self.atoms.net_active_window,
                AtomEnum::WINDOW,
                0,
                1,
            )?
            .reply()?;
        let window = reply
            .value32()
            .and_then(|mut values| values.next())
            .filter(|id| *id != NONE);
        match window {
            Some(window) if self.window_on_current_desktop(window)? => Ok(Some(window)),
            _ => Ok(None),
        }
    }

    fn current_desktop(&self) -> Result<u32, NativeError> {
        let reply = self
            .conn
            .get_property(
                false,
                self.root,
                self.atoms.net_current_desktop,
                AtomEnum::CARDINAL,
                0,
                1,
            )?
            .reply()?;
        reply
            .value32()
            .and_then(|mut values| values.next())
            .ok_or_else(|| {
                NativeError::internal("X11 window manager did not report a current workspace")
            })
    }

    fn window_desktop(&self, window: Window) -> Result<Option<u32>, NativeError> {
        let reply = self
            .conn
            .get_property(
                false,
                window,
                self.atoms.net_wm_desktop,
                AtomEnum::CARDINAL,
                0,
                1,
            )?
            .reply()?;
        Ok(reply.value32().and_then(|mut values| values.next()))
    }

    fn window_on_current_desktop(&self, window: Window) -> Result<bool, NativeError> {
        let current = self.current_desktop()?;
        Ok(self
            .window_desktop(window)?
            .is_none_or(|desktop| desktop == current || desktop == u32::MAX))
    }

    fn current_client_windows(&self) -> Result<Vec<Window>, NativeError> {
        let mut windows = Vec::new();
        for window in self.client_windows()? {
            if self.window_on_current_desktop(window)? {
                windows.push(window);
            }
        }
        Ok(windows)
    }

    fn client_windows(&self) -> Result<Vec<Window>, NativeError> {
        let reply = self
            .conn
            .get_property(
                false,
                self.root,
                self.atoms.net_client_list,
                AtomEnum::WINDOW,
                0,
                u32::MAX,
            )?
            .reply()?;
        Ok(reply
            .value32()
            .map(|values| values.collect())
            .unwrap_or_default())
    }

    fn window_rect(&self, window: Window) -> Result<RectValue, NativeError> {
        let geometry = self.conn.get_geometry(window)?.reply()?;
        let translated = self
            .conn
            .translate_coordinates(window, self.root, 0, 0)?
            .reply()?;
        Ok(RectValue {
            x: i32::from(translated.dst_x),
            y: i32::from(translated.dst_y),
            width: i32::from(geometry.width),
            height: i32::from(geometry.height),
        })
    }

    fn window_title(&self, window: Window) -> Result<Option<String>, NativeError> {
        if let Some(value) =
            self.property_string(window, self.atoms.net_wm_name, self.atoms.utf8_string)?
        {
            return Ok(Some(value));
        }
        self.property_string(window, self.atoms.wm_name, AtomEnum::STRING.into())
    }

    fn window_app(&self, window: Window) -> Result<Option<String>, NativeError> {
        if let Some(value) =
            self.property_string(window, self.atoms.wm_class, AtomEnum::STRING.into())?
        {
            let value = value
                .replace('\0', " ")
                .split_whitespace()
                .last()
                .unwrap_or("")
                .to_owned();
            if !value.is_empty() {
                return Ok(Some(value));
            }
        }
        let pid = self.window_pid(window)?;
        Ok(pid.and_then(|pid| {
            fs::read_to_string(format!("/proc/{pid}/comm"))
                .ok()
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty())
        }))
    }

    fn window_pid(&self, window: Window) -> Result<Option<u32>, NativeError> {
        let reply = self
            .conn
            .get_property(
                false,
                window,
                self.atoms.net_wm_pid,
                AtomEnum::CARDINAL,
                0,
                1,
            )?
            .reply()?;
        Ok(reply.value32().and_then(|mut values| values.next()))
    }

    fn property_string(
        &self,
        window: Window,
        property: Atom,
        type_: Atom,
    ) -> Result<Option<String>, NativeError> {
        let reply = self
            .conn
            .get_property(false, window, property, type_, 0, u32::MAX)?
            .reply()?;
        if reply.value.is_empty() {
            return Ok(None);
        }
        let value = String::from_utf8_lossy(&reply.value)
            .trim_end_matches('\0')
            .to_owned();
        Ok((!value.is_empty()).then_some(value))
    }
}

struct Atoms {
    net_client_list: Atom,
    net_active_window: Atom,
    net_current_desktop: Atom,
    net_wm_desktop: Atom,
    net_wm_pid: Atom,
    net_wm_name: Atom,
    utf8_string: Atom,
    wm_name: Atom,
    wm_class: Atom,
}

impl Atoms {
    fn new(conn: &RustConnection) -> Result<Self, NativeError> {
        Ok(Self {
            net_client_list: intern(conn, "_NET_CLIENT_LIST")?,
            net_active_window: intern(conn, "_NET_ACTIVE_WINDOW")?,
            net_current_desktop: intern(conn, "_NET_CURRENT_DESKTOP")?,
            net_wm_desktop: intern(conn, "_NET_WM_DESKTOP")?,
            net_wm_pid: intern(conn, "_NET_WM_PID")?,
            net_wm_name: intern(conn, "_NET_WM_NAME")?,
            utf8_string: intern(conn, "UTF8_STRING")?,
            wm_name: intern(conn, "WM_NAME")?,
            wm_class: intern(conn, "WM_CLASS")?,
        })
    }
}

fn intern(conn: &RustConnection, name: &str) -> Result<Atom, NativeError> {
    Ok(conn.intern_atom(false, name.as_bytes())?.reply()?.atom)
}

fn add_process_tree(pid: u32, output: &mut HashSet<u32>) {
    if !output.insert(pid) {
        return;
    }
    let children =
        fs::read_to_string(format!("/proc/{pid}/task/{pid}/children")).unwrap_or_default();
    for child in children.split_whitespace() {
        if let Ok(child) = child.parse::<u32>() {
            add_process_tree(child, output);
        }
    }
}

fn clamp_i16(value: f64) -> i16 {
    value
        .round()
        .clamp(f64::from(i16::MIN), f64::from(i16::MAX)) as i16
}

fn overlap_ratio(a: RectValue, b: RectValue) -> f64 {
    let Some(overlap) = intersect(a, b) else {
        return 0.0;
    };
    let overlap_area = i64::from(overlap.width) * i64::from(overlap.height);
    let a_area = i64::from(a.width.max(0)) * i64::from(a.height.max(0));
    let b_area = i64::from(b.width.max(0)) * i64::from(b.height.max(0));
    let reference = a_area.min(b_area);
    if reference <= 0 {
        0.0
    } else {
        overlap_area as f64 / reference as f64
    }
}

pub fn intersect(a: RectValue, b: RectValue) -> Option<RectValue> {
    let left = a.x.max(b.x);
    let top = a.y.max(b.y);
    let right = a.right().min(b.right());
    let bottom = a.bottom().min(b.bottom());
    (right > left && bottom > top).then_some(RectValue {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    })
}
