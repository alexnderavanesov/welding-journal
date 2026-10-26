import { runPlaywright } from '../playwright-process'
process.exitCode = await runPlaywright(['--config', 'e2e/lifecycle.config.ts'])
