/**
 * Thinking harder: the assistant (Haiku) can hand one question to a bigger, slower model and put its answer in its own
 * words, then carry on as Haiku. The Claude Code brain does it with a one-shot, locked-down `claude -p` (no tools, no
 * settings files, no saved session) on the same subscription; the API brain re-asks the bigger model itself
 * (standalone.ts).
 *
 * Environment:
 *   FROGHUB_BIG_MODEL  the bigger model, or "none" to turn it off (default sonnet; the API brain's default is in standalone.ts)
 */
import { tmpdir } from 'os'

export const THINK_DESCRIPTION =
  'Hand one question to a bigger, cleverer but slower model, for what needs real thought: multi-step maths or ' +
  'homework, a careful explanation, planning something, or a fact you are unsure of. Takes several seconds more. ' +
  'Not for everyday chat, the time, the weather, devices or quick facts.'

const SYSTEM =
  'You are helping Frog Hub, a family smart display, answer a question that needs careful thought. Work it out ' +
  'properly, then give the answer and the key reasoning briefly and plainly (it will be put into a short spoken ' +
  'reply, possibly to a child): a short paragraph at most, no markdown.'

/** The bigger model to use, or '' if it's turned off. */
export function bigModel(fallback: string): string {
  const wanted = (process.env.FROGHUB_BIG_MODEL ?? '').trim()
  return wanted === 'none' ? '' : wanted || fallback
}

/** The bigger model's answer to `question` through `claude -p` (throws if it fails or takes longer than `ms`). */
export async function thinkHarder(question: string, model = bigModel('sonnet'), ms = 25_000): Promise<string> {
  if (!model) throw new Error('Thinking harder is turned off.')
  const proc = Bun.spawn(
    ['claude', '-p', '--model', model, '--restricted', '--tools', '', '--strict-mcp-config', '--no-session-persistence',
      '--system-prompt', SYSTEM, question],
    { cwd: tmpdir(), env: process.env, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' },
  )
  let timer: Timer | undefined
  const late = new Promise<null>(done => { timer = setTimeout(() => done(null), ms) })
  const finished = await Promise.race([Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]), late])
  clearTimeout(timer)
  if (!finished) {
    proc.kill()
    throw new Error(`The bigger model took longer than ${ms / 1000} seconds; answer it yourself.`)
  }
  const [out, err, code] = finished
  if (code !== 0 || !out.trim()) throw new Error(`The bigger model failed (${(err || out).trim().slice(0, 200) || `exit ${code}`}); answer it yourself.`)
  return out.trim()
}
