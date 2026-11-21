package expo.modules.geoalarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject

class AlarmStopReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == AlarmNotifier.ACTION_SNOOZE) {
      val raw = intent.getStringExtra(AlarmNotifier.EXTRA_RING)
      if (raw != null) {
        try { RingScheduler.snooze(context, JSONObject(raw)) } catch (e: Exception) {}
      }
    }
    AlarmNotifier.stop(context)
    AlarmActivity.finishIfShowing()
  }
}
