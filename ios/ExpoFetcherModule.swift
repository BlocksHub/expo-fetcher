import ExpoModulesCore
import Foundation

public final class ExpoFetcherModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoFetcher")

    Class(NativeSession.self) {
      Constructor { (config: NativeSessionConfig) -> NativeSession in
        return NativeSession(config: config)
      }
    }

    Class(NativeResponse.self) {
      Constructor { () -> NativeResponse in
        return NativeResponse()
      }

      Property("status") { (response: NativeResponse) in response.status }
      Property("statusText") { (_: NativeResponse) in "" }
      Property("url") { (response: NativeResponse) in response.url }
      Property("redirected") { (response: NativeResponse) in response.redirected }
      Property("_rawHeaders") { (response: NativeResponse) in response.headers }

      AsyncFunction("startStreaming") { (response: NativeResponse) throws -> Data? in
        return try response.startStreaming()
      }.runOnQueue(fetcherQueue)

      AsyncFunction("cancelStreaming") { (response: NativeResponse) in
        response.cancelStreaming()
      }.runOnQueue(fetcherQueue)

      AsyncFunction("arrayBuffer") { (response: NativeResponse, promise: Promise) in
        response.waitFor([.completed, .failed]) { state in
          if state == .completed {
            promise.resolve(response.drain())
          } else {
            promise.reject(response.error ?? FetcherException(.network, "The request failed."))
          }
        }
      }.runOnQueue(fetcherQueue)

      AsyncFunction("text") { (response: NativeResponse, promise: Promise) in
        response.waitFor([.completed, .failed]) { state in
          if state == .completed {
            promise.resolve(String(decoding: response.drain(), as: UTF8.self))
          } else {
            promise.reject(response.error ?? FetcherException(.network, "The request failed."))
          }
        }
      }.runOnQueue(fetcherQueue)
    }

    Class(NativeRequest.self) {
      Constructor { (response: NativeResponse) -> NativeRequest in
        return NativeRequest(response: response)
      }

      AsyncFunction("start") {
        (
          request: NativeRequest, session: NativeSession, urlString: String, requestInit: NativeRequestInit,
          body: Data?, partLayout: [String]?, partChunks: [Data]?, promise: Promise
        ) in
        guard let url = URL(string: urlString) else {
          promise.reject(FetcherException(.invalidUrl, "Invalid URL: \(urlString)"))
          return
        }
        let parts = partLayout.map { BodyPart.from(layout: $0, chunks: partChunks ?? []) }
        request.start(session: session, url: url, requestInit: requestInit, body: body, parts: parts)
        request.response.waitFor([.responseReceived, .failed]) { state in
          if state == .failed {
            promise.reject(request.response.error ?? FetcherException(.network, "The request failed."))
          } else {
            promise.resolve()
          }
        }
      }.runOnQueue(fetcherQueue)

      AsyncFunction("cancel") { (request: NativeRequest) in
        request.cancel()
      }.runOnQueue(fetcherQueue)
    }

    AsyncFunction("getCookies") { (urlString: String) -> [[String: Any?]] in
      guard let url = URL(string: urlString) else {
        throw FetcherException(.invalidUrl, "Invalid URL: \(urlString)")
      }
      let cookies = HTTPCookieStorage.shared.cookies(for: url) ?? []
      return cookies.map { cookie in
        [
          "name": cookie.name,
          "value": cookie.value,
          "domain": cookie.domain,
          "path": cookie.path,
          "expires": cookie.expiresDate.map { $0.timeIntervalSince1970 * 1000 },
          "secure": cookie.isSecure,
          "httpOnly": cookie.isHTTPOnly,
        ]
      }
    }

    AsyncFunction("setCookie") { (urlString: String, header: String) in
      guard let url = URL(string: urlString) else {
        throw FetcherException(.invalidUrl, "Invalid URL: \(urlString)")
      }
      let cookies = HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": header], for: url)
      for cookie in cookies {
        HTTPCookieStorage.shared.setCookie(cookie)
      }
    }

    AsyncFunction("clearCookies") {
      let storage = HTTPCookieStorage.shared
      for cookie in storage.cookies ?? [] {
        storage.deleteCookie(cookie)
      }
    }

    AsyncFunction("clearCache") {
      URLCache.shared.removeAllCachedResponses()
    }
  }
}
