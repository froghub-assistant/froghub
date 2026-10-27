# Sums, units and facts

So the assistant doesn't do maths in its head or guess at facts, it has tools for them.

## Sums

`calculate` works sums out exactly: + − × ÷, powers, brackets, roots and a few functions. The sum is parsed, never run
as code.

## Units

`convert_units` converts length, weight, volume (British pints and gallons, US cups), temperature, speed, time and area.

## Wikipedia

`wikipedia` looks things up on Wikipedia, or on [Simple English Wikipedia](https://simple.wikipedia.org) for
children. It gives the best match's summary, its picture (which `show_on_screen` accepts) and other matches, or with
`more`, the article itself.

## Wikidata

`wikidata` gives exact facts from [Wikidata](https://www.wikidata.org): population, area, capital, birthdays, heights,
atomic numbers, boiling points, distance from Earth and so on. It skips names and disambiguation pages, and says when
the name could mean something else.

Wikipedia and Wikidata are off with the grown-ups' "Look things up online" switch.
