import {
  validateGeneratedCode,
  detectLanguage,
  formatValidationReport,
} from '../../src/security/code-validator.js';

describe('Code Validator', () => {
  describe('detectLanguage', () => {
    it('should detect language from file path', () => {
      expect(detectLanguage('test.ts')).toBe('typescript');
      expect(detectLanguage('test.js')).toBe('javascript');
      expect(detectLanguage('test.py')).toBe('python');
      expect(detectLanguage('test.sh')).toBe('shell');
      expect(detectLanguage('test.sql')).toBe('sql');
      expect(detectLanguage('test.html')).toBe('html');
    });

    it('should detect from content heuristics', () => {
      expect(detectLanguage(undefined, '#!/bin/bash\necho hello')).toBe('shell');
      expect(detectLanguage(undefined, '#!/usr/bin/python\nprint("hi")')).toBe('python');
      expect(detectLanguage(undefined, 'import React from "react"')).toBe('typescript');
      expect(detectLanguage(undefined, 'SELECT * FROM users')).toBe('sql');
    });

    it('should return unknown for undetectable content', () => {
      expect(detectLanguage(undefined, 'just some random text')).toBe('unknown');
    });
  });

  describe('validateGeneratedCode', () => {
    it('should pass safe code', () => {
      const result = validateGeneratedCode(
        'const x = 1;\nconst y = x + 2;\nconsole.log(y);',
        'typescript'
      );
      expect(result.safe).toBe(true);
      expect(result.findings.length).toBe(0);
    });

    it('should detect eval()', () => {
      const result = validateGeneratedCode(
        'const x = eval(userInput);',
        'javascript'
      );
      expect(result.safe).toBe(false);
      expect(result.findings.some(f => f.name === 'eval')).toBe(true);
    });

    it('should detect innerHTML assignment', () => {
      const result = validateGeneratedCode(
        'element.innerHTML = userInput;',
        'javascript'
      );
      expect(result.safe).toBe(false);
      expect(result.findings.some(f => f.name === 'innerHTML')).toBe(true);
    });

    it('should detect hardcoded passwords', () => {
      const result = validateGeneratedCode(
        "const password = 'mysecretpassword123';",
        'javascript'
      );
      expect(result.safe).toBe(false);
      expect(result.findings.some(f => f.name === 'hardcoded-secret')).toBe(true);
    });

    it('should detect child_process usage', () => {
      const result = validateGeneratedCode(
        "const { exec } = require('child_process');",
        'javascript'
      );
      expect(result.safe).toBe(false);
      expect(result.findings.some(f => f.name === 'child_process')).toBe(true);
    });

    it('should detect prototype pollution', () => {
      const result = validateGeneratedCode(
        'obj.__proto__.polluted = true;',
        'javascript'
      );
      expect(result.safe).toBe(false);
      expect(result.findings.some(f => f.name === 'proto')).toBe(true);
    });

    it('should detect private keys in code', () => {
      const result = validateGeneratedCode(
        'const key = "-----BEGIN RSA PRIVATE KEY-----\\nMIIBog..."',
        'javascript'
      );
      expect(result.safe).toBe(false);
      expect(result.findings.some(f => f.name === 'private-key')).toBe(true);
    });

    it('should skip comment lines', () => {
      const result = validateGeneratedCode(
        '// eval(userInput)\nconst x = 1;',
        'javascript'
      );
      expect(result.safe).toBe(true);
    });

    it('should detect Python-specific patterns', () => {
      const result = validateGeneratedCode(
        'import os\nos.system("rm -rf /")',
        'python'
      );
      expect(result.safe).toBe(false);
      expect(result.findings.some(f => f.name === 'os-system')).toBe(true);
    });

    it('should detect SQL DROP statements', () => {
      const result = validateGeneratedCode(
        'DROP TABLE users;',
        'sql'
      );
      expect(result.safe).toBe(false);
      expect(result.findings.some(f => f.name === 'sql-drop')).toBe(true);
    });

    it('should count findings by severity', () => {
      const result = validateGeneratedCode(
        "eval(x);\nconst secret = 'password123456789';",
        'javascript'
      );
      expect(result.counts.critical).toBeGreaterThanOrEqual(1);
    });
  });

  describe('formatValidationReport', () => {
    it('should report no issues for safe code', () => {
      const result = validateGeneratedCode('const x = 1;', 'javascript');
      const report = formatValidationReport(result);
      expect(report).toContain('No security issues found');
    });

    it('should format findings with severity', () => {
      const result = validateGeneratedCode('eval(x);', 'javascript');
      const report = formatValidationReport(result);
      expect(report).toContain('CRITICAL');
      expect(report).toContain('eval');
    });
  });
});
