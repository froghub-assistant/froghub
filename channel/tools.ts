/**
 * The assistant's tools (apart from reply), the same for both brains: server.ts offers them to Claude Code over MCP,
 * standalone.ts to the model it calls. Each checks the grown-ups' policy switches itself.
 */
import { type Reply, cleanActions, clean } from './common.ts'
import { weatherTool, getWeather } from './weather.ts'
import { findRecipe, recipeTool } from './recipes.ts'
import { mathsTools, runMathsTool } from './maths.ts'
import { lookUp, wikipediaTool } from './wikipedia.ts'
import { historyTool, searchHistory } from './history.ts'
import { alarmTools, runAlarmTool } from './alarms.ts'
import { type Display, displayTool, cleanDisplay } from './display.ts'
import { type Screen, announce, findDisplay, message, onlineDisplays } from './announce.ts'
import { runScheduleTool, scheduleTools } from './schedule.ts'
import { THINK_DESCRIPTION, bigModel, thinkHarder } from './thinker.ts'
import { policy } from './store.ts'

export type Tool = { name: string; description: string; inputSchema: Record<string, unknown> }
export type ToolResult = { text: string; isError?: boolean }
/** The request a tool is called for: the display it came from, and where show_on_screen's card goes (none when no
 * request is open, e.g. it timed out). */
export type ToolContext = { from?: Screen; show?: (card: Display) => void }

const { request_id: _, ...cardFields } = displayTool.inputSchema.properties

const thinkTool: Tool = {
  name: 'think_harder',
  description: `${THINK_DESCRIPTION} Put the answer it gives in your own words in your reply. If it fails, answer yourself.`,
  inputSchema: {
    type: 'object',
    properties: { question: { type: 'string', description: 'The question, with whatever it needs to know from the conversation (it sees nothing else)' } },
    required: ['question'],
  },
}

const announceTool: Tool = {
  name: 'announce',
  description:
    'Say and show something on the displays now, without anyone having asked there (e.g. while answering a ' +
    'scheduled job, or "tell everyone tea is ready" from the admin page). For passing on a message from the ' +
    'display you were asked at, use send_message instead.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'What they will hear, making sense on its own' },
      show: { type: 'object', properties: cardFields, description: 'A card to show with it (as show_on_screen)' },
      to: { type: 'string', description: "One display's name; leave out for all of them" },
      at_night: { type: 'boolean', description: 'Speak it during night hours too (otherwise it is only shown then)' },
    },
    required: ['text'],
  },
}

const sendMessageTool: Tool = {
  name: 'send_message',
  description:
    'Pass a message on to the other Frog Hub displays (e.g. "tell the kitchen I am hungry"): they say it aloud and show it. ' +
    'Not shown on the display you were asked from. Then reply as usual to say it is sent.',
  inputSchema: {
    type: 'object',
    properties: {
      request_id: { type: 'string' },
      text: { type: 'string', description: 'What they will hear, making sense on its own, e.g. "Sam says they are hungry!"' },
      to: { type: 'string', description: "One display's name, from the [Other displays: …] list; leave out for all of them" },
    },
    required: ['request_id', 'text'],
  },
}

/** The tools, for a brain that passes request_id to them (Claude Code) or not (the API brain). think_harder is
 * only offered with `think` (the API brain has its own, which hands the whole request over). */
export function tools(o: { requestIds: boolean; think: boolean }): Tool[] {
  const list: Tool[] = [weatherTool, recipeTool(), ...mathsTools, wikipediaTool, historyTool, ...alarmTools, displayTool, ...(o.think && bigModel('sonnet') ? [thinkTool] : []),
    announceTool, ...scheduleTools, sendMessageTool]
  if (o.requestIds) return list
  return list.map(t => {
    const { request_id: _, ...properties } = (t.inputSchema.properties ?? {}) as Record<string, unknown>
    const required = ((t.inputSchema.required ?? []) as string[]).filter(r => r !== 'request_id')
    return { ...t, inputSchema: { ...t.inputSchema, properties, required } }
  })
}

const off = (what: string): ToolResult => ({ isError: true, text: `A grown-up has turned off ${what} in Frog Hub's settings.` })
const fail = (err: unknown): ToolResult => ({ isError: true, text: (err as Error).message })

/** Runs one of the tools above; undefined if it isn't one of them. */
export async function runTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult | undefined> {
  const allowed = policy()
  try {
    if (name === 'get_weather') {
      if (!allowed.weather) return off('the weather')
      return { text: await getWeather(args) }
    }
    if (name === 'find_recipe') return { text: await findRecipe(args) }
    if (name === 'calculate' || name === 'convert_units') return { text: runMathsTool(name, args) }
    if (name === 'search_history') return { text: searchHistory(args) }
    if (name === 'wikipedia') {
      if (!allowed.webSearch) return off('looking things up online')
      return { text: await lookUp(args) }
    }
    if (name === 'show_on_screen') {
      if (!allowed.screen) return off('showing things on the screen')
      if (!ctx.show) return { isError: true, text: 'No open request with that id: call show_on_screen before reply.' }
      ctx.show(await cleanDisplay(args))
      return { text: 'It will appear on the screen with your reply.' }
    }
    if (name === 'send_message') {
      if (!allowed.announce) return off('sending messages to the other displays')
      if (!ctx.show) return { isError: true, text: 'No open request with that id.' }
      const text = clean(args.text, 300)
      if (!text) return { isError: true, text: 'Nothing to send.' }
      const others = onlineDisplays(ctx.from?.id)
      if (!others.length) return { isError: true, text: 'No other Frog Hub displays are on right now.' }
      const to = args.to ? findDisplay(String(args.to), ctx.from?.id) : undefined
      if (args.to && !to) return { isError: true, text: `No display called "${args.to}" is on. Displays that are on: ${others.map(s => s.name).join(', ')}.` }
      message(text, ctx.from, to)
      return { text: `Sent to ${to ? to.name : others.map(s => s.name).join(', ')}.` }
    }
    if (name === 'think_harder') return { text: await thinkHarder(clean(args.question, 4000)) }
    if (name === 'announce') {
      if (!allowed.announce) return off('announcements')
      const text = clean(args.text, 500)
      if (!text) return { isError: true, text: 'Nothing to say.' }
      const to = args.to ? findDisplay(String(args.to)) : undefined
      if (args.to && !to) return { isError: true, text: `No display called "${args.to}" is on. Displays that are on: ${onlineDisplays().map(s => s.name).join(', ') || 'none'}.` }
      const display = args.show && typeof args.show === 'object' ? await cleanDisplay({ ...(args.show as Record<string, unknown>) }) : undefined
      announce({ text, display, to: to?.id, at_night: args.at_night === true })
      return { text: `Announced on ${to ? to.name : 'every display that is on'}.` }
    }
    if (scheduleTools.some(t => t.name === name)) {
      if (!allowed.announce) return off('announcements')
      return { text: runScheduleTool(name, args) }
    }
    if (alarmTools.some(t => t.name === name)) {
      if (!allowed.alarms) return off('alarms and timers')
      return { text: runAlarmTool(name, args) }
    }
  } catch (err) {
    return name === 'get_weather' ? { isError: true, text: `Couldn't get the weather: ${(err as Error).message}` } : fail(err)
  }
  return undefined
}

/** A reply's room actions, minus what the grown-ups turned off. */
export function allowedActions(actions: unknown): Reply['actions'] {
  const allowed = policy()
  return cleanActions(actions).filter(a => allowed.devices && (allowed.music || a.service !== 'play_music'))
}
