const {getAllInitiators} = require('../../helpers/initiators');
const assert = require('assert');

const input = {
    type: 'bla',
    url: 'https://example.com/a.js',
    lineNumber: 1,
    stack: {
        callFrames: [
            {
                functionName: 'b',
                lineNumber: 1,
                columnNumber: 1,
                scriptId: '1',
                url: 'https://example.com/b.js'
            },
            {
                functionName: 'c',
                lineNumber: 1,
                columnNumber: 1,
                scriptId: '2',
                url: 'https://example.com/c.js'
            }
        ],
        parent: {
            callFrames: [
                {
                    functionName: 'd',
                    lineNumber: 1,
                    columnNumber: 1,
                    scriptId: '3',
                    url: 'https://example.com/d.js'
                },
                {
                    functionName: 'e',
                    lineNumber: 1,
                    columnNumber: 1,
                    scriptId: '4',
                    url: 'https://example.com/e.js'
                }
            ]
        }
    }
};

const output = getAllInitiators(input);

assert(output instanceof Set, 'Output is a Set');
assert.deepEqual(Array.from(output), [
    'https://example.com/a.js',
    'https://example.com/b.js',
    'https://example.com/c.js',
    'https://example.com/d.js',
    'https://example.com/e.js'
], 'All initiators were extracted and are in the right order.');