import { NativeModule, requireNativeModule } from 'expo';
import type { FetchInit, FetchResponse } from '../types';

declare class ExpoFetcherModule extends NativeModule {
  fetch(url: string, init?: FetchInit): Promise<FetchResponse>;
  clearCookies(): Promise<void>;
}

export default requireNativeModule<ExpoFetcherModule>('ExpoFetcher');
