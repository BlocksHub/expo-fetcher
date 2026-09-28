import CryptoKit
import Foundation
import Security

final class PinningEvaluator {
  private let pins: [(pattern: String, hashes: Set<String>)]

  init(pins: [PinRecord]) {
    self.pins = pins.map { (pattern: $0.host.lowercased(), hashes: Set($0.hashes)) }
  }

  var isEmpty: Bool {
    pins.isEmpty
  }

  func hashes(for host: String) -> Set<String>? {
    let host = host.lowercased()
    var result = Set<String>()
    for pin in pins where Self.matches(pattern: pin.pattern, host: host) {
      result.formUnion(pin.hashes)
    }
    return result.isEmpty ? nil : result
  }

  static func matches(pattern: String, host: String) -> Bool {
    if pattern.hasPrefix("**.") {
      let suffix = String(pattern.dropFirst(3))
      return host == suffix || host.hasSuffix("." + suffix)
    }
    if pattern.hasPrefix("*.") {
      let suffix = String(pattern.dropFirst(2))
      guard host.hasSuffix("." + suffix) else {
        return false
      }
      let label = host.dropLast(suffix.count + 1)
      return !label.isEmpty && !label.contains(".")
    }
    return pattern == host
  }

  enum Outcome {
    case trusted
    case untrustedChain(Error?)
    case pinMismatch
  }

  func evaluate(trust: SecTrust, host: String, expected: Set<String>) -> Outcome {
    let policy = SecPolicyCreateSSL(true, host as CFString)
    SecTrustSetPolicies(trust, policy)
    var error: CFError?
    guard SecTrustEvaluateWithError(trust, &error) else {
      return .untrustedChain(error)
    }
    guard let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate] else {
      return .pinMismatch
    }
    for certificate in chain {
      if let hash = Self.spkiHash(certificate), expected.contains("sha256/" + hash) {
        return .trusted
      }
    }
    return .pinMismatch
  }

  private static let rsa2048Header: [UInt8] = [
    0x30, 0x82, 0x01, 0x22, 0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86,
    0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00, 0x03, 0x82, 0x01, 0x0f, 0x00,
  ]
  private static let rsa3072Header: [UInt8] = [
    0x30, 0x82, 0x01, 0xa2, 0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86,
    0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00, 0x03, 0x82, 0x01, 0x8f, 0x00,
  ]
  private static let rsa4096Header: [UInt8] = [
    0x30, 0x82, 0x02, 0x22, 0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86,
    0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00, 0x03, 0x82, 0x02, 0x0f, 0x00,
  ]
  private static let ecP256Header: [UInt8] = [
    0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
    0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03,
    0x42, 0x00,
  ]
  private static let ecP384Header: [UInt8] = [
    0x30, 0x76, 0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
    0x01, 0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x22, 0x03, 0x62, 0x00,
  ]

  static func spkiHash(_ certificate: SecCertificate) -> String? {
    guard
      let key = SecCertificateCopyKey(certificate),
      let attributes = SecKeyCopyAttributes(key) as? [CFString: Any],
      let keyType = attributes[kSecAttrKeyType] as? String,
      let keySize = attributes[kSecAttrKeySizeInBits] as? Int,
      let raw = SecKeyCopyExternalRepresentation(key, nil) as Data?
    else {
      return nil
    }
    let rsa = kSecAttrKeyTypeRSA as String
    let ec = kSecAttrKeyTypeECSECPrimeRandom as String
    let header: [UInt8]
    switch (keyType, keySize) {
    case (rsa, 2048): header = rsa2048Header
    case (rsa, 3072): header = rsa3072Header
    case (rsa, 4096): header = rsa4096Header
    case (ec, 256): header = ecP256Header
    case (ec, 384): header = ecP384Header
    default: return nil
    }
    var spki = Data(header)
    spki.append(raw)
    return Data(SHA256.hash(data: spki)).base64EncodedString()
  }
}
