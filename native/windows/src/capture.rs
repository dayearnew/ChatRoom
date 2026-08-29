use std::ffi::c_void;
use std::mem::size_of;

use base64::{engine::general_purpose::STANDARD, Engine};
use windows::core::BOOL;
use windows::Win32::Foundation::{LPARAM, RECT};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject,
    EnumDisplayMonitors, GetDC, GetDIBits, GetMonitorInfoW, ReleaseDC, SelectObject, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, HBITMAP, HDC, HGDIOBJ, HMONITOR,
    MONITORINFOEXW, SRCCOPY,
};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
};

use crate::models::{DisplayInfo, NativeError, RectValue, ScreenshotPayload};

#[derive(Clone, Debug)]
pub struct DisplayTarget {
    pub info: DisplayInfo,
    pub rect: RectValue,
}

pub struct Capture;

impl Capture {
    pub fn displays(&self) -> Result<Vec<DisplayInfo>, NativeError> {
        Ok(self
            .display_targets()?
            .into_iter()
            .map(|value| value.info)
            .collect())
    }

    pub fn display_targets(&self) -> Result<Vec<DisplayTarget>, NativeError> {
        let mut displays = Vec::<DisplayTarget>::new();
        unsafe {
            EnumDisplayMonitors(
                None,
                None,
                Some(enum_monitor),
                LPARAM(&mut displays as *mut _ as isize),
            )
            .ok()?;
        }
        Ok(displays)
    }

    pub fn virtual_screen(&self) -> RectValue {
        unsafe {
            RectValue {
                x: GetSystemMetrics(SM_XVIRTUALSCREEN),
                y: GetSystemMetrics(SM_YVIRTUALSCREEN),
                width: GetSystemMetrics(SM_CXVIRTUALSCREEN),
                height: GetSystemMetrics(SM_CYVIRTUALSCREEN),
            }
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
            .ok_or_else(|| NativeError::not_found("No displays are available"))
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
                    .map(|d| d.info.clone())
            })
            .or_else(|| displays.first().map(|display| display.info.clone()))
            .ok_or_else(|| NativeError::not_found("No displays are available"))
    }

    pub fn screenshot(&self, rect: RectValue) -> Result<ScreenshotPayload, NativeError> {
        if rect.width <= 0 || rect.height <= 0 {
            return Err(NativeError::invalid("Invalid screenshot region"));
        }

        let pixels = unsafe { capture_rgba(rect)? };
        let mut encoded = Vec::new();
        {
            let mut encoder =
                png::Encoder::new(&mut encoded, rect.width as u32, rect.height as u32);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder
                .write_header()
                .map_err(|error| NativeError::internal(error.to_string()))?;
            writer
                .write_image_data(&pixels)
                .map_err(|error| NativeError::internal(error.to_string()))?;
        }
        Ok(ScreenshotPayload {
            mime_type: "image/png",
            data: STANDARD.encode(encoded),
        })
    }
}

unsafe extern "system" fn enum_monitor(
    monitor: HMONITOR,
    _hdc: HDC,
    _rect: *mut RECT,
    data: LPARAM,
) -> BOOL {
    let displays = &mut *(data.0 as *mut Vec<DisplayTarget>);
    let mut monitor_info = MONITORINFOEXW::default();
    monitor_info.monitorInfo.cbSize = size_of::<MONITORINFOEXW>() as u32;
    if GetMonitorInfoW(monitor, &mut monitor_info.monitorInfo).as_bool() {
        let rect = monitor_info.monitorInfo.rcMonitor;
        let name_end = monitor_info
            .szDevice
            .iter()
            .position(|value| *value == 0)
            .unwrap_or(monitor_info.szDevice.len());
        let name = String::from_utf16_lossy(&monitor_info.szDevice[..name_end]);
        let mut dpi_x = 96u32;
        let mut dpi_y = 96u32;
        let _ = GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y);
        displays.push(DisplayTarget {
            info: DisplayInfo {
                id: (monitor.0 as usize).to_string(),
                name,
                width: (rect.right - rect.left) as f64,
                height: (rect.bottom - rect.top) as f64,
                scale: dpi_x as f64 / 96.0,
                primary: (monitor_info.monitorInfo.dwFlags & 1) != 0,
            },
            rect: RectValue {
                x: rect.left,
                y: rect.top,
                width: rect.right - rect.left,
                height: rect.bottom - rect.top,
            },
        });
    }
    BOOL(1)
}

unsafe fn capture_rgba(rect: RectValue) -> Result<Vec<u8>, NativeError> {
    let screen = GetDC(None);
    if screen.0.is_null() {
        return Err(NativeError::internal("GetDC failed"));
    }
    let screen = ScreenDc(screen);

    let memory = CreateCompatibleDC(Some(screen.0));
    if memory.0.is_null() {
        return Err(NativeError::internal("CreateCompatibleDC failed"));
    }
    let memory = MemoryDc(memory);

    let bitmap = CreateCompatibleBitmap(screen.0, rect.width, rect.height);
    if bitmap.0.is_null() {
        return Err(NativeError::internal("CreateCompatibleBitmap failed"));
    }
    let bitmap = Bitmap(bitmap);
    let old = SelectObject(memory.0, HGDIOBJ(bitmap.0 .0));
    if old.0.is_null() {
        return Err(NativeError::internal("SelectObject failed"));
    }
    let selection = Selection { dc: memory.0, old };

    BitBlt(
        memory.0,
        0,
        0,
        rect.width,
        rect.height,
        Some(screen.0),
        rect.x,
        rect.y,
        SRCCOPY | CAPTUREBLT,
    )?;

    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: rect.width,
            biHeight: -rect.height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut bgra = vec![0u8; rect.width as usize * rect.height as usize * 4];
    let copied = GetDIBits(
        memory.0,
        bitmap.0,
        0,
        rect.height as u32,
        Some(bgra.as_mut_ptr().cast::<c_void>()),
        &mut info,
        DIB_RGB_COLORS,
    );
    if copied == 0 {
        return Err(NativeError::internal("GetDIBits failed"));
    }
    drop(selection);

    for pixel in bgra.as_chunks_mut::<4>().0 {
        pixel.swap(0, 2);
        pixel[3] = 255;
    }
    Ok(bgra)
}

struct ScreenDc(HDC);
impl Drop for ScreenDc {
    fn drop(&mut self) {
        unsafe {
            ReleaseDC(None, self.0);
        }
    }
}

struct MemoryDc(HDC);
impl Drop for MemoryDc {
    fn drop(&mut self) {
        unsafe {
            let _ = DeleteDC(self.0);
        }
    }
}

struct Bitmap(HBITMAP);
impl Drop for Bitmap {
    fn drop(&mut self) {
        unsafe {
            let _ = DeleteObject(HGDIOBJ(self.0 .0));
        }
    }
}

struct Selection {
    dc: HDC,
    old: HGDIOBJ,
}
impl Drop for Selection {
    fn drop(&mut self) {
        unsafe {
            SelectObject(self.dc, self.old);
        }
    }
}
