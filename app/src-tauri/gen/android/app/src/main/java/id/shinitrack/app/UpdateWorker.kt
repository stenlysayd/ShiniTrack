package id.shinitrack.app

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

class UpdateWorker(
    private val context: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(context, workerParams) {

    companion object {
        private const val TAG = "UpdateWorker"
        const val WORK_NAME = "shinitrack_periodic_check"

        fun schedule(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val workRequest = PeriodicWorkRequestBuilder<UpdateWorker>(15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                workRequest
            )
            Log.i(TAG, "WorkManager periodic update check scheduled (15 min, network connected constraint)")
        }
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try {
            ShiniBridge.init(context)
            if (!ShiniBridge.isLoaded) {
                Log.w(TAG, "Native library not loaded; skipping background check")
                return@withContext Result.failure()
            }
            Log.i(TAG, "Running background update check...")
            val dir = context.filesDir.absolutePath
            val json = ShiniBridge.nativeBackgroundCheck(dir)
            val notices = ShiniBridge.parseNotices(json)
            Log.i(TAG, "Background check returned ${notices.size} new notices")

            for (notice in notices) {
                Notif.show(context, notice)
            }
            Result.success()
        } catch (e: Throwable) {
            Log.e(TAG, "Background update check failed", e)
            Result.retry()
        }
    }
}
