/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
const {execSync} = require('child_process');

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

    try {
        console.time(`⏱ "${testPath}"`);
        execSync(`node --unhandled-rejections=strict ${testPath}`);
        console.log(`✅ "${testPath}" passed`);
    } catch (e) {
        console.log(`🛑 "${testPath}" failed`);
        process.exit(1);
    } finally {
        console.timeEnd(`⏱ "${testPath}"`);
    }
}
