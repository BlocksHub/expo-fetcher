import ExpoModulesCore
import Foundation

final class NativeRequest: SharedObject, @unchecked Sendable {
  let response: NativeResponse
  private var task: URLSessionTask?
  private var canceled = false

  init(response: NativeResponse) {
    self.response = response
    super.init()
  }

  func start(
    session: NativeSession,
    url: URL,
    requestInit: NativeRequestInit,
    body: Data?,
    parts: [BodyPart]?
  ) {
    let request = buildRequest(session: session, url: url, requestInit: requestInit, body: body)
    response.redirectMode = requestInit.redirect
    response.cacheMode = requestInit.cache
    response.reportUploadProgress = requestInit.reportUploadProgress
    response.reportDownloadProgress = requestInit.reportDownloadProgress
    response.markStarted()

    guard let parts, !parts.isEmpty else {
      resume(session: session, task: session.urlSession.dataTask(with: request))
      return
    }

    DispatchQueue.global(qos: .utility).async {
      let source: Result<(file: URL, temporary: Bool), FetcherException>
      do {
        source = .success(try UploadBody.prepare(parts: parts))
      } catch let error as FetcherException {
        source = .failure(error)
      } catch {
        source = .failure(FetcherException(.file, error.localizedDescription, cause: error))
      }
      fetcherQueue.async {
        switch source {
        case .failure(let error):
          self.response.fail(error)
        case .success(let upload):
          if upload.temporary {
            self.response.temporaryFile = upload.file
          }
          if self.canceled {
            if upload.temporary {
              try? FileManager.default.removeItem(at: upload.file)
            }
            return
          }
          self.resume(session: session, task: session.urlSession.uploadTask(with: request, fromFile: upload.file))
        }
      }
    }
  }

  func cancel() {
    canceled = true
    response.pendingError = FetcherException(.canceled, "The request was canceled.")
    if let task {
      task.cancel()
    } else {
      response.fail(response.pendingError!)
    }
  }

  private func resume(session: NativeSession, task: URLSessionTask) {
    self.task = task
    response.cancelTask = { [weak task] in task?.cancel() }
    session.register(task: task, handler: response)
    task.resume()
  }

  private func buildRequest(
    session: NativeSession,
    url: URL,
    requestInit: NativeRequestInit,
    body: Data?
  ) -> URLRequest {
    var request = URLRequest(url: url)
    request.httpMethod = requestInit.method
    request.timeoutInterval = max(1, session.config.idleTimeout / 1000)
    request.httpShouldHandleCookies = session.config.cookies && requestInit.credentials == .include

    var hasCacheControl = false
    for pair in requestInit.headers where pair.count == 2 {
      if pair[0].caseInsensitiveCompare("Cache-Control") == .orderedSame {
        hasCacheControl = true
      }
      request.addValue(pair[1], forHTTPHeaderField: pair[0])
    }

    switch requestInit.cache {
    case .default:
      request.cachePolicy = .useProtocolCachePolicy
    case .noStore, .reload:
      request.cachePolicy = .reloadIgnoringLocalCacheData
    case .noCache:
      request.cachePolicy = .useProtocolCachePolicy
      if !hasCacheControl {
        request.setValue("max-age=0", forHTTPHeaderField: "Cache-Control")
      }
    case .forceCache:
      request.cachePolicy = .returnCacheDataElseLoad
    case .onlyIfCached:
      request.cachePolicy = .returnCacheDataDontLoad
    }

    request.httpBody = body
    return request
  }
}

enum UploadBody {
  private static let copyChunkSize = 1 << 20

  static func fileURL(from uri: String) throws -> URL {
    let url: URL?
    if uri.hasPrefix("file://") {
      url = URL(string: uri)
    } else if uri.hasPrefix("/") {
      url = URL(fileURLWithPath: uri)
    } else {
      throw FetcherException(
        .file, "Unsupported file URI \"\(uri)\": only file:// URIs and absolute paths can be uploaded on iOS.")
    }
    guard let url, FileManager.default.isReadableFile(atPath: url.path) else {
      throw FetcherException(.file, "File not found or not readable: \(uri)")
    }
    return url
  }

  static func prepare(parts: [BodyPart]) throws -> (file: URL, temporary: Bool) {
    if parts.count == 1, case .file(let uri) = parts[0] {
      return (try fileURL(from: uri), false)
    }
    let destination = FileManager.default.temporaryDirectory
      .appendingPathComponent("expo-fetcher-\(UUID().uuidString).body")
    FileManager.default.createFile(atPath: destination.path, contents: nil)
    do {
      let output = try FileHandle(forWritingTo: destination)
      defer { try? output.close() }
      for part in parts {
        switch part {
        case .data(let data):
          try output.write(contentsOf: data)
        case .file(let uri):
          let input = try FileHandle(forReadingFrom: try fileURL(from: uri))
          defer { try? input.close() }
          while let chunk = try input.read(upToCount: copyChunkSize), !chunk.isEmpty {
            try output.write(contentsOf: chunk)
          }
        }
      }
    } catch {
      try? FileManager.default.removeItem(at: destination)
      throw error
    }
    return (destination, true)
  }
}
