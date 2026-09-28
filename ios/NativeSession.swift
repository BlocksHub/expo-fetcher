import ExpoModulesCore
import Foundation

let fetcherQueue = DispatchQueue(label: "expo.modules.fetcher", qos: .userInitiated)

private let delegateOperationQueue: OperationQueue = {
  let queue = OperationQueue()
  queue.underlyingQueue = fetcherQueue
  queue.maxConcurrentOperationCount = 1
  queue.name = "expo.modules.fetcher.delegate"
  return queue
}()

final class NativeSession: SharedObject, @unchecked Sendable {
  let config: NativeSessionConfig
  let pinning: PinningEvaluator
  let urlSession: URLSession
  private let delegate: SessionDelegate

  init(config: NativeSessionConfig) {
    self.config = config
    self.pinning = PinningEvaluator(pins: config.pins)
    self.delegate = SessionDelegate(pinning: pinning)

    let configuration = URLSessionConfiguration.default
    configuration.httpMaximumConnectionsPerHost = max(1, config.maxConnectionsPerHost)
    configuration.timeoutIntervalForRequest = max(1, config.idleTimeout / 1000)
    configuration.waitsForConnectivity = config.waitsForConnectivity
    configuration.urlCache = URLCache.shared
    if config.cookies {
      configuration.httpCookieStorage = HTTPCookieStorage.shared
      configuration.httpShouldSetCookies = true
      configuration.httpCookieAcceptPolicy = .always
    } else {
      configuration.httpCookieStorage = nil
      configuration.httpShouldSetCookies = false
      configuration.httpCookieAcceptPolicy = .never
    }
    if Bundle.main.infoDictionary?["ReactNetworkForceWifiOnly"] as? Bool == true {
      configuration.allowsCellularAccess = false
    }
    self.urlSession = URLSession(
      configuration: configuration, delegate: delegate, delegateQueue: delegateOperationQueue)
    super.init()
  }

  func register(task: URLSessionTask, handler: NativeResponse) {
    delegate.handlers[task.taskIdentifier] = handler
  }

  override func sharedObjectWillRelease() {
    urlSession.finishTasksAndInvalidate()
  }
}

private final class SessionDelegate: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  var handlers: [Int: NativeResponse] = [:]
  let pinning: PinningEvaluator

  init(pinning: PinningEvaluator) {
    self.pinning = pinning
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    guard let handler = handlers[task.taskIdentifier] else {
      completionHandler(request)
      return
    }
    handler.willRedirect(task: task, newRequest: request, completionHandler: completionHandler)
  }

  func urlSession(
    _ session: URLSession,
    dataTask: URLSessionDataTask,
    didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    handlers[dataTask.taskIdentifier]?.didReceive(response: response)
    completionHandler(.allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    handlers[dataTask.taskIdentifier]?.didReceive(data: data)
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didSendBodyData bytesSent: Int64,
    totalBytesSent: Int64,
    totalBytesExpectedToSend: Int64
  ) {
    handlers[task.taskIdentifier]?.didSendBody(sent: totalBytesSent, total: totalBytesExpectedToSend)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    let handler = handlers.removeValue(forKey: task.taskIdentifier)
    handler?.didComplete(error: error)
  }

  func urlSession(
    _ session: URLSession,
    dataTask: URLSessionDataTask,
    willCacheResponse proposedResponse: CachedURLResponse,
    completionHandler: @escaping (CachedURLResponse?) -> Void
  ) {
    let storesCache = handlers[dataTask.taskIdentifier]?.cacheMode != .noStore
    completionHandler(storesCache ? proposedResponse : nil)
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    let space = challenge.protectionSpace
    guard
      space.authenticationMethod == NSURLAuthenticationMethodServerTrust,
      let trust = space.serverTrust,
      let expected = pinning.hashes(for: space.host)
    else {
      completionHandler(.performDefaultHandling, nil)
      return
    }
    switch pinning.evaluate(trust: trust, host: space.host, expected: expected) {
    case .trusted:
      completionHandler(.useCredential, URLCredential(trust: trust))
    case .untrustedChain(let error):
      handlers[task.taskIdentifier]?.pendingError = FetcherException(
        .tls, "The certificate chain for \(space.host) is not trusted.", cause: error)
      completionHandler(.cancelAuthenticationChallenge, nil)
    case .pinMismatch:
      handlers[task.taskIdentifier]?.pendingError = FetcherException(
        .pinning, "No certificate in the chain for \(space.host) matches the configured pins.")
      completionHandler(.cancelAuthenticationChallenge, nil)
    }
  }
}
