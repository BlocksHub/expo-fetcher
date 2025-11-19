import Foundation

class LegacyRequestService {
  
  func makeRequest(url: String, options: [String: Any]) async throws -> [String: Any] {
    
    guard let requestURL = URL(string: url) else {
      throw NSError(
        domain: "ExpoFetcherModule",
        code: -1,
        userInfo: [NSLocalizedDescriptionKey: "Invalid URL"]
      )
    }
    
    var request = URLRequest(url: requestURL)
    request.httpMethod = options["method"] as? String ?? "GET"
    let perRequestTimeout = options["timeout"] as? Double ?? 30.0
    request.timeoutInterval = perRequestTimeout

    print("[ExpoFetcher] makeRequest START: \(request.httpMethod ?? "GET") \(url) timeout=\(perRequestTimeout)s options=\(options)")
    
    if let headers = options["headers"] as? [String: String] {
      for (key, value) in headers {
        request.setValue(value, forHTTPHeaderField: key)
      }
    }
    
    if let body = options["body"] as? String {
      request.httpBody = body.data(using: .utf8)
    }
    
    let manageCookies = options["manageCookies"] as? Bool ?? true
    request.httpShouldHandleCookies = manageCookies

    let followRedirects = options["followRedirects"] as? Bool ?? true
    let config = URLSessionConfiguration.default
    config.httpCookieAcceptPolicy = manageCookies ? .always : .never
    config.httpShouldSetCookies = manageCookies
    config.timeoutIntervalForRequest = perRequestTimeout
    config.timeoutIntervalForResource = perRequestTimeout * 2

    let session = URLSession(
      configuration: config,
      delegate: RedirectHandler(followRedirects: followRedirects),
      delegateQueue: nil
    )

    let startTime = Date()
    let (data, response): (Data, URLResponse)
    do {
      (data, response) = try await session.data(for: request)
    } catch {
      let elapsed = Date().timeIntervalSince(startTime)
      print("[ExpoFetcher] makeRequest ERROR after \(String(format: "%.2f", elapsed))s for \(url): \(error)")
      throw error
    }
    
    guard let httpResponse = response as? HTTPURLResponse else {
      throw NSError(
        domain: "ExpoFetcherModule",
        code: -2,
        userInfo: [NSLocalizedDescriptionKey: "Invalid response"]
      )
    }
    
    var headersDict: [String: String] = [:]
    for (key, value) in httpResponse.allHeaderFields {
      if let keyStr = key as? String, let valueStr = value as? String {
        headersDict[keyStr.lowercased()] = valueStr
      }
    }
    
    var cookies: [[String: String]] = []
    if manageCookies, let url = httpResponse.url,
       let httpCookies = HTTPCookieStorage.shared.cookies(for: url) {
      for cookie in httpCookies {
        cookies.append([
          "name": cookie.name,
          "value": cookie.value,
          "domain": cookie.domain,
          "path": cookie.path
        ])
      }
    }
    
    let bodyString = String(data: data, encoding: .utf8) ?? ""
    let isRedirect = httpResponse.statusCode >= 300 && httpResponse.statusCode < 400
    let redirectUrl = isRedirect ? headersDict["location"] : nil
    
    return [
      "status": httpResponse.statusCode,
      "statusText": HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode),
      "headers": headersDict,
      "body": bodyString,
      "url": httpResponse.url?.absoluteString ?? url,
      "redirected": !followRedirects && isRedirect,
      "redirectUrl": redirectUrl as Any,
      "cookies": cookies
    ]
  }
}
