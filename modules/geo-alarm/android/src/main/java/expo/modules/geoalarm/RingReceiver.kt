package expo.modules.geoalarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class RingReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra(RingScheduler.EXTRA_RING_ID) ?: return
    RingScheduler.fire(context, id)
  }
}
