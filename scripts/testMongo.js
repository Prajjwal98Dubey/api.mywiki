// npm run test:mongo
//
// Runs the whole test suite against MongoDB instead of the JSON files. Each test file
// creates (and drops) its own mywiki_test_<random> database on TEST_MONGODB_URI, or
// MONGODB_URI when that is not set. Use a dev cluster — never point this at production data.

import { spawn } from 'node:child_process';

if (!process.env.TEST_MONGODB_URI && !process.env.MONGODB_URI) {
  console.error('Set TEST_MONGODB_URI (or MONGODB_URI in .env) to run the suite against MongoDB.');
  process.exit(1);
}

const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, TEST_STORAGE_DRIVER: 'mongo' },
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
