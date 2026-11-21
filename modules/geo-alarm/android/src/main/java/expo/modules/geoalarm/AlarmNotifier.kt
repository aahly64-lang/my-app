package expo.modules.geoalarm

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

object AlarmNotifier {
  const val CHANNEL_ID = "geo_alarm_channel_v1"
  const val NOTIFICATION_ID = 46021
  const val EXTRA_TITLE = "geo_alarm_title"
  const val EXTRA_BODY = "geo_alarm_body"
  const val ALARM_DURATION_MS = 3L * 60L * 1000L

  private fun alarmSoundUri(): Uri {
    return RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
      ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
      ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
  }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(CHANNEL_ID, "שעון מעורר לפי מיקום", NotificationManager.IMPORTANCE_HIGH)
    channel.description = "צלצול כשנכנסים לאזור שהוגדר"
    val attrs = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ALARM)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
    channel.setSound(alarmSoundUri(), attrs)
    channel.enableVibration(true)
    channel.vibrationPattern = longArrayOf(0, 800, 600, 800, 600)
    channel.setBypassDnd(true)
    channel.lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
    manager.createNotificationChannel(channel)
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

  private fun pendingFlags(): Int {
    return PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
  }

  fun show(context: Context, title: String, body: String) {
    ensureChannel(context)
    maxAlarmVolume(context)

    val activityIntent = Intent(context, AlarmActivity::class.java).apply {
      putExtra(EXTRA_TITLE, title)
      putExtra(EXTRA_BODY, body)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION)
    }
    val fullScreenPi = PendingIntent.getActivity(context, 1, activityIntent, pendingFlags())

    val stopIntent = Intent(context, AlarmStopReceiver::class.java)
    val stopPi = PendingIntent.getBroadcast(context, 2, stopIntent, pendingFlags())

    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
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
      .setTimeoutAfter(ALARM_DURATION_MS)
      .setSound(alarmSoundUri(), AudioManager.STREAM_ALARM)
      .setVibrate(longArrayOf(0, 800, 600, 800, 600))
      .addAction(0, "עצור", stopPi)

    val notification = builder.build()
    notification.flags = notification.flags or android.app.Notification.FLAG_INSISTENT

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
