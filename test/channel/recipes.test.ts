import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { rmSync, writeFileSync } from 'fs'
import { cleanDisplay } from '../../channel/display.ts'
import { describeMeal, describeRecipe, findRecipe, RECIPEAPI_KEY_FILE, type Recipe, recipeTool } from '../../channel/recipes.ts'
import { tools } from '../../channel/tools.ts'

// TheMealDB, cut down to what find_recipe reads
const PIE = {
  idMeal: '52802', strMeal: 'Fish pie', strCategory: 'Seafood', strArea: 'British',
  strMealThumb: 'https://www.themealdb.com/images/media/meals/ysxwuq1487323065.jpg',
  strInstructions: 'Heat the oven to 200C.\r\n\r\nBoil the potatoes.\r\nBake for 30 minutes.',
  strIngredient1: 'Floury Potatoes', strMeasure1: '900g', strIngredient2: 'Milk', strMeasure2: '1 cup',
  strIngredient3: 'Salt', strMeasure3: '', strIngredient4: '', strMeasure4: ' ', strIngredient5: null, strMeasure5: null,
}
const LIST = Array.from({ length: 15 }, (_, i) => ({ idMeal: String(53000 + i), strMeal: `Chicken dish ${i + 1}` }))

const asked: string[] = []
let answer: (path: string) => unknown = () => ({ meals: null })
let status = 200
let auth: string | null = null
const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  asked.push(url.replace('https://www.themealdb.com/api/json/v1/1/', '').replace('https://recipeapi.io/api/v1/', 'recipeapi:'))
  auth = new Headers(init?.headers).get('authorization')
  return Response.json(answer(asked.at(-1)!), { status })
}) as typeof fetch)
afterAll(() => fetchSpy.mockRestore())
beforeEach(() => {
  asked.length = 0
  answer = () => ({ meals: null })
  status = 200
})

describe('describeMeal', () => {
  test('name, id, kind, picture, ingredients with measures, and the method without blank lines', () => {
    expect(describeMeal(PIE)).toBe([
      'Fish pie (id 52802): Seafood, British',
      'Picture: https://www.themealdb.com/images/media/meals/ysxwuq1487323065.jpg',
      'Ingredients: 900g Floury Potatoes; 1 cup Milk; Salt',
      'Method: Heat the oven to 200C.\nBoil the potatoes.\nBake for 30 minutes.',
    ].join('\n'))
  })
})

describe('find_recipe', () => {
  test('by name gives the first in full and lists the others', async () => {
    answer = () => ({ meals: [PIE, { ...PIE, idMeal: '1', strMeal: 'Smoked fish pie' }] })
    const text = await findRecipe({ name: 'fish pie' })
    expect(asked).toEqual(['search.php?s=fish%20pie'])
    expect(text).toStartWith('Fish pie (id 52802)')
    expect(text).toEndWith('Others: 1: Smoked fish pie')
  })

  test('by ingredient lists ideas (the first 12), with ids to look up', async () => {
    answer = () => ({ meals: LIST })
    const text = await findRecipe({ ingredient: 'Chicken Breast' })
    expect(asked).toEqual(['filter.php?i=chicken_breast'])
    expect(text.split('\n')[0]).toBe('15 recipes for the ingredient "Chicken Breast", the first 12 (look one up by id):')
    expect(text.split('\n')).toHaveLength(13)
    expect(text).toContain('53000: Chicken dish 1')
  })

  test('by category and by cuisine', async () => {
    answer = () => ({ meals: LIST.slice(0, 2) })
    await findRecipe({ category: 'Dessert' })
    await findRecipe({ area: 'British' })
    expect(asked).toEqual(['filter.php?c=Dessert', 'filter.php?a=British'])
  })

  test('by id, and at random', async () => {
    answer = () => ({ meals: [PIE] })
    expect(await findRecipe({ id: '52802' })).toStartWith('Fish pie')
    expect(await findRecipe({ random: true })).toStartWith('Fish pie')
    expect(asked).toEqual(['lookup.php?i=52802', 'random.php'])
  })

  test('says when there is nothing, or nothing was asked', async () => {
    await expect(findRecipe({ name: 'zzz' })).rejects.toThrow('TheMealDB has nothing called "zzz"')
    await expect(findRecipe({ id: '1' })).rejects.toThrow('No recipe with id 1.')
    await expect(findRecipe({})).rejects.toThrow('Give a name, id, ingredient, category or area, or random.')
  })
})

describe('recipe pictures on the screen', () => {
  test("TheMealDB's pictures may be shown, look-alikes may not", async () => {
    expect((await cleanDisplay({ image_url: PIE.strMealThumb })).image).toBe(PIE.strMealThumb)
    for (const url of ['https://www.themealdb.com/api/json/v1/1/random.php', 'https://www.themealdb.com.evil.com/images/x.jpg', 'http://www.themealdb.com/images/x.jpg'])
      await expect(cleanDisplay({ image_url: url })).rejects.toThrow('Pictures must be')
  })
})

// recipeapi.io, cut down to what find_recipe reads
const TOSTADAS: Recipe = {
  id: 449, name: 'Beef Tostadas', description: 'Crispy tortillas topped with seasoned beef.', difficulty: 'easy',
  meal_type: 'side_dish', cuisine: 'mexican', dietary_tags: ['nut_free', 'gluten_free'], servings: 6, prep_time: 15,
  cook_time: 20, calories_per_serving: 450, protein: 25,
  instructions: ['Brown the beef.', ' Warm the shells. '],
  ingredients: [
    { name: 'Garlic', quantity: 2, unit: 'clove', optional: false },
    { name: 'Cheddar cheese', quantity: 100, unit: 'g', optional: true },
    { name: 'Salt', quantity: null, unit: null },
  ],
}
const page = (data: Recipe[], total = data.length) => ({ data, meta: { total, per_page: 10 } })

describe('recipeapi.io, with a key', () => {
  beforeEach(() => writeFileSync(RECIPEAPI_KEY_FILE, 'sk_live_test\n'))
  afterEach(() => rmSync(RECIPEAPI_KEY_FILE, { force: true }))

  test('describeRecipe: what it is, how long, nutrition, ingredients and the numbered method', () => {
    expect(describeRecipe(TOSTADAS)).toBe([
      'Beef Tostadas (id 449): easy Mexican side dish, nut free, gluten free; serves 6; 15 min prep, 20 min cooking; 450 kcal and 25 g protein a serving',
      'Crispy tortillas topped with seasoned beef.',
      'Ingredients: 2 clove Garlic; 100 g Cheddar cheese (optional); Salt',
      'Method:\n1. Brown the beef.\n2. Warm the shells.',
    ].join('\n'))
  })

  test('the tool offers its filters, and the key goes as a Bearer token', async () => {
    expect(Object.keys(recipeTool().inputSchema.properties)).toContain('diet')
    expect(tools({ requestIds: false, think: false }).find(t => t.name === 'find_recipe')!.description).toContain('recipeapi.io')
    answer = () => ({ data: TOSTADAS })
    await findRecipe({ id: '449' })
    expect(asked).toEqual(['recipeapi:recipes/449'])
    expect(auth).toBe('Bearer sk_live_test')
  })

  test('by name gives the first in full and lists the others', async () => {
    answer = () => page([TOSTADAS, { id: 7, name: 'Chicken Tostadas', prep_time: 10 }], 14)
    const text = await findRecipe({ name: 'tostadas' })
    expect(asked).toEqual(['recipeapi:recipes?search=tostadas&per_page=10'])
    expect(text).toStartWith('Beef Tostadas (id 449)')
    expect(text).toEndWith('Others (14 in all): 7: Chicken Tostadas (10 min)')
  })

  test('filters make a list of ideas, tidied into what the API takes', async () => {
    answer = () => page([TOSTADAS, { id: 7, name: 'Chicken Tostadas' }], 30)
    const text = await findRecipe({ ingredients: 'beef, cheese ,', cuisine: 'Mexican', meal_type: 'Side dish', diet: 'gluten-free', max_prep_minutes: 20.4, max_calories: -5 })
    expect(asked).toEqual(['recipeapi:recipes?ingredients=beef%2Ccheese&cuisine=mexican&meal_type=side_dish&dietary_tags=gluten_free&prep_time_max=20&per_page=10'])
    expect(text.split('\n')).toEqual([
      '30 recipes for the ingredients beef,cheese, the cuisine mexican, the meal side_dish, the diet gluten_free, minutes of prep at most 20, the first 2 (look one up by id):',
      '449: Beef Tostadas (35 min)',
      '7: Chicken Tostadas',
    ])
  })

  test('random takes the same filters', async () => {
    answer = () => ({ data: TOSTADAS })
    expect(await findRecipe({ random: true, difficulty: 'Easy' })).toStartWith('Beef Tostadas')
    expect(asked).toEqual(['recipeapi:recipes/random?difficulty=easy'])
  })

  test('says when there is nothing, or nothing was asked, or the API says no', async () => {
    answer = () => page([])
    await expect(findRecipe({ name: 'zzz' })).rejects.toThrow('recipeapi.io has nothing for the name zzz')
    await expect(findRecipe({})).rejects.toThrow('Give a name, id, ingredients')
    await expect(findRecipe({ id: '52802; drop' })).rejects.toThrow("isn't a recipe id")
    status = 401
    await expect(findRecipe({ id: '1' })).rejects.toThrow('recipeapi.io turned the key down')
    status = 429
    answer = () => ({ error: { code: 'USAGE_LIMIT_EXCEEDED', message: 'Monthly API usage limit exceeded.' } })
    await expect(findRecipe({ random: true })).rejects.toThrow('recipeapi.io answered 429: Monthly API usage limit exceeded.')
  })

  test('an empty key file means TheMealDB again', async () => {
    writeFileSync(RECIPEAPI_KEY_FILE, '\n')
    expect(recipeTool().description).toStartWith('Recipes from TheMealDB')
    answer = () => ({ meals: [PIE] })
    await findRecipe({ random: true })
    expect(asked).toEqual(['random.php'])
  })
})
