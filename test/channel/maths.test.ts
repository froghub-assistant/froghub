import { describe, expect, test } from 'bun:test'
import { calculate, convertUnits, runMathsTool, tidy } from '../../channel/maths.ts'

describe('calculate', () => {
  test.each([
    ['(12 + 8) * 3', 60], ['2^10', 1024], ['2 ** 3 ** 2', 512], ['-2^2', -4], ['10 - 4 - 3', 3], ['7 % 3', 1],
    ['sqrt(144)', 12], ['round(2.5) + abs(-1)', 4], ['sin(90)', 1], ['log(1000)', 3], ['80 * 15 / 100', 12],
    ['1,000 + 1', 1001], ['6 × 7 ÷ 2', 21], ['.5 + 1.25', 1.75], ['2e3', 2000], ['pi * 2', 2 * Math.PI],
  ])('%s = %p', (sum, answer) => expect(calculate(sum)).toBeCloseTo(answer, 10))

  test('says what is wrong', () => {
    expect(() => calculate('1 / 0')).toThrow("can't divide by zero")
    expect(() => calculate('(1 + 2')).toThrow('Expected ")" at the end')
    expect(() => calculate('2 + ')).toThrow('ends too soon')
    expect(() => calculate('process.exit()')).toThrow('I don\'t know "process"')
    expect(() => calculate('2 3')).toThrow('I don\'t understand "3"')
    expect(() => calculate('sqrt(-1)')).toThrow('no answer')
  })

  test('answers without floating-point noise', () => {
    expect(tidy(calculate('0.1 + 0.2'))).toBe('0.3')
    expect(runMathsTool('calculate', { expression: '0.1 + 0.2' })).toBe('0.1 + 0.2 = 0.3')
  })
})

describe('convert_units', () => {
  test.each([
    [1, 'mile', 'km', 1.609344], [6, 'feet', 'm', 1.8288], [5, 'inches', 'cm', 12.7], [11, 'stone', 'kg', 69.85322498],
    [1, 'lb', 'g', 453.59237], [2, 'pints', 'l', 1.1365225], [1, 'cup', 'ml', 240], [3, 'tbsp', 'tsp', 9],
    [200, 'C', 'F', 392], [350, '°F', 'celsius', 176.6666667], [0, 'degrees C', 'K', 273.15],
    [70, 'mph', 'km/h', 112.65408], [90, 'minutes', 'hours', 1.5], [1, 'acre', 'm2', 4046.856422],
  ])('%p %s in %s', (value, from, to, answer) => expect(convertUnits(value, from, to)).toBeCloseTo(answer, 5))

  test('only between units of the same kind, and ones it knows', () => {
    expect(() => convertUnits(1, 'cup', 'g')).toThrow("cup is a volume and g is a weight: they can't be converted.")
    expect(() => convertUnits(1, 'C', 'kg')).toThrow('measure different things')
    expect(() => convertUnits(1, 'furlong', 'm')).toThrow('I don\'t know the unit "furlong"')
  })

  test('as the assistant reads it', () => {
    expect(runMathsTool('convert_units', { value: 200, from: 'C', to: 'F' })).toBe('200 C = 392 F')
  })
})
