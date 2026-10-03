package id.shinitrack.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

object Notif {
    private const val TAG = "ShiniNotif"
    const val CHANNEL_ID = "shinitrack_chapters"
    const val CHANNEL_NAME = "Chapter Baru"

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (manager.getNotificationChannel(CHANNEL_ID) == null) {
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    CHANNEL_NAME,
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "Notifikasi rilis chapter baru untuk komik favorit"
                    enableVibration(true)
                    vibrationPattern = longArrayOf(0, 250, 150, 250)
                    enableLights(true)
                    lightColor = 0xFF6366F1.toInt()
                    setShowBadge(true)
                    lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
                }
                manager.createNotificationChannel(channel)
            }
        }
    }

    fun show(context: Context, notice: NoticeItem) {
        ensureChannel(context)

        thread(name = "NotifBuilder-${notice.id}") {
            try {
                buildAndNotify(context, notice)
            } catch (e: Throwable) {
                Log.e(TAG, "Failed to show notification", e)
            }
        }
    }

    private fun buildAndNotify(context: Context, notice: NoticeItem) {
        // Deep link to shinitrack://manga/{manga_id}
        val viewIntent = Intent(Intent.ACTION_VIEW, Uri.parse("shinitrack://manga/${notice.mangaId}")).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingViewIntent = PendingIntent.getActivity(
            context,
            notice.id,
            viewIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Fetch cover bitmap if available (with Shinigami anti-hotlink referer)
        val coverBitmap: Bitmap? = notice.cover?.let { fetchBitmap(it) }

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setColor(0xFF6366F1.toInt())
            .setContentTitle(notice.title)
            .setContentText(notice.text)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pendingViewIntent)
            .setAutoCancel(true)
            .setDefaults(NotificationCompat.DEFAULT_ALL)

        if (coverBitmap != null) {
            builder.setLargeIcon(coverBitmap)
            builder.setStyle(
                NotificationCompat.BigPictureStyle()
                    .bigPicture(coverBitmap)
                    .setBigContentTitle(notice.title)
                    .setSummaryText(notice.text)
            )
        } else {
            builder.setStyle(NotificationCompat.BigTextStyle().bigText(notice.text))
        }

        // Action button 1: "Buka Komik"
        builder.addAction(
            android.R.drawable.ic_menu_view,
            "Buka Komik",
            pendingViewIntent
        )

        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(notice.id, builder.build())
    }

    private fun fetchBitmap(urlStr: String): Bitmap? {
        if (urlStr.isBlank() || !urlStr.startsWith("http")) return null
        return try {
            val url = URL(urlStr)
            val conn = url.openConnection() as HttpURLConnection
            conn.doInput = true
            conn.connectTimeout = 5000
            conn.readTimeout = 7000
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 ShiniTrack-App")
            conn.setRequestProperty("Referer", "https://shinigami.asia/")
            conn.connect()
            val input = conn.inputStream
            BitmapFactory.decodeStream(input)
        } catch (e: Throwable) {
            Log.w(TAG, "Failed to download cover bitmap: $urlStr", e)
            null
        }
    }
}

