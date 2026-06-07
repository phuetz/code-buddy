/**
 * FCS Compatibility Tests
 *
 * Verifies 100% compatibility with FileCommander Script
 */

import { executeFCS, parseFCS } from '../../src/scripting/index.js';

describe('FCS Compatibility', () => {
  describe('Lexer', () => {
    test('tokenizes basic expressions', () => {
      const { tokens } = parseFCS('let x = 10 + 20');
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens.some(t => t.type === 'Keyword' && t.value === 'let')).toBe(true);
      expect(tokens.some(t => t.type === 'Number' && t.value === '10')).toBe(true);
    });

    test('tokenizes strings with interpolation', () => {
      const { tokens } = parseFCS('let s = "Hello ${name}"');
      expect(tokens.some(t => t.type === 'String')).toBe(true);
    });

    test('tokenizes pipeline operator', () => {
      const { tokens } = parseFCS('x |> func');
      expect(tokens.some(t => t.type === 'Pipeline')).toBe(true);
    });

    test('tokenizes decorators', () => {
      const { tokens } = parseFCS('@test\nfunc foo() {}');
      expect(tokens.some(t => t.type === 'Decorator')).toBe(true);
    });
  });

  describe('Parser', () => {
    test('parses variable declarations', () => {
      const { ast } = parseFCS('let x = 10');
      expect(ast.statements[0].type).toBe('VarDeclaration');
    });

    test('parses function declarations with func keyword', () => {
      const { ast } = parseFCS('func greet(name) { print(name) }');
      expect(ast.statements[0].type).toBe('FunctionDeclaration');
    });

    test('parses for-in loops', () => {
      const { ast } = parseFCS('for x in items { print(x) }');
      expect(ast.statements[0].type).toBe('For');
    });

    test('parses if statements without parentheses', () => {
      const { ast } = parseFCS('if x > 10 { print("yes") }');
      expect(ast.statements[0].type).toBe('If');
    });

    test('parses class declarations', () => {
      const { ast } = parseFCS('class Person { let name = "" }');
      expect(ast.statements[0].type).toBe('ClassDeclaration');
    });
  });

  describe('Runtime', () => {
    test('executes print statement', async () => {
      const result = await executeFCS('print("Hello FCS!")');
      expect(result.success).toBe(true);
      expect(result.output).toContain('Hello FCS!');
    });

    test('executes variable assignment and arithmetic', async () => {
      const result = await executeFCS(`
        let x = 10
        let y = 20
        print(x + y)
      `);
      expect(result.success).toBe(true);
      expect(result.output).toContain('30');
    });

    test('executes power operator', async () => {
      const result = await executeFCS('print(2 ** 10)');
      expect(result.success).toBe(true);
      expect(result.output).toContain('1024');
    });

    test('executes function calls', async () => {
      const result = await executeFCS(`
        func double(n) { return n * 2 }
        print(double(21))
      `);
      expect(result.success).toBe(true);
      expect(result.output).toContain('42');
    });

    test('executes for loops with range', async () => {
      const result = await executeFCS(`
        let total = 0
        for i in range(5) { total = total + i }
        print(total)
      `);
      expect(result.success).toBe(true);
      expect(result.output).toContain('10'); // 0+1+2+3+4 = 10
    });

    test('executes conditional statements', async () => {
      const result = await executeFCS(`
        let x = 50
        if x > 40 { print("yes") } else { print("no") }
      `);
      expect(result.success).toBe(true);
      expect(result.output).toContain('yes');
    });

    test('executes string operations', async () => {
      const result = await executeFCS(`
        print(upper("hello"))
        print(lower("WORLD"))
        print(trim("  test  "))
      `);
      expect(result.success).toBe(true);
      expect(result.output).toContain('HELLO');
      expect(result.output).toContain('world');
      expect(result.output).toContain('test');
    });

    test('executes array operations', async () => {
      const result = await executeFCS(`
        let arr = [1, 2, 3]
        print(len(arr))
        push(arr, 4)
        print(len(arr))
      `);
      expect(result.success).toBe(true);
      expect(result.output).toContain('3');
      expect(result.output).toContain('4');
    });

    test('provides math constants', async () => {
      const result = await executeFCS(`
        print(PI > 3.14)
        print(E > 2.71)
      `);
      expect(result.success).toBe(true);
      expect(result.output).toContain('true');
    });

    test('executes try-catch', async () => {
      const result = await executeFCS(`
        try {
          throw "error"
        } catch (e) {
          print("caught")
        }
      `);
      expect(result.success).toBe(true);
      expect(result.output).toContain('caught');
    });

    test('executes nested functions', async () => {
      const result = await executeFCS(`
        func outer(x) {
          func inner(y) { return y * 2 }
          return inner(x) + 1
        }
        print(outer(5))
      `);
      expect(result.success).toBe(true);
      expect(result.output).toContain('11'); // 5*2+1 = 11
    });
  });

  describe('FileCommander Script Compatibility', () => {
    test('supports func keyword (FCS style)', async () => {
      const result = await executeFCS(`
        func add(a, b) { return a + b }
        print(add(1, 2))
      `);
      expect(result.success).toBe(true);
      expect(result.output).toContain('3');
    });

    test('supports for-in with range (FCS style)', async () => {
      const result = await executeFCS(`
        for i in range(3) { print(i) }
      `);
      expect(result.success).toBe(true);
      expect(result.output).toEqual(['0', '1', '2']);
    });

    test('supports dict literals', async () => {
      const result = await executeFCS(`
        let obj = { name: "test", value: 42 }
        print(obj.name)
        print(obj.value)
      `);
      expect(result.success).toBe(true);
      expect(result.output).toContain('test');
      expect(result.output).toContain('42');
    });

    test('supports string multiplication (FCS style)', async () => {
      const result = await executeFCS('print("x" * 3)');
      expect(result.success).toBe(true);
      expect(result.output).toContain('xxx');
    });
  });

  describe('NexusFile FCS suite contract', () => {
    test('executes Python-style def, test, local variables, and range blocks', async () => {
      const result = await executeFCS(`
        def add(a, b):
          temp = a + b
          return temp

        test "locals stay local":
          inside = add(20, 22)
          assert inside == 42

        total = 0
        for i in range(4):
          total = total + i

        print(add(total, 36))
        print(defined("inside"))
      `);

      expect(result.success).toBe(true);
      expect(result.output).toEqual(['42', 'false']);
      expect(result.testResults).toEqual([{ name: 'locals stay local', passed: true }]);
    });

    test('executes repeat blocks and keeps loop counters local', async () => {
      const result = await executeFCS(`
        count = 0
        repeat 3:
          count = count + 1

        print(count)
        print(defined("i"))
        print(defined("_"))
      `);

      expect(result.success).toBe(true);
      expect(result.output).toEqual(['3', 'false', 'false']);
    });

    test('reports runtime assertion failures through executeFCS', async () => {
      const result = await executeFCS(`
        test "fails":
          assert false, "expected failure"
      `);

      expect(result.success).toBe(false);
      expect(result.error).toBe('1 FCS test(s) failed');
      expect(result.testResults).toEqual([
        { name: 'fails', passed: false, error: 'expected failure' },
      ]);
    });

    test('bounds range expansion for suite scripts', async () => {
      const result = await executeFCS('print(len(range(5)))', {
        maxLoopIterations: 3,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('range() exceeded maxLoopIterations (3)');
    });
  });
});
