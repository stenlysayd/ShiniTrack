package id.shinitrack.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.widget.Toast
import androidx.documentfile.provider.DocumentFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.concurrent.thread

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

    private const val SAF_PREFS = "shini_saf"
    private const val SAF_BACKUP_KEY = "auto_backup_tree_uri"
    private const val SAF_EXPORT_KEY = "export_tree_uri"

    private data class SafRequest(
        val action: String,
        val kind: String = "",
        val sourcePath: String = "",
        val defaultName: String = ""
    )

    @Volatile
    private var pendingSafRequest: SafRequest? = null

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
        return try {
            val ctx = appContext ?: currentActivity?.applicationContext
            if (ctx == null) {
                installResult(false, false, "Context aplikasi tidak tersedia.", apkPath)
            } else {
                installApk(ctx.applicationContext, apkPath)
            }
        } catch (e: Throwable) {
            Log.e(TAG, "triggerInstallApk failed", e)
            installResult(false, false, "Gagal membuka penginstal: ${e.message ?: e.javaClass.simpleName}", apkPath)
        }
    }

    private fun installResult(success: Boolean, needsPermission: Boolean, message: String, filePath: String): String {
        return JSONObject().apply {
            put("success", success)
            put("needsPermission", needsPermission)
            put("message", message)
            put("file_path", filePath)
        }.toString()
    }

    fun installApk(context: Context, apkPath: String): String {
        return try {
            val ctx = context.applicationContext
            val file = File(apkPath)
            if (!file.exists() || !file.isFile || file.length() <= 0L) {
                Log.e(TAG, "APK file does not exist or is empty: $apkPath")
                return installResult(false, false, "File APK tidak ditemukan atau kosong: $apkPath", apkPath)
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !ctx.packageManager.canRequestPackageInstalls()) {
                Log.w(TAG, "REQUEST_INSTALL_PACKAGES not granted. Launching unknown sources settings")
                pendingApkPath = apkPath
                val settingsIntent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                    data = Uri.parse("package:${ctx.packageName}")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                ctx.startActivity(settingsIntent)
                return installResult(
                    false,
                    true,
                    "Aktifkan izin pasang aplikasi dari ShiniTrack, lalu ketuk Pasang Pembaruan lagi.",
                    apkPath
                )
            }

            val apkUri = androidx.core.content.FileProvider.getUriForFile(
                ctx,
                "id.shinitrack.app.fileprovider",
                file
            )
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(apkUri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }

            ctx.startActivity(intent)
            Log.i(TAG, "Successfully started package installer intent for $apkPath")
            installResult(true, false, "Membuka penginstal paket Android...", apkPath)
        } catch (e: Throwable) {
            Log.e(TAG, "Failed to launch package installer for $apkPath", e)
            installResult(false, false, "Gagal membuka penginstal: ${e.message ?: e.javaClass.simpleName}", apkPath)
        }
    }

    private fun safPrefs(context: Context) =
        context.applicationContext.getSharedPreferences(SAF_PREFS, Context.MODE_PRIVATE)

    private fun safKey(kind: String): String {
        return when (kind.lowercase()) {
            "backup", "auto_backup", "auto-backup", "cadangan" -> SAF_BACKUP_KEY
            else -> SAF_EXPORT_KEY
        }
    }

    private fun toast(context: Context?, message: String) {
        val ctx = (context ?: currentActivity ?: appContext)?.applicationContext ?: return
        Handler(Looper.getMainLooper()).post {
            Toast.makeText(ctx, message, Toast.LENGTH_SHORT).show()
        }
    }

    private fun activeMainActivity(): MainActivity? {
        val activity = currentActivity as? MainActivity
        if (activity == null) {
            toast(null, "Buka ShiniTrack sebelum memilih folder.")
        }
        return activity
    }

    @JvmStatic
    fun openDocumentTree(kind: String): Boolean {
        return try {
            val activity = activeMainActivity() ?: return false
            val normalizedKind = if (safKey(kind) == SAF_BACKUP_KEY) "backup" else "export"
            pendingSafRequest = SafRequest(action = "open_tree", kind = normalizedKind)
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                addFlags(
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or
                        Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                        Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                        Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
                )
            }
            if (!activity.launchSafIntent(intent)) {
                pendingSafRequest = null
                toast(activity, "Gagal membuka pemilih folder.")
                return false
            }
            true
        } catch (e: Throwable) {
            pendingSafRequest = null
            Log.e(TAG, "openDocumentTree failed", e)
            toast(null, "Gagal membuka pemilih folder: ${e.message ?: e.javaClass.simpleName}")
            false
        }
    }

    @JvmStatic
    fun createSafDocument(sourcePath: String, defaultName: String): Boolean {
        return try {
            val activity = activeMainActivity() ?: return false
            val source = File(sourcePath)
            if (!source.exists() || !source.isFile || source.length() <= 0L) {
                toast(activity, "Berkas cadangan tidak ditemukan.")
                return false
            }
            val name = defaultName.ifBlank { source.name.ifBlank { "shinitrack_backup.json" } }
            pendingSafRequest = SafRequest(
                action = "create_document",
                sourcePath = source.absolutePath,
                defaultName = name
            )
            val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "application/json"
                putExtra(Intent.EXTRA_TITLE, name)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            }
            if (!activity.launchSafIntent(intent)) {
                pendingSafRequest = null
                toast(activity, "Gagal membuka penyimpan berkas.")
                return false
            }
            true
        } catch (e: Throwable) {
            pendingSafRequest = null
            Log.e(TAG, "createSafDocument failed", e)
            toast(null, "Gagal menyimpan cadangan: ${e.message ?: e.javaClass.simpleName}")
            false
        }
    }

    @JvmStatic
    fun shareDocument(sourcePath: String): Boolean {
        return try {
            val ctx = appContext ?: currentActivity?.applicationContext
            if (ctx == null) {
                toast(null, "Context aplikasi tidak tersedia.")
                return false
            }
            val file = File(sourcePath)
            if (!file.exists() || !file.isFile || file.length() <= 0L) {
                toast(ctx, "Berkas cadangan tidak ditemukan.")
                return false
            }
            val uri = androidx.core.content.FileProvider.getUriForFile(
                ctx,
                "id.shinitrack.app.fileprovider",
                file
            )
            val sendIntent = Intent(Intent.ACTION_SEND).apply {
                type = "application/json"
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val chooser = Intent.createChooser(sendIntent, "Bagikan cadangan").apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            ctx.startActivity(chooser)
            true
        } catch (e: Throwable) {
            Log.e(TAG, "shareDocument failed", e)
            toast(null, "Gagal membagikan cadangan: ${e.message ?: e.javaClass.simpleName}")
            false
        }
    }

    @JvmStatic
    fun copyDownloadsToTree(): Boolean {
        return try {
            val ctx = appContext ?: currentActivity?.applicationContext
            if (ctx == null) {
                toast(null, "Context aplikasi tidak tersedia.")
                return false
            }
            val treeUriString = safPrefs(ctx).getString(SAF_EXPORT_KEY, "") ?: ""
            if (treeUriString.isBlank()) {
                toast(ctx, "Pilih folder ekspor unduhan dulu.")
                return false
            }
            thread(name = "ShiniTrackDownloadsExport") {
                try {
                    val downloadsDir = File(ctx.filesDir, "downloads")
                    val tree = DocumentFile.fromTreeUri(ctx, Uri.parse(treeUriString))
                    if (tree == null || !tree.isDirectory) {
                        toast(ctx, "Folder ekspor unduhan tidak dapat dibuka.")
                        return@thread
                    }
                    if (!downloadsDir.exists()) {
                        toast(ctx, "Belum ada unduhan untuk disalin.")
                        return@thread
                    }
                    val stats = CopyStats()
                    copyDirectoryContents(ctx, downloadsDir, tree, stats)
                    toast(ctx, "Unduhan disalin: ${stats.files} berkas (${formatBytes(stats.bytes)}).")
                } catch (e: Throwable) {
                    Log.e(TAG, "copyDownloadsToTree worker failed", e)
                    toast(ctx, "Gagal menyalin unduhan: ${e.message ?: e.javaClass.simpleName}")
                }
            }
            true
        } catch (e: Throwable) {
            Log.e(TAG, "copyDownloadsToTree failed", e)
            toast(null, "Gagal menyalin unduhan: ${e.message ?: e.javaClass.simpleName}")
            false
        }
    }

    @JvmStatic
    fun getSafState(): String {
        return try {
            val ctx = appContext ?: currentActivity?.applicationContext ?: return "{}"
            val prefs = safPrefs(ctx)
            JSONObject().apply {
                put("backup_tree", treeDisplayName(ctx, prefs.getString(SAF_BACKUP_KEY, "") ?: ""))
                put("export_tree", treeDisplayName(ctx, prefs.getString(SAF_EXPORT_KEY, "") ?: ""))
            }.toString()
        } catch (e: Throwable) {
            Log.e(TAG, "getSafState failed", e)
            "{}"
        }
    }

    @JvmStatic
    fun syncBackupsToTree(context: Context): Boolean {
        return try {
            val ctx = context.applicationContext
            val treeUriString = safPrefs(ctx).getString(SAF_BACKUP_KEY, "") ?: ""
            if (treeUriString.isBlank()) {
                return true
            }
            val backupDir = File(ctx.filesDir, "backups")
            if (!backupDir.exists()) {
                return true
            }
            val tree = DocumentFile.fromTreeUri(ctx, Uri.parse(treeUriString)) ?: return false
            val backups = backupDir
                .listFiles { file -> file.isFile && file.name.startsWith("shinitrack_backup_") && file.name.endsWith(".json") }
                ?.sortedByDescending { it.lastModified() }
                ?: emptyList()
            var copied = 0
            for (source in backups) {
                val existing = findChild(tree, source.name)
                if (existing != null && existing.isFile && existing.length() == source.length()) {
                    continue
                }
                existing?.delete()
                val target = tree.createFile("application/json", source.name) ?: continue
                copyFileToUri(ctx, source, target.uri)
                copied += 1
            }
            trimSafBackups(tree, 5)
            if (copied > 0) {
                toast(ctx, "Cadangan otomatis disalin ke folder pilihan.")
            }
            true
        } catch (e: Throwable) {
            Log.e(TAG, "syncBackupsToTree failed", e)
            toast(context, "Gagal menyalin cadangan otomatis: ${e.message ?: e.javaClass.simpleName}")
            false
        }
    }

    @JvmStatic
    fun handleSafActivityResult(context: Context, resultCode: Int, data: Intent?) {
        val request = pendingSafRequest
        pendingSafRequest = null
        if (request == null) {
            return
        }
        try {
            if (resultCode != Activity.RESULT_OK || data?.data == null) {
                toast(context, "Aksi dibatalkan.")
                return
            }
            val uri = data.data ?: return
            when (request.action) {
                "open_tree" -> {
                    val flags = data.flags and (
                        Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    )
                    if (flags != 0) {
                        context.contentResolver.takePersistableUriPermission(uri, flags)
                    }
                    safPrefs(context).edit()
                        .putString(safKey(request.kind), uri.toString())
                        .apply()
                    val label = if (safKey(request.kind) == SAF_BACKUP_KEY) "cadangan otomatis" else "ekspor unduhan"
                    toast(context, "Folder $label disimpan.")
                }
                "create_document" -> {
                    val source = File(request.sourcePath)
                    copyFileToUri(context.applicationContext, source, uri)
                    toast(context, "Cadangan disimpan.")
                }
            }
        } catch (e: Throwable) {
            Log.e(TAG, "handleSafActivityResult failed", e)
            toast(context, "Gagal menyelesaikan aksi: ${e.message ?: e.javaClass.simpleName}")
        }
    }

    private data class CopyStats(var files: Int = 0, var bytes: Long = 0L)

    private fun copyDirectoryContents(
        context: Context,
        sourceDir: File,
        targetDir: DocumentFile,
        stats: CopyStats
    ) {
        sourceDir.listFiles()?.forEach { source ->
            if (source.isDirectory) {
                val childDir = ensureDirectory(targetDir, source.name) ?: return@forEach
                copyDirectoryContents(context, source, childDir, stats)
            } else if (source.isFile) {
                val existing = findChild(targetDir, source.name)
                if (existing != null && existing.isFile && existing.length() == source.length()) {
                    return@forEach
                }
                existing?.delete()
                val target = targetDir.createFile(mimeFor(source.name), source.name) ?: return@forEach
                copyFileToUri(context, source, target.uri)
                stats.files += 1
                stats.bytes += source.length()
            }
        }
    }

    private fun ensureDirectory(parent: DocumentFile, name: String): DocumentFile? {
        val existing = findChild(parent, name)
        if (existing != null && existing.isDirectory) {
            return existing
        }
        existing?.delete()
        return parent.createDirectory(name)
    }

    private fun findChild(parent: DocumentFile, name: String): DocumentFile? {
        return parent.listFiles().firstOrNull { it.name == name }
    }

    private fun copyFileToUri(context: Context, source: File, targetUri: Uri) {
        source.inputStream().use { input ->
            val output = context.contentResolver.openOutputStream(targetUri, "w")
                ?: throw IllegalStateException("Output SAF tidak tersedia")
            output.use { input.copyTo(it) }
        }
    }

    private fun trimSafBackups(tree: DocumentFile, keepCount: Int) {
        tree.listFiles()
            .filter { it.isFile && (it.name ?: "").startsWith("shinitrack_backup_") && (it.name ?: "").endsWith(".json") }
            .sortedWith(compareByDescending<DocumentFile> { it.lastModified() }.thenByDescending { it.name ?: "" })
            .drop(keepCount)
            .forEach { it.delete() }
    }

    private fun treeDisplayName(context: Context, treeUriString: String): String {
        if (treeUriString.isBlank()) return ""
        return try {
            val tree = DocumentFile.fromTreeUri(context, Uri.parse(treeUriString))
            tree?.name ?: ""
        } catch (e: Throwable) {
            Log.w(TAG, "Failed to read SAF tree name", e)
            ""
        }
    }

    private fun mimeFor(name: String): String {
        return when (name.substringAfterLast('.', "").lowercase()) {
            "jpg", "jpeg" -> "image/jpeg"
            "png" -> "image/png"
            "webp" -> "image/webp"
            "gif" -> "image/gif"
            "json" -> "application/json"
            else -> "application/octet-stream"
        }
    }

    private fun formatBytes(bytes: Long): String {
        if (bytes <= 0L) return "0 B"
        val units = arrayOf("B", "KB", "MB", "GB")
        var value = bytes * 1.0
        var unit = 0
        while (value >= 1024.0 && unit < units.lastIndex) {
            value /= 1024.0
            unit += 1
        }
        return if (unit == 0) {
            "${bytes} B"
        } else {
            String.format(java.util.Locale.US, "%.1f %s", value, units[unit])
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

