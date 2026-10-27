# Recipes

The assistant's `find_recipe` tool finds a recipe by name, ideas by main ingredient, category (Dessert,
Vegetarian…) or cuisine (British, Indian…), or one at random. It can put the ingredients and the method on the screen,
and says measures in grams and °C.

## TheMealDB (no key needed)

Without a key it uses [TheMealDB](https://www.themealdb.com), with pictures that `show_on_screen` accepts. It uses
TheMealDB's free key `1` (for personal and educational use); set `FROGHUB_MEALDB_KEY` for your own.

## recipeapi.io

With a [recipeapi.io](https://recipeapi.io) key, which setup asks for, it uses that instead: over 50,000 recipes in
metric, searchable by name or by what's in the fridge, and filtered by cuisine, meal, difficulty, diet (vegetarian,
gluten free, halal…), preparation time and calories, with nutrition per serving. It has no pictures, so the assistant
shows the ingredients or steps instead. The free plan allows 500 requests a month, and each search or look-up is one.

If recipeapi.io fails (it's down, out of requests or the key was turned down) or finds nothing, Frog Hub quietly asks
TheMealDB instead, as near as it can (a name, the first ingredient, the cuisine, or a meal or diet TheMealDB has). It
tells the assistant which filters TheMealDB couldn't apply (a diet above all), so it checks the recipe. Failures are
logged.

- To use TheMealDB while keeping the key, untick "Find recipes on recipeapi.io" on the admin page's Assistant tab.
- The key is kept in `~/.config/froghub/recipeapi.key`; `FROGHUB_RECIPEAPI_KEY` overrides it. Answering "none" in
  setup goes back to TheMealDB.
