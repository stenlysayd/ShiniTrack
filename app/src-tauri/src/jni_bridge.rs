//! JNI exports used by the Kotlin bridge (`id.shinitrack.app.ShiniBridge`).
//!
//! These run without the Tauri runtime (WorkManager / BroadcastReceiver may
//! start the process with no Activity), so they only use `backend`.

use std::path::PathBuf;

use jni::objects::{JByteArray, JClass, JString};
use jni::sys::{jboolean, jstring, JNI_FALSE, JNI_TRUE};
use jni::JNIEnv;

use crate::backend;

fn init_logging() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        android_logger::init_once(
            android_logger::Config::default()
                .with_max_level(log::LevelFilter::Info)
                .with_tag("ShiniTrack"),
        );
    });
}

fn get_string(env: &mut JNIEnv, s: &JString) -> Option<String> {
    if s.is_null() {
        return None;
    }
    env.get_string(s).ok().map(|s| s.into())
}

fn to_jstring(env: &mut JNIEnv, s: &str) -> jstring {
    env.new_string(s)
        .map(|j| j.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

fn notices_json(r: anyhow::Result<Vec<backend::Notice>>) -> String {
    match r {
        Ok(n) => serde_json::to_string(&n).unwrap_or_else(|_| "[]".into()),
        Err(e) => {
            log::warn!("bridge call failed: {e:#}");
            "[]".into()
        }
    }
}

static JAVA_VM: std::sync::OnceLock<jni::JavaVM> = std::sync::OnceLock::new();

/// Called from `MainActivity.onCreate` before Tauri starts, and from every
/// background entry point, so all code paths share one data directory.
#[no_mangle]
pub extern "system" fn Java_id_shinitrack_app_ShiniBridge_nativeInit(
    mut env: JNIEnv,
    _class: JClass,
    data_dir: JString,
) {
    init_logging();
    if let Ok(vm) = env.get_java_vm() {
        let _ = JAVA_VM.set(vm);
    }
    if let Some(d) = get_string(&mut env, &data_dir) {
        backend::set_data_dir_override(PathBuf::from(d));
    }
}

pub fn trigger_install_apk(apk_path: &str) -> anyhow::Result<bool> {
    let vm = JAVA_VM.get().ok_or_else(|| anyhow::anyhow!("JavaVM not initialized"))?;
    let mut env = vm.attach_current_thread()?;
    let class = env.find_class("id/shinitrack/app/ShiniBridge")?;
    let j_path = env.new_string(apk_path)?;
    let val = env.call_static_method(
        class,
        "triggerInstallApk",
        "(Ljava/lang/String;)Z",
        &[(&j_path).into()],
    )?;
    Ok(val.z()?)
}

/// WorkManager periodic job. Returns a JSON array of notices.
#[no_mangle]
pub extern "system" fn Java_id_shinitrack_app_ShiniBridge_nativeBackgroundCheck(
    mut env: JNIEnv,
    _class: JClass,
    data_dir: JString,
) -> jstring {
    init_logging();
    let Some(dir) = get_string(&mut env, &data_dir) else {
        return to_jstring(&mut env, "[]");
    };
    let json = notices_json(backend::block_on(backend::background_check(&PathBuf::from(dir))));
    to_jstring(&mut env, &json)
}

/// UnifiedPush message. Returns a JSON array of notices (0 or 1).
#[no_mangle]
pub extern "system" fn Java_id_shinitrack_app_ShiniBridge_nativeHandlePush(
    mut env: JNIEnv,
    _class: JClass,
    data_dir: JString,
    payload: JByteArray,
) -> jstring {
    init_logging();
    let dir = get_string(&mut env, &data_dir);
    let bytes = env.convert_byte_array(&payload).unwrap_or_default();
    let json = match dir {
        Some(d) => notices_json(backend::handle_push(&PathBuf::from(d), &bytes)),
        None => "[]".into(),
    };
    to_jstring(&mut env, &json)
}

/// New / removed UnifiedPush endpoint. Blocking network call: run off the main thread.
#[no_mangle]
pub extern "system" fn Java_id_shinitrack_app_ShiniBridge_nativeRegisterEndpoint(
    mut env: JNIEnv,
    _class: JClass,
    data_dir: JString,
    endpoint: JString,
) -> jboolean {
    init_logging();
    let Some(dir) = get_string(&mut env, &data_dir) else { return JNI_FALSE };
    let endpoint = get_string(&mut env, &endpoint);
    match backend::block_on(backend::register_endpoint(&PathBuf::from(dir), endpoint)) {
        Ok(()) => JNI_TRUE,
        Err(e) => {
            log::warn!("register endpoint failed: {e:#}");
            JNI_FALSE
        }
    }
}
