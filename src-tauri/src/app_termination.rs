//! macOS can terminate the app without closing its window: Quit from the Dock,
//! logout, restart, or a quit Apple event from another process. tao's app
//! delegate has no `applicationShouldTerminate:`, so those exits skip the
//! frontend's unsaved-changes prompt. This adds one that holds the quit while
//! editor tabs are unsaved and routes it through the same prompt as Cmd+Q.

use std::sync::atomic::{AtomicBool, Ordering};

static HAS_UNSAVED_EDITOR_TABS: AtomicBool = AtomicBool::new(false);

pub fn set_has_unsaved_editor_tabs(has_unsaved: bool) {
    HAS_UNSAVED_EDITOR_TABS.store(has_unsaved, Ordering::SeqCst);
}

#[cfg(target_os = "macos")]
pub use macos::install;

#[cfg(target_os = "macos")]
mod macos {
    use std::{
        ffi::{c_char, c_void},
        sync::{atomic::Ordering, OnceLock},
    };

    use tauri::{AppHandle, Emitter};

    use super::HAS_UNSAVED_EDITOR_TABS;

    type Class = *mut c_void;
    type Sel = *const c_void;
    type Id = *mut c_void;

    const NS_TERMINATE_CANCEL: usize = 0;
    const NS_TERMINATE_NOW: usize = 1;

    #[link(name = "objc", kind = "dylib")]
    extern "C" {
        fn objc_getClass(name: *const c_char) -> Class;
        fn sel_registerName(name: *const c_char) -> Sel;
        fn class_addMethod(cls: Class, name: Sel, imp: *const c_void, types: *const c_char) -> i8;
    }

    static APP: OnceLock<AppHandle> = OnceLock::new();

    extern "C" fn application_should_terminate(_this: Id, _sel: Sel, _sender: Id) -> usize {
        if !HAS_UNSAVED_EDITOR_TABS.load(Ordering::SeqCst) {
            return NS_TERMINATE_NOW;
        }
        if let Some(app) = APP.get() {
            // The frontend asks about the tabs and closes the window if the user agrees.
            let _ = app.emit("menu-action", "quit");
        }
        NS_TERMINATE_CANCEL
    }

    /// Safety: `class` must be a registered Objective-C class.
    pub(super) unsafe fn add_should_terminate(class: Class) -> bool {
        // NSApplicationTerminateReply (NSUInteger) applicationShouldTerminate:(NSApplication *)
        class_addMethod(
            class,
            sel_registerName(c"applicationShouldTerminate:".as_ptr()),
            application_should_terminate as *const c_void,
            c"Q@:@".as_ptr(),
        ) != 0
    }

    pub fn install(app: &AppHandle) {
        let _ = APP.set(app.clone());
        unsafe {
            let class = objc_getClass(c"TaoAppDelegateParent".as_ptr());
            if class.is_null() {
                log::warn!(
                    "app delegate class not found; Dock quit will skip the unsaved tabs prompt"
                );
                return;
            }
            if !add_should_terminate(class) {
                log::warn!(
                    "app delegate already answers applicationShouldTerminate:; leaving it in place"
                );
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use std::ffi::{c_char, c_void};

        use super::{add_should_terminate, Class, Id, Sel, NS_TERMINATE_CANCEL, NS_TERMINATE_NOW};
        use crate::app_termination::set_has_unsaved_editor_tabs;

        #[link(name = "objc", kind = "dylib")]
        extern "C" {
            fn objc_getClass(name: *const c_char) -> Class;
            fn objc_allocateClassPair(
                superclass: Class,
                name: *const c_char,
                extra: usize,
            ) -> Class;
            fn objc_registerClassPair(cls: Class);
            fn sel_registerName(name: *const c_char) -> Sel;
            fn class_getInstanceMethod(cls: Class, name: Sel) -> *mut c_void;
            fn class_getMethodImplementation(cls: Class, name: Sel) -> *const c_void;
        }

        #[test]
        fn delegate_holds_termination_only_while_editor_tabs_are_unsaved() {
            unsafe {
                let class = objc_allocateClassPair(
                    objc_getClass(c"NSObject".as_ptr()),
                    c"PanesTerminationTestDelegate".as_ptr(),
                    0,
                );
                assert!(!class.is_null());
                objc_registerClassPair(class);
                let sel = sel_registerName(c"applicationShouldTerminate:".as_ptr());
                assert!(class_getInstanceMethod(class, sel).is_null());

                assert!(add_should_terminate(class));
                assert!(!class_getInstanceMethod(class, sel).is_null());
                let imp: extern "C" fn(Id, Sel, Id) -> usize =
                    std::mem::transmute(class_getMethodImplementation(class, sel));

                set_has_unsaved_editor_tabs(false);
                assert_eq!(
                    imp(std::ptr::null_mut(), sel, std::ptr::null_mut()),
                    NS_TERMINATE_NOW
                );
                set_has_unsaved_editor_tabs(true);
                assert_eq!(
                    imp(std::ptr::null_mut(), sel, std::ptr::null_mut()),
                    NS_TERMINATE_CANCEL
                );
                set_has_unsaved_editor_tabs(false);
            }
        }
    }
}
