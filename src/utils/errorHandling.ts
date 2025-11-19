export function formatFetchError(error: unknown, context?: {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
}): string {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  let formattedMessage = '\n' + '='.repeat(60) + '\n';
  formattedMessage += '🚨 FETCH ERROR DETAILS\n';
  formattedMessage += '='.repeat(60) + '\n';
  
  if (context?.url) {
    formattedMessage += `📍 URL: ${context.url}\n`;
  }
  
  if (context?.method) {
    formattedMessage += `🔧 Method: ${context.method}\n`;
  }
  
  if (context?.headers) {
    formattedMessage += `📋 Headers:\n`;
    Object.entries(context.headers).forEach(([key, value]) => {
      formattedMessage += `   ${key}: ${value}\n`;
    });
  }
  
  formattedMessage += `\n❌ Error Message:\n${errorMessage}\n`;
  
  if (errorStack) {
    formattedMessage += `\n📚 Stack Trace:\n${errorStack}\n`;
  }
  
  formattedMessage += '\n💡 Common Solutions:\n';
  formattedMessage += '   1. Verify the URL is complete (https://example.com/path)\n';
  formattedMessage += '   2. Check your internet connection\n';
  formattedMessage += '   3. Ensure the server is accessible\n';
  formattedMessage += '   4. Check for CORS issues (web only)\n';
  formattedMessage += '='.repeat(60) + '\n';

  return formattedMessage;
}

export function validateUrl(url: string): { valid: boolean; error?: string; details?: string } {
  if (!url || url.trim() === '') {
    return {
      valid: false,
      error: 'URL is empty',
      details: 'Provide a non-empty URL string'
    };
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return {
      valid: false,
      error: 'Missing protocol',
      details: `URL must start with http:// or https://. Received: "${url}"`
    };
  }

  try {
    const urlObj = new URL(url);
    if (!urlObj.hostname) {
      return {
        valid: false,
        error: 'Missing hostname',
        details: `URL must include a hostname. Received: "${url}"`
      };
    }
    return { valid: true };
  } catch (e) {
    return {
      valid: false,
      error: 'Invalid URL format',
      details: `${e instanceof Error ? e.message : String(e)}. Received: "${url}"`
    };
  }
}
