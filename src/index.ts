// Beacon Node TypeScript Instrumentation Library
import { randomUUID } from 'crypto'
import fp from 'fastify-plugin'
import { AsyncLocalStorage } from 'async_hooks'
import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'

export const executionContext = new AsyncLocalStorage<{
  traceId: string
  spanId: string
  logCount: number
  parentSpanId?: string
}>()

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
}

// Beacon Server response types
export type BeaconResponse = {
  status: 'accepted' | 'error'
  timestamp: string
  message: string
}

export type BeaconBatchResponse = BeaconResponse & {
  total_logs: number
  valid_logs: number
  invalid_logs: number
}

// Configuration for the beacon client - optimized for 5k+ req/min
type BeaconConfig = {
  baseUrl: string
  sendEnabled: boolean
  batchSize: number
  batchTimeout: number
  maxRetries: number
  retryDelay: number
  enableValidation: boolean
}

const DEFAULT_CONFIG: BeaconConfig = {
  baseUrl: process.env['BEACON_URL'] || 'http://localhost:8085',
  sendEnabled:
    !!process.env['BEACON_URL'] &&
    process.env['BEACON_ENABLED']?.toLowerCase() !== 'false',
  batchSize: 50, // Optimized for 5k+ req/min performance
  batchTimeout: 5000, // 5 seconds auto-flush as required
  maxRetries: 3,
  retryDelay: 1000, // 1 second initial delay
  enableValidation: true, // MANDATORY validation to prevent batch failures
}

// ====== VALIDATION FUNCTIONS (Pure Functions) ======

// IP Address Validation - Critical for server acceptance
export const isValidIP = (ip: string): boolean => {
  if (!ip || typeof ip !== 'string') return false

  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/
  if (!ipv4Regex.test(ip)) return false

  return ip.split('.').every((octet) => {
    const num = parseInt(octet, 10)
    return num >= 0 && num <= 255 && octet === num.toString()
  })
}

// HTTP Status Code Validation - Server enforces 100-599 range
export const isValidHttpStatus = (status: number): boolean => {
  return Number.isInteger(status) && status >= 100 && status <= 599
}

// Path Length Validation - Server enforces ≤2048 chars
export const isValidPath = (path: string): boolean => {
  return typeof path === 'string' && path.length > 0 && path.length <= 2048
}

// Database Query Validation - Prevent oversized queries
export const isValidDbQuery = (query: string): boolean => {
  return typeof query === 'string' && query.length > 0 && query.length <= 8192
}

// Database Query Type Validation
export const isValidDbQueryType = (queryType: string): boolean => {
  const validTypes = [
    'SELECT',
    'INSERT',
    'UPDATE',
    'DELETE',
    'CREATE',
    'DROP',
    'ALTER',
    'TRUNCATE',
    'CALL',
    'EXPLAIN',
  ]
  return validTypes.includes(queryType.toUpperCase())
}

// Enhanced comprehensive event validation for strict server requirements
export const validateLogEvent = (
  event: LogEvent
): { isValid: boolean; errors: string[] } => {
  const errors: string[] = []

  // Required fields
  if (!event.event_type || !['log', 'http', 'db'].includes(event.event_type)) {
    errors.push('event_type must be one of: log, http, db')
  }

  if (!event.message || typeof event.message !== 'string') {
    errors.push('message is required and must be a string')
  }

  // Optional severity validation
  if (
    event.severity &&
    !['debug', 'info', 'warn', 'error', 'fatal'].includes(event.severity)
  ) {
    errors.push('severity must be one of: debug, info, warn, error, fatal')
  }

  // Enhanced trace info validation
  if (event.trace_info) {
    const { trace_info } = event

    // HTTP validations
    if (trace_info.http_remote_ip && !isValidIP(trace_info.http_remote_ip)) {
      errors.push(`Invalid IP address: ${trace_info.http_remote_ip}`)
    }

    if (
      trace_info.http_status_code &&
      !isValidHttpStatus(trace_info.http_status_code)
    ) {
      errors.push(`Invalid HTTP status code: ${trace_info.http_status_code}`)
    }

    if (trace_info.http_path && !isValidPath(trace_info.http_path)) {
      errors.push(`Invalid HTTP path: too long or empty`)
    }

    if (trace_info.http_method && typeof trace_info.http_method !== 'string') {
      errors.push('http_method must be a string')
    }

    // Enhanced DB validations
    if (trace_info.db_query && !isValidDbQuery(trace_info.db_query)) {
      errors.push('db_query is too long or empty')
    }

    if (
      trace_info.db_query_type &&
      !isValidDbQueryType(trace_info.db_query_type)
    ) {
      errors.push('db_query_type must be a valid SQL operation type')
    }

    if (
      trace_info.db_duration_ms &&
      (typeof trace_info.db_duration_ms !== 'number' ||
        trace_info.db_duration_ms < 0)
    ) {
      errors.push('db_duration_ms must be a non-negative number')
    }

    if (
      trace_info.db_rows_affected &&
      (!Number.isInteger(trace_info.db_rows_affected) ||
        trace_info.db_rows_affected < 0)
    ) {
      errors.push('db_rows_affected must be a non-negative integer')
    }

    if (
      trace_info.db_rows_examined &&
      (!Number.isInteger(trace_info.db_rows_examined) ||
        trace_info.db_rows_examined < 0)
    ) {
      errors.push('db_rows_examined must be a non-negative integer')
    }

    // Duration validations
    if (
      trace_info.http_duration_ms &&
      (typeof trace_info.http_duration_ms !== 'number' ||
        trace_info.http_duration_ms < 0)
    ) {
      errors.push('http_duration_ms must be a non-negative number')
    }

    // String field validations
    const stringFields = [
      'db_table_name',
      'db_database',
      'db_error_code',
      'db_error_message',
      'db_connection_id',
      'db_transaction_id',
    ]
    stringFields.forEach((field) => {
      const value = trace_info[field as keyof TraceInfo]
      if (value && typeof value !== 'string') {
        errors.push(`${field} must be a string`)
      }
    })
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}

// ====== TRACE LIFECYCLE MANAGEMENT ======

type TraceData = {
  traceId: string
  startTime: number
  method?: string
  path?: string
  logs: LogEvent[]
  dbEvents: LogEvent[]
}

// Functional trace manager using closures
export const createTraceManager = (config: BeaconConfig = DEFAULT_CONFIG) => {
  const activeTraces = new Map<string, TraceData>()

  // Pure function to create trace data
  const createTraceData = (traceId: string): TraceData => ({
    traceId,
    startTime: Date.now(),
    logs: [],
    dbEvents: [],
  })

  const startHttpTrace = (
    traceId: string,
    spanId: string,
    method: string,
    path: string,
    userAgent?: string,
    remoteIP?: string
  ): LogEvent => {
    const traceData = createTraceData(traceId)
    traceData.method = method
    traceData.path = path
    activeTraces.set(traceId, traceData)

    const event: LogEvent = {
      event_type: 'http',
      message: `${method} ${path} - HTTP request started`,
      severity: 'info',
      trace_id: traceId,
      span_id: spanId,
      trace_info: {
        http_method: method,
        http_path: path,
        http_user_agent: userAgent,
        http_remote_ip: remoteIP && isValidIP(remoteIP) ? remoteIP : undefined,
      },
    }

    return event
  }

  const addLog = (
    traceId: string,
    message: string,
    severity: LogEvent['severity'] = 'info',
    customFields?: Record<string, unknown>
  ): LogEvent => {
    const trace = activeTraces.get(traceId)

    const store = executionContext.getStore()
    if (store) {
      // Increment the log count for this trace
      store.logCount += 1
    }

    const event: LogEvent = {
      event_type: 'log',
      message,
      severity,
      trace_id: traceId,
      span_id: `log-${Date.now()}`,
      order_in_trace: store?.logCount,
      trace_info: customFields ? { custom_fields: customFields } : undefined,
    }

    if (trace) {
      trace.logs.push(event)
    }

    return event
  }

  // Enhanced database event tracking with comprehensive metadata
  const addDbEvent = (
    traceId: string,
    spanId: string, // Accept spanId as parameter
    query: string,
    durationMs: number,
    rowsAffected?: number,
    dbMetadata?: {
      queryType?: string
      tableName?: string
      database?: string
      rowsExamined?: number
      errorCode?: string
      errorMessage?: string
      connectionId?: string
      transactionId?: string
    }
  ): LogEvent => {
    const trace = activeTraces.get(traceId)

    const store = executionContext.getStore()
    if (store) {
      // Increment the log count for this trace
      store.logCount += 1
    }
    // TODO: Using query in message only works for this test project because it uses tRPC.
    // In production, consider using a more generic message or sanitizing the query.
    const message = dbMetadata?.errorCode
      ? `Database query failed: ${query.substring(0, 50)}${
          query.length > 50 ? '...' : ''
        }`
      : `Database query completed: ${query.substring(0, 50)}${
          query.length > 50 ? '...' : ''
        }`

    const event: LogEvent = {
      event_type: 'db',
      message,
      severity: dbMetadata?.errorCode ? 'error' : 'info',
      trace_id: traceId,
      span_id: spanId,
      order_in_trace: store?.logCount,
      trace_info: {
        db_query:
          config.enableValidation && isValidDbQuery(query)
            ? query
            : query.substring(0, 100) + '...',
        db_duration_ms: Math.round(durationMs),
        db_rows_affected: rowsAffected,
        db_query_type: dbMetadata?.queryType,
        db_table_name: dbMetadata?.tableName,
        db_database: dbMetadata?.database,
        db_rows_examined: dbMetadata?.rowsExamined,
        db_error_code: dbMetadata?.errorCode,
        db_error_message: dbMetadata?.errorMessage,
        db_connection_id: dbMetadata?.connectionId,
        db_transaction_id: dbMetadata?.transactionId,
      },
    }

    if (trace) {
      trace.dbEvents.push(event)
    }

    return event
  }

  const endHttpTrace = (
    traceId: string,
    spanId: string,
    statusCode: number,
    durationMs: number
  ): LogEvent | null => {
    const trace = activeTraces.get(traceId)
    if (!trace) return null

    const method = trace.method || 'UNKNOWN'
    const path = trace.path || 'UNKNOWN'

    const store = executionContext.getStore()
    if (store) {
      // Increment the log count for this trace
      store.logCount += 1
    }
    const event: LogEvent = {
      event_type: 'http',
      message: `${method} ${path} - HTTP request completed`,
      severity: 'info',
      trace_id: traceId,
      span_id: spanId,
      order_in_trace: store?.logCount,
      trace_info: {
        http_status_code: isValidHttpStatus(statusCode)
          ? statusCode
          : undefined,
        http_duration_ms: Math.round(durationMs),
        http_finished: true,
        log_count: store?.logCount,
      },
    }

    activeTraces.delete(traceId)
    return event
  }

  const getActiveTraces = (): string[] => Array.from(activeTraces.keys())

  const getTraceData = (traceId: string): TraceData | undefined =>
    activeTraces.get(traceId)

  return {
    startHttpTrace,
    addLog,
    addDbEvent,
    endHttpTrace,
    getActiveTraces,
    getTraceData,
  }
}

// ====== ENHANCED BATCHING SYSTEM ======

// Functional batching system with strict validation
type BatcherState = {
  batch: LogEvent[]
  batchTimer: NodeJS.Timeout | null
  config: BeaconConfig
  failedEvents: LogEvent[]
  validationErrors: Array<{ event: LogEvent; errors: string[] }>
}

// Pure function to create a new batcher state
const createBatcherState = (
  config: BeaconConfig = DEFAULT_CONFIG
): BatcherState => ({
  batch: [],
  batchTimer: null,
  config,
  failedEvents: [],
  validationErrors: [],
})

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
    throw error
  }
}

// Pure function to send single log
const sendSingleLog = async (
  logEvent: LogEvent,
  config: BeaconConfig
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

// Pure function to send batch logs
const sendBatchLogs = async (
  logEvents: LogEvent[],
  config: BeaconConfig
): Promise<void> => {
  if (!config.sendEnabled) {
    return
  }
  await sendWithRetry(
    `${config.baseUrl}/logs/batch`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(logEvents),
    },
    config
  )
}

// Enhanced flush function with strict validation
const flushLogs = async (
  batch: LogEvent[],
  config: BeaconConfig
): Promise<void> => {
  if (batch.length === 0) {
    return
  }

  // if (state.batchTimer) {
  //   clearTimeout(state.batchTimer)
  // }

  // MANDATORY validation to prevent server batch failures
  const validEvents: LogEvent[] = []
  const invalidEvents: Array<{ event: LogEvent; errors: string[] }> = []

  if (config.enableValidation) {
    for (const event of batch) {
      const validation = validateLogEvent(event)
      if (validation.isValid) {
        validEvents.push(event)
      } else {
        invalidEvents.push({ event, errors: validation.errors })
        console.warn(
          'Invalid event dropped:',
          event,
          'Errors:',
          validation.errors
        )
      }
    }
  } else {
    validEvents.push(...batch)
  }

  if (validEvents.length === 0) {
    return // No valid events to send
  }
  try {
    if (validEvents.length === 1) {
      await sendSingleLog(validEvents[0], config)
    } else {
      await sendBatchLogs(validEvents, config)
    }
  } catch (error) {
    console.error('Failed to send logs to Beacon Server:', error)
  }
}

// High-performance functional batcher optimized for 5k+ req/min
export const createLogBatcher = (config: BeaconConfig = DEFAULT_CONFIG) => {
  let state = createBatcherState(config)

  let buffer: LogEvent[] = []
  let batchTimer: NodeJS.Timeout | null

  const addLog = async (logEvent: LogEvent): Promise<void> => {
    // Add timestamp if not provided
    const normalizedEvent: LogEvent = {
      ...logEvent,
      timestamp: logEvent.timestamp || new Date().toISOString(),
      severity: logEvent.severity || 'info', // Default severity
    }

    state = {
      ...state,
      batch: [...state.batch, normalizedEvent],
    }

    // buffer.push(normalizedEvent)
    sendSingleLog(normalizedEvent, config)

    // if (buffer.length >= config.batchSize) {
    //   await flush()
    // } else if (!batchTimer) {
    //   batchTimer = setTimeout(async () => {
    //     await flush()
    //   }, config.batchTimeout)
    // }
  }

  const flush = async (): Promise<void> => {
    if (batchTimer) {
      clearTimeout(batchTimer)
      batchTimer = null
    }
    const batch = [...buffer]
    buffer = []
    await flushLogs(batch, config)
  }

  const shutdown = async (): Promise<void> => {
    await flush()
  }

  const getStats = () => ({
    batchSize: state.batch.length,
    failedEvents: state.failedEvents.length,
    validationErrors: state.validationErrors.length,
    config: state.config,
  })

  const getFailedEvents = () => [...state.failedEvents]

  const getValidationErrors = () => [...state.validationErrors]

  const clearFailedEvents = () => {
    state = { ...state, failedEvents: [] }
  }

  // Return object with methods (functional approach)
  return {
    addLog,
    flush,
    shutdown,
    getStats,
    getFailedEvents,
    getValidationErrors,
    clearFailedEvents,
    // Getter for current state (for debugging/testing)
    getState: () => ({
      ...state,
      batch: [...state.batch],
      failedEvents: [...state.failedEvents],
      validationErrors: [...state.validationErrors],
    }),
  }
}

// Create global batcher instance using functional approach
const globalBatcher = createLogBatcher()

// Create global trace manager
const globalTraceManager = createTraceManager()

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  await globalBatcher.shutdown()
})

process.on('SIGINT', async () => {
  await globalBatcher.shutdown()
})

// ====== PUBLIC API ======

export const sendLog = async (logEvent: LogEvent): Promise<void> => {
  if (debugLogging) {
    console.log('🚀 Sending log to Beacon Server:', {
      event_type: logEvent.event_type,
      message: logEvent.message,
      trace_id: logEvent.trace_id,
      span_id: logEvent.span_id,
      timestamp: new Date().toISOString(),
    })
  }
  await globalBatcher.addLog(logEvent)
}

export const runInSpan = async (
  cb: () => Promise<unknown>
): Promise<unknown> => {
  return executionContext.run(
    {
      traceId: executionContext.getStore()?.traceId || randomUUID(),
      parentSpanId: executionContext.getStore()?.spanId,
      spanId: randomUUID(),
      logCount: executionContext.getStore()?.logCount || 0,
    },
    cb
  )
}

// Enhanced logging functions with trace support
const createLogEvent = (
  event_type: LogEvent['event_type'],
  severity: LogEvent['severity'],
  message: string
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
    trace_id: store?.traceId,
    span_id: store?.spanId,
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

// Enhanced DB logging function with comprehensive metadata support
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

  const store = executionContext.getStore()
  if (store) {
    // Increment the log count for this trace
    store.logCount += 1
  }

  const event: LogEvent = {
    event_type: 'db',
    severity: metadata?.errorCode ? 'error' : 'info',
    message,
    trace_id: store?.traceId,
    span_id: store?.spanId || randomUUID(),
    parent_span_id: store?.parentSpanId,
    order_in_trace: store?.logCount,
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
  }
  sendLog(event)
}

// ====== DEBUG HELPERS ======

// Debug flag for troubleshooting
let debugLogging = false

export const enableDebugLogging = (): void => {
  debugLogging = true
  console.log('🔍 Beacon Debug Logging Enabled')
}

export const disableDebugLogging = (): void => {
  debugLogging = false
  console.log('🔍 Beacon Debug Logging Disabled')
}

// ====== PUBLIC API ======

export const startHttpTrace = (
  traceId: string,
  spanId: string,
  method: string,
  path: string,
  userAgent?: string,
  remoteIP?: string
): void => {
  const event = globalTraceManager.startHttpTrace(
    traceId,
    spanId,
    method,
    path,
    userAgent,
    remoteIP
  )
  sendLog(event)
}

export const addTraceLog = (
  traceId: string,
  message: string,
  severity: LogEvent['severity'] = 'info',
  customFields?: Record<string, unknown>
): void => {
  const event = globalTraceManager.addLog(
    traceId,
    message,
    severity,
    customFields
  )
  sendLog(event)
}

// Enhanced database event with comprehensive metadata
export const addTraceDbEvent = (
  traceId: string,
  spanId: string, // Accept spanId as parameter
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
  }
): void => {
  const event = globalTraceManager.addDbEvent(
    traceId,
    spanId,
    query,
    durationMs,
    rowsAffected,
    metadata
  )
  sendLog(event)
}

export const endHttpTrace = (
  traceId: string,
  spanId: string,
  statusCode: number,
  durationMs: number
): void => {
  const event = globalTraceManager.endHttpTrace(
    traceId,
    spanId,
    statusCode,
    durationMs
  )
  if (event) {
    // Also include log count from execution context if available
    const store = executionContext.getStore()
    if (store && event.trace_info) {
      event.trace_info.log_count = store.logCount
    }
    sendLog(event)
  }
}

// Extended Fastify types
declare module 'fastify' {
  interface FastifyRequest {
    logContext: {
      traceId: string
      spanId: string
      start: bigint
      logCount: number
      logs: unknown[]
    }
    _logContext?: {
      traceId: string
      spanId: string
      start: bigint
      logCount: number
      logs: unknown[]
    }
    onRequestCallback?: (request: FastifyRequest, reply: FastifyReply) => void
  }

  interface FastifyReply {
    onReplyCallback?: (request: FastifyRequest, reply: FastifyReply) => void
  }
}

export type MyPluginOptions = {
  onRequestCallback?: (request: FastifyRequest, reply: FastifyReply) => void
  onReplyCallback?: (request: FastifyRequest, reply: FastifyReply) => void
  excludePaths?: string[] // Paths to exclude from trace logging
}

const myPluginAsync: FastifyPluginAsync<MyPluginOptions> = async (
  fastify,
  options
) => {
  fastify.decorateRequest('logContext', {
    getter() {
      return (
        (this as FastifyRequest)._logContext || {
          traceId: '',
          spanId: '',
          start: BigInt(0),
          logCount: 0,
          logs: [],
        }
      )
    },
    setter(value) {
      // Store the value on the request object
      (this as FastifyRequest)._logContext = value
    },
  })
  fastify.decorateRequest('onRequestCallback', options.onRequestCallback)
  fastify.decorateReply('onReplyCallback', options.onReplyCallback)

  // Helper function to check if path should be excluded
  const shouldExcludePath = (path: string): boolean => {
    if (!options.excludePaths || options.excludePaths.length === 0) {
      return false
    }

    const normalizedPath = path.split('?')[0] // Remove query params for matching
    return options.excludePaths.some((excludePath) => {
      // Support exact match and wildcard patterns
      if (excludePath.endsWith('*')) {
        const prefix = excludePath.slice(0, -1)
        return normalizedPath.startsWith(prefix)
      }
      return normalizedPath === excludePath
    })
  }

  fastify.addHook('onRequest', async (req, reply) => {
    const traceId = randomUUID()
    const spanId = randomUUID()
    const start = process.hrtime.bigint()

    req.logContext = {
      traceId,
      spanId,
      start,
      logCount: 0,
      logs: [],
    }

    // Check if this path should be excluded from trace logging
    if (!shouldExcludePath(req.url)) {
      // Use enhanced HTTP trace logging for non-excluded paths
      startHttpTrace(
        traceId,
        spanId,
        req.method,
        req.url.split('?')[0],
        req.headers['user-agent'],
        req.ip
      )
    }

    req.onRequestCallback?.(req, reply)
  })

  fastify.addHook('preHandler', (request, _reply, next) => {
    const { traceId, spanId, logCount } = request.logContext || {
      traceId: randomUUID(),
      spanId: randomUUID(),
      logCount: 0,
    }
    executionContext.run({ traceId, spanId, logCount }, next)
  })

  fastify.addHook('onResponse', async (req, reply) => {
    const { traceId, spanId, start } = req.logContext || {}
    if (!traceId || !spanId || !start) return

    const durationMs = Number(process.hrtime.bigint() - start) / 1e6

    // Only log trace completion for non-excluded paths
    if (!shouldExcludePath(req.url)) {
      endHttpTrace(traceId, spanId, reply.statusCode, durationMs)
    }

    reply.onReplyCallback?.(req, reply)
  })
}

export const loggerPlugin = fp(myPluginAsync, {})

// Health check and utility functions - enhanced with validation
export const checkBeaconHealth = async (
  baseUrl = DEFAULT_CONFIG.baseUrl
): Promise<boolean> => {
  try {
    const response = await fetch(`${baseUrl}/health`)
    return response.ok
  } catch {
    return false
  }
}

export const getBeaconStats = async (
  baseUrl = DEFAULT_CONFIG.baseUrl
): Promise<Record<string, unknown> | null> => {
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

// All functions are exported individually above
