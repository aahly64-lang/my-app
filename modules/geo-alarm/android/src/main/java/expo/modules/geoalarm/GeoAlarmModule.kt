package expo.modules.geoalarm

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import org.json.JSONObject
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class GeoAlarmModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private var consumedIntentHash: Int? = null
  private var pendingSoundPromise: Promise? = null
  private val soundRequestCode = 46077

  private fun soundTitle(uri: String?): String {
    return try {
      val u = if (uri.isNullOrBlank()) AlarmNotifier.defaultSoundUri() else Uri.parse(uri)
      RingtoneManager.getRingtone(context, u)?.getTitle(context) ?: "ברירת מחדל"
    } catch (e: Exception) {
      "ברירת מחדל"
    }
  }

  private fun extractSharedText(intent: Intent?): String? {
    if (intent == null || intent.action != Intent.ACTION_SEND) return null
    val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return null
    return text
  }

  private fun startSettingsIntent(intent: Intent): Boolean {
    return try {
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      true
    } catch (e: Exception) {
      false
    }
  }

  private fun appDetailsIntent(): Intent =
    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.packageName))

  override fun definition() = ModuleDefinition {
    Name("GeoAlarm")

    Events("onSharedText")

    Function("triggerAlarm") { title: String, body: String, kind: String, sound: String?, durationMs: Double ->
      AlarmNotifier.showSimple(context, title, body, kind, sound, durationMs.toLong())
      Unit
    }

    Function("scheduleRing") { json: String ->
      RingScheduler.schedule(context, JSONObject(json))
      Unit
    }

    Function("cancelRing") { id: String ->
      RingScheduler.cancel(context, id)
      RingScheduler.cancel(context, "$id:snooze")
      Unit
    }

    Function("getScheduledRingIds") {
      RingScheduler.ids(context)
    }

    Function("getSoundTitle") { uri: String? ->
      soundTitle(uri)
    }

    AsyncFunction("pickSound") { current: String?, title: String, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      pendingSoundPromise?.resolve(null)
      pendingSoundPromise = promise
      val intent = Intent(RingtoneManager.ACTION_RINGTONE_PICKER).apply {
        putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, RingtoneManager.TYPE_ALL)
        putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true)
        putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false)
        putExtra(RingtoneManager.EXTRA_RINGTONE_DEFAULT_URI, AlarmNotifier.defaultSoundUri())
        putExtra(RingtoneManager.EXTRA_RINGTONE_TITLE, title)
        if (!current.isNullOrBlank()) {
          putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, Uri.parse(current))
        } else {
          putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, AlarmNotifier.defaultSoundUri())
        }
      }
      try {
        activity.startActivityForResult(intent, soundRequestCode)
      } catch (e: Exception) {
        pendingSoundPromise = null
        promise.resolve(null)
      }
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != soundRequestCode) return@OnActivityResult
      val promise = pendingSoundPromise ?: return@OnActivityResult
      pendingSoundPromise = null
      if (payload.resultCode != android.app.Activity.RESULT_OK) {
        promise.resolve(null)
        return@OnActivityResult
      }
      @Suppress("DEPRECATION")
      val picked: Uri? = payload.data?.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI)
      val uriString = picked?.toString() ?: ""
      promise.resolve(mapOf("uri" to uriString, "title" to soundTitle(uriString)))
    }

    Function("stopAlarm") {
      AlarmNotifier.stop(context)
      AlarmActivity.finishIfShowing()
      Unit
    }

    Function("canUseFullScreenIntent") {
      AlarmNotifier.canUseFullScreenIntent(context)
    }

    Function("openFullScreenIntentSettings") {
      if (Build.VERSION.SDK_INT >= 34) {
        val intent = Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + context.packageName))
        if (!startSettingsIntent(intent)) {
          startSettingsIntent(appDetailsIntent())
        }
      } else {
        startSettingsIntent(appDetailsIntent())
      }
      Unit
    }

    Function("isIgnoringBatteryOptimizations") {
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    Function("requestIgnoreBatteryOptimizations") {
      val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + context.packageName))
      if (!startSettingsIntent(intent)) {
        startSettingsIntent(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
      }
      Unit
    }

    Function("openAutoStartSettings") {
      val candidates = listOf(
        ComponentName("com.hihonor.systemmanager", "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
        ComponentName("com.hihonor.systemmanager", "com.hihonor.systemmanager.appcontrol.activity.StartupAppControlActivity"),
        ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
        ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity"),
        ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")
      )
      var opened = false
      for (component in candidates) {
        val intent = Intent().setComponent(component)
        if (startSettingsIntent(intent)) {
          opened = true
          break
        }
      }
      if (!opened) startSettingsIntent(appDetailsIntent())
      opened
    }

    Function("openAppSettings") {
      startSettingsIntent(appDetailsIntent())
      Unit
    }

    Function("getInitialSharedText") {
      val intent = appContext.currentActivity?.intent
      val hash = intent?.let { System.identityHashCode(it) }
      if (hash != null && hash == consumedIntentHash) {
        null
      } else {
        consumedIntentHash = hash
        extractSharedText(intent)
      }
    }

    OnNewIntent { intent ->
      val text = extractSharedText(intent)
      if (text != null) {
        consumedIntentHash = System.identityHashCode(intent)
        sendEvent("onSharedText", mapOf("text" to text))
      }
    }
  }
}
