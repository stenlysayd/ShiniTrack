package id.shinitrack.app

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

class BackupWorker(
    private val context: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(context, workerParams) {

    companion object {
        private const val TAG = "BackupWorker"
        const val WORK_NAME = "shinitrack_periodic_backup"

        init {
            try {
                System.loadLibrary("shinitrack_app_lib")
            } catch (e: Throwable) {
                Log.e(TAG, "Failed to load native library in BackupWorker", e)
            }
        }

        fun schedule(context: Context, intervalStr: String = "24h") {
            if (intervalStr == "off") {
                cancel(context)
                return
            }
            val hours: Long = when (intervalStr) {
                "6h" -> 6
                "12h" -> 12
                "24h" -> 24
                "weekly" -> 7 * 24
                else -> 24
            }
            val constraints = Constraints.Builder()
                .setRequiresBatteryNotLow(true)
                .build()

            val workRequest = PeriodicWorkRequestBuilder<BackupWorker>(hours, TimeUnit.HOURS)
                .setConstraints(constraints)
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                workRequest
            )
            Log.i(TAG, "WorkManager periodic backup scheduled ($hours hours)")
        }

        fun schedule(context: Context, intervalHours: Long) {
            schedule(context, "${intervalHours}h")
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
            Log.i(TAG, "WorkManager periodic backup cancelled")
        }
    }

    private external fun triggerBackupWithResult(dataDir: String): String
    private external fun getBackupTreeUri(dataDir: String): String

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try {
            Log.i(TAG, "Running background auto-backup...")
            val dir = context.filesDir.absolutePath
            val backupPath = triggerBackupWithResult(dir)
            if (backupPath.isNullOrEmpty()) {
                Log.w(TAG, "Background auto-backup returned empty path")
                return@withContext Result.retry()
            }
            val backupFile = java.io.File(backupPath)
            if (!backupFile.exists() || backupFile.length() == 0L) {
                return@withContext Result.retry()
            }

            val treeUriStr = getBackupTreeUri(dir)
            if (!treeUriStr.isNullOrEmpty()) {
                try {
                    val treeUri = android.net.Uri.parse(treeUriStr)
                    val treeDoc = androidx.documentfile.provider.DocumentFile.fromTreeUri(context, treeUri)
                    if (treeDoc != null && treeDoc.canWrite()) {
                        val targetDoc = treeDoc.createFile("application/json", backupFile.name)
                        if (targetDoc != null) {
                            context.contentResolver.openOutputStream(targetDoc.uri)?.use { outStream ->
                                backupFile.inputStream().use { inStream ->
                                    inStream.copyTo(outStream)
                                }
                            }
                        }
                        val regex = Regex("^shinitrack_backup_.*\\.json$")
                        val backupDocs = treeDoc.listFiles()
                            .filter { it.name?.matches(regex) == true }
                            .sortedBy { it.lastModified() }
                        if (backupDocs.size > 5) {
                            for (i in 0 until (backupDocs.size - 5)) {
                                backupDocs[i].delete()
                            }
                        }
                    }
                } catch (te: Throwable) {
                    Log.w(TAG, "Failed copying auto-backup to tree URI, keeping internal copy", te)
                }
            }
            Log.i(TAG, "Background auto-backup completed successfully")
            Result.success()
        } catch (e: Exception) {
            Log.e(TAG, "Background auto-backup failed", e)
            Result.retry()
        }
    }
}
