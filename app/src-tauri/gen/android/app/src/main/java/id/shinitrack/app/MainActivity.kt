package id.shinitrack.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat

class MainActivity : TauriActivity() {
    companion object {
        private const val TAG = "MainActivity"
    }

    private val requestNotificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        Log.i(TAG, "POST_NOTIFICATIONS granted: $isGranted")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        try {
            enableEdgeToEdge()
        } catch (e: Throwable) {
            Log.w(TAG, "enableEdgeToEdge not supported", e)
        }

        try {
            ShiniBridge.init(this)
        } catch (e: Throwable) {
            Log.e(TAG, "ShiniBridge.init failed", e)
        }

        try {
            Notif.ensureChannel(this)
        } catch (e: Throwable) {
            Log.e(TAG, "Notif.ensureChannel failed", e)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            try {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                    requestNotificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
            } catch (e: Throwable) {
                Log.e(TAG, "Permission request failed", e)
            }
        }

        try {
            UpdateWorker.schedule(this)
        } catch (e: Throwable) {
            Log.e(TAG, "UpdateWorker.schedule failed", e)
        }

        try {
            registerUnifiedPush()
        } catch (e: Throwable) {
            Log.e(TAG, "registerUnifiedPush failed", e)
        }

        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        val data: Uri? = intent?.data
        if (data != null && data.scheme == "shinitrack" && data.host == "manga") {
            val mangaId = data.lastPathSegment
            if (!mangaId.isNullOrEmpty()) {
                Log.i(TAG, "Navigating to comic deep link: $mangaId")
                // On Tauri, eval JavaScript hash navigation
                // window.location.hash = '#/manga/$mangaId'
            }
        }
    }

    private fun registerUnifiedPush() {
        val intent = Intent("org.unifiedpush.android.connector.REGISTER").apply {
            putExtra("features", arrayOf("org.unifiedpush.android.connector.FEATURE_BYTES_MESSAGE"))
        }
        sendBroadcast(intent)
        Log.i(TAG, "Sent UnifiedPush registration broadcast")
    }
}
