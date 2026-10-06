//! JNI exports used by the Kotlin bridge (`id.shinitrack.app.ShiniBridge`).
//!
//! These run without the Tauri runtime (WorkManager / BroadcastReceiver may
//! start the process with no Activity), so they only use `backend`.

use std::path::PathBuf;

use jni::objects::{JByteArray, JClass, JObject, JString};
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

pub fn trigger_install_apk(apk_path: &str) -> anyhow::Result<crate::updater::InstallOutcome> {
    let vm = JAVA_VM.get().ok_or_else(|| anyhow::anyhow!("JavaVM not initialized"))?;
    let mut env = vm.attach_current_thread()?;
    let class = env.find_class("id/shinitrack/app/ShiniBridge")?;
    let j_path = env.new_string(apk_path)?;
    let val = env.call_static_method(
        class,
        "triggerInstallApk",
        "(Ljava/lang/String;)Ljava/lang/String;",
        &[(&j_path).into()],
    )?;
    let j_str: JString = val.l()?.into();
    let json = get_string(&mut env, &j_str).unwrap_or_default();
    let outcome: crate::updater::InstallOutcome = serde_json::from_str(&json).unwrap_or(
        crate::updater::InstallOutcome {
            success: false,
            needs_permission: false,
            message: "Gagal memproses hasil instalasi".into(),
            file_path: apk_path.to_string(),
        },
    );
    Ok(outcome)
}

pub fn can_install_packages() -> anyhow::Result<bool> {
    let vm = JAVA_VM.get().ok_or_else(|| anyhow::anyhow!("JavaVM not initialized"))?;
    let mut env = vm.attach_current_thread()?;
    let class = env.find_class("id/shinitrack/app/ShiniBridge")?;
    let val = env.call_static_method(class, "canInstallPackages", "()Z", &[])?;
    Ok(val.z()?)
}

pub fn request_install_permission() -> anyhow::Result<bool> {
    let vm = JAVA_VM.get().ok_or_else(|| anyhow::anyhow!("JavaVM not initialized"))?;
    let mut env = vm.attach_current_thread()?;
    let class = env.find_class("id/shinitrack/app/ShiniBridge")?;
    let val = env.call_static_method(class, "requestInstallPermission", "()Z", &[])?;
    Ok(val.z()?)
}

pub fn is_wifi_connected() -> anyhow::Result<bool> {
    let vm = JAVA_VM.get().ok_or_else(|| anyhow::anyhow!("JavaVM not initialized"))?;
    let mut env = vm.attach_current_thread()?;

    // Try obtaining Android Context:
    // 1) ActivityThread.currentApplication()
    // 2) Fallback to ShiniBridge.INSTANCE.getCurrentActivity()
    let context = match (|| -> anyhow::Result<JObject> {
        let act_thread_class = env.find_class("android/app/ActivityThread")?;
        let app_obj = env
            .call_static_method(
                act_thread_class,
                "currentApplication",
                "()Landroid/app/Application;",
                &[],
            )?
            .l()?;
        if app_obj.is_null() {
            anyhow::bail!("currentApplication is null");
        }
        Ok(app_obj)
    })() {
        Ok(ctx) => ctx,
        Err(_) => {
            let _ = env.exception_clear();
            let bridge_class = env.find_class("id/shinitrack/app/ShiniBridge")?;
            let instance = env
                .get_static_field(
                    &bridge_class,
                    "INSTANCE",
                    "Lid/shinitrack/app/ShiniBridge;",
                )?
                .l()?;
            let act = env
                .call_method(
                    instance,
                    "getCurrentActivity",
                    "()Landroid/app/Activity;",
                    &[],
                )?
                .l()?;
            if act.is_null() {
                anyhow::bail!("No Android context available");
            }
            act
        }
    };

    // Get ConnectivityManager: context.getSystemService("connectivity")
    let service_name = env.new_string("connectivity")?;
    let cm = env
        .call_method(
            &context,
            "getSystemService",
            "(Ljava/lang/String;)Ljava/lang/Object;",
            &[(&service_name).into()],
        )?
        .l()?;
    if cm.is_null() {
        return Ok(false);
    }

    // Try API 23+ getActiveNetwork -> getNetworkCapabilities -> hasTransport(TRANSPORT_WIFI = 1)
    let has_wifi_caps = (|| -> anyhow::Result<bool> {
        let active_net = env
            .call_method(&cm, "getActiveNetwork", "()Landroid/net/Network;", &[])?
            .l()?;
        if active_net.is_null() {
            return Ok(false);
        }
        let caps = env
            .call_method(
                &cm,
                "getNetworkCapabilities",
                "(Landroid/net/Network;)Landroid/net/NetworkCapabilities;",
                &[(&active_net).into()],
            )?
            .l()?;
        if caps.is_null() {
            return Ok(false);
        }
        // NetworkCapabilities.TRANSPORT_WIFI = 1
        let has_wifi = env
            .call_method(&caps, "hasTransport", "(I)Z", &[1.into()])?
            .z()?;
        Ok(has_wifi)
    })();

    if let Ok(res) = has_wifi_caps {
        return Ok(res);
    }
    let _ = env.exception_clear();

    // Fallback for older APIs: cm.getActiveNetworkInfo() -> isConnected() && getType() == TYPE_WIFI (1)
    let net_info = env
        .call_method(
            &cm,
            "getActiveNetworkInfo",
            "()Landroid/net/NetworkInfo;",
            &[],
        )?
        .l()?;
    if net_info.is_null() {
        return Ok(false);
    }
    let is_connected = env.call_method(&net_info, "isConnected", "()Z", &[])?.z()?;
    if !is_connected {
        return Ok(false);
    }
    let net_type = env.call_method(&net_info, "getType", "()I", &[])?.i()?;
    // ConnectivityManager.TYPE_WIFI = 1
    Ok(net_type == 1)
}

pub fn show_native_notification(notice: &backend::Notice) -> anyhow::Result<()> {
    let vm = JAVA_VM.get().ok_or_else(|| anyhow::anyhow!("JavaVM not initialized"))?;
    let mut env = vm.attach_current_thread()?;
    let class = env.find_class("id/shinitrack/app/ShiniBridge")?;
    let json = serde_json::to_string(notice)?;
    let j_json = env.new_string(&json)?;
    env.call_static_method(
        class,
        "showNotification",
        "(Ljava/lang/String;)V",
        &[(&j_json).into()],
    )?;
    Ok(())
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

/// Periodic auto-backup triggered by WorkManager BackupWorker.
#[no_mangle]
pub extern "system" fn Java_id_shinitrack_app_BackupWorker_triggerBackup(
    mut env: JNIEnv,
    _this: JObject,
    data_dir: JString,
) -> jboolean {
    init_logging();
    let Some(dir) = get_string(&mut env, &data_dir) else {
        return JNI_FALSE;
    };
    match crate::commands::backup_create_headless(&PathBuf::from(dir)) {
        Ok(res) => {
            log::info!(
                "BackupWorker completed: {} (favs: {}, cats: {})",
                res.file_path,
                res.favorites_count,
                res.categories_count
            );
            JNI_TRUE
        }
        Err(e) => {
            log::error!("BackupWorker backup failed: {e:#}");
            JNI_FALSE
        }
    }
}

