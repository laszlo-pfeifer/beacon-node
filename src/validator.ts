// ====== VALIDATION FUNCTIONS (Pure Functions) ======

import { LogEvent, TraceInfo } from './beacon.js'

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
