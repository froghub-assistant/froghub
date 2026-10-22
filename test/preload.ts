// Loaded before every test file (bunfig.toml). A plain `bun test` would use the real ~/.config/froghub, so refuse.
import { homedir } from 'os'

if (!process.env.FROGHUB_TEST_HOME || homedir() !== process.env.FROGHUB_TEST_HOME) {
  throw new Error('Run the tests with `bun run test`: it gives them their own HOME, away from the real settings.')
}
