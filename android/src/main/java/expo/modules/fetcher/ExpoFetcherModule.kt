package expo.modules.fetcher

import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

class ExpoFetcherModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ExpoFetcher")

    Class(NativeSession::class) {
      Constructor { config: NativeSessionConfig ->
        NativeSession(appContext, config)
      }
    }

    Class(NativeResponse::class) {
      Constructor {
        NativeResponse(appContext)
      }

      Property("status") { response: NativeResponse -> response.status }
      Property("statusText") { response: NativeResponse -> response.statusText }
      Property("url") { response: NativeResponse -> response.url }
      Property("redirected") { response: NativeResponse -> response.redirected }
      Property("_rawHeaders") { response: NativeResponse -> response.headers }

      AsyncFunction("startStreaming") { response: NativeResponse, promise: Promise ->
        fetcherExecutor.execute {
          try {
            promise.resolve(response.startStreaming())
          } catch (e: FetcherException) {
            promise.reject(e)
          }
        }
      }

      AsyncFunction("cancelStreaming") { response: NativeResponse, promise: Promise ->
        fetcherExecutor.execute {
          response.cancelStreaming()
          promise.resolve(null)
        }
      }

      AsyncFunction("arrayBuffer") { response: NativeResponse, promise: Promise ->
        fetcherExecutor.execute {
          response.waitFor(setOf(NativeResponse.State.COMPLETED, NativeResponse.State.FAILED)) { state ->
            if (state == NativeResponse.State.COMPLETED) {
              promise.resolve(response.drain())
            } else {
              promise.reject(response.error ?: FetcherException(FetcherErrorCode.NETWORK, "The request failed."))
            }
          }
        }
      }

      AsyncFunction("text") { response: NativeResponse, promise: Promise ->
        fetcherExecutor.execute {
          response.waitFor(setOf(NativeResponse.State.COMPLETED, NativeResponse.State.FAILED)) { state ->
            if (state == NativeResponse.State.COMPLETED) {
              promise.resolve(response.drain().toString(Charsets.UTF_8))
            } else {
              promise.reject(response.error ?: FetcherException(FetcherErrorCode.NETWORK, "The request failed."))
            }
          }
        }
      }
    }

    Class(NativeRequest::class) {
      Constructor { response: NativeResponse ->
        NativeRequest(appContext, response)
      }

      AsyncFunction("start") {
          request: NativeRequest,
          session: NativeSession,
          url: String,
          init: NativeRequestInit,
          body: ByteArray?,
          partLayout: List<String>?,
          partChunks: List<ByteArray>?,
          promise: Promise ->
        val context = context
        val parts = partLayout?.let { BodyPart.from(it, partChunks ?: emptyList()) }
        fetcherExecutor.execute {
          try {
            request.start(context, session, url, init, body, parts)
          } catch (e: Throwable) {
            request.response.fail(FetcherException.from(e))
          }
          request.response.waitFor(
            setOf(NativeResponse.State.RESPONSE_RECEIVED, NativeResponse.State.FAILED)
          ) { state ->
            if (state == NativeResponse.State.FAILED) {
              promise.reject(request.response.error ?: FetcherException(FetcherErrorCode.NETWORK, "The request failed."))
            } else {
              promise.resolve(null)
            }
          }
        }
      }

      AsyncFunction("cancel") { request: NativeRequest, promise: Promise ->
        fetcherExecutor.execute {
          request.cancel()
          promise.resolve(null)
        }
      }
    }

    AsyncFunction("getCookies") { url: String ->
      val httpUrl = url.toHttpUrlOrNull()
        ?: throw FetcherException(FetcherErrorCode.INVALID_URL, "Invalid URL: $url")
      WebkitCookieJar.getCookies(httpUrl).map { cookie ->
        mapOf(
          "name" to cookie.name,
          "value" to cookie.value,
          "domain" to null,
          "path" to null,
          "expires" to null,
          "secure" to false,
          "httpOnly" to false
        )
      }
    }

    AsyncFunction("setCookie") { url: String, header: String ->
      val httpUrl = url.toHttpUrlOrNull()
        ?: throw FetcherException(FetcherErrorCode.INVALID_URL, "Invalid URL: $url")
      WebkitCookieJar.setCookie(httpUrl, header)
    }

    AsyncFunction("clearCookies") { promise: Promise ->
      WebkitCookieJar.clear { promise.resolve(null) }
    }

    AsyncFunction("clearCache") {
      SharedNetworking.cache(context).evictAll()
    }
  }
}
