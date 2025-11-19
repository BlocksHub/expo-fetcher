export type RequestMethod = 
  | 'GET' 
  | 'POST' 
  | 'PUT' 
  | 'DELETE' 
  | 'PATCH' 
  | 'HEAD' 
  | 'OPTIONS';

export type RequestRedirection = 'follow' | 'error' | 'manual';

export interface RequestInit {
  body?: string | ArrayBuffer | Uint8Array;
  headers?: Headers | Record<string, string>;
  method?: RequestMethod;
  redirect?: RequestRedirection;
}

export interface FetchInit {
  body?: string | ArrayBuffer;
  headers?: Record<string, string>;
  method?: string;
  redirect?: string;
  timeout?: number;
  exposeNonHttpOnlyCookies?: boolean;
}

export interface FetchResponse {
  status: number;
  statusText: string;
  headers: string[];
  bodyBase64: string;
  url: string;
  ok: boolean;
  redirected: boolean;
  type: string;
}
