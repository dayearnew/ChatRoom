use std::collections::{HashMap, HashSet, VecDeque};

use atspi::connection::P2P;
use atspi::proxy::proxy_ext::ProxyExt;
use atspi::{AccessibilityConnection, CoordType, Interface, ObjectRefOwned, Role, State};
use futures_lite::future::block_on;

use crate::models::{ElementInfo, NativeError, RectValue};

const MAX_ELEMENTS: usize = 500;
const MAX_TEXT_VALUE: i32 = 4096;

pub struct Accessibility {
    connection: Option<AccessibilityConnection>,
    elements: HashMap<i32, ObjectRefOwned>,
    roles: HashMap<i32, Role>,
    next_id: i32,
}

impl Accessibility {
    pub fn new() -> Self {
        let connection = block_on(AccessibilityConnection::new()).ok();
        Self {
            connection,
            elements: HashMap::new(),
            roles: HashMap::new(),
            next_id: 1,
        }
    }

    pub fn reset_elements(&mut self) {
        self.elements.clear();
        self.roles.clear();
        self.next_id = 1;
    }

    pub fn collect(
        &mut self,
        app_hint: Option<&str>,
        allowed_pids: Option<&HashSet<u32>>,
    ) -> Result<Vec<ElementInfo>, NativeError> {
        self.reset_elements();
        let Some(connection) = self.connection.clone() else {
            return Ok(Vec::new());
        };
        block_on(self.collect_async(&connection, app_hint, allowed_pids))
    }

    pub fn rect(&self, id: i32) -> Result<RectValue, NativeError> {
        let reference = self.element_ref(id)?.clone();
        let connection = self.connection_ref()?;
        block_on(async {
            let proxy = connection.object_as_accessible(&reference).await?;
            let component = proxy.proxies().await?.component().await?;
            let (x, y, width, height) = component.get_extents(CoordType::Screen).await?;
            Ok(RectValue {
                x,
                y,
                width,
                height,
            })
        })
    }

    pub fn is_window(&self, id: i32) -> Result<bool, NativeError> {
        let role = self.roles.get(&id).copied().ok_or_else(stale_element)?;
        Ok(matches!(
            role,
            Role::Frame | Role::Dialog | Role::Window | Role::InternalFrame
        ))
    }

    pub fn process_id(&self, id: i32) -> Result<u32, NativeError> {
        let reference = self.element_ref(id)?.clone();
        let connection = self.connection_ref()?;
        block_on(root_process_id(connection, &reference)).ok_or_else(stale_element)
    }

    pub fn invoke(&self, id: i32) -> Result<(), NativeError> {
        let reference = self.element_ref(id)?.clone();
        let connection = self.connection_ref()?;
        block_on(async {
            let proxy = connection.object_as_accessible(&reference).await?;
            let action = proxy.proxies().await?.action().await?;
            if action.n_actions().await? <= 0 || !action.do_action(0).await? {
                return Err(NativeError::invalid("Target element cannot be invoked"));
            }
            Ok(())
        })
    }

    pub fn set_value(&self, id: i32, value: &str) -> Result<(), NativeError> {
        let reference = self.element_ref(id)?.clone();
        let connection = self.connection_ref()?;
        block_on(async {
            let proxy = connection.object_as_accessible(&reference).await?;
            let editable = proxy.proxies().await?.editable_text().await?;
            if !editable.set_text_contents(value).await? {
                return Err(NativeError::invalid(
                    "Target element does not accept text values",
                ));
            }
            Ok(())
        })
    }

    pub fn select_text(&self, id: i32, start: i32, length: i32) -> Result<(), NativeError> {
        if start < 0 || length < 0 {
            return Err(NativeError::invalid(
                "Text selection range must be non-negative",
            ));
        }
        let end = start
            .checked_add(length)
            .ok_or_else(|| NativeError::invalid("Text selection range is too large"))?;
        let reference = self.element_ref(id)?.clone();
        let connection = self.connection_ref()?;
        block_on(async {
            let proxy = connection.object_as_accessible(&reference).await?;
            let text = proxy.proxies().await?.text().await?;
            let selection_count = text.get_n_selections().await.unwrap_or(0);
            for index in (0..selection_count).rev() {
                let _ = text.remove_selection(index).await;
            }
            if !text.add_selection(start, end).await? {
                return Err(NativeError::invalid("Target element cannot select text"));
            }
            Ok(())
        })
    }

    pub fn focus(&self, id: i32) -> Result<(), NativeError> {
        let reference = self.element_ref(id)?.clone();
        let connection = self.connection_ref()?;
        block_on(async {
            let proxy = connection.object_as_accessible(&reference).await?;
            let component = proxy.proxies().await?.component().await?;
            if !component.grab_focus().await? {
                return Err(NativeError::invalid("Target element cannot receive focus"));
            }
            Ok(())
        })
    }

    async fn collect_async(
        &mut self,
        connection: &AccessibilityConnection,
        app_hint: Option<&str>,
        allowed_pids: Option<&HashSet<u32>>,
    ) -> Result<Vec<ElementInfo>, NativeError> {
        let root = connection.root_accessible_on_registry().await?;
        let mut roots = root.get_children().await.unwrap_or_default();
        if let Some(allowed_pids) = allowed_pids {
            let mut filtered = Vec::new();
            for reference in roots {
                if root_process_id(connection, &reference)
                    .await
                    .is_some_and(|pid| allowed_pids.contains(&pid))
                {
                    filtered.push(reference);
                }
            }
            roots = filtered;
        }
        if let Some(hint) = app_hint.filter(|value| !value.is_empty()) {
            let hint = hint.to_lowercase();
            let mut preferred = Vec::new();
            let mut fallback = Vec::new();
            for reference in roots {
                let name = match connection.object_as_accessible(&reference).await {
                    Ok(proxy) => proxy.name().await.unwrap_or_default(),
                    Err(_) => String::new(),
                };
                let name = name.to_lowercase();
                if !name.is_empty() && (name.contains(&hint) || hint.contains(&name)) {
                    preferred.push(reference);
                } else {
                    fallback.push(reference);
                }
            }
            preferred.extend(fallback);
            roots = preferred;
        }

        let mut queue = VecDeque::from(roots);
        let mut output = Vec::with_capacity(128);
        while let Some(reference) = queue.pop_front() {
            if output.len() >= MAX_ELEMENTS {
                break;
            }
            let proxy = match connection.object_as_accessible(&reference).await {
                Ok(proxy) => proxy,
                Err(_) => continue,
            };
            if let Ok(info) = self.describe(connection, &reference).await {
                output.push(info);
            }
            if output.len() >= MAX_ELEMENTS {
                break;
            }
            if let Ok(children) = proxy.get_children().await {
                queue.extend(children);
            }
        }
        Ok(output)
    }

    async fn describe(
        &mut self,
        connection: &AccessibilityConnection,
        reference: &ObjectRefOwned,
    ) -> Result<ElementInfo, NativeError> {
        let proxy = connection.object_as_accessible(reference).await?;
        let role = proxy.get_role().await.unwrap_or(Role::Unknown);
        let states = proxy.get_state().await.unwrap_or_default();
        let interfaces = proxy.get_interfaces().await.unwrap_or_default();
        let sensitive = role == Role::PasswordText;
        let name = nonempty(proxy.name().await.ok());
        let proxies = proxy.proxies().await.ok();

        let bounds = if interfaces.contains(Interface::Component) {
            match proxies.as_ref() {
                Some(proxies) => match proxies.component().await {
                    Ok(component) => component
                        .get_extents(CoordType::Screen)
                        .await
                        .ok()
                        .and_then(|(x, y, width, height)| {
                            (width > 0 && height > 0).then_some([
                                f64::from(x),
                                f64::from(y),
                                f64::from(width),
                                f64::from(height),
                            ])
                        }),
                    Err(_) => None,
                },
                None => None,
            }
        } else {
            None
        };

        let mut actions = Vec::with_capacity(3);
        if interfaces.contains(Interface::Action) {
            actions.push("invoke".to_owned());
        }
        if interfaces.contains(Interface::EditableText) {
            actions.push("set_value".to_owned());
        }
        if interfaces.contains(Interface::Text) {
            actions.push("select_text".to_owned());
        }

        let value = if sensitive || !interfaces.contains(Interface::Text) {
            None
        } else {
            match proxies.as_ref() {
                Some(proxies) => match proxies.text().await {
                    Ok(text) => {
                        let count = text
                            .character_count()
                            .await
                            .unwrap_or(0)
                            .clamp(0, MAX_TEXT_VALUE);
                        if count == 0 {
                            None
                        } else {
                            nonempty(text.get_text(0, count).await.ok())
                        }
                    }
                    Err(_) => None,
                },
                None => None,
            }
        };

        let id = self.next_id;
        self.next_id += 1;
        self.elements.insert(id, reference.clone());
        self.roles.insert(id, role);

        Ok(ElementInfo {
            id,
            role: role_name(role).to_owned(),
            name,
            value,
            enabled: states.contains(State::Enabled),
            focused: states.contains(State::Focused),
            selected: states.contains(State::Selected),
            sensitive,
            bounds,
            actions,
        })
    }

    fn connection_ref(&self) -> Result<&AccessibilityConnection, NativeError> {
        self.connection.as_ref().ok_or_else(|| {
            NativeError::unsupported(
                "AT-SPI is unavailable in this desktop session; semantic Computer Use actions are disabled",
            )
        })
    }

    fn element_ref(&self, id: i32) -> Result<&ObjectRefOwned, NativeError> {
        self.elements.get(&id).ok_or_else(stale_element)
    }
}

async fn root_process_id(
    connection: &AccessibilityConnection,
    reference: &ObjectRefOwned,
) -> Option<u32> {
    let name = reference.name()?.clone();
    let proxy = zbus::fdo::DBusProxy::new(connection.connection())
        .await
        .ok()?;
    proxy.get_connection_unix_process_id(name.into()).await.ok()
}

fn stale_element() -> NativeError {
    NativeError::stale("Computer element is unavailable; take a fresh snapshot first")
}

fn nonempty(value: Option<String>) -> Option<String> {
    value.filter(|value| !value.is_empty())
}

fn role_name(role: Role) -> &'static str {
    match role {
        Role::Button | Role::ToggleButton | Role::PushButtonMenu => "button",
        Role::Entry | Role::PasswordText => "textbox",
        Role::Text | Role::DocumentText | Role::Static | Role::Label | Role::Paragraph => "text",
        Role::CheckBox | Role::CheckMenuItem => "checkbox",
        Role::RadioButton | Role::RadioMenuItem => "radio",
        Role::Menu | Role::MenuBar | Role::PopupMenu => "menu",
        Role::MenuItem | Role::TearoffMenuItem => "menuitem",
        Role::List => "list",
        Role::ListItem => "listitem",
        Role::Table | Role::TreeTable => "table",
        Role::Link => "link",
        Role::Slider | Role::ScrollBar => "slider",
        Role::PageTab | Role::PageTabList => "tab",
        Role::Frame | Role::Dialog | Role::Window | Role::InternalFrame => "window",
        _ => "other",
    }
}
