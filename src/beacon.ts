import { debugLogging } from './debug.js'
import { DEFAULT_CONFIG, type BeaconConfig } from './config.js'

// Enhanced TraceInfo type for multi-table buffer system with comprehensive DB tracking
export type TraceInfo = {
  // HTTP fields
  http_method?: string
  http_path?: string // Original path: /api/users/123
  http_status_code?: number // 100-599 only
  http_duration_ms?: number
  http_user_agent?: string
  http_remote_ip?: string // MUST be valid IP format
  http_finished?: boolean // Whether the HTTP request has finished

  log_count?: number // Number of logs in the trace

  // Database fields - EXPANDED for comprehensive tracking
  db_query?: string
  db_duration_ms?: number
  db_rows_affected?: number
  db_query_type?: string // SELECT, INSERT, UPDATE, DELETE, etc.
  db_table_name?: string // Primary table being queried
  db_database?: string // Database/schema name
  db_rows_examined?: number // For performance analysis
  db_error_code?: string // Database error code if failed
  db_error_message?: string // Error message if failed
  db_connection_id?: string // Database connection identifier
  db_transaction_id?: string // Transaction ID

  // Custom fields
  custom_fields?: Record<string, unknown>
}
export type DbInfo = {
  // Database fields - EXPANDED for comprehensive tracking
  db_query?: string
  db_duration_ms?: number
  db_rows_affected?: number
  db_query_type?: string // SELECT, INSERT, UPDATE, DELETE, etc.
  db_table_name?: string // Primary table being queried
  db_database?: string // Database/schema name
  db_rows_examined?: number // For performance analysis
  db_error_code?: string // Database error code if failed
  db_error_message?: string // Error message if failed
  db_connection_id?: string // Database connection identifier
  db_transaction_id?: string // Transaction ID

  // Custom fields
  custom_fields?: Record<string, unknown>
}

// Enhanced LogEvent type for beacon-server multi-table support
export type LogEvent = {
  event_type: 'log' | 'http' | 'db' // Required
  message: string // Required
  severity?: 'debug' | 'info' | 'warn' | 'error' | 'fatal' // Optional (default: info)
  timestamp?: string // Optional (ISO 8601)

  // Optional trace linking
  trace_id?: string // Optional
  span_id?: string // Optional
  parent_span_id?: string // Optional
  order_in_trace?: number // Optional

  // NEW: Enhanced trace information (stored in traces table)
  trace_info?: TraceInfo // Optional
  db_info?: DbInfo // Optional
}

// Enhanced retry logic with validation error handling
const sendWithRetry = async (
  url: string,
  options: RequestInit,
  config: BeaconConfig,
  retryCount = 0
): Promise<void> => {
  try {
    if (debugLogging) {
      console.log(`🌐 Sending request to ${url}`, {
        method: options.method,
        retryCount,
        body: options.body ? JSON.parse(options.body as string) : null,
      })
    }

    const response = await fetch(url, options)

    if (debugLogging) {
      console.log(`📡 Server response from ${url}:`, {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries()),
      })
    }

    if (response.ok) {
      if (debugLogging) {
        const responseText = await response.text()
        console.log(`✅ Success response body:`, responseText)
      }
      return // Success
    }

    if (response.status === 400) {
      // Validation error - don't retry, log the error
      const errorText = await response.text()
      console.error('❌ Validation error from server:', errorText)
      if (debugLogging) {
        console.log('🔍 Full validation error details:', {
          status: response.status,
          statusText: response.statusText,
          body: errorText,
          url,
        })
      }
      return // Don't retry validation errors
    }

    const errorText = await response.text()
    if (debugLogging) {
      console.log(`⚠️ Error response body:`, errorText)
    }
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  } catch (error) {
    if (debugLogging) {
      console.log(
        `🔄 Request failed, retry ${retryCount}/${config.maxRetries}:`,
        error
      )
    }

    if (retryCount < config.maxRetries) {
      const delay = config.retryDelay * Math.pow(2, retryCount) // Exponential backoff
      if (debugLogging) {
        console.log(`⏳ Retrying in ${delay}ms...`)
      }
      await new Promise((resolve) => setTimeout(resolve, delay))
      return sendWithRetry(url, options, config, retryCount + 1)
    }
  }
}

// Pure function to send single log
export const sendSingleLog = async (
  logEvent: LogEvent,
  config: BeaconConfig = DEFAULT_CONFIG
): Promise<void> => {
  if (!config.sendEnabled) {
    return
  }
  await sendWithRetry(
    `${config.baseUrl}/logs`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(logEvent),
    },
    config
  )
}

// Health check and utility functions - enhanced with validation
export const checkBeaconHealth = async (
  config: BeaconConfig = DEFAULT_CONFIG
): Promise<boolean> => {
  const { baseUrl } = config
  try {
    const response = await fetch(`${baseUrl}/health`)
    return response.ok
  } catch {
    return false
  }
}

export const getBeaconStats = async (
  config: BeaconConfig = DEFAULT_CONFIG
): Promise<Record<string, unknown> | null> => {
  const { baseUrl } = config
  try {
    const response = await fetch(`${baseUrl}/logs/stats`)
    if (response.ok) {
      return (await response.json()) as Record<string, unknown>
    }
  } catch (error) {
    console.error('Failed to get Beacon stats:', error)
  }
  return null
}

// TODO: check this if batching is needed and it works properly
// // Pure function to send batch logs
// exportconst sendBatchLogs = async (
//     logEvents: LogEvent[],
//     config: BeaconConfig
//   ): Promise<void> => {
//     if (!config.sendEnabled) {
//       return
//     }
//     await sendWithRetry(
//       `${config.baseUrl}/logs/batch`,
//       {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify(logEvents),
//       },
//       config
//     )
//   }
