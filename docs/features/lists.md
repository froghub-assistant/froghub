# Lists

"Add milk and eggs to the shopping list", "what's on the to-do list?", "tick off bread": the `lists` tool shows, adds
to, ticks off and removes from the household's lists in Home Assistant, the same ones you see in the Home Assistant
app. Any to-do list works, such as Home Assistant's own Shopping list, Local To-do lists, or lists from Google Tasks,
Todoist and the like.

## Which lists

Home Assistant often has people's own lists too (from their Google account, say), so Frog Hub only uses the lists a
grown-up shares with it:

- By default, only Home Assistant's own **Shopping list** (`todo.shopping_list`).
- The admin page's **Assistant** tab lists every to-do list in Home Assistant under *📝 Lists it can use*: tick the
  ones the assistant may read and change.

The server reaches Home Assistant with the Home Assistant token the displays share (the one a grown-up set up with
the PIN).

Off with the grown-ups' "Read and change the shared to-do and shopping lists" switch.
