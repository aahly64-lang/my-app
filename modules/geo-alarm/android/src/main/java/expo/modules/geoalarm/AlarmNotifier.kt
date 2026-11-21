package expo.modules.geoalarm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

object AlarmNotifier {
  const val NOTIFICATION_ID = 46021
  const val EXTRA_RING = "geo_alarm_ring_json"
  const val ACTION_STOP = "expo.modules.geoalarm.STOP"
  const val ACTION_SNOOZE = "expo.modules.geoalarm.SNOOZE"
  const val DEFAULT_DURATION_MS = 3L * 60L * 1000L

  fun defaultSoundUri(): Uri {
    return RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
      ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
      ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
  }

  private fun soundUri(ring: JSONObject): Uri {
    val s = ring.optString("sound", "")
    return if (s.isNotBlank()) Uri.parse(s) else defaultSoundUri()
  }

  /** A notification channel's sound cannot change, so there is one channel per sound. */
  private fun ensureChannel(context: Context, sound: Uri): String {
    val id = "ring_" + Integer.toHexString(sound.toString().hashCode())
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return id
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(id) != null) return id
    val channel = NotificationChannel(id, "צלצולים", NotificationManager.IMPORTANCE_HIGH)
    channel.description = "שעון מעורר, טיימר, תזכורות והתראות מיקום"
    val attrs = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ALARM)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
    channel.setSound(sound, attrs)
    channel.enableVibration(true)
    channel.vibrationPattern = longArrayOf(0, 800, 600, 800, 600)
    channel.setBypassDnd(true)
    channel.lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
    manager.createNotificationChannel(channel)
    return id
  }

  private fun maxAlarmVolume(context: Context) {
    try {
      val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      val max = audio.getStreamMaxVolume(AudioManager.STREAM_ALARM)
      audio.setStreamVolume(AudioManager.STREAM_ALARM, max, 0)
    } catch (e: Exception) {
      // Some devices block volume changes (e.g. Do Not Disturb). The alarm still rings.
    }
  }

  private fun pendingFlags(): Int = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

  fun canSnooze(ring: JSONObject): Boolean {
    val min = ring.optInt("snoozeMin", 0)
    val left = ring.optInt("snoozeLeft", -1)
    return min > 0 && left != 0
  }

  fun showSimple(context: Context, title: String, body: String, kind: String, sound: String?, durationMs: Long) {
    val ring = JSONObject().apply {
      put("id", "instant")
      put("title", title)
      put("body", body)
      put("kind", kind)
      put("sound", sound ?: "")
      put("durationMs", durationMs)
      put("snoozeMin", 0)
    }
    show(context, ring)
  }

  fun show(context: Context, ring: JSONObject) {
    val sound = soundUri(ring)
    val channelId = ensureChannel(context, sound)
    maxAlarmVolume(context)

    val title = ring.optString("title", "שעון מעורר")
    val body = ring.optString("body", "")
    val durationMs = ring.optLong("durationMs", DEFAULT_DURATION_MS).let { if (it <= 0) DEFAULT_DURATION_MS else it }
    ring.put("durationMs", durationMs)
    val json = ring.toString()

    val activityIntent = Intent(context, AlarmActivity::class.java).apply {
      putExtra(EXTRA_RING, json)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION)
    }
    val fullScreenPi = PendingIntent.getActivity(context, 1, activityIntent, pendingFlags())

    val stopIntent = Intent(context, AlarmStopReceiver::class.java).apply {
      action = ACTION_STOP
      putExtra(EXTRA_RING, json)
    }
    val stopPi = PendingIntent.getBroadcast(context, 2, stopIntent, pendingFlags())

    val builder = NotificationCompat.Builder(context, channelId)
      .setSmallIcon(context.applicationInfo.icon)
      .setContentTitle(title)
      .setContentText(body)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setFullScreenIntent(fullScreenPi, true)
      .setContentIntent(fullScreenPi)
      .setOngoing(true)
      .setAutoCancel(false)
      .setTimeoutAfter(durationMs)
      .setSound(sound, AudioManager.STREAM_ALARM)
      .setVibrate(longArrayOf(0, 800, 600, 800, 600))
      .addAction(0, "עצור", stopPi)

    if (canSnooze(ring)) {
      val snoozeIntent = Intent(context, AlarmStopReceiver::class.java).apply {
        action = ACTION_SNOOZE
        putExtra(EXTRA_RING, json)
      }
      val snoozePi = PendingIntent.getBroadcast(context, 4, snoozeIntent, pendingFlags())
      builder.addAction(0, "נודניק " + ring.optInt("snoozeMin") + " דק'", snoozePi)
    }

    val notification = builder.build()
    notification.flags = notification.flags or Notification.FLAG_INSISTENT

    try {
      NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
    } catch (e: SecurityException) {
      // Notification permission not granted.
    }
  }

  fun stop(context: Context) {
    NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
  }

  fun canUseFullScreenIntent(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < 34) return true
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    return manager.canUseFullScreenIntent()
  }
}
