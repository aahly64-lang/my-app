package expo.modules.geoalarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class AlarmStopReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    AlarmNotifier.stop(context)
    AlarmActivity.finishIfShowing()
  }
}
