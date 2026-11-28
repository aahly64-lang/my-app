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
  private var pendingScanPromise: Promise? = null
  private val scanRequestCode = 4721
  private var scanQuality = "normal"
  private var pendingContactPromise: Promise? = null
  private val contactRequestCode = 4722
  private var pendingSpeechPromise: Promise? = null
  private val speechRequestCode = 4723
  private val soundRequestCode = 46077

  private fun soundTitle(uri: String?): String {
    return try {
      val u = if (uri.isNullOrBlank()) AlarmNotifier.defaultSoundUri() else Uri.parse(uri)
      RingtoneManager.getRingtone(context, u)?.getTitle(context) ?: "ברירת מחדל"
    } catch (e: Exception) {
      "ברירת מחדל"
    }
  }

  private var consumedFilesIntentHash: Int? = null

  /** Files shared into the app ("Share" -> our app) from WhatsApp, mail, gallery... */
  @Suppress("DEPRECATION")
  private fun sharedStreams(intent: Intent?): List<Uri> {
    if (intent == null) return emptyList()
    val out = ArrayList<Uri>()
    try {
      when (intent.action) {
        Intent.ACTION_SEND -> (intent.getParcelableExtra<android.os.Parcelable>(Intent.EXTRA_STREAM) as? Uri)?.let { out.add(it) }
        Intent.ACTION_SEND_MULTIPLE ->
          intent.getParcelableArrayListExtra<android.os.Parcelable>(Intent.EXTRA_STREAM)?.forEach { (it as? Uri)?.let { u -> out.add(u) } }
        else -> return emptyList()
      }
      if (out.isEmpty()) intent.clipData?.let { clip -> for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let { out.add(it) } }
    } catch (e: Exception) {
    }
    return out.distinct()
  }

  /** Copies the shared files into the cache right away (the permission to read them is only temporary). */
  private fun copySharedFiles(intent: Intent): List<Map<String, Any?>> {
    val dir = java.io.File(context.cacheDir, "shared").apply { mkdirs() }
    val old = System.currentTimeMillis() - 24 * 3600_000L
    dir.listFiles()?.forEach { if (it.lastModified() < old) it.delete() }
    val out = ArrayList<Map<String, Any?>>()
    for ((i, uri) in sharedStreams(intent).withIndex()) {
      try {
        var name: String? = null
        context.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
          if (c.moveToFirst()) name = c.getString(0)
        }
        val mime = context.contentResolver.getType(uri) ?: intent.type?.takeIf { !it.contains("*") } ?: "application/octet-stream"
        val clean = (name ?: uri.lastPathSegment ?: "קובץ").substringAfterLast('/').replace(Regex("[\\\\/:*?\"<>|]"), "_").ifBlank { "קובץ" }
        val file = java.io.File(dir, "${System.currentTimeMillis()}-$i-$clean")
        context.contentResolver.openInputStream(uri)?.use { input -> java.io.FileOutputStream(file).use { input.copyTo(it) } } ?: continue
        out.add(mapOf("uri" to Uri.fromFile(file).toString(), "name" to clean, "mime" to mime, "size" to file.length().toDouble()))
      } catch (e: Exception) {
      }
    }
    return out
  }

  private fun extractSharedText(intent: Intent?): String? {
    if (intent == null || intent.action != Intent.ACTION_SEND) return null
    if (sharedStreams(intent).isNotEmpty()) return null // a file (WhatsApp may add a caption as text)
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

    Events("onSharedText", "onSharedFiles")

    Function("triggerAlarm") { title: String, body: String, kind: String, sound: String?, durationMs: Double ->
      AlarmNotifier.showSimple(context, title, body, kind, sound, durationMs.toLong())
      Unit
    }

    Function("quietNotifications") { taskName: String ->
      AlarmNotifier.removeOldChannels(context)
      AlarmNotifier.quietTrackingChannel(context, taskName)
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

    AsyncFunction("listDocuments") { uri: String ->
      DocumentsHelper.list(context, uri)
    }

    Function("documentFolderName") { uri: String ->
      DocumentsHelper.name(context, uri)
    }

    Function("openDocument") { uri: String, mime: String ->
      DocumentsHelper.open(context, uri, mime)
    }

    Function("shareDocument") { uri: String, mime: String ->
      DocumentsHelper.share(context, uri, mime)
    }

    Function("releaseFolder") { uri: String ->
      DocumentsHelper.release(context, uri)
      Unit
    }

    // ---------- ringtone maker ----------
    Function("audioDuration") { src: String ->
      RingtoneMaker.durationMs(context, src).toDouble()
    }

    AsyncFunction("audioWaveform") { src: String, buckets: Int ->
      val w = RingtoneMaker.waveform(src, buckets)
      mapOf("peaks" to w.peaks.map { it.toDouble() }, "durationMs" to w.durationMs.toDouble())
    }

    AsyncFunction("makeRingtone") { src: String, startMs: Double, endMs: Double, fadeMs: Double, fadeOutMs: Double, id: String, name: String ->
      val dir = java.io.File(context.filesDir, "ringtones").apply { mkdirs() }
      val out = java.io.File(dir, "$id.m4a")
      if (out.exists()) out.delete()
      RingtoneMaker.trim(src, startMs.toLong(), endMs.toLong(), fadeMs.toLong(), fadeOutMs.toLong(), out)
      val media = RingtoneMaker.publish(context, out, name)
      mapOf("path" to "file://" + out.absolutePath, "mediaUri" to media)
    }

    Function("renameRingtone") { mediaUri: String?, name: String ->
      RingtoneMaker.rename(context, mediaUri, name)
      Unit
    }

    Function("deleteRingtone") { path: String?, mediaUri: String? ->
      RingtoneMaker.delete(context, path, mediaUri)
      Unit
    }

    Function("previewAudio") { src: String, startMs: Double, endMs: Double, fadeBaseMs: Double, fadeMs: Double, fadeOutMs: Double ->
      RingtoneMaker.preview(context, src, startMs.toLong(), endMs.toLong(), fadeBaseMs.toLong(), fadeMs.toLong(), fadeOutMs.toLong())
      Unit
    }

    Function("previewPosition") {
      RingtoneMaker.previewPosition().toDouble()
    }

    Function("stopPreview") {
      RingtoneMaker.stopPreview()
      Unit
    }

    Function("canWriteSettings") {
      RingtoneMaker.canWriteSettings(context)
    }

    Function("openWriteSettings") {
      RingtoneMaker.openWriteSettings(context)
      Unit
    }

    Function("openSoundSettings") {
      RingtoneMaker.openSoundSettings(context)
      Unit
    }

    Function("setPhoneRingtone") { mediaUri: String, type: String ->
      RingtoneMaker.setPhoneDefault(context, mediaUri, type)
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

    // ---------- documents ----------
    AsyncFunction("searchDocuments") { roots: List<String>, query: String, limit: Int ->
      DocumentsHelper.search(context, roots, query, limit)
    }

    AsyncFunction("documentThumbnail") { uri: String, mime: String, size: Int, stamp: Double ->
      DocumentsHelper.thumbnail(context, uri, mime, size, stamp.toLong())
    }

    // ---------- documents: text from scans (on the phone) ----------
    AsyncFunction("readText") { uri: String, mime: String, maxPages: Int ->
      DocsOcr.read(context, uri, mime, maxPages)
    }

    // ---------- documents: shrink, two-sided card, sign ----------
    AsyncFunction("compressForShare") { uri: String, mime: String, name: String ->
      DocsTools.compress(context, uri, mime, name)
    }

    AsyncFunction("cardOnePage") { uri: String ->
      DocsTools.cardOnePage(context, uri)
    }

    AsyncFunction("signPdf") { src: String, page: Int, png: String, x: Double, y: Double, w: Double ->
      DocsTools.signPdf(context, src, page, png, x, y, w)
    }

    // ---------- documents stage C: preview + duplicates ----------
    AsyncFunction("pdfPageCount") { uri: String ->
      DocsPreview.pdfPageCount(context, uri)
    }

    AsyncFunction("renderPdfPage") { uri: String, page: Int, width: Int, stamp: Double ->
      DocsPreview.renderPdfPage(context, uri, page, width, stamp.toLong())
    }

    AsyncFunction("previewImage") { uri: String, maxPx: Int, stamp: Double ->
      DocsPreview.previewImage(context, uri, maxPx, stamp.toLong())
    }

    AsyncFunction("findDuplicates") { roots: List<String> ->
      DocsPreview.findDuplicates(context, roots)
    }

    Function("renameDocument") { uri: String, name: String ->
      DocumentsHelper.rename(context, uri, name)
    }

    Function("deleteDocument") { uri: String ->
      DocumentsHelper.delete(context, uri)
    }

    Function("shareDocuments") { uris: List<String>, mimes: List<String> ->
      DocumentsHelper.shareMany(context, uris, mimes)
    }

    AsyncFunction("copyIntoFolder") { src: String, treeUri: String, name: String, mime: String ->
      DocumentsHelper.copyInto(context, src, treeUri, name, mime)
    }

    AsyncFunction("copyToFile") { src: String, dest: String ->
      DocsExtra.copyToFile(context, src, dest)
    }

    Function("documentParent") { uri: String ->
      DocsExtra.parentFolder(uri)
    }

    Function("isUnmetered") {
      DocsExtra.isUnmetered(context)
    }

    AsyncFunction("uploadToSession") { src: String, sessionUrl: String, mime: String ->
      DocsExtra.uploadToSession(context, src, sessionUrl, mime)
    }

    AsyncFunction("protectPdf") { src: String, password: String, name: String ->
      DocsExtra.protectPdf(context, src, password, name)
    }

    AsyncFunction("createFolder") { parentUri: String, name: String ->
      DocumentsHelper.createFolder(context, parentUri, name)
    }

    /** System contact picker (phone numbers). No contacts permission needed for the picked entry. */
    AsyncFunction("pickContact") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      pendingContactPromise?.resolve(null)
      pendingContactPromise = promise
      try {
        val intent = Intent(Intent.ACTION_PICK, android.provider.ContactsContract.CommonDataKinds.Phone.CONTENT_URI)
        activity.startActivityForResult(intent, contactRequestCode)
      } catch (e: Exception) {
        pendingContactPromise = null
        promise.resolve(null)
      }
    }

    /**
     * Google's speech-to-text dialog (Hebrew). Resolves with the recognized text, "" when
     * cancelled, or null when no speech recognizer is installed.
     */
    AsyncFunction("listen") { prompt: String, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      pendingSpeechPromise?.resolve("")
      pendingSpeechPromise = promise
      try {
        val intent = Intent(android.speech.RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
          putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE_MODEL, android.speech.RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
          putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE, "he-IL")
          putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "he-IL")
          putExtra(android.speech.RecognizerIntent.EXTRA_PROMPT, prompt)
          putExtra(android.speech.RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        activity.startActivityForResult(intent, speechRequestCode)
      } catch (e: Exception) {
        pendingSpeechPromise = null
        promise.resolve(null)
      }
    }

    AsyncFunction("moveDocument") { src: String, srcParent: String, destFolder: String ->
      DocumentsHelper.move(context, src, srcParent, destFolder)
    }

    AsyncFunction("combinePdf") { uris: List<String>, mimes: List<String>, quality: String, overwrite: String? ->
      ScanEnhancer.combine(context, uris, mimes, quality, overwrite)
    }

    AsyncFunction("getInitialSharedFiles") {
      val intent = appContext.currentActivity?.intent
      val hash = intent?.let { System.identityHashCode(it) }
      if (intent == null || hash == consumedFilesIntentHash || sharedStreams(intent).isEmpty()) {
        emptyList<Map<String, Any?>>()
      } else {
        consumedFilesIntentHash = hash
        copySharedFiles(intent)
      }
    }

    AsyncFunction("rotatePdf") { uri: String, degrees: Int ->
      ScanEnhancer.rotatePdf(context, uri, degrees)
    }

    AsyncFunction("rotatePdfPages") { uri: String, degrees: List<Int> ->
      ScanEnhancer.rotatePages(context, uri, degrees)
    }

    AsyncFunction("uprightScan") { uri: String ->
      DocsOcr.upright(context, uri)
    }

    /** Google's document scanner: returns the content uri of the scanned PDF, or null if cancelled. */
    AsyncFunction("scanDocument") { quality: String, pageLimit: Int, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("ERR_SCAN", "אין מסך פעיל", null)
        return@AsyncFunction
      }
      pendingScanPromise?.resolve(null)
      pendingScanPromise = promise
      scanQuality = quality
      try {
        val options = com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions.Builder()
          .setGalleryImportAllowed(true)
          .setPageLimit(pageLimit.coerceIn(1, 30))
          .setResultFormats(com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions.RESULT_FORMAT_PDF)
          .setScannerMode(com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions.SCANNER_MODE_FULL)
          .build()
        com.google.mlkit.vision.documentscanner.GmsDocumentScanning.getClient(options)
          .getStartScanIntent(activity)
          .addOnSuccessListener { sender ->
            try {
              activity.startIntentSenderForResult(sender, scanRequestCode, null, 0, 0, 0)
            } catch (e: Exception) {
              pendingScanPromise = null
              promise.reject("ERR_SCAN", e.message ?: "הסורק לא נפתח", e)
            }
          }
          .addOnFailureListener { e ->
            pendingScanPromise = null
            promise.reject("ERR_SCAN", e.message ?: "הסורק לא זמין בטלפון", e)
          }
      } catch (e: Throwable) {
        pendingScanPromise = null
        promise.reject("ERR_SCAN", e.message ?: "הסורק לא זמין בטלפון", e)
      }
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode == speechRequestCode) {
        val promise = pendingSpeechPromise ?: return@OnActivityResult
        pendingSpeechPromise = null
        val text = if (payload.resultCode == android.app.Activity.RESULT_OK)
          payload.data?.getStringArrayListExtra(android.speech.RecognizerIntent.EXTRA_RESULTS)?.firstOrNull() ?: ""
        else ""
        promise.resolve(text)
        return@OnActivityResult
      }
      if (payload.requestCode == contactRequestCode) {
        val promise = pendingContactPromise ?: return@OnActivityResult
        pendingContactPromise = null
        val uri = payload.data?.data
        if (payload.resultCode != android.app.Activity.RESULT_OK || uri == null) {
          promise.resolve(null)
          return@OnActivityResult
        }
        try {
          val cols = arrayOf(
            android.provider.ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            android.provider.ContactsContract.CommonDataKinds.Phone.NUMBER
          )
          var result: Map<String, String>? = null
          context.contentResolver.query(uri, cols, null, null, null)?.use { c ->
            if (c.moveToFirst()) result = mapOf("name" to (c.getString(0) ?: ""), "phone" to (c.getString(1) ?: ""))
          }
          promise.resolve(result)
        } catch (e: Exception) {
          promise.resolve(null)
        }
        return@OnActivityResult
      }
      if (payload.requestCode == scanRequestCode) {
        val promise = pendingScanPromise ?: return@OnActivityResult
        pendingScanPromise = null
        if (payload.resultCode != android.app.Activity.RESULT_OK) {
          promise.resolve(null)
          return@OnActivityResult
        }
        val result = com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult.fromActivityResultIntent(payload.data)
        val pdf = result?.pdf
        val pages = result?.pages ?: emptyList()
        // Clean every page the same way, off the main thread; fall back to the scanner's PDF.
        Thread {
          val enhanced = if (scanQuality == "original" || pdf == null) null else try { ScanEnhancer.enhance(context, pdf.uri, scanQuality) } catch (e: Throwable) { null }
          val uri = enhanced ?: pdf?.uri?.toString()
          val count = if (pages.isNotEmpty()) pages.size else (pdf?.pageCount ?: 0)
          promise.resolve(
            if (uri == null) null else mapOf("uri" to uri, "pages" to count.toDouble(), "enhanced" to (enhanced != null))
          )
        }.start()
        return@OnActivityResult
      }
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
      if (sharedStreams(intent).isNotEmpty()) {
        consumedFilesIntentHash = System.identityHashCode(intent)
        Thread {
          val files = copySharedFiles(intent)
          if (files.isNotEmpty()) sendEvent("onSharedFiles", mapOf("files" to files))
        }.start()
        return@OnNewIntent
      }
      val text = extractSharedText(intent)
      if (text != null) {
        consumedIntentHash = System.identityHashCode(intent)
        sendEvent("onSharedText", mapOf("text" to text))
      }
    }
  }
}
