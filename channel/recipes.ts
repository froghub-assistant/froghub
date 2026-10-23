/**
 * Recipes from TheMealDB (themealdb.com): the assistant's find_recipe tool looks one up by name, or lists ideas by main
 * ingredient, category or cuisine, or picks one at random, and can show its picture and ingredients with show_on_screen.
 *
 * Environment:
 *   FROGHUB_MEALDB_KEY  TheMealDB API key (default "1", their free key for personal and educational use)
 */
import { clean } from './common.ts'

const KEY = process.env.FROGHUB_MEALDB_KEY || '1'
const API = `https://www.themealdb.com/api/json/v1/${encodeURIComponent(KEY)}`
const MAX_LIST = 12
const MAX_METHOD = 2500

export const recipeTool = {
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
  const r = await fetch(`${API}/${path}`, { headers: { 'User-Agent': 'FrogHub/0.1 (home display)' }, signal: AbortSignal.timeout(8000) })
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
