/**
 * Recipes: the assistant's find_recipe tool looks one up by name, lists ideas, or picks one at random.
 *
 * TheMealDB (themealdb.com) by default: by name, or ideas by main ingredient, category or cuisine; it has pictures,
 * so show_on_screen can show one with the ingredients. recipeapi.io instead when there's a key for it (setup asks):
 * 50,000 recipes with filters for cuisine, meal, difficulty, diet, time and calories, and nutrition, but no pictures.
 *
 * Environment:
 *   FROGHUB_MEALDB_KEY     TheMealDB API key (default "1", their free key for personal and educational use)
 *   FROGHUB_RECIPEAPI_KEY  a recipeapi.io key (sk_live_…); otherwise ~/.config/froghub/recipeapi.key if not empty
 */
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { clean } from './common.ts'

const KEY = process.env.FROGHUB_MEALDB_KEY || '1'
const API = `https://www.themealdb.com/api/json/v1/${encodeURIComponent(KEY)}`
const RECIPEAPI = 'https://recipeapi.io/api/v1'
export const RECIPEAPI_KEY_FILE = join(homedir(), '.config', 'froghub', 'recipeapi.key')
const MAX_LIST = 12
const MAX_METHOD = 2500
const HEADERS = { 'User-Agent': 'FrogHub/0.1 (home display)' }

/** The recipeapi.io key, if there is one (read each time, so setup can change it without a restart). */
export const recipeApiKey = () =>
  process.env.FROGHUB_RECIPEAPI_KEY || (existsSync(RECIPEAPI_KEY_FILE) ? readFileSync(RECIPEAPI_KEY_FILE, 'utf8').trim() : '')

/** find_recipe as the assistant sees it: recipeapi.io's when there's a key, else TheMealDB's. */
export const recipeTool = () => (recipeApiKey() ? recipeApiTool : mealDbTool)

const mealDbTool = {
  name: 'find_recipe',
  description:
    'Recipes from TheMealDB. Give name to look one up ("shepherd\'s pie"), or ingredient, category or area for a list ' +
    'of ideas, then look one up by its id; or random for a surprise. A full recipe comes with its picture, so you can ' +
    'show it with show_on_screen (image_url, and the ingredients as items) while you read out the gist. Measures are ' +
    'often American (cups, °F): put them in grams and °C when you say them.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The dish, e.g. "lasagne"' },
      id: { type: 'string', description: 'A recipe id from an earlier list' },
      ingredient: { type: 'string', description: 'Main ingredient, e.g. "chicken breast", "salmon"' },
      category: { type: 'string', description: 'e.g. Dessert, Vegetarian, Vegan, Seafood, Pasta, Breakfast, Starter, Side, Beef, Chicken' },
      area: { type: 'string', description: 'Cuisine, e.g. British, Italian, Indian, Mexican, Japanese' },
      random: { type: 'boolean', description: 'A random recipe' },
    },
  },
}

type Meal = Record<string, string | null>

async function get(path: string): Promise<Meal[]> {
  const r = await fetch(`${API}/${path}`, { headers: HEADERS, signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw new Error(`TheMealDB answered ${r.status}`)
  const body = await r.json().catch(() => null)
  return Array.isArray(body?.meals) ? body.meals : []
}

/** A whole recipe, for the assistant: name, id, kind, picture, ingredients with measures, and the method. */
export function describeMeal(m: Meal): string {
  const ingredients: string[] = []
  for (let i = 1; i <= 20; i++) {
    const what = (m[`strIngredient${i}`] ?? '').trim()
    if (what) ingredients.push(`${(m[`strMeasure${i}`] ?? '').trim()} ${what}`.trim())
  }
  const method = (m.strInstructions ?? '').replace(/\r/g, '').replace(/\n{2,}/g, '\n').trim()
  return [
    `${m.strMeal} (id ${m.idMeal}): ${[m.strCategory, m.strArea].filter(Boolean).join(', ')}`,
    m.strMealThumb ? `Picture: ${m.strMealThumb}` : '',
    `Ingredients: ${ingredients.join('; ')}`,
    `Method: ${method.length > MAX_METHOD ? `${method.slice(0, MAX_METHOD)}…` : method}`,
  ].filter(Boolean).join('\n')
}

const listing = (meals: Meal[], what: string) =>
  `${meals.length} ${what}${meals.length > MAX_LIST ? `, the first ${MAX_LIST}` : ''} (look one up by id):\n` +
  meals.slice(0, MAX_LIST).map(m => `${m.idMeal}: ${m.strMeal}`).join('\n')

/** Runs find_recipe; returns the text for the assistant (throws when there's nothing to say). */
export async function findRecipe(args: Record<string, unknown>): Promise<string> {
  return recipeApiKey() ? findOnRecipeApi(args) : findOnMealDb(args)
}

async function findOnMealDb(args: Record<string, unknown>): Promise<string> {
  const word = (k: string) => clean(args[k], 60)
  if (word('id')) {
    const [meal] = await get(`lookup.php?i=${encodeURIComponent(word('id'))}`)
    if (!meal) throw new Error(`No recipe with id ${word('id')}.`)
    return describeMeal(meal)
  }
  if (word('name')) {
    const meals = await get(`search.php?s=${encodeURIComponent(word('name'))}`)
    if (!meals.length) throw new Error(`TheMealDB has nothing called "${word('name')}"; try a simpler name, or an ingredient.`)
    return meals.length === 1 ? describeMeal(meals[0]) : `${describeMeal(meals[0])}\n\nOthers: ${meals.slice(1, MAX_LIST).map(m => `${m.idMeal}: ${m.strMeal}`).join('; ')}`
  }
  for (const [k, letter] of [['ingredient', 'i'], ['category', 'c'], ['area', 'a']] as const) {
    if (!word(k)) continue
    const value = k === 'ingredient' ? word(k).toLowerCase().replace(/\s+/g, '_') : word(k)
    const meals = await get(`filter.php?${letter}=${encodeURIComponent(value)}`)
    if (!meals.length) throw new Error(`Nothing for the ${k} "${word(k)}".`)
    return listing(meals, `recipes for the ${k} "${word(k)}"`)
  }
  if (args.random === true) {
    const [meal] = await get('random.php')
    if (!meal) throw new Error('TheMealDB gave no recipe.')
    return describeMeal(meal)
  }
  throw new Error('Give a name, id, ingredient, category or area, or random.')
}

// ---- recipeapi.io ----

const recipeApiTool = {
  name: 'find_recipe',
  description:
    'Recipes from recipeapi.io (metric). Give name to look one up ("shepherd\'s pie"); or any of ingredients, cuisine, ' +
    'meal_type, difficulty, diet, max_prep_minutes and max_calories for a list of ideas (with name too, to narrow it), ' +
    'then look one up by its id; or random (the same filters apply) for a surprise. There are no pictures: show the ' +
    'ingredients or steps with show_on_screen as items while you read out the gist.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The dish, e.g. "lasagne"' },
      id: { type: 'string', description: 'A recipe id from an earlier list' },
      ingredients: { type: 'string', description: 'What they have, separated by commas, e.g. "chicken, rice"' },
      cuisine: { type: 'string', description: 'american, chinese, french, greek, italian, japanese, mexican, portuguese, spanish, thai or turkish' },
      meal_type: { type: 'string', description: 'starter, main, dessert, appetizer, breakfast, brunch, snack, side_dish, soup, drink or sauce' },
      difficulty: { type: 'string', description: 'easy, medium or hard' },
      diet: { type: 'string', description: 'One of vegetarian, vegan, gluten_free, dairy_free, nut_free, halal, kosher' },
      max_prep_minutes: { type: 'number', description: 'At most this much preparation time' },
      max_calories: { type: 'number', description: 'At most this many calories a serving' },
      random: { type: 'boolean', description: 'A random recipe' },
    },
  },
}

type Ingredient = { name: string; quantity?: number | null; unit?: string | null; optional?: boolean }
export type Recipe = {
  id: number; name: string; description?: string; difficulty?: string; meal_type?: string; cuisine?: string
  dietary_tags?: string[]; servings?: number; prep_time?: number; cook_time?: number; calories_per_serving?: number
  protein?: number; instructions?: string[]; ingredients?: Ingredient[]
}

async function recipeApi(path: string, query: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(query).toString()
  const r = await fetch(`${RECIPEAPI}/${path}${qs ? `?${qs}` : ''}`, {
    headers: { ...HEADERS, Authorization: `Bearer ${recipeApiKey()}` },
    signal: AbortSignal.timeout(8000),
  })
  const body = await r.json().catch(() => null)
  if (r.ok) return body
  const said = clean(body?.error?.message, 200)
  if (r.status === 401) throw new Error('recipeapi.io turned the key down; a grown-up can set a new one with bun run setup.')
  throw new Error(`recipeapi.io answered ${r.status}${said ? `: ${said}` : ''}`)
}

const words = (s?: string) => (s ?? '').replace(/_/g, ' ')

/** A whole recipe, for the assistant: what it is, how long, nutrition, ingredients and the numbered method. */
export function describeRecipe(r: Recipe): string {
  const kind = [r.difficulty, words(r.cuisine).replace(/^./, c => c.toUpperCase()), words(r.meal_type)].filter(Boolean).join(' ')
  const facts = [
    kind + (r.dietary_tags?.length ? `, ${r.dietary_tags.map(words).join(', ')}` : ''),
    r.servings ? `serves ${r.servings}` : '',
    [r.prep_time ? `${r.prep_time} min prep` : '', r.cook_time ? `${r.cook_time} min cooking` : ''].filter(Boolean).join(', '),
    [r.calories_per_serving ? `${r.calories_per_serving} kcal` : '', r.protein ? `${r.protein} g protein` : ''].filter(Boolean).join(' and ') +
      (r.calories_per_serving || r.protein ? ' a serving' : ''),
  ].filter(Boolean)
  const ingredients = (r.ingredients ?? []).map(i =>
    `${[i.quantity, i.unit].filter(x => x !== null && x !== undefined && x !== '').join(' ')} ${i.name}${i.optional ? ' (optional)' : ''}`.trim())
  const method = (r.instructions ?? []).map((step, n) => `${n + 1}. ${step.trim()}`).join('\n')
  return [
    `${r.name} (id ${r.id}): ${facts.join('; ')}`,
    r.description?.trim() ?? '',
    `Ingredients: ${ingredients.join('; ')}`,
    `Method:\n${method.length > MAX_METHOD ? `${method.slice(0, MAX_METHOD)}…` : method}`,
  ].filter(Boolean).join('\n')
}

const LABELS: Record<string, string> = {
  search: 'the name', ingredients: 'the ingredients', cuisine: 'the cuisine', meal_type: 'the meal', difficulty: 'the difficulty',
  dietary_tags: 'the diet', prep_time_max: 'minutes of prep at most', calories_per_serving_max: 'kcal a serving at most',
}
const lower = (s: string) => s.toLowerCase().replace(/[\s-]+/g, '_')

async function findOnRecipeApi(args: Record<string, unknown>): Promise<string> {
  const word = (k: string) => clean(args[k], 80)
  const number = (k: string) => {
    const n = Number(args[k])
    return args[k] !== undefined && n > 0 ? String(Math.round(n)) : ''
  }
  if (word('id')) {
    if (!/^\d+$/.test(word('id'))) throw new Error(`"${word('id')}" isn't a recipe id; ids are numbers.`)
    return describeRecipe((await recipeApi(`recipes/${word('id')}`, {})).data)
  }
  const filters = Object.fromEntries(Object.entries({
    search: word('name'),
    ingredients: word('ingredients').split(',').map(s => s.trim()).filter(Boolean).join(','),
    cuisine: word('cuisine').toLowerCase(),
    meal_type: lower(word('meal_type')),
    difficulty: word('difficulty').toLowerCase(),
    dietary_tags: lower(word('diet')),
    prep_time_max: number('max_prep_minutes'),
    calories_per_serving_max: number('max_calories'),
  }).filter(([, v]) => v))
  if (args.random === true) return describeRecipe((await recipeApi('recipes/random', filters)).data)
  if (!Object.keys(filters).length) throw new Error('Give a name, id, ingredients, cuisine, meal_type, difficulty, diet, time or calories, or random.')
  const body = await recipeApi('recipes', { ...filters, per_page: '10' })
  const found: Recipe[] = Array.isArray(body?.data) ? body.data : []
  const total: number = body?.meta?.total ?? found.length
  const asked = Object.entries(filters).map(([k, v]) => `${LABELS[k]} ${v}`).join(', ')
  if (!found.length) throw new Error(`recipeapi.io has nothing for ${asked}; try fewer or simpler filters.`)
  const line = (r: Recipe) => `${r.id}: ${r.name}${r.prep_time || r.cook_time ? ` (${(r.prep_time ?? 0) + (r.cook_time ?? 0)} min)` : ''}`
  if (word('name')) {
    const others = found.slice(1).map(line).join('; ')
    return `${describeRecipe(found[0])}${others ? `\n\nOthers${total > found.length ? ` (${total} in all)` : ''}: ${others}` : ''}`
  }
  return `${total} recipes for ${asked}${total > found.length ? `, the first ${found.length}` : ''} (look one up by id):\n` + found.map(line).join('\n')
}
