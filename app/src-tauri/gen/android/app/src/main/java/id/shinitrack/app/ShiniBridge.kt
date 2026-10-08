package id.shinitrack.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

data class NoticeItem(
    val id: Int,
    val mangaId: String,
    val title: String,
    val text: String,
    val cover: String?
)

object ShiniBridge {
    private const val TAG = "ShiniBridge"
    var isLoaded: Boolean = false
        private set

    @Volatile
    private var appContext: Context? = null

    @Volatile
    var currentActivity: Activity? = null

    @Volatile
    var pendingApkPath: String? = null

    init {
        try {
            System.loadLibrary("shinitrack_app_lib")
            isLoaded = true
            Log.i(TAG, "Native library loaded successfully")
        } catch (e: Throwable) {
            Log.e(TAG, "Failed to load native library", e)
        }
    }

    external fun nativeInit(dataDir: String)
    external fun nativeBackgroundCheck(dataDir: String): String
    external fun nativeHandlePush(dataDir: String, payload: ByteArray): String
    external fun nativeRegisterEndpoint(dataDir: String, endpoint: String): Boolean

    fun init(context: Context) {
        appContext = context.applicationContext
        if (context is Activity) {
            currentActivity = context
        }
        if (!isLoaded) {
            Log.w(TAG, "Skipping nativeInit: native library not loaded")
            return
        }
        try {
            val dir = context.filesDir.absolutePath
            nativeInit(dir)
        } catch (e: Throwable) {
            Log.e(TAG, "nativeInit call failed", e)
        }
    }

    @JvmStatic
    fun canInstallPackages(): Boolean {
        val ctx = currentActivity ?: appContext ?: return false
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.packageManager.canRequestPackageInstalls()
        } else {
            true
        }
    }

    @JvmStatic
    fun requestInstallPermission(): Boolean {
        val targetContext = currentActivity ?: appContext ?: return false
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                    data = Uri.parse("package:${targetContext.packageName}")
                    if (targetContext !is Activity) {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                }
                targetContext.startActivity(intent)
                Log.i(TAG, "Launched Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES")
                true
            } else {
                true
            }
        } catch (e: Throwable) {
            Log.e(TAG, "Failed to launch unknown sources settings", e)
            false
        }
    }

    @JvmStatic
    fun triggerInstallApk(apkPath: String): String {
        val ctx = currentActivity ?: appContext
        if (ctx == null) {
            Log.e(TAG, "Cannot install APK: context is null")
            return JSONObject().apply {
                put("success", false)
                put("needsPermission", false)
                put("message", "Context aplikasi tidak tersedia.")
            }.toString()
        }
        return installApk(ctx, apkPath)
    }

    fun installApk(context: Context, apkPath: String): String {
        val result = JSONObject()
        val file = File(apkPath)
        if (!file.exists()) {
            Log.e(TAG, "APK file does not exist: $apkPath")
            result.put("success", false)
            result.put("needsPermission", false)
            result.put("message", "File APK tidak ditemukan: $apkPath")
            return result.toString()
        }

        // Check REQUEST_INSTALL_PACKAGES on Android O (API 26+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!context.packageManager.canRequestPackageInstalls()) {
                Log.w(TAG, "REQUEST_INSTALL_PACKAGES not granted. Launching unknown sources settings.")
                pendingApkPath = apkPath
                requestInstallPermission()
                result.put("success", false)
                result.put("needsPermission", true)
                result.put("message", "Izin Diperlukan: Aktifkan 'Izinkan dari sumber ini' di pengaturan Android yang terbuka, lalu ketuk 'Pasang Pembaruan'.")
                return result.toString()
            }
        }

        return try {
            file.setReadable(true, false)
            val apkUri = androidx.core.content.FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                file
            )
            val targetContext = currentActivity ?: context
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(apkUri, "application/vnd.android.package-archive")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
            }

            targetContext.startActivity(intent)
            Log.i(TAG, "Successfully started package installer intent for $apkPath")
            result.put("success", true)
            result.put("needsPermission", false)
            result.put("message", "Membuka penginstal paket Android...")
            result.toString()
        } catch (e: Throwable) {
            Log.e(TAG, "Failed to launch package installer for $apkPath", e)
            result.put("success", false)
            result.put("needsPermission", false)
            result.put("message", "Gagal membuka penginstal: ${e.message}")
            result.toString()
        }
    }

    @JvmStatic
    fun showNotification(noticeJson: String) {
        val ctx = currentActivity ?: appContext ?: return
        try {
            val obj = JSONObject(noticeJson)
            val notice = NoticeItem(
                id = obj.optInt("id", (System.currentTimeMillis() % 100000).toInt()),
                mangaId = obj.optString("manga_id", ""),
                title = obj.optString("title", "ShiniTrack"),
                text = obj.optString("text", "Chapter baru telah rilis!"),
                cover = if (obj.has("cover") && !obj.isNull("cover")) obj.getString("cover") else null
            )
            Notif.show(ctx, notice)
        } catch (e: Throwable) {
            Log.e(TAG, "Failed to show notification from native bridge", e)
        }
    }

    fun parseNotices(jsonStr: String): List<NoticeItem> {
        val list = mutableListOf<NoticeItem>()
        try {
            val arr = JSONArray(jsonStr)
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                list.add(
                    NoticeItem(
                        id = obj.optInt("id", (System.currentTimeMillis() % 100000).toInt()),
                        mangaId = obj.optString("manga_id", ""),
                        title = obj.optString("title", "ShiniTrack"),
                        text = obj.optString("text", "Chapter baru telah rilis!"),
                        cover = if (obj.has("cover") && !obj.isNull("cover")) obj.getString("cover") else null
                    )
                )
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse notices: $jsonStr", e)
        }
        return list
    }
}

