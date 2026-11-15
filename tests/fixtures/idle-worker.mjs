#!/usr/bin/env node
process.stdout.write('diagnostic output '.repeat(8192));
process.stderr.write('diagnostic error '.repeat(8192));
setInterval(() => {}, 1000);
