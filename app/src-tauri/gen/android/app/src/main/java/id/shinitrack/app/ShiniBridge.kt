package id.shinitrack.app

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

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
    fun triggerInstallApk(apkPath: String): Boolean {
        val ctx = appContext
        if (ctx == null) {
            Log.e(TAG, "Cannot install APK: appContext is null")
            return false
        }
        return installApk(ctx, apkPath)
    }

    fun installApk(context: Context, apkPath: String): Boolean {
        return try {
            val file = java.io.File(apkPath)
            if (!file.exists()) {
                Log.e(TAG, "APK file does not exist: $apkPath")
                return false
            }
            val apkUri = androidx.core.content.FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                file
            )
            val intent = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
                setDataAndType(apkUri, "application/vnd.android.package-archive")
                addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            Log.i(TAG, "Successfully started package installer intent for $apkPath")
            true
        } catch (e: Throwable) {
            Log.e(TAG, "Failed to launch package installer for $apkPath", e)
            false
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
