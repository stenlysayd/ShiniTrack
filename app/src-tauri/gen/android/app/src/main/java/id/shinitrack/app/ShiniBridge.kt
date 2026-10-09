package id.shinitrack.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.activity.result.ActivityResultLauncher
import androidx.core.content.FileProvider
import androidx.documentfile.provider.DocumentFile
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
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

    @Volatile
    var safLauncher: ActivityResultLauncher<Intent>? = null

    @Volatile
    var pendingKind: String? = null

    @Volatile
    var pendingPayload: String? = null

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
    external fun nativeOnSafResult(kind: String, ok: Boolean, message: String, uri: String?)
    external fun nativeOnExportProgress(done: Int, total: Int)

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
        try {
            val ctx = appContext ?: currentActivity
            if (ctx == null) {
                return "ERR:Context tidak tersedia"
            }
            val file = File(apkPath)
            if (!file.exists() || file.length() <= 0) {
                return "ERR:file tidak ditemukan"
            }
            if (Build.VERSION.SDK_INT >= 26 && !ctx.packageManager.canRequestPackageInstalls()) {
                val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                    data = Uri.parse("package:${ctx.packageName}")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                ctx.startActivity(intent)
                return "NEED_PERMISSION"
            }
            val apkUri = androidx.core.content.FileProvider.getUriForFile(
                ctx,
                "${ctx.packageName}.fileprovider",
                file
            )
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(apkUri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            ctx.startActivity(intent)
            return "OK"
        } catch (t: Throwable) {
            return "ERR:" + (t.message ?: t.javaClass.simpleName)
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

    @JvmStatic
    fun saveBackupSaf(filePath: String): Boolean {
        return try {
            val launcher = safLauncher ?: return false
            val file = File(filePath)
            if (!file.exists()) return false
            pendingKind = "save_backup"
            pendingPayload = filePath
            val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "application/json"
                putExtra(Intent.EXTRA_TITLE, file.name)
            }
            launcher.launch(intent)
            true
        } catch (e: Throwable) {
            Log.e(TAG, "saveBackupSaf failed", e)
            false
        }
    }

    @JvmStatic
    fun shareBackup(filePath: String): Boolean {
        return try {
            val ctx = currentActivity ?: appContext ?: return false
            val file = File(filePath)
            if (!file.exists()) return false
            val uri = FileProvider.getUriForFile(
                ctx,
                "${ctx.packageName}.fileprovider",
                file
            )
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "application/json"
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                if (ctx !is Activity) {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            }
            val chooser = Intent.createChooser(intent, "Bagikan berkas cadangan").apply {
                if (ctx !is Activity) {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            }
            ctx.startActivity(chooser)
            notifySafResult("share_backup", true, "Membuka dialog berbagi", null)
            true
        } catch (e: Throwable) {
            Log.e(TAG, "shareBackup failed", e)
            notifySafResult("share_backup", false, e.message ?: "Gagal membagikan berkas", null)
            false
        }
    }

    @JvmStatic
    fun pickTree(kind: String): Boolean {
        return try {
            val launcher = safLauncher ?: return false
            pendingKind = kind
            pendingPayload = null
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                addFlags(
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                )
            }
            launcher.launch(intent)
            true
        } catch (e: Throwable) {
            Log.e(TAG, "pickTree failed", e)
            false
        }
    }

    @JvmStatic
    fun openRestoreDocument(): Boolean {
        return try {
            val launcher = safLauncher ?: return false
            pendingKind = "restore"
            pendingPayload = null
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "application/json"
                putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/json", "application/octet-stream", "*/*"))
            }
            launcher.launch(intent)
            true
        } catch (e: Throwable) {
            Log.e(TAG, "openRestoreDocument failed", e)
            false
        }
    }

    @JvmStatic
    fun getTreeFolderName(treeUriStr: String): String? {
        val ctx = appContext ?: currentActivity ?: return null
        return try {
            val uri = Uri.parse(treeUriStr)
            val doc = DocumentFile.fromTreeUri(ctx, uri)
            if (doc != null && doc.canWrite()) {
                doc.name ?: "Folder Terpilih"
            } else {
                null
            }
        } catch (e: Throwable) {
            null
        }
    }

    fun handleActivityResult(activity: Activity, resultCode: Int, data: Intent?) {
        val kind = pendingKind ?: return
        val payload = pendingPayload
        pendingKind = null
        pendingPayload = null

        if (resultCode != Activity.RESULT_OK || data == null || data.data == null) {
            notifySafResult(kind, false, "Dibatalkan oleh pengguna", null)
            return
        }

        val targetUri = data.data!!
        CoroutineScope(Dispatchers.IO).launch {
            try {
                when (kind) {
                    "save_backup" -> {
                        val srcFile = File(payload ?: "")
                        if (!srcFile.exists()) {
                            notifySafResult(kind, false, "Berkas cadangan tidak ditemukan", null)
                            return@launch
                        }
                        activity.contentResolver.openOutputStream(targetUri)?.use { outStream ->
                            srcFile.inputStream().use { inStream ->
                                inStream.copyTo(outStream)
                            }
                        }
                        notifySafResult(kind, true, "Cadangan berhasil disimpan", targetUri.toString())
                    }
                    "pick_tree", "pick_export_tree" -> {
                        val flags = data.flags and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                        val takeFlags = if (flags != 0) flags else (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                        try {
                            activity.contentResolver.takePersistableUriPermission(targetUri, takeFlags)
                        } catch (e: SecurityException) {
                            Log.w(TAG, "takePersistableUriPermission failed", e)
                        }
                        val doc = DocumentFile.fromTreeUri(activity, targetUri)
                        val folderName = doc?.name ?: targetUri.lastPathSegment ?: "Folder Terpilih"
                        notifySafResult(kind, true, folderName, targetUri.toString())
                    }
                    "restore" -> {
                        val cacheDir = File(activity.filesDir, "cache")
                        if (!cacheDir.exists()) cacheDir.mkdirs()
                        val restoreFile = File(cacheDir, "restore.json")
                        activity.contentResolver.openInputStream(targetUri)?.use { inStream ->
                            restoreFile.outputStream().use { outStream ->
                                inStream.copyTo(outStream)
                            }
                        }
                        notifySafResult(kind, true, restoreFile.absolutePath, targetUri.toString())
                    }
                    else -> {
                        notifySafResult(kind, false, "Aksi SAF tidak dikenal: $kind", null)
                    }
                }
            } catch (t: Throwable) {
                Log.e(TAG, "Error handling SAF result for $kind", t)
                notifySafResult(kind, false, t.message ?: "Terjadi kesalahan saat memproses berkas", null)
            }
        }
    }

    fun notifySafResult(kind: String, ok: Boolean, message: String, uri: String?) {
        try {
            if (isLoaded) {
                nativeOnSafResult(kind, ok, message, uri)
            }
        } catch (t: Throwable) {
            Log.e(TAG, "nativeOnSafResult failed", t)
        }
    }

    @JvmStatic
    fun exportDownloadsToTree(treeUriStr: String): Boolean {
        val ctx = appContext ?: currentActivity ?: return false
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val treeUri = Uri.parse(treeUriStr)
                val destTree = DocumentFile.fromTreeUri(ctx, treeUri)
                if (destTree == null || !destTree.canWrite()) {
                    notifySafResult("export_downloads", false, "Folder tujuan tidak dapat ditulis", null)
                    return@launch
                }
                val downloadsDir = File(ctx.filesDir, "downloads")
                if (!downloadsDir.exists() || !downloadsDir.isDirectory) {
                    notifySafResult("export_downloads", true, "Tidak ada unduhan untuk disalin", treeUriStr)
                    return@launch
                }

                fun countFiles(dir: File): Int {
                    var count = 0
                    dir.listFiles()?.forEach { file ->
                        if (file.isDirectory) {
                            count += countFiles(file)
                        } else if (!file.name.endsWith(".part")) {
                            count += 1
                        }
                    }
                    return count
                }

                val total = countFiles(downloadsDir)
                if (total == 0) {
                    notifySafResult("export_downloads", true, "Tidak ada berkas unduhan untuk disalin", treeUriStr)
                    return@launch
                }

                var done = 0

                fun copyRecursive(src: File, parentDoc: DocumentFile) {
                    val files = src.listFiles() ?: return
                    for (file in files) {
                        if (file.isDirectory) {
                            var subDoc = parentDoc.findFile(file.name)
                            if (subDoc == null || !subDoc.isDirectory) {
                                subDoc = parentDoc.createDirectory(file.name)
                            }
                            if (subDoc != null) {
                                copyRecursive(file, subDoc)
                            }
                        } else {
                            if (file.name.endsWith(".part")) continue
                            val existing = parentDoc.findFile(file.name)
                            if (existing != null && existing.isFile && existing.length() == file.length()) {
                                done++
                                notifyExportProgress(done, total)
                                continue
                            }
                            val mime = when {
                                file.name.endsWith(".jpg", true) || file.name.endsWith(".jpeg", true) -> "image/jpeg"
                                file.name.endsWith(".png", true) -> "image/png"
                                file.name.endsWith(".webp", true) -> "image/webp"
                                else -> "application/octet-stream"
                            }
                            val destFile = existing ?: parentDoc.createFile(mime, file.name)
                            if (destFile != null) {
                                ctx.contentResolver.openOutputStream(destFile.uri)?.use { outStream ->
                                    file.inputStream().use { inStream ->
                                        inStream.copyTo(outStream)
                                    }
                                }
                            }
                            done++
                            notifyExportProgress(done, total)
                        }
                    }
                }

                notifyExportProgress(0, total)
                copyRecursive(downloadsDir, destTree)
                notifySafResult("export_downloads", true, "Unduhan berhasil disalin ($done berkas)", treeUriStr)
            } catch (t: Throwable) {
                Log.e(TAG, "exportDownloadsToTree failed", t)
                notifySafResult("export_downloads", false, t.message ?: "Gagal menyalin unduhan", null)
            }
        }
        return true
    }

    fun notifyExportProgress(done: Int, total: Int) {
        try {
            if (isLoaded) {
                nativeOnExportProgress(done, total)
            }
        } catch (t: Throwable) {
            Log.e(TAG, "nativeOnExportProgress failed", t)
        }
    }

    @JvmStatic
    fun rescheduleBackupWorker(intervalStr: String) {
        val ctx = appContext ?: currentActivity ?: return
        try {
            BackupWorker.schedule(ctx, intervalStr)
        } catch (e: Throwable) {
            Log.e(TAG, "rescheduleBackupWorker failed", e)
        }
    }
}

