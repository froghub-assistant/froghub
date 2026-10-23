import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { cleanDisplay } from '../../channel/display.ts'
import { describeMeal, findRecipe } from '../../channel/recipes.ts'

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
const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
  const url = String(input)
  asked.push(url.replace('https://www.themealdb.com/api/json/v1/1/', ''))
  return Response.json(answer(asked.at(-1)!))
}) as typeof fetch)
afterAll(() => fetchSpy.mockRestore())
beforeEach(() => {
  asked.length = 0
  answer = () => ({ meals: null })
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
