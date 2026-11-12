                                     
                             
                                                         
                                 
                         
                                   
                                  
                              
                             
                                    
                               
                                              
 

const SENSITIVE_KEY_PATTERN =
  /token|secret|password|apikey|api_key|service_role|authorization|signature|connection|dsn|credential/i;

const SENSITIVE_VALUE_PATTERNS = [
  /simulated_meta_token_[a-z0-9_]+/gi,
  /postgres:\/\/[^\s"']+/gi,
  /AIza[0-9A-Za-z-_]{20,}/g,
  /EAAG[0-9A-Za-z]+/g,
];

function sanitizeValue(value         )          {
  if (typeof value === 'string') {
    let cleaned = value;
    for (const pattern of SENSITIVE_VALUE_PATTERNS) {
      cleaned = cleaned.replace(pattern, '[REDACTED_SECRET]');
    }
    return cleaned;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value !== null && typeof value === 'object') {
    const result                          = {};
    for (const [k, v] of Object.entries(value                           )) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        result[k] = '[REDACTED]';
      } else {
        result[k] = sanitizeValue(v);
      }
    }
    return result;
  }
  return value;
}

const recentLogsBuffer                       = [];
const MAX_BUFFER_SIZE = 200;

export const logger = {
  log(entry                                       )                     {
    const sanitizedMetadata = entry.metadata
      ? (sanitizeValue(entry.metadata)                           )
      : undefined;

    const fullEntry                     = {
      timestamp: new Date().toISOString(),
      ...entry,
      metadata: sanitizedMetadata,
    };

    recentLogsBuffer.push(fullEntry);
    if (recentLogsBuffer.length > MAX_BUFFER_SIZE) {
      recentLogsBuffer.shift();
    }

    if (process.env.NODE_ENV !== 'test') {
      const output = JSON.stringify(fullEntry);
      if (entry.level === 'error' || entry.level === 'security') {
        console.error(output);
      } else {
        console.log(output);
      }
    }

    return fullEntry;
  },

  getRecentLogs()                                {
    return [...recentLogsBuffer];
  },

  clearRecentLogs()       {
    recentLogsBuffer.length = 0;
  },
};

