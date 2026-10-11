package id.shinitrack.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.ActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import org.json.JSONObject

class MainActivity : TauriActivity() {
    companion object {
        private const val TAG = "MainActivity"
    }

    override val handleBackNavigation: Boolean = true

    private var appWebView: WebView? = null
    private var pendingDeepLinkMangaId: String? = null

    private val requestNotificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        Log.i(TAG, "POST_NOTIFICATIONS granted: $isGranted")
    }

    private val safActivityResult = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result: ActivityResult ->
        ShiniBridge.handleSafActivityResult(this, result.resultCode, result.data)
    }

    fun launchSafIntent(intent: Intent): Boolean {
        return try {
            safActivityResult.launch(intent)
            true
        } catch (e: Throwable) {
            Log.e(TAG, "SAF launch failed", e)
            false
        }
    }

    override fun onWebViewCreate(webView: WebView) {
        super.onWebViewCreate(webView)
        appWebView = webView
        pendingDeepLinkMangaId?.let { mangaId ->
            pendingDeepLinkMangaId = null
            navigateToManga(mangaId)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        try {
            ShiniBridge.init(this)
        } catch (e: Throwable) {
            Log.e(TAG, "ShiniBridge.init before super.onCreate failed", e)
        }

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
            BackupWorker.schedule(this)
        } catch (e: Throwable) {
            Log.e(TAG, "BackupWorker.schedule failed", e)
        }

        try {
            registerUnifiedPush()
        } catch (e: Throwable) {
            Log.e(TAG, "registerUnifiedPush failed", e)
        }

        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        ShiniBridge.currentActivity = this

        try {
            val pending = ShiniBridge.pendingApkPath
            if (pending != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (packageManager.canRequestPackageInstalls()) {
                    Log.i(TAG, "Install permission granted! Resuming installation for: $pending")
                    ShiniBridge.pendingApkPath = null
                    ShiniBridge.installApk(this, pending)
                }
            }
        } catch (e: Throwable) {
            Log.e(TAG, "Failed to resume APK installation", e)
        }
    }

    override fun onPause() {
        super.onPause()
        if (ShiniBridge.currentActivity === this) {
            ShiniBridge.currentActivity = null
        }
    }

    override fun onDestroy() {
        appWebView = null
        if (ShiniBridge.currentActivity === this) {
            ShiniBridge.currentActivity = null
        }
        super.onDestroy()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun navigateToManga(mangaId: String) {
        val webView = appWebView
        if (webView == null) {
            pendingDeepLinkMangaId = mangaId
            return
        }
        val safeHash = JSONObject.quote("#/manga/$mangaId")
        webView.post {
            try {
                webView.evaluateJavascript("window.location.hash = $safeHash;", null)
            } catch (e: Throwable) {
                Log.w(TAG, "Deep link navigation failed", e)
            }
        }
    }

    private fun handleIntent(intent: Intent?) {
        try {
            val data: Uri? = intent?.data
            if (data != null && data.scheme == "shinitrack" && data.host == "manga") {
                val mangaId = data.lastPathSegment
                if (!mangaId.isNullOrEmpty()) {
                    Log.i(TAG, "Navigating to comic deep link: $mangaId")
                    navigateToManga(mangaId)
                }
            }
        } catch (e: Throwable) {
            Log.w(TAG, "handleIntent failed", e)
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
