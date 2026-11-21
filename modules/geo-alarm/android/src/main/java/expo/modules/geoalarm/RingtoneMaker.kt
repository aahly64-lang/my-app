package expo.modules.geoalarm

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.provider.Settings
import java.io.File
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Creates ringtones from any audio file on the phone:
 * decode -> cut [start, end] -> optional fade-in -> encode AAC (.m4a).
 * The result is kept in the app's folder and also published to the phone's
 * Ringtones (MediaStore), so it can be used by the app's alarms and by the phone.
 */
object RingtoneMaker {
  private const val TIMEOUT_US = 10_000L
  private const val BITRATE = 128_000

  private fun localPath(src: String): String = if (src.startsWith("file://")) Uri.parse(src).path!! else src

  /** Duration of an audio file in ms, or 0. */
  fun durationMs(ctx: Context, src: String): Long {
    val r = MediaMetadataRetriever()
    return try {
      if (src.startsWith("content://")) r.setDataSource(ctx, Uri.parse(src)) else r.setDataSource(localPath(src))
      r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
    } catch (e: Exception) {
      0L
    } finally {
      try { r.release() } catch (_: Exception) {}
    }
  }

  // ---------------------------------------------------------------- trimming

  /** Cuts and re-encodes. Returns the output file. */
  fun trim(src: String, startMs: Long, endMs: Long, fadeMs: Long, out: File) {
    val startUs = startMs * 1000
    val endUs = endMs * 1000
    val extractor = MediaExtractor()
    extractor.setDataSource(localPath(src))
    var trackIndex = -1
    var inFormat: MediaFormat? = null
    for (i in 0 until extractor.trackCount) {
      val f = extractor.getTrackFormat(i)
      if (f.getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true) {
        trackIndex = i
        inFormat = f
        break
      }
    }
    if (trackIndex < 0 || inFormat == null) {
      extractor.release()
      throw IllegalArgumentException("לא נמצא ערוץ שמע בקובץ")
    }
    extractor.selectTrack(trackIndex)
    extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)

    val decoder = MediaCodec.createDecoderByType(inFormat.getString(MediaFormat.KEY_MIME)!!)
    decoder.configure(inFormat, null, null, 0)
    decoder.start()

    var sampleRate = if (inFormat.containsKey(MediaFormat.KEY_SAMPLE_RATE)) inFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE) else 44100
    var channels = if (inFormat.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) inFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT) else 2
    var floatPcm = false

    var encoder: MediaCodec? = null
    var muxer: MediaMuxer? = null
    var muxTrack = -1
    var muxStarted = false
    val encInfo = MediaCodec.BufferInfo()
    var framesWritten = 0L

    // PCM (16-bit, interleaved) waiting to go into the encoder
    var pending = ByteArray(0)
    var pendingPos = 0

    fun ensureEncoder() {
      if (encoder != null) return
      val ch = channels.coerceIn(1, 2)
      val f = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, ch)
      f.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
      f.setInteger(MediaFormat.KEY_BIT_RATE, BITRATE)
      f.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 64 * 1024)
      val e = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
      e.configure(f, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
      e.start()
      encoder = e
      muxer = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    }

    fun drainEncoder(endOfStream: Boolean) {
      val e = encoder ?: return
      while (true) {
        val idx = e.dequeueOutputBuffer(encInfo, TIMEOUT_US)
        if (idx == MediaCodec.INFO_TRY_AGAIN_LATER) {
          if (!endOfStream) return
        } else if (idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          muxTrack = muxer!!.addTrack(e.outputFormat)
          muxer!!.start()
          muxStarted = true
        } else if (idx >= 0) {
          val buf = e.getOutputBuffer(idx)!!
          if (encInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) encInfo.size = 0
          if (encInfo.size > 0 && muxStarted) {
            buf.position(encInfo.offset)
            buf.limit(encInfo.offset + encInfo.size)
            muxer!!.writeSampleData(muxTrack, buf, encInfo)
          }
          val eos = encInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
          e.releaseOutputBuffer(idx, false)
          if (eos) return
        }
      }
    }

    /** Pushes pending PCM into the encoder; when [eos] also signals end of stream. */
    fun feedEncoder(eos: Boolean) {
      val e = encoder ?: return
      val ch = channels.coerceIn(1, 2)
      val bytesPerFrame = 2 * ch
      while (pendingPos < pending.size || eos) {
        val idx = e.dequeueInputBuffer(TIMEOUT_US)
        if (idx < 0) {
          drainEncoder(false)
          continue
        }
        val buf = e.getInputBuffer(idx)!!
        buf.clear()
        val remaining = pending.size - pendingPos
        var n = minOf(remaining, buf.capacity())
        n -= n % bytesPerFrame
        val pts = framesWritten * 1_000_000L / sampleRate
        if (n <= 0) {
          if (eos) {
            e.queueInputBuffer(idx, 0, 0, pts, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            return
          }
          e.queueInputBuffer(idx, 0, 0, pts, 0)
          break
        }
        buf.put(pending, pendingPos, n)
        pendingPos += n
        framesWritten += (n / bytesPerFrame)
        e.queueInputBuffer(idx, 0, n, pts, 0)
        drainEncoder(false)
      }
      if (pendingPos >= pending.size) {
        pending = ByteArray(0)
        pendingPos = 0
      }
    }

    /** Converts a decoded buffer to 16-bit PCM, keeps only [start,end], applies the fade. */
    fun acceptDecoded(data: ByteBuffer, size: Int, ptsUs: Long) {
      val inCh = channels
      val outCh = inCh.coerceIn(1, 2)
      val bytesPerSample = if (floatPcm) 4 else 2
      val frames = size / (bytesPerSample * inCh)
      if (frames <= 0) return
      data.order(ByteOrder.nativeOrder())
      val outBuf = ByteBuffer.allocate(frames * outCh * 2).order(ByteOrder.LITTLE_ENDIAN)
      var kept = 0
      for (f in 0 until frames) {
        val t = ptsUs + f * 1_000_000L / sampleRate
        if (t < startUs || t >= endUs) {
          data.position(data.position() + bytesPerSample * inCh)
          continue
        }
        val gain = if (fadeMs > 0) ((t - startUs).toDouble() / (fadeMs * 1000.0)).coerceIn(0.0, 1.0) else 1.0
        for (c in 0 until inCh) {
          val v: Int = if (floatPcm) (data.float * 32767f).toInt() else data.short.toInt()
          if (c < outCh) outBuf.putShort((v * gain).toInt().coerceIn(-32768, 32767).toShort())
        }
        kept++
      }
      if (kept == 0) return
      val bytes = ByteArray(kept * outCh * 2)
      outBuf.flip()
      outBuf.get(bytes)
      val left = pending.size - pendingPos
      val merged = ByteArray(left + bytes.size)
      System.arraycopy(pending, pendingPos, merged, 0, left)
      System.arraycopy(bytes, 0, merged, left, bytes.size)
      pending = merged
      pendingPos = 0
    }

    val decInfo = MediaCodec.BufferInfo()
    var inputDone = false
    var outputDone = false
    try {
      while (!outputDone) {
        if (!inputDone) {
          val idx = decoder.dequeueInputBuffer(TIMEOUT_US)
          if (idx >= 0) {
            val buf = decoder.getInputBuffer(idx)!!
            val n = extractor.readSampleData(buf, 0)
            val t = extractor.sampleTime
            if (n < 0 || t > endUs) {
              decoder.queueInputBuffer(idx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              decoder.queueInputBuffer(idx, 0, n, t, 0)
              extractor.advance()
            }
          }
        }
        val o = decoder.dequeueOutputBuffer(decInfo, TIMEOUT_US)
        if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          val f = decoder.outputFormat
          if (f.containsKey(MediaFormat.KEY_SAMPLE_RATE)) sampleRate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
          if (f.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
          if (Build.VERSION.SDK_INT >= 24 && f.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
            floatPcm = f.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
          }
        } else if (o >= 0) {
          if (decInfo.size > 0) {
            ensureEncoder()
            val buf = decoder.getOutputBuffer(o)!!
            buf.position(decInfo.offset)
            buf.limit(decInfo.offset + decInfo.size)
            acceptDecoded(buf.slice(), decInfo.size, decInfo.presentationTimeUs)
            feedEncoder(false)
          }
          val eos = decInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
          decoder.releaseOutputBuffer(o, false)
          if (eos) outputDone = true
        }
      }
      ensureEncoder()
      feedEncoder(true)
      drainEncoder(true)
      if (!muxStarted || framesWritten == 0L) throw IllegalStateException("לא נוצר שמע מהקטע שנבחר")
    } finally {
      try { decoder.stop() } catch (_: Exception) {}
      try { decoder.release() } catch (_: Exception) {}
      try { extractor.release() } catch (_: Exception) {}
      try { encoder?.stop() } catch (_: Exception) {}
      try { encoder?.release() } catch (_: Exception) {}
      try { if (muxStarted) muxer?.stop() } catch (_: Exception) {}
      try { muxer?.release() } catch (_: Exception) {}
    }
  }

  // ---------------------------------------------------------------- phone ringtones

  /** Publishes the file to the phone's Ringtones. Returns the content:// uri or null. */
  fun publish(ctx: Context, file: File, name: String): String? {
    if (Build.VERSION.SDK_INT < 29) return null
    val resolver = ctx.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.Audio.Media.DISPLAY_NAME, "$name.m4a")
      put(MediaStore.Audio.Media.TITLE, name)
      put(MediaStore.Audio.Media.MIME_TYPE, "audio/mp4")
      put(MediaStore.Audio.Media.RELATIVE_PATH, Environment.DIRECTORY_RINGTONES + "/יומן ושולחן עבודה")
      put(MediaStore.Audio.Media.IS_RINGTONE, 1)
      put(MediaStore.Audio.Media.IS_NOTIFICATION, 1)
      put(MediaStore.Audio.Media.IS_ALARM, 1)
      put(MediaStore.Audio.Media.IS_MUSIC, 0)
      put(MediaStore.Audio.Media.IS_PENDING, 1)
    }
    val uri = resolver.insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values) ?: return null
    try {
      resolver.openOutputStream(uri)!!.use { out -> FileInputStream(file).use { it.copyTo(out) } }
      resolver.update(uri, ContentValues().apply { put(MediaStore.Audio.Media.IS_PENDING, 0) }, null, null)
    } catch (e: Exception) {
      try { resolver.delete(uri, null, null) } catch (_: Exception) {}
      return null
    }
    return uri.toString()
  }

  fun rename(ctx: Context, mediaUri: String?, name: String) {
    if (mediaUri.isNullOrBlank()) return
    try {
      ctx.contentResolver.update(Uri.parse(mediaUri), ContentValues().apply {
        put(MediaStore.Audio.Media.TITLE, name)
      }, null, null)
    } catch (_: Exception) {}
  }

  fun delete(ctx: Context, path: String?, mediaUri: String?) {
    try { if (!path.isNullOrBlank()) File(localPath(path)).delete() } catch (_: Exception) {}
    try { if (!mediaUri.isNullOrBlank()) ctx.contentResolver.delete(Uri.parse(mediaUri), null, null) } catch (_: Exception) {}
  }

  fun canWriteSettings(ctx: Context): Boolean = Settings.System.canWrite(ctx)

  fun openWriteSettings(ctx: Context) {
    val i = Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:" + ctx.packageName))
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    ctx.startActivity(i)
  }

  fun openSoundSettings(ctx: Context) {
    val i = Intent(Settings.ACTION_SOUND_SETTINGS)
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    ctx.startActivity(i)
  }

  /** type: "call" | "notification" | "alarm". Needs the "modify system settings" permission. */
  fun setPhoneDefault(ctx: Context, mediaUri: String, type: String): Boolean {
    if (!Settings.System.canWrite(ctx)) return false
    val t = when (type) {
      "notification" -> RingtoneManager.TYPE_NOTIFICATION
      "alarm" -> RingtoneManager.TYPE_ALARM
      else -> RingtoneManager.TYPE_RINGTONE
    }
    return try {
      RingtoneManager.setActualDefaultRingtoneUri(ctx, t, Uri.parse(mediaUri))
      true
    } catch (e: Exception) {
      false
    }
  }

  // ---------------------------------------------------------------- preview

  private var player: MediaPlayer? = null
  private val handler = Handler(Looper.getMainLooper())
  private var stopAt = 0L
  private var fadeAt = 0L
  private var fadeLen = 0L

  private val ticker = object : Runnable {
    override fun run() {
      val p = player ?: return
      try {
        val pos = p.currentPosition.toLong()
        if (fadeLen > 0) {
          val g = ((pos - fadeAt).toFloat() / fadeLen).coerceIn(0f, 1f)
          p.setVolume(g, g)
        }
        if (pos >= stopAt || !p.isPlaying) {
          stopPreview()
          return
        }
      } catch (_: Exception) {
        stopPreview()
        return
      }
      handler.postDelayed(this, 50)
    }
  }

  fun preview(ctx: Context, src: String, startMs: Long, endMs: Long, fadeMs: Long) {
    stopPreview()
    val p = MediaPlayer()
    if (src.startsWith("content://")) p.setDataSource(ctx, Uri.parse(src)) else p.setDataSource(localPath(src))
    p.prepare()
    p.seekTo(startMs.toInt())
    stopAt = endMs
    fadeAt = startMs
    fadeLen = fadeMs
    if (fadeMs > 0) p.setVolume(0f, 0f)
    p.start()
    player = p
    handler.post(ticker)
  }

  /** Current position in ms while previewing, or -1 when stopped. */
  fun previewPosition(): Long = try { player?.currentPosition?.toLong() ?: -1L } catch (_: Exception) { -1L }

  fun stopPreview() {
    handler.removeCallbacks(ticker)
    try { player?.stop() } catch (_: Exception) {}
    try { player?.release() } catch (_: Exception) {}
    player = null
  }
}
