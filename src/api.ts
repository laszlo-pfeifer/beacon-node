import { randomUUID } from 'crypto'
import { LogEvent, sendSingleLog } from './beacon.js'
import { debugLogging } from './debug.js'
import { executionContext } from './execution-context.js'
import { isValidHttpStatus, isValidIP } from './validator.js'

const sendLog = async (logEvent: LogEvent): Promise<void> => {
  if (debugLogging) {
    console.log('🚀 Sending log to Beacon Server:', {
      event_type: logEvent.event_type,
      message: logEvent.message,
      trace_id: logEvent.trace_id,
      span_id: logEvent.span_id,
      timestamp: new Date().toISOString(),
    })
  }
  await sendSingleLog(logEvent)
}

const createLogEvent = (
  event_type: LogEvent['event_type'],
  severity: LogEvent['severity'],
  message: string,
  trace_id?: string,
  span_id?: string
): LogEvent => {
  const store = executionContext.getStore()
  if (store) {
    // Increment the log count for this trace
    store.logCount += 1
  }

  return {
    event_type,
    severity,
    message,
    timestamp: new Date().toISOString(), // TODO: check what timezone specific setting should be used in here.
    trace_id: store?.traceId ?? trace_id,
    span_id: store?.spanId ?? span_id,
    parent_span_id: store?.parentSpanId,
    order_in_trace: store?.logCount,
  }
}

export const logInfo = (
  message: string,
  extra: Record<string, unknown> = {}
): void => {
  const { _beacon_skip } = extra
  if (_beacon_skip === true) return
  sendLog(createLogEvent('log', 'info', message))
}

export const logWarn = (
  message: string,
  extra: Record<string, unknown> = {}
): void => {
  const { _beacon_skip } = extra
  if (_beacon_skip === true) return
  sendLog(createLogEvent('log', 'warn', message))
}

export const logError = (
  message: string,
  extra: Record<string, unknown> = {}
): void => {
  const { _beacon_skip } = extra
  if (_beacon_skip === true) return
  sendLog(createLogEvent('log', 'error', message))
}

export const logDebug = (
  message: string,
  extra: Record<string, unknown> = {}
): void => {
  const { _beacon_skip } = extra
  if (_beacon_skip === true) return
  sendLog(createLogEvent('log', 'debug', message))
}

export const logFatal = (
  message: string,
  extra: Record<string, unknown> = {}
): void => {
  const { _beacon_skip } = extra
  if (_beacon_skip === true) return
  sendLog(createLogEvent('log', 'fatal', message))
}

export const logDbOperation = (
  query: string,
  durationMs: number,
  rowsAffected?: number,
  metadata?: {
    queryType?: string
    tableName?: string
    database?: string
    rowsExamined?: number
    errorCode?: string
    errorMessage?: string
    connectionId?: string
    transactionId?: string
  },
  extra: Record<string, unknown> = {}
): void => {
  const { _beacon_skip } = extra
  if (_beacon_skip === true) return

  if (debugLogging) {
    console.log('📊 logDbOperation called:', {
      query: query.substring(0, 50) + (query.length > 50 ? '...' : ''),
      durationMs,
      metadata,
      trace_id: executionContext.getStore()?.traceId,
      span_id: executionContext.getStore()?.spanId,
    })
  }

  // TODO: Using query in message only works for this test project because it uses tRPC.
  // In production, consider using a more generic message or sanitizing the query.
  const message = metadata?.errorCode
    ? `Database query failed: ${query.substring(0, 50)}${
        query.length > 50 ? '...' : ''
      }`
    : `Database query completed: ${query.substring(0, 50)}${
        query.length > 50 ? '...' : ''
      }`

  const event: LogEvent = createLogEvent(
    'db',
    metadata?.errorCode ? 'error' : 'info',
    message
  )

  const enhancedEvent: LogEvent = {
    ...event,
    trace_info: {
      db_query: query,
      db_duration_ms: Math.round(durationMs),
      db_rows_affected: rowsAffected,
      db_query_type: metadata?.queryType,
      db_table_name: metadata?.tableName,
      db_database: metadata?.database,
      db_rows_examined: metadata?.rowsExamined,
      db_error_code: metadata?.errorCode,
      db_error_message: metadata?.errorMessage,
      db_connection_id: metadata?.connectionId,
      db_transaction_id: metadata?.transactionId,
      custom_fields: Object.keys(extra).length > 0 ? extra : undefined,
    },
    db_info: {
      db_query: query,
      db_duration_ms: Math.round(durationMs),
      db_rows_affected: rowsAffected,
      db_query_type: metadata?.queryType,
      db_table_name: metadata?.tableName,
      db_database: metadata?.database,
      db_rows_examined: metadata?.rowsExamined,
      db_error_code: metadata?.errorCode,
      db_error_message: metadata?.errorMessage,
      db_connection_id: metadata?.connectionId,
      db_transaction_id: metadata?.transactionId,
      custom_fields: Object.keys(extra).length > 0 ? extra : undefined,
    },
  }

  sendLog(enhancedEvent)
}

export const startHttpTrace = ({
  method,
  path,
  userAgent,
  remoteIP,
}: {
  method: string
  path: string
  userAgent?: string
  remoteIP?: string
}): void => {
  const event: LogEvent = createLogEvent(
    'http',
    'info',
    `${method} ${path} - HTTP request started`
  )
  const enhancedEvent: LogEvent = {
    ...event,
    trace_info: {
      http_method: method,
      http_path: path,
      http_user_agent: userAgent,
      http_remote_ip: remoteIP && isValidIP(remoteIP) ? remoteIP : undefined,
    },
  }

  sendLog(enhancedEvent)
}

export const endHttpTrace = ({
  method,
  path,
  statusCode,
  durationMs,
}: {
  method: string
  path: string
  statusCode: number
  durationMs: number
}): void => {
  const event: LogEvent = createLogEvent(
    'http',
    'info',
    `${method} ${path} - HTTP request completed`
  )
  const enhancedEvent: LogEvent = {
    ...event,
    trace_info: {
      http_status_code: isValidHttpStatus(statusCode) ? statusCode : undefined,
      http_duration_ms: Math.round(durationMs),
      http_finished: true,
      log_count: executionContext.getStore()?.logCount,
    },
  }

  sendLog(enhancedEvent)
}

export function runInSpan<T>(fn: () => Promise<T> | T): Promise<T> | T {
  const parentStore = executionContext.getStore()

  const childStore = {
    traceId: parentStore?.traceId || randomUUID(),
    spanId: randomUUID(),
    parentSpanId: parentStore?.spanId,
    logCount: parentStore?.logCount || 0, // INHERIT parent's count
  }

  return executionContext.run(childStore, () => {
    const result = fn()

    // CRITICAL: Sync the updated count back to parent
    if (parentStore) {
      parentStore.logCount = childStore.logCount
    }

    return result
  })
}
