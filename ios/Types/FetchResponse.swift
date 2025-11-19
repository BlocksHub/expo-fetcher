import ExpoModulesCore

struct FetchResponse: Record {
  @Field var status: Int
  @Field var statusText: String
  @Field var headers: [String]
  @Field var bodyBase64: String
  @Field var url: String
  @Field var ok: Bool
  @Field var redirected: Bool
  @Field var type: String
}
