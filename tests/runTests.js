/* eslint-disable no-console, no-process-env */
const path = require('path');
const fs = require('fs');
const {execSync} = require('child_process');
const MAX_ATTEMPTS = process.env.CI ? 3 : 1;

/**
 * @param {string} startPath
 */
function fromDir(startPath) {
    const files = fs.readdirSync(startPath);
    const tests = [];

    for (let i = 0; i < files.length; i++) {
        const filename = path.join(startPath, files[i]);
        const stat = fs.lstatSync(filename);
        if (stat.isDirectory()) {
            fromDir(filename).forEach(t => tests.push(t));
        } else if (filename.indexOf('.test.js') >= 0) {
            tests.push(filename);
        }
    }

    return tests;
}

const tests = fromDir('./');

for (const testPath of tests) {
    console.log(`\nRunning "${testPath}"…`);
    let attempt = 1;
    while (attempt <= MAX_ATTEMPTS) {
        try {
            console.time(`⏱ "${testPath}"`);
            execSync(`node --unhandled-rejections=strict ${testPath}`);
            console.log(`✅ "${testPath}" passed`);
            break;
        } catch (e) {
            console.log(`🛑 "${testPath}" failed, attempt ${attempt} / ${MAX_ATTEMPTS}`);
            if (attempt >= MAX_ATTEMPTS) {
                process.exit(1);
            } else {
                attempt++;
            }
        } finally {
            console.timeEnd(`⏱ "${testPath}"`);
        }
    }
}
