import ExpoModulesCore
import Foundation

final class NativeResponse: SharedObject, @unchecked Sendable {
  enum State {
    case initialized
    case started
    case responseReceived
    case streaming
    case streamingCanceled
    case completed
    case failed
  }

  private(set) var state: State = .initialized {
    didSet {
      let listeners = stateListeners
      stateListeners = []
      for listener in listeners where !listener(state) {
        stateListeners.append(listener)
      }
    }
  }
  private var stateListeners: [(State) -> Bool] = []

  private(set) var status = -1
  private(set) var url = ""
  private(set) var headers: [[String]] = []
  private(set) var redirected = false
  private(set) var error: FetcherException?

  var pendingError: FetcherException?

  var redirectMode: RedirectMode = .follow
  var cacheMode: CacheMode = .default
  var reportUploadProgress = false
  var reportDownloadProgress = false
  var cancelTask: (() -> Void)?
  var temporaryFile: URL?

  private var buffer: [Data] = []
  private var received: Int64 = 0
  private var expected: Int64 = -1
  private var lastDownloadEmit: TimeInterval = 0
  private var lastUploadEmit: TimeInterval = 0

  private static let progressInterval: TimeInterval = 0.05

  func waitFor(_ states: [State], callback: @escaping (State) -> Void) {
    if states.contains(state) {
      callback(state)
      return
    }
    stateListeners.append { newState in
      guard states.contains(newState) else {
        return false
      }
      callback(newState)
      return true
    }
  }

  func markStarted() {
    if state == .initialized {
      state = .started
    }
  }

  func startStreaming() throws -> Data? {
    switch state {
    case .responseReceived:
      state = .streaming
      let queued = drain()
      if !queued.isEmpty {
        emit(event: "didReceiveResponseData", arguments: queued)
      }
      return nil
    case .completed:
      return drain()
    case .failed:
      throw error ?? FetcherException(.network, "The request failed.")
    default:
      return nil
    }
  }

  func cancelStreaming() {
    guard state == .responseReceived || state == .streaming else {
      return
    }
    buffer.removeAll()
    state = .streamingCanceled
    cancelTask?()
  }

  func drain() -> Data {
    if buffer.count == 1 {
      return buffer.removeFirst()
    }
    let size = buffer.reduce(0) { $0 + $1.count }
    var result = Data(capacity: size)
    for chunk in buffer {
      result.append(chunk)
    }
    buffer.removeAll()
    return result
  }

  func fail(_ exception: FetcherException) {
    guard state != .completed && state != .failed else {
      return
    }
    finish(error: exception)
  }

  func willRedirect(
    task: URLSessionTask,
    newRequest: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    switch redirectMode {
    case .follow:
      redirected = true
      completionHandler(newRequest)
    case .manual:
      completionHandler(nil)
    case .error:
      pendingError = FetcherException(.redirect, "Redirect is not allowed when redirect mode is 'error'.")
      completionHandler(nil)
      task.cancel()
    }
  }

  func didReceive(response: URLResponse) {
    guard state == .started, pendingError == nil else {
      return
    }
    url = response.url?.absoluteString ?? ""
    expected = response.expectedContentLength
    if let http = response as? HTTPURLResponse {
      status = http.statusCode
      headers = Self.headerPairs(http)
    } else {
      status = 200
    }
    state = .responseReceived
  }

  func didReceive(data: Data) {
    received += Int64(data.count)
    switch state {
    case .responseReceived:
      buffer.append(data)
    case .streaming:
      emit(event: "didReceiveResponseData", arguments: data)
    default:
      return
    }
    emitDownloadProgress(force: false)
  }

  func didSendBody(sent: Int64, total: Int64) {
    guard reportUploadProgress else {
      return
    }
    let now = ProcessInfo.processInfo.systemUptime
    if sent < total && now - lastUploadEmit < Self.progressInterval {
      return
    }
    lastUploadEmit = now
    emit(event: "uploadProgress", arguments: Double(sent), Double(total))
  }

  func didComplete(error: Error?) {
    if let temporaryFile {
      try? FileManager.default.removeItem(at: temporaryFile)
      self.temporaryFile = nil
    }
    if let pendingError {
      finish(error: pendingError)
      return
    }
    if let error {
      if state == .streamingCanceled {
        state = .failed
        emit(event: "readyForJSFinalization")
        return
      }
      finish(error: FetcherException.from(error))
      return
    }
    guard state == .responseReceived || state == .streaming || state == .streamingCanceled else {
      return
    }
    emitDownloadProgress(force: true)
    if state == .streaming {
      emit(event: "didComplete")
    }
    state = .completed
    emit(event: "readyForJSFinalization")
  }

  private func finish(error exception: FetcherException) {
    self.error = exception
    if state == .streaming {
      emit(event: "didFailWithError", arguments: exception.message, exception.code)
    }
    buffer.removeAll()
    state = .failed
    emit(event: "readyForJSFinalization")
  }

  private func emitDownloadProgress(force: Bool) {
    guard reportDownloadProgress else {
      return
    }
    let now = ProcessInfo.processInfo.systemUptime
    if !force && now - lastDownloadEmit < Self.progressInterval {
      return
    }
    lastDownloadEmit = now
    emit(event: "downloadProgress", arguments: Double(received), Double(expected))
  }

  private static func headerPairs(_ response: HTTPURLResponse) -> [[String]] {
    var pairs: [[String]] = []
    var setCookie: String?
    for (key, value) in response.allHeaderFields {
      guard let name = key as? String else {
        continue
      }
      let text = (value as? String) ?? String(describing: value)
      if name.caseInsensitiveCompare("Set-Cookie") == .orderedSame {
        setCookie = text
      } else {
        pairs.append([name, text])
      }
    }
    if let setCookie, let url = response.url {
      let cookies = HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": setCookie], for: url)
      for cookie in cookies {
        pairs.append(["Set-Cookie", serialize(cookie)])
      }
    }
    return pairs
  }

  private static let cookieDateFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "GMT")
    formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss 'GMT'"
    return formatter
  }()

  static func serialize(_ cookie: HTTPCookie) -> String {
    var parts = ["\(cookie.name)=\(cookie.value)"]
    if !cookie.domain.isEmpty {
      parts.append("Domain=\(cookie.domain)")
    }
    parts.append("Path=\(cookie.path)")
    if let expires = cookie.expiresDate {
      parts.append("Expires=\(cookieDateFormatter.string(from: expires))")
    }
    if cookie.isSecure {
      parts.append("Secure")
    }
    if cookie.isHTTPOnly {
      parts.append("HttpOnly")
    }
    if let sameSite = cookie.sameSitePolicy {
      parts.append("SameSite=\(sameSite.rawValue)")
    }
    return parts.joined(separator: "; ")
  }
}
