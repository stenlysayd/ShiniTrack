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

        fun schedule(context: Context, intervalHours: Long = 6) {
            val constraints = Constraints.Builder()
                .setRequiresBatteryNotLow(true)
                .build()

            val workRequest = PeriodicWorkRequestBuilder<BackupWorker>(intervalHours, TimeUnit.HOURS)
                .setConstraints(constraints)
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                workRequest
            )
            Log.i(TAG, "WorkManager periodic backup scheduled ($intervalHours hours)")
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
            Log.i(TAG, "WorkManager periodic backup cancelled")
        }
    }

    private external fun triggerBackup(dataDir: String): Boolean

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try {
            Log.i(TAG, "Running background auto-backup...")
            val dir = context.filesDir.absolutePath
            val success = triggerBackup(dir)
            if (success) {
                ShiniBridge.syncBackupsToTree(context)
                Log.i(TAG, "Background auto-backup completed successfully")
                Result.success()
            } else {
                Log.w(TAG, "Background auto-backup returned false")
                Result.retry()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Background auto-backup failed", e)
            Result.retry()
        }
    }
}
