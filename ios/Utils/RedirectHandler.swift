import Foundation

final class RedirectHandler: NSObject, URLSessionTaskDelegate {

  let followRedirects: Bool
  
  private let syncQueue = DispatchQueue(label: "com.expo.fetcher.redirect.sync")
  private var _capturedCookies: [HTTPCookie] = []

  var capturedCookies: [HTTPCookie] {
    get { syncQueue.sync { _capturedCookies } }
    set { syncQueue.sync { _capturedCookies = newValue } }
  }

  init(followRedirects: Bool) {
    self.followRedirects = followRedirects
    super.init()
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    let redirectUrl = request.url?.absoluteString ?? ""
    print("[ExpoFetcher] RedirectHandler: redirect \(response.statusCode) -> \(redirectUrl)")

    if let url = response.url {
        let headerFields = response.allHeaderFields as? [String: String] ?? [:]
        let cookies = HTTPCookie.cookies(withResponseHeaderFields: headerFields, for: url)
        self.capturedCookies = cookies
    }

    if !followRedirects {
      print("[ExpoFetcher] RedirectHandler: ⛔ manual mode — stopping redirection")
      completionHandler(nil)
      return
    }

    print("[ExpoFetcher] RedirectHandler: ✅ following HTTP redirect")
    completionHandler(request)
  }
}