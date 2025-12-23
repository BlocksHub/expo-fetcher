export function formatFetchError(error: unknown, context?: {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
}): string {
  const baseError = error instanceof Error ? error : new Error(String(error));
  
  const parts: string[] = [];
  parts.push(`[FetchError]: ${baseError.message}`);

  if (context) {
    const { method, url, headers } = context;
    if (method || url) {
      parts.push(`Request: ${method || 'GET'} ${url || 'UNKNOWN'}`);
    }
    
    if (headers && Object.keys(headers).length > 0) {
      try {
        parts.push(`Headers: ${JSON.stringify(headers)}`);
      } catch {
        parts.push('Headers: [Unable to stringify]');
      }
    }
  }

  if (baseError.stack) {
    parts.push(`Stack Trace: ${baseError.stack}`);
  }

  return parts.join('\n');
}

export function validateUrl(url: string): { valid: boolean; error?: string; details?: string } {
  if (!url || !url.trim()) {
    return {
      valid: false,
      error: 'Empty URL',
      details: 'The provided URL string is empty or null.'
    };
  }

  try {
    const parsedUrl = new URL(url);
    
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return {
        valid: false,
        error: 'Unsupported Protocol',
        details: `URL protocol must be http: or https:. Received: "${parsedUrl.protocol}"`
      };
    }

    if (!parsedUrl.hostname) {
      return {
        valid: false,
        error: 'Missing Hostname',
        details: 'The URL does not contain a valid hostname.'
      };
    }

    return { valid: true };
  } catch (e) {
    if (!url.match(/^[a-zA-Z]+:\/\//)) {
       return {
        valid: false,
        error: 'Invalid Format',
        details: 'URL appears to be missing a protocol (e.g., https://). ' + (e instanceof Error ? e.message : String(e))
      };
    }

    return {
      valid: false,
      error: 'Malformed URL',
      details: e instanceof Error ? e.message : String(e)
    };
  }
}
