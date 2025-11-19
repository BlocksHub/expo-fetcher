import Foundation
import ExpoModulesCore

final class FetchService {

  func performFetch(url: String, options: FetchInit?) async throws -> FetchResponse {
    guard let requestURL = URL(string: url) else {
      throw NSError(domain: "ExpoFetcherModule", code: -1,
                    userInfo: [NSLocalizedDescriptionKey: "Invalid URL"])
    }

    var request = URLRequest(url: requestURL)
    request.httpMethod = options?.method ?? "GET"
    let perRequestTimeout = options?.timeout ?? 30.0
    request.timeoutInterval = perRequestTimeout
    
    request.httpShouldHandleCookies = false

    print("[ExpoFetcher] performFetch START: \(request.httpMethod ?? "GET") \(url)")

    if let headers = options?.headers {
      for (k, v) in headers { request.setValue(v, forHTTPHeaderField: k) }
    }
    
    if let body = options?.body {
      request.httpBody = body.data(using: .utf8)
    }

    let followRedirects = (options?.redirect ?? "follow") == "follow"

    let config = URLSessionConfiguration.ephemeral
    config.httpCookieAcceptPolicy = .never
    config.httpShouldSetCookies = false
    config.timeoutIntervalForRequest = perRequestTimeout

    let redirectHandler = RedirectHandler(followRedirects: followRedirects)
    let session = URLSession(configuration: config, delegate: redirectHandler, delegateQueue: nil)

    do {
      let (data, response) = try await session.data(for: request)
      
      guard let httpResponse = response as? HTTPURLResponse else {
        throw NSError(domain: "ExpoFetcherModule", code: -2, userInfo: [NSLocalizedDescriptionKey: "Not HTTP response"])
      }

      var headersArray: [String] = []
      
      for (k, v) in httpResponse.allHeaderFields {
        if let key = k as? String, let val = v as? String {
            if key.caseInsensitiveCompare("Set-Cookie") != .orderedSame {
                headersArray.append(key)
                headersArray.append(val)
            }
        }
      }
      
      if let url = httpResponse.url {
          let rawHeaders = httpResponse.allHeaderFields as? [String: String] ?? [:]
          let cookies = HTTPCookie.cookies(withResponseHeaderFields: rawHeaders, for: url)
          
          for cookie in cookies {
              var cookieParts = ["\(cookie.name)=\(cookie.value)"]
              
              if !cookie.domain.isEmpty {
                  cookieParts.append("Domain=\(cookie.domain)")
              }
              
              cookieParts.append("Path=\(cookie.path)")
              
              if let expires = cookie.expiresDate {
                  let formatter = DateFormatter()
                  formatter.locale = Locale(identifier: "en_US")
                  formatter.timeZone = TimeZone(identifier: "GMT")
                  formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss 'GMT'"
                  cookieParts.append("Expires=\(formatter.string(from: expires))")
              }
              
              if cookie.isSecure { cookieParts.append("Secure") }
              if cookie.isHTTPOnly { cookieParts.append("HttpOnly") }
              
              let cookieString = cookieParts.joined(separator: "; ")
              
              headersArray.append("Set-Cookie")
              headersArray.append(cookieString)
          }
      }

      let bodyBase64 = data.base64EncodedString()
      let isRedirect = [301, 302, 303, 307, 308].contains(httpResponse.statusCode)

      let fetchResponse = FetchResponse()
      fetchResponse.status = httpResponse.statusCode
      fetchResponse.statusText = HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode)
      fetchResponse.headers = headersArray
      fetchResponse.bodyBase64 = bodyBase64
      fetchResponse.url = httpResponse.url?.absoluteString ?? url
      fetchResponse.ok = !isRedirect && httpResponse.statusCode >= 200 && httpResponse.statusCode < 300
      fetchResponse.redirected = false
      fetchResponse.type = "default"

      return fetchResponse

    } catch {
      print("[ExpoFetcher] Error: \(error)")
      throw error
    }
  }
}