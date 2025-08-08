import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'crypto'

// Mock the sendSingleLog function - must be hoisted
vi.mock('./beacon.js', () => ({
  sendSingleLog: vi.fn(),
}))

// Mock debug logging - must be hoisted
vi.mock('./debug.js', () => ({
  debugLogging: false,
}))

import { executionContext } from './execution-context.js'
import {
  logInfo,
  logWarn,
  logError,
  logDebug,
  logFatal,
  logDbOperation,
  startHttpTrace,
  endHttpTrace,
  runInSpan,
} from './api.js'
import { sendSingleLog } from './beacon.js'

// Get the mocked function
const mockSendSingleLog = vi.mocked(sendSingleLog)

describe('API Tests', () => {
  beforeEach(() => {
    mockSendSingleLog.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Individual Logging Functions', () => {
    it('should call logInfo and increment logCount', async () => {
      await executionContext.run(
        { traceId: 'test-trace', spanId: 'test-span', logCount: 0 },
        () => {
          logInfo('Test info message')

          expect(mockSendSingleLog).toHaveBeenCalledTimes(1)
          expect(mockSendSingleLog).toHaveBeenCalledWith(
            expect.objectContaining({
              event_type: 'log',
              severity: 'info',
              message: 'Test info message',
              trace_id: 'test-trace',
              span_id: 'test-span',
              order_in_trace: 1,
            })
          )

          // Verify logCount was incremented
          expect(executionContext.getStore()?.logCount).toBe(1)
        }
      )
    })

    it('should call logWarn and increment logCount', async () => {
      await executionContext.run(
        { traceId: 'test-trace', spanId: 'test-span', logCount: 5 },
        () => {
          logWarn('Test warning message')

          expect(mockSendSingleLog).toHaveBeenCalledWith(
            expect.objectContaining({
              event_type: 'log',
              severity: 'warn',
              message: 'Test warning message',
              order_in_trace: 6,
            })
          )

          expect(executionContext.getStore()?.logCount).toBe(6)
        }
      )
    })

    it('should call logError and increment logCount', async () => {
      await executionContext.run(
        { traceId: 'test-trace', spanId: 'test-span', logCount: 0 },
        () => {
          logError('Test error message')

          expect(mockSendSingleLog).toHaveBeenCalledWith(
            expect.objectContaining({
              event_type: 'log',
              severity: 'error',
              message: 'Test error message',
              order_in_trace: 1,
            })
          )
        }
      )
    })

    it('should call logDebug and increment logCount', async () => {
      await executionContext.run(
        { traceId: 'test-trace', spanId: 'test-span', logCount: 0 },
        () => {
          logDebug('Test debug message')

          expect(mockSendSingleLog).toHaveBeenCalledWith(
            expect.objectContaining({
              event_type: 'log',
              severity: 'debug',
              message: 'Test debug message',
              order_in_trace: 1,
            })
          )
        }
      )
    })

    it('should call logFatal and increment logCount', async () => {
      await executionContext.run(
        { traceId: 'test-trace', spanId: 'test-span', logCount: 0 },
        () => {
          logFatal('Test fatal message')

          expect(mockSendSingleLog).toHaveBeenCalledWith(
            expect.objectContaining({
              event_type: 'log',
              severity: 'fatal',
              message: 'Test fatal message',
              order_in_trace: 1,
            })
          )
        }
      )
    })

    it('should skip logging when _beacon_skip is true', async () => {
      await executionContext.run(
        { traceId: 'test-trace', spanId: 'test-span', logCount: 0 },
        () => {
          logInfo('Should be skipped', { _beacon_skip: true })

          expect(mockSendSingleLog).not.toHaveBeenCalled()
          expect(executionContext.getStore()?.logCount).toBe(0)
        }
      )
    })
  })

  describe('Database Logging', () => {
    it('should log successful database operation', async () => {
      await executionContext.run(
        { traceId: 'test-trace', spanId: 'test-span', logCount: 2 },
        () => {
          logDbOperation('SELECT * FROM users WHERE id = 1', 25.5, 1, {
            queryType: 'SELECT',
            tableName: 'users',
            database: 'myapp',
            rowsExamined: 100,
          })

          expect(mockSendSingleLog).toHaveBeenCalledWith(
            expect.objectContaining({
              event_type: 'db',
              severity: 'info',
              message:
                'Database query completed: SELECT * FROM users WHERE id = 1',
              trace_id: 'test-trace',
              order_in_trace: 3, // Only incremented once in createLogEvent
              trace_info: expect.objectContaining({
                db_query: 'SELECT * FROM users WHERE id = 1',
                db_duration_ms: 26,
                db_rows_affected: 1,
                db_query_type: 'SELECT',
                db_table_name: 'users',
                db_database: 'myapp',
                db_rows_examined: 100,
              }),
              db_info: expect.objectContaining({
                db_query: 'SELECT * FROM users WHERE id = 1',
                db_duration_ms: 26,
                db_rows_affected: 1,
                db_query_type: 'SELECT',
                db_table_name: 'users',
                db_database: 'myapp',
                db_rows_examined: 100,
              }),
            })
          )

          expect(executionContext.getStore()?.logCount).toBe(3)
        }
      )
    })

    it('should log failed database operation', async () => {
      await executionContext.run(
        { traceId: 'test-trace', spanId: 'test-span', logCount: 0 },
        () => {
          logDbOperation('UPDATE users SET email = ? WHERE id = 1', 100, 0, {
            queryType: 'UPDATE',
            tableName: 'users',
            errorCode: 'ER_DUP_ENTRY',
            errorMessage: 'Duplicate entry for key email',
          })

          expect(mockSendSingleLog).toHaveBeenCalledWith(
            expect.objectContaining({
              event_type: 'db',
              severity: 'error',
              message:
                'Database query failed: UPDATE users SET email = ? WHERE id = 1',
              order_in_trace: 1, // Only incremented once in createLogEvent
              trace_info: expect.objectContaining({
                db_error_code: 'ER_DUP_ENTRY',
                db_error_message: 'Duplicate entry for key email',
              }),
              db_info: expect.objectContaining({
                db_error_code: 'ER_DUP_ENTRY',
                db_error_message: 'Duplicate entry for key email',
              }),
            })
          )
        }
      )
    })

    it('should truncate long database queries', async () => {
      await executionContext.run(
        { traceId: 'test-trace', spanId: 'test-span', logCount: 0 },
        () => {
          const longQuery =
            'SELECT * FROM users WHERE name LIKE "%very-long-search-term%" AND age > 18 AND status = "active"'

          logDbOperation(longQuery, 50)

          expect(mockSendSingleLog).toHaveBeenCalledWith(
            expect.objectContaining({
              message:
                'Database query completed: SELECT * FROM users WHERE name LIKE "%very-long-se...',
              order_in_trace: 1,
            })
          )
        }
      )
    })
  })

  describe('HTTP Trace Functions', () => {
    it('should start HTTP trace', async () => {
      await executionContext.run(
        { traceId: 'test-trace', spanId: 'test-span', logCount: 0 },
        () => {
          startHttpTrace({
            method: 'GET',
            path: '/api/users',
            userAgent: 'Mozilla/5.0',
            remoteIP: '192.168.1.1',
          })

          expect(mockSendSingleLog).toHaveBeenCalledWith(
            expect.objectContaining({
              event_type: 'http',
              severity: 'info',
              message: 'GET /api/users - HTTP request started',
              order_in_trace: 1,
              trace_info: expect.objectContaining({
                http_method: 'GET',
                http_path: '/api/users',
                http_user_agent: 'Mozilla/5.0',
                http_remote_ip: '192.168.1.1',
              }),
            })
          )

          expect(executionContext.getStore()?.logCount).toBe(1)
        }
      )
    })

    it('should end HTTP trace with log count', async () => {
      await executionContext.run(
        { traceId: 'test-trace', spanId: 'test-span', logCount: 5 },
        () => {
          endHttpTrace({
            method: 'POST',
            path: '/api/users',
            statusCode: 201,
            durationMs: 150.75,
          })

          expect(mockSendSingleLog).toHaveBeenCalledWith(
            expect.objectContaining({
              event_type: 'http',
              severity: 'info',
              message: 'POST /api/users - HTTP request completed',
              order_in_trace: 6,
              trace_info: expect.objectContaining({
                http_status_code: 201,
                http_duration_ms: 151,
                http_finished: true,
                log_count: 6, // Should include the current log
              }),
            })
          )
        }
      )
    })

    it('should handle invalid IP addresses', async () => {
      await executionContext.run(
        { traceId: 'test-trace', spanId: 'test-span', logCount: 0 },
        () => {
          startHttpTrace({
            method: 'GET',
            path: '/api/users',
            userAgent: 'Mozilla/5.0',
            remoteIP: 'invalid-ip',
          })

          expect(mockSendSingleLog).toHaveBeenCalledWith(
            expect.objectContaining({
              trace_info: expect.objectContaining({
                http_remote_ip: undefined, // Should be undefined for invalid IP
              }),
            })
          )
        }
      )
    })
  })

  describe('runInSpan', () => {
    it('should create new execution context and preserve parent context', async () => {
      const parentTraceId = 'parent-trace'
      const parentSpanId = 'parent-span'

      await executionContext.run(
        { traceId: parentTraceId, spanId: parentSpanId, logCount: 3 },
        async () => {
          const result = await runInSpan(async () => {
            const store = executionContext.getStore()
            expect(store?.traceId).toBe(parentTraceId) // Should preserve parent trace
            expect(store?.parentSpanId).toBe(parentSpanId) // Should set parent span
            expect(store?.spanId).not.toBe(parentSpanId) // Should have new span
            expect(store?.logCount).toBe(3) // Should preserve parent log count

            return 'test-result'
          })

          expect(result).toBe('test-result')
        }
      )
    })

    it('should create new trace when no parent context', async () => {
      const result = await runInSpan(async () => {
        const store = executionContext.getStore()
        expect(store?.traceId).toMatch(/^[0-9a-f-]{36}$/) // Should be UUID
        expect(store?.spanId).toMatch(/^[0-9a-f-]{36}$/) // Should be UUID
        expect(store?.logCount).toBe(0) // Should start at 0
        expect(store?.parentSpanId).toBeUndefined()

        return 'isolated-result'
      })

      expect(result).toBe('isolated-result')
    })
  })

  describe('Realistic HTTP Request Scenario', () => {
    it('should handle complete HTTP request lifecycle with correct order_in_trace and log_count', async () => {
      const traceId = randomUUID()
      const spanId = randomUUID()

      await executionContext.run({ traceId, spanId, logCount: 0 }, () => {
        // 1. Start HTTP trace
        startHttpTrace({
          method: 'POST',
          path: '/api/users',
          userAgent: 'Mozilla/5.0',
          remoteIP: '192.168.1.100',
        })

        // 2. Log some info
        logInfo('Processing user creation request')

        // 3. Database operation 1
        logDbOperation('SELECT COUNT(*) FROM users WHERE email = ?', 15.2, 1, {
          queryType: 'SELECT',
          tableName: 'users',
        })

        // 4. Log validation
        logDebug('Email validation passed')

        // 5. Database operation 2
        logDbOperation(
          'INSERT INTO users (name, email) VALUES (?, ?)',
          45.8,
          1,
          { queryType: 'INSERT', tableName: 'users' }
        )

        // 6. Log success
        logInfo('User created successfully')

        // 7. End HTTP trace
        endHttpTrace({
          method: 'POST',
          path: '/api/users',
          statusCode: 201,
          durationMs: 250.5,
        })

        // Verify all calls were made in correct order
        expect(mockSendSingleLog).toHaveBeenCalledTimes(7)

        // Check each call's order_in_trace
        const calls = mockSendSingleLog.mock.calls

        // Call 1: startHttpTrace
        expect(calls[0][0]).toMatchObject({
          event_type: 'http',
          message: 'POST /api/users - HTTP request started',
          order_in_trace: 1,
          trace_id: traceId,
        })

        // Call 2: logInfo
        expect(calls[1][0]).toMatchObject({
          event_type: 'log',
          severity: 'info',
          message: 'Processing user creation request',
          order_in_trace: 2,
          trace_id: traceId,
        })

        // Call 3: logDbOperation (SELECT)
        expect(calls[2][0]).toMatchObject({
          event_type: 'db',
          severity: 'info',
          message:
            'Database query completed: SELECT COUNT(*) FROM users WHERE email = ?',
          order_in_trace: 3, // Fixed - no double counting
          trace_id: traceId,
          trace_info: expect.objectContaining({
            db_query_type: 'SELECT',
            db_table_name: 'users',
          }),
        })

        // Call 4: logDebug
        expect(calls[3][0]).toMatchObject({
          event_type: 'log',
          severity: 'debug',
          message: 'Email validation passed',
          order_in_trace: 4,
          trace_id: traceId,
        })

        // Call 5: logDbOperation (INSERT)
        expect(calls[4][0]).toMatchObject({
          event_type: 'db',
          severity: 'info',
          message:
            'Database query completed: INSERT INTO users (name, email) VALUES (?, ?)',
          order_in_trace: 5,
          trace_id: traceId,
          trace_info: expect.objectContaining({
            db_query_type: 'INSERT',
            db_table_name: 'users',
          }),
        })

        // Call 6: logInfo (success)
        expect(calls[5][0]).toMatchObject({
          event_type: 'log',
          severity: 'info',
          message: 'User created successfully',
          order_in_trace: 6,
          trace_id: traceId,
        })

        // Call 7: endHttpTrace
        expect(calls[6][0]).toMatchObject({
          event_type: 'http',
          message: 'POST /api/users - HTTP request completed',
          order_in_trace: 7,
          trace_id: traceId,
          trace_info: expect.objectContaining({
            http_status_code: 201,
            http_duration_ms: 251,
            http_finished: true,
            log_count: 7, // Should reflect total logs in this trace
          }),
        })

        // Verify final execution context state
        expect(executionContext.getStore()?.logCount).toBe(7)
      })
    })

    it('should handle error scenario with correct order_in_trace', async () => {
      const traceId = randomUUID()
      const spanId = randomUUID()

      await executionContext.run({ traceId, spanId, logCount: 0 }, () => {
        // 1. Start HTTP trace
        startHttpTrace({
          method: 'POST',
          path: '/api/users',
          userAgent: 'Mozilla/5.0',
          remoteIP: '192.168.1.100',
        })

        // 2. Log processing
        logInfo('Processing user creation request')

        // 3. Failed database operation
        logDbOperation(
          'INSERT INTO users (name, email) VALUES (?, ?)',
          25.3,
          0,
          {
            queryType: 'INSERT',
            tableName: 'users',
            errorCode: 'ER_DUP_ENTRY',
            errorMessage: 'Duplicate entry for email',
          }
        )

        // 4. Log error
        logError('Failed to create user: email already exists')

        // 5. End HTTP trace with error status
        endHttpTrace({
          method: 'POST',
          path: '/api/users',
          statusCode: 400,
          durationMs: 85.2,
        })

        expect(mockSendSingleLog).toHaveBeenCalledTimes(5)

        const calls = mockSendSingleLog.mock.calls

        // Verify the error database operation
        expect(calls[2][0]).toMatchObject({
          event_type: 'db',
          severity: 'error', // Should be error severity
          order_in_trace: 3, // Fixed - no double counting
          trace_info: expect.objectContaining({
            db_error_code: 'ER_DUP_ENTRY',
            db_error_message: 'Duplicate entry for email',
          }),
        })

        // Verify error log
        expect(calls[3][0]).toMatchObject({
          event_type: 'log',
          severity: 'error',
          message: 'Failed to create user: email already exists',
          order_in_trace: 4,
        })

        // Verify final trace shows total count
        expect(calls[4][0]).toMatchObject({
          trace_info: expect.objectContaining({
            http_status_code: 400,
            log_count: 5,
          }),
        })
      })
    })
  })
})
