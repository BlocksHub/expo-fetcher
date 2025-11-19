package expo.modules.fetcher.utils

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody

object RequestBodyHelper {
  fun createRequestBody(body: Any?): RequestBody? {
    return when (body) {
      null -> null
      is String -> body.toRequestBody("text/plain".toMediaType())
      is ByteArray -> body.toRequestBody("application/octet-stream".toMediaType())
      is List<*> -> {
        val bodyBytes = body.map { (it as Number).toByte() }.toByteArray()
        bodyBytes.toRequestBody("application/octet-stream".toMediaType())
      }
      else -> null
    }
  }
}
