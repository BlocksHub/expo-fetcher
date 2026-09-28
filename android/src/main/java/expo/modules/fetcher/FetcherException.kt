package expo.modules.fetcher

import expo.modules.kotlin.exception.CodedException
import java.io.FileNotFoundException
import java.io.InterruptedIOException
import java.net.SocketTimeoutException
import java.net.UnknownServiceException
import javax.net.ssl.SSLException
import javax.net.ssl.SSLPeerUnverifiedException

enum class FetcherErrorCode(val code: String) {
  NETWORK("ERR_FETCHER_NETWORK"),
  TIMEOUT("ERR_FETCHER_TIMEOUT"),
  CANCELED("ERR_FETCHER_CANCELED"),
  PINNING("ERR_FETCHER_PINNING"),
  TLS("ERR_FETCHER_TLS"),
  REDIRECT("ERR_FETCHER_REDIRECT"),
  INVALID_URL("ERR_FETCHER_INVALID_URL"),
  FILE("ERR_FETCHER_FILE")
}

class FetcherException(
  val errorCode: FetcherErrorCode,
  message: String,
  cause: Throwable? = null
) : CodedException(errorCode.code, message, cause) {
  companion object {
    fun from(error: Throwable): FetcherException {
      if (error is FetcherException) {
        return error
      }
      val message = error.message ?: error.javaClass.simpleName
      val code = when {
        error is SSLPeerUnverifiedException && message.contains("pinning", ignoreCase = true) -> FetcherErrorCode.PINNING
        error is SSLException -> FetcherErrorCode.TLS
        error is UnknownServiceException && message.contains("CLEARTEXT") -> FetcherErrorCode.TLS
        error is SocketTimeoutException -> FetcherErrorCode.TIMEOUT
        error is InterruptedIOException && message == "timeout" -> FetcherErrorCode.TIMEOUT
        error is FileNotFoundException -> FetcherErrorCode.FILE
        else -> FetcherErrorCode.NETWORK
      }
      return FetcherException(code, message, error)
    }
  }
}
