package id.shinitrack.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class PushReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "PushReceiver"
        const val ACTION_MESSAGE = "org.unifiedpush.android.connector.MESSAGE"
        const val ACTION_NEW_ENDPOINT = "org.unifiedpush.android.connector.NEW_ENDPOINT"
        const val ACTION_UNREGISTERED = "org.unifiedpush.android.connector.UNREGISTERED"
        const val ACTION_REG_FAILED = "org.unifiedpush.android.connector.REGISTRATION_FAILED"

        const val EXTRA_BYTES_MESSAGE = "bytesMessage"
        const val EXTRA_ENDPOINT = "endpoint"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        Log.i(TAG, "Received UnifiedPush action: $action")
        val dataDir = context.filesDir.absolutePath

        when (action) {
            ACTION_MESSAGE -> {
                val bytes = intent.getByteArrayExtra(EXTRA_BYTES_MESSAGE) ?: return
                try {
                    val json = ShiniBridge.nativeHandlePush(dataDir, bytes)
                    val notices = ShiniBridge.parseNotices(json)
                    Log.i(TAG, "Push received, parsed ${notices.size} notices")
                    for (notice in notices) {
                        Notif.show(context, notice)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error handling push message", e)
                }
            }

            ACTION_NEW_ENDPOINT -> {
                val endpoint = intent.getStringExtra(EXTRA_ENDPOINT) ?: return
                Log.i(TAG, "New UnifiedPush endpoint: $endpoint")
                // Register with server in background coroutine
                CoroutineScope(Dispatchers.IO).launch {
                    try {
                        val ok = ShiniBridge.nativeRegisterEndpoint(dataDir, endpoint)
                        Log.i(TAG, "Server registration result: $ok")
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to register endpoint with server", e)
                    }
                }
            }

            ACTION_UNREGISTERED -> {
                Log.i(TAG, "UnifiedPush unregistered")
                CoroutineScope(Dispatchers.IO).launch {
                    try {
                        ShiniBridge.nativeRegisterEndpoint(dataDir, "")
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to unregister endpoint", e)
                    }
                }
            }

            ACTION_REG_FAILED -> {
                Log.w(TAG, "UnifiedPush registration failed")
            }
        }
    }
}
