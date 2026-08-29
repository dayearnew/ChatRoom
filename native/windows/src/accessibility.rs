use std::collections::HashMap;

use windows::core::{Interface, BOOL, BSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, RECT};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationInvokePattern,
    IUIAutomationTextPattern, IUIAutomationTransformPattern, IUIAutomationValuePattern,
    TextPatternRangeEndpoint_End, TextPatternRangeEndpoint_Start, TextUnit_Character,
    TreeScope_Descendants, UIA_ButtonControlTypeId, UIA_CheckBoxControlTypeId,
    UIA_DataGridControlTypeId, UIA_DocumentControlTypeId, UIA_EditControlTypeId,
    UIA_HyperlinkControlTypeId, UIA_InvokePatternId, UIA_ListControlTypeId,
    UIA_ListItemControlTypeId, UIA_MenuControlTypeId, UIA_MenuItemControlTypeId,
    UIA_RadioButtonControlTypeId, UIA_SliderControlTypeId, UIA_TabControlTypeId,
    UIA_TabItemControlTypeId, UIA_TableControlTypeId, UIA_TextControlTypeId, UIA_TextPatternId,
    UIA_TransformPatternId, UIA_ValuePatternId, UIA_WindowControlTypeId, UIA_CONTROLTYPE_ID,
    UIA_PATTERN_ID,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetForegroundWindow, GetWindowRect, GetWindowTextLengthW, GetWindowTextW,
    GetWindowThreadProcessId, IsWindowVisible, SetForegroundWindow, ShowWindow, SW_RESTORE,
};

use crate::models::{ElementInfo, NativeError, RectValue};

pub struct Accessibility {
    automation: IUIAutomation,
    elements: HashMap<i32, IUIAutomationElement>,
    next_id: i32,
}

impl Accessibility {
    pub fn new() -> Result<Self, NativeError> {
        let automation = unsafe {
            CoCreateInstance::<_, IUIAutomation>(&CUIAutomation, None, CLSCTX_INPROC_SERVER)?
        };
        Ok(Self {
            automation,
            elements: HashMap::new(),
            next_id: 1,
        })
    }

    pub fn reset_elements(&mut self) {
        self.elements.clear();
        self.next_id = 1;
    }

    pub fn element(&self, id: i32) -> Result<IUIAutomationElement, NativeError> {
        self.elements.get(&id).cloned().ok_or_else(|| {
            NativeError::stale("Computer element is unavailable; take a fresh snapshot first")
        })
    }

    pub fn active_root(&self) -> Result<IUIAutomationElement, NativeError> {
        unsafe {
            let window = GetForegroundWindow();
            if !window.0.is_null() {
                if let Ok(root) = self.automation.ElementFromHandle(window) {
                    return Ok(root);
                }
            }
            self.automation
                .GetFocusedElement()
                .or_else(|_| self.automation.GetRootElement())
                .map_err(NativeError::from)
        }
    }

    pub fn element_from_window(&self, window: HWND) -> Result<IUIAutomationElement, NativeError> {
        unsafe {
            self.automation
                .ElementFromHandle(window)
                .map_err(NativeError::from)
        }
    }

    pub fn collect(
        &mut self,
        root: Option<IUIAutomationElement>,
    ) -> Result<Vec<ElementInfo>, NativeError> {
        self.reset_elements();
        let root = match root {
            Some(value) => value,
            None => self.active_root()?,
        };
        let mut output = Vec::with_capacity(64);
        output.push(self.describe(&root)?);

        unsafe {
            let condition = self.automation.CreateTrueCondition()?;
            let descendants = root.FindAll(TreeScope_Descendants, &condition)?;
            let count = descendants.Length()?.min(499);
            for index in 0..count {
                if let Ok(element) = descendants.GetElement(index) {
                    if let Ok(info) = self.describe(&element) {
                        output.push(info);
                    }
                }
            }
        }
        Ok(output)
    }

    fn describe(&mut self, element: &IUIAutomationElement) -> Result<ElementInfo, NativeError> {
        let id = self.next_id;
        self.next_id += 1;
        self.elements.insert(id, element.clone());

        unsafe {
            let control_type = element.CurrentControlType()?;
            let name = optional_bstr(element.CurrentName().ok());
            let enabled = element.CurrentIsEnabled()?.as_bool();
            let focused = element.CurrentHasKeyboardFocus()?.as_bool();
            let sensitive = element.CurrentIsPassword()?.as_bool();
            let rect = element.CurrentBoundingRectangle().ok();
            let mut actions = Vec::new();
            let mut value = None;

            if current_pattern::<IUIAutomationInvokePattern>(element, UIA_InvokePatternId).is_ok() {
                actions.push("invoke".to_owned());
            }
            if let Ok(pattern) =
                current_pattern::<IUIAutomationValuePattern>(element, UIA_ValuePatternId)
            {
                actions.push("set_value".to_owned());
                if !sensitive {
                    value = optional_bstr(pattern.CurrentValue().ok());
                }
            }
            if current_pattern::<IUIAutomationTextPattern>(element, UIA_TextPatternId).is_ok() {
                actions.push("select_text".to_owned());
            }

            Ok(ElementInfo {
                id,
                role: role(control_type),
                name,
                value,
                enabled,
                focused,
                selected: false,
                sensitive,
                bounds: rect.map(|rect| {
                    [
                        rect.left as f64,
                        rect.top as f64,
                        (rect.right - rect.left) as f64,
                        (rect.bottom - rect.top) as f64,
                    ]
                }),
                actions,
            })
        }
    }

    pub fn rect(&self, id: i32) -> Result<RectValue, NativeError> {
        let element = self.element(id)?;
        unsafe {
            let rect = element.CurrentBoundingRectangle()?;
            Ok(RectValue {
                x: rect.left,
                y: rect.top,
                width: rect.right - rect.left,
                height: rect.bottom - rect.top,
            })
        }
    }

    pub fn is_window(&self, id: i32) -> Result<bool, NativeError> {
        let element = self.element(id)?;
        unsafe { Ok(element.CurrentControlType()? == UIA_WindowControlTypeId) }
    }

    pub fn invoke(&self, id: i32) -> Result<(), NativeError> {
        let element = self.element(id)?;
        let pattern = unsafe {
            current_pattern::<IUIAutomationInvokePattern>(&element, UIA_InvokePatternId)?
        };
        unsafe {
            pattern.Invoke()?;
        }
        Ok(())
    }

    pub fn set_value(&self, id: i32, value: &str) -> Result<(), NativeError> {
        let element = self.element(id)?;
        let pattern =
            unsafe { current_pattern::<IUIAutomationValuePattern>(&element, UIA_ValuePatternId)? };
        let value = BSTR::from(value);
        unsafe {
            pattern.SetValue(&value)?;
        }
        Ok(())
    }

    pub fn select_text(&self, id: i32, start: i32, length: i32) -> Result<(), NativeError> {
        let element = self.element(id)?;
        let pattern =
            unsafe { current_pattern::<IUIAutomationTextPattern>(&element, UIA_TextPatternId)? };
        unsafe {
            let range = pattern.DocumentRange()?;
            let _ = range.MoveEndpointByUnit(
                TextPatternRangeEndpoint_End,
                TextUnit_Character,
                -1_000_000,
            )?;
            let _ = range.MoveEndpointByUnit(
                TextPatternRangeEndpoint_Start,
                TextUnit_Character,
                -1_000_000,
            )?;
            let _ = range.MoveEndpointByUnit(
                TextPatternRangeEndpoint_Start,
                TextUnit_Character,
                start,
            )?;
            range.MoveEndpointByRange(
                TextPatternRangeEndpoint_End,
                &range,
                TextPatternRangeEndpoint_Start,
            )?;
            let _ = range.MoveEndpointByUnit(
                TextPatternRangeEndpoint_End,
                TextUnit_Character,
                length,
            )?;
            range.Select()?;
        }
        Ok(())
    }

    pub fn focus(&self, id: i32) -> Result<(), NativeError> {
        let element = self.element(id)?;
        unsafe {
            element.SetFocus()?;
        }
        Ok(())
    }

    pub fn activate_window(&self, id: i32) -> Result<(), NativeError> {
        self.focus(id)
    }

    pub fn move_window(&self, id: i32, x: f64, y: f64) -> Result<(), NativeError> {
        let element = self.element(id)?;
        let pattern = unsafe {
            current_pattern::<IUIAutomationTransformPattern>(&element, UIA_TransformPatternId)?
        };
        unsafe {
            pattern.Move(x, y)?;
        }
        Ok(())
    }

    pub fn resize_window(&self, id: i32, width: f64, height: f64) -> Result<(), NativeError> {
        let element = self.element(id)?;
        let pattern = unsafe {
            current_pattern::<IUIAutomationTransformPattern>(&element, UIA_TransformPatternId)?
        };
        unsafe {
            pattern.Resize(width, height)?;
        }
        Ok(())
    }

    pub fn find_application_window(&self, query: &str) -> Result<HWND, NativeError> {
        let mut context = WindowSearch {
            query: query.to_lowercase(),
            found: HWND::default(),
        };
        unsafe {
            EnumWindows(
                Some(enum_window),
                LPARAM(&mut context as *mut WindowSearch as isize),
            )?;
        }
        if context.found.0.is_null() {
            Err(NativeError::not_found("Target application is not running"))
        } else {
            Ok(context.found)
        }
    }

    pub fn activate_application(&self, query: &str) -> Result<(), NativeError> {
        let window = self.find_application_window(query)?;
        unsafe {
            let _ = ShowWindow(window, SW_RESTORE);
            if !SetForegroundWindow(window).as_bool() {
                return Err(NativeError::internal("SetForegroundWindow failed"));
            }
        }
        Ok(())
    }

    pub fn foreground_context(&self) -> (Option<String>, Option<String>) {
        unsafe {
            let window = GetForegroundWindow();
            if window.0.is_null() {
                return (None, None);
            }
            (process_name(window), window_title(window))
        }
    }
}

unsafe fn current_pattern<T: Interface>(
    element: &IUIAutomationElement,
    pattern_id: UIA_PATTERN_ID,
) -> windows::core::Result<T> {
    element.GetCurrentPattern(pattern_id)?.cast()
}

fn optional_bstr(value: Option<windows::core::BSTR>) -> Option<String> {
    value
        .map(|value| value.to_string())
        .filter(|value| !value.is_empty())
}

fn role(control_type: UIA_CONTROLTYPE_ID) -> String {
    match control_type {
        value if value == UIA_ButtonControlTypeId => "button",
        value if value == UIA_EditControlTypeId || value == UIA_DocumentControlTypeId => "textbox",
        value if value == UIA_TextControlTypeId => "text",
        value if value == UIA_CheckBoxControlTypeId => "checkbox",
        value if value == UIA_RadioButtonControlTypeId => "radio",
        value if value == UIA_MenuControlTypeId => "menu",
        value if value == UIA_MenuItemControlTypeId => "menuitem",
        value if value == UIA_ListControlTypeId => "list",
        value if value == UIA_ListItemControlTypeId => "listitem",
        value if value == UIA_TableControlTypeId || value == UIA_DataGridControlTypeId => "table",
        value if value == UIA_HyperlinkControlTypeId => "link",
        value if value == UIA_SliderControlTypeId => "slider",
        value if value == UIA_TabControlTypeId || value == UIA_TabItemControlTypeId => "tab",
        value if value == UIA_WindowControlTypeId => "window",
        _ => "other",
    }
    .to_owned()
}

struct WindowSearch {
    query: String,
    found: HWND,
}

unsafe extern "system" fn enum_window(window: HWND, data: LPARAM) -> BOOL {
    if !IsWindowVisible(window).as_bool() {
        return BOOL(1);
    }
    let context = &mut *(data.0 as *mut WindowSearch);
    let process = process_name(window).unwrap_or_default().to_lowercase();
    let title = window_title(window).unwrap_or_default().to_lowercase();
    if process.contains(&context.query) || title.contains(&context.query) {
        context.found = window;
        return BOOL(0);
    }
    BOOL(1)
}

pub fn window_rect(window: HWND) -> Result<RectValue, NativeError> {
    unsafe {
        let mut rect = RECT::default();
        GetWindowRect(window, &mut rect)?;
        Ok(RectValue {
            x: rect.left,
            y: rect.top,
            width: rect.right - rect.left,
            height: rect.bottom - rect.top,
        })
    }
}

unsafe fn window_title(window: HWND) -> Option<String> {
    let length = GetWindowTextLengthW(window);
    if length <= 0 {
        return None;
    }
    let mut buffer = vec![0u16; length as usize + 1];
    let copied = GetWindowTextW(window, &mut buffer);
    if copied <= 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&buffer[..copied as usize]))
}

unsafe fn process_name(window: HWND) -> Option<String> {
    let mut pid = 0u32;
    GetWindowThreadProcessId(window, Some(&mut pid));
    if pid == 0 {
        return None;
    }
    let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
    let mut buffer = vec![0u16; 1024];
    let mut size = buffer.len() as u32;
    let result = QueryFullProcessImageNameW(
        process,
        PROCESS_NAME_FORMAT(0),
        PWSTR(buffer.as_mut_ptr()),
        &mut size,
    );
    let _ = CloseHandle(process);
    if result.is_err() || size == 0 {
        return None;
    }
    let path = String::from_utf16_lossy(&buffer[..size as usize]);
    path.rsplit(['\\', '/']).next().map(str::to_owned)
}
