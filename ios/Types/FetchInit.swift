import ExpoModulesCore

struct FetchInit: Record {
  @Field var body: String?
  @Field var headers: [String: String]?
  @Field var method: String?
  @Field var redirect: String?
  @Field var timeout: Double?
  @Field var exposeNonHttpOnlyCookies: Bool?
}
