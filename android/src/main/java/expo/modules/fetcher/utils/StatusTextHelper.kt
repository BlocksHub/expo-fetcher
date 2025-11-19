package expo.modules.fetcher.utils

object StatusTextHelper {
  fun getStatusText(code: Int, message: String): String {
    return when (code) {
      200 -> "OK"
      201 -> "Created"
      204 -> "No Content"
      301 -> "Moved Permanently"
      302 -> "Found"
      304 -> "Not Modified"
      400 -> "Bad Request"
      401 -> "Unauthorized"
      403 -> "Forbidden"
      404 -> "Not Found"
      500 -> "Internal Server Error"
      502 -> "Bad Gateway"
      503 -> "Service Unavailable"
      else -> message
    }
  }
}
