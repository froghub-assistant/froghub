/**
 * Sums and unit conversions, worked out exactly rather than by the model: calculate (arithmetic, powers, roots and a
 * few functions, without eval) and convert_units (length, weight, volume with British pints and gallons and US cups,
 * temperature, speed, time, area).
 */
import type { Tool } from './tools.ts'

export const mathsTools: Tool[] = [
  {
    name: 'calculate',
    description:
      'Work out a sum exactly instead of in your head: + - * / ^ (power) % (remainder), brackets, and sqrt, cbrt, abs, ' +
      'round, floor, ceil, sin, cos, tan (degrees), log (base 10), ln, pi, e. E.g. "(12 + 8) * 3", "2^10", "sqrt(144)". ' +
      'For a percentage, write it out: 15% of 80 is "80 * 15 / 100".',
    inputSchema: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] },
  },
  {
    name: 'convert_units',
    description:
      'Convert between units: length (mm cm m km in ft yd mile), weight (mg g kg oz lb stone), volume (ml cl l tsp tbsp ' +
      'cup (US, 240 ml) floz pint gallon (British)), temperature (C F K), speed (mph km/h m/s knot), time (s min h day ' +
      'week year), area (cm2 m2 km2 sqft acre hectare). Not between kinds (cups of flour to grams needs the food).',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'number' }, from: { type: 'string' }, to: { type: 'string' } },
      required: ['value', 'from', 'to'],
    },
  },
]

// ---- calculate: a small recursive-descent parser ----

const FUNCTIONS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sin: x => Math.sin((x * Math.PI) / 180), cos: x => Math.cos((x * Math.PI) / 180), tan: x => Math.tan((x * Math.PI) / 180),
  log: Math.log10, ln: Math.log,
}
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E }

export function calculate(expression: string): number {
  const src = expression.toLowerCase().replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/(\d),(?=\d{3}\b)/g, '$1')
  if (src.length > 200) throw new Error('That sum is too long.')
  const tokens = src.match(/\d+\.?\d*(?:e[+-]?\d+)?|\.\d+|[a-z]+|\*\*|[-+*/^%(),]|\S/g) ?? []
  let i = 0
  const peek = () => tokens[i]
  const take = (t?: string) => {
    if (t !== undefined && tokens[i] !== t) throw new Error(`Expected "${t}"${tokens[i] ? ` but found "${tokens[i]}"` : ' at the end'}.`)
    return tokens[i++]
  }
  // sum := term (('+'|'-') term)* ; term := power (('*'|'/'|'%') power)* ; power := unary ('^' power)? ; unary := '-' unary | atom
  const sum = (): number => {
    let v = term()
    while (peek() === '+' || peek() === '-') v = take() === '+' ? v + term() : v - term()
    return v
  }
  const term = (): number => {
    let v = unary()
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = take()
      const r = unary()
      if (op !== '*' && r === 0) throw new Error('You can\'t divide by zero.')
      v = op === '*' ? v * r : op === '/' ? v / r : v % r
    }
    return v
  }
  const unary = (): number => (peek() === '-' ? (take(), -unary()) : peek() === '+' ? (take(), unary()) : power())
  const power = (): number => {
    const base = atom()
    if (peek() === '^' || peek() === '**') {
      take()
      return base ** unary()
    }
    return base
  }
  const atom = (): number => {
    const t = take()
    if (t === undefined) throw new Error('The sum ends too soon.')
    if (t === '(') {
      const v = sum()
      take(')')
      return v
    }
    if (/^[\d.]/.test(t)) return Number(t)
    if (t in CONSTANTS) return CONSTANTS[t]
    if (t in FUNCTIONS) {
      take('(')
      const v = sum()
      take(')')
      return FUNCTIONS[t](v)
    }
    throw new Error(`I don't know "${t}" in a sum.`)
  }
  if (!tokens.length) throw new Error('Give a sum to work out.')
  const result = sum()
  if (i < tokens.length) throw new Error(`I don't understand "${tokens[i]}" there.`)
  if (!Number.isFinite(result)) throw new Error('That has no answer (it is too big, or not a real number).')
  return result
}

/** A result as words a person would say: no floating-point noise, at most 10 significant figures. */
export const tidy = (n: number) => (Math.abs(n) < 1e-12 ? '0' : String(Number(n.toPrecision(10))))

// ---- convert_units ----

type Unit = { kind: string; factor: number; names: string[] } // factor: how many of the kind's base unit
const UNITS: Unit[] = [
  // length, in metres
  { kind: 'length', factor: 0.001, names: ['mm', 'millimetre', 'millimeter'] },
  { kind: 'length', factor: 0.01, names: ['cm', 'centimetre', 'centimeter'] },
  { kind: 'length', factor: 1, names: ['m', 'metre', 'meter'] },
  { kind: 'length', factor: 1000, names: ['km', 'kilometre', 'kilometer'] },
  { kind: 'length', factor: 0.0254, names: ['in', 'inch', 'inches', '"'] },
  { kind: 'length', factor: 0.3048, names: ['ft', 'foot', 'feet', "'"] },
  { kind: 'length', factor: 0.9144, names: ['yd', 'yard'] },
  { kind: 'length', factor: 1609.344, names: ['mi', 'mile'] },
  // weight, in grams
  { kind: 'weight', factor: 0.001, names: ['mg', 'milligram'] },
  { kind: 'weight', factor: 1, names: ['g', 'gram', 'gramme'] },
  { kind: 'weight', factor: 1000, names: ['kg', 'kilo', 'kilogram'] },
  { kind: 'weight', factor: 1e6, names: ['t', 'tonne', 'metric ton'] },
  { kind: 'weight', factor: 28.349523125, names: ['oz', 'ounce'] },
  { kind: 'weight', factor: 453.59237, names: ['lb', 'lbs', 'pound'] },
  { kind: 'weight', factor: 6350.29318, names: ['st', 'stone'] },
  // volume, in millilitres
  { kind: 'volume', factor: 1, names: ['ml', 'millilitre', 'milliliter'] },
  { kind: 'volume', factor: 10, names: ['cl', 'centilitre', 'centiliter'] },
  { kind: 'volume', factor: 1000, names: ['l', 'litre', 'liter'] },
  { kind: 'volume', factor: 5, names: ['tsp', 'teaspoon'] },
  { kind: 'volume', factor: 15, names: ['tbsp', 'tablespoon'] },
  { kind: 'volume', factor: 240, names: ['cup', 'us cup'] },
  { kind: 'volume', factor: 28.4130625, names: ['floz', 'fl oz', 'fluid ounce'] },
  { kind: 'volume', factor: 568.26125, names: ['pt', 'pint'] },
  { kind: 'volume', factor: 4546.09, names: ['gal', 'gallon'] },
  // speed, in metres a second
  { kind: 'speed', factor: 1, names: ['m/s', 'mps', 'metres per second', 'meters per second'] },
  { kind: 'speed', factor: 1000 / 3600, names: ['km/h', 'kph', 'kmh', 'kilometres per hour', 'kilometers per hour'] },
  { kind: 'speed', factor: 0.44704, names: ['mph', 'miles per hour'] },
  { kind: 'speed', factor: 1852 / 3600, names: ['knot', 'kn', 'kt'] },
  // time, in seconds
  { kind: 'time', factor: 1, names: ['s', 'sec', 'second'] },
  { kind: 'time', factor: 60, names: ['min', 'minute'] },
  { kind: 'time', factor: 3600, names: ['h', 'hr', 'hour'] },
  { kind: 'time', factor: 86400, names: ['d', 'day'] },
  { kind: 'time', factor: 604800, names: ['wk', 'week'] },
  { kind: 'time', factor: 31557600, names: ['yr', 'year'] }, // a Julian year (365.25 days)
  // area, in square metres
  { kind: 'area', factor: 1e-4, names: ['cm2', 'cm²', 'square centimetre', 'square centimeter'] },
  { kind: 'area', factor: 1, names: ['m2', 'm²', 'square metre', 'square meter'] },
  { kind: 'area', factor: 1e6, names: ['km2', 'km²', 'square kilometre', 'square kilometer'] },
  { kind: 'area', factor: 0.09290304, names: ['sqft', 'ft2', 'ft²', 'square foot', 'square feet'] },
  { kind: 'area', factor: 4046.8564224, names: ['acre'] },
  { kind: 'area', factor: 1e4, names: ['ha', 'hectare'] },
]
const TEMPERATURES: Record<string, string> = {
  c: 'C', '°c': 'C', celsius: 'C', centigrade: 'C', f: 'F', '°f': 'F', fahrenheit: 'F', k: 'K', kelvin: 'K',
}

function unit(name: string): Unit | string {
  const n = name.trim().toLowerCase().replace(/\.$/, '').replace(/\s+/g, ' ')
  if (TEMPERATURES[n] || TEMPERATURES[n.replace(/^degrees? /, '')]) return TEMPERATURES[n] || TEMPERATURES[n.replace(/^degrees? /, '')]
  const plain = n.replace(/(es|s)$/, '')
  const found = UNITS.find(u => u.names.includes(n)) ?? UNITS.find(u => u.names.includes(plain)) ?? UNITS.find(u => u.names.includes(n.replace(/s$/, '')))
  if (!found) throw new Error(`I don't know the unit "${name}".`)
  return found
}

const toKelvin = (v: number, from: string) => (from === 'C' ? v + 273.15 : from === 'F' ? ((v - 32) * 5) / 9 + 273.15 : v)
const fromKelvin = (k: number, to: string) => (to === 'C' ? k - 273.15 : to === 'F' ? ((k - 273.15) * 9) / 5 + 32 : k)

export function convertUnits(value: number, from: string, to: string): number {
  if (!Number.isFinite(value)) throw new Error('Give a number to convert.')
  const a = unit(from)
  const b = unit(to)
  if (typeof a === 'string' || typeof b === 'string') {
    if (typeof a !== 'string' || typeof b !== 'string') throw new Error(`${from} and ${to} measure different things.`)
    return fromKelvin(toKelvin(value, a), b)
  }
  if (a.kind !== b.kind) throw new Error(`${from} is a ${a.kind} and ${to} is a ${b.kind}: they can't be converted.`)
  return (value * a.factor) / b.factor
}

/** Runs one of the tools above; returns the text for the assistant (throws on bad input). */
export function runMathsTool(name: string, args: Record<string, unknown>): string {
  if (name === 'calculate') {
    const expression = String(args.expression ?? '').trim()
    return `${expression} = ${tidy(calculate(expression))}`
  }
  const value = Number(args.value)
  const from = String(args.from ?? '')
  const to = String(args.to ?? '')
  return `${tidy(value)} ${from} = ${tidy(convertUnits(value, from, to))} ${to}`
}
