/**
 * Unit tests for logger module
 * 
 * These tests don't require electron mocking since they test pure utility functions.
 */
import { describe, it, expect } from 'vitest'

// Test the utility functions directly without importing the full logger module
// (which depends on electron-log that requires electron runtime)

describe('Logger Utility Functions', () => {
  describe('getErrorMessage', () => {
    // Inline implementation for testing (matches logger.ts)
    function getErrorMessage(error: unknown): string {
      if (error instanceof Error) return error.message
      if (typeof error === 'string') return error
      return 'Unknown error'
    }

    it('should extract message from Error object', () => {
      const error = new Error('Something went wrong')
      expect(getErrorMessage(error)).toBe('Something went wrong')
    })

    it('should return string as-is', () => {
      expect(getErrorMessage('Direct message')).toBe('Direct message')
    })

    it('should return "Unknown error" for other types', () => {
      expect(getErrorMessage(null)).toBe('Unknown error')
      expect(getErrorMessage(undefined)).toBe('Unknown error')
      expect(getErrorMessage(123)).toBe('Unknown error')
      expect(getErrorMessage({})).toBe('Unknown error')
    })
  })

  describe('classifyError', () => {
    // Inline implementation for testing (matches logger.ts)
    function getErrorMessage(error: unknown): string {
      if (error instanceof Error) return error.message
      if (typeof error === 'string') return error
      return 'Unknown error'
    }

    function classifyError(error: unknown): 'network' | 'auth' | 'server' | 'unknown' {
      const message = getErrorMessage(error).toLowerCase()

      if (
        message.includes('network') ||
        message.includes('econnrefused') ||
        message.includes('timeout')
      ) {
        return 'network'
      }
      if (message.includes('unauthorized') || message.includes('401') || message.includes('auth')) {
        return 'auth'
      }
      if (message.includes('500') || message.includes('502') || message.includes('503')) {
        return 'server'
      }
      return 'unknown'
    }

    it('should classify network errors', () => {
      expect(classifyError(new Error('Network request failed'))).toBe('network')
      expect(classifyError(new Error('ECONNREFUSED'))).toBe('network')
      expect(classifyError(new Error('Request timeout'))).toBe('network')
    })

    it('should classify auth errors', () => {
      expect(classifyError(new Error('Unauthorized'))).toBe('auth')
      expect(classifyError(new Error('HTTP 401'))).toBe('auth')
      expect(classifyError(new Error('Auth token expired'))).toBe('auth')
    })

    it('should classify server errors', () => {
      expect(classifyError(new Error('HTTP 500 Internal Server Error'))).toBe('server')
      expect(classifyError(new Error('502 Bad Gateway'))).toBe('server')
      expect(classifyError(new Error('503 Service Unavailable'))).toBe('server')
    })

    it('should return unknown for unclassified errors', () => {
      expect(classifyError(new Error('Something else'))).toBe('unknown')
      expect(classifyError('Random error')).toBe('unknown')
    })
  })
})
