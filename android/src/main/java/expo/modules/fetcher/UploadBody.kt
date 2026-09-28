package expo.modules.fetcher

import android.content.Context
import android.content.res.AssetFileDescriptor
import android.net.Uri
import okhttp3.MediaType
import okhttp3.RequestBody
import okio.Buffer
import okio.BufferedSink
import okio.ForwardingSink
import okio.buffer
import okio.source
import java.io.File
import java.io.FileNotFoundException
import java.io.InputStream

class PartsRequestBody(
  private val context: Context,
  private val parts: List<BodyPart>,
  private val mediaType: MediaType?
) : RequestBody() {
  private val length: Long by lazy {
    var total = 0L
    for (part in parts) {
      val size = when (part) {
        is BodyPart.Data -> part.bytes.size.toLong()
        is BodyPart.File -> fileLength(part.uri)
      }
      if (size < 0) {
        return@lazy -1L
      }
      total += size
    }
    total
  }

  init {
    for (part in parts) {
      if (part is BodyPart.File) {
        openStream(part.uri).close()
      }
    }
  }

  override fun contentType(): MediaType? = mediaType

  override fun contentLength(): Long = length

  override fun writeTo(sink: BufferedSink) {
    for (part in parts) {
      when (part) {
        is BodyPart.Data -> sink.write(part.bytes)
        is BodyPart.File -> openStream(part.uri).source().use { source -> sink.writeAll(source) }
      }
    }
  }

  private fun fileLength(uri: String): Long {
    return when {
      uri.startsWith("content://") -> try {
        context.contentResolver.openAssetFileDescriptor(Uri.parse(uri), "r")?.use { it.length }
          ?: AssetFileDescriptor.UNKNOWN_LENGTH
      } catch (e: Exception) {
        AssetFileDescriptor.UNKNOWN_LENGTH
      }
      else -> fileFor(uri).length()
    }
  }

  private fun openStream(uri: String): InputStream {
    return try {
      if (uri.startsWith("content://")) {
        context.contentResolver.openInputStream(Uri.parse(uri))
          ?: throw FileNotFoundException(uri)
      } else {
        fileFor(uri).inputStream()
      }
    } catch (e: Exception) {
      throw FetcherException(FetcherErrorCode.FILE, "Cannot read file for upload: $uri", e)
    }
  }

  private fun fileFor(uri: String): File {
    val path = when {
      uri.startsWith("file://") -> Uri.parse(uri).path
      uri.startsWith("/") -> uri
      else -> null
    } ?: throw FetcherException(
      FetcherErrorCode.FILE,
      "Unsupported file URI \"$uri\": use file://, content:// or an absolute path."
    )
    return File(path)
  }
}

class ProgressRequestBody(
  private val delegate: RequestBody,
  private val onProgress: (sent: Long, total: Long) -> Unit
) : RequestBody() {
  override fun contentType(): MediaType? = delegate.contentType()

  override fun contentLength(): Long = delegate.contentLength()

  override fun isOneShot(): Boolean = delegate.isOneShot()

  override fun writeTo(sink: BufferedSink) {
    val total = contentLength()
    var sent = 0L
    var lastEmit = 0L
    val counting = object : ForwardingSink(sink) {
      override fun write(source: Buffer, byteCount: Long) {
        super.write(source, byteCount)
        sent += byteCount
        val now = System.nanoTime()
        if (now - lastEmit >= PROGRESS_INTERVAL_NS || sent == total) {
          lastEmit = now
          onProgress(sent, total)
        }
      }
    }.buffer()
    delegate.writeTo(counting)
    counting.flush()
  }
}

internal const val PROGRESS_INTERVAL_NS = 50_000_000L
