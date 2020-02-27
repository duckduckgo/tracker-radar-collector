const {filterHeaders, normalizeHeaders} = require('../../helpers/headers');
const assert = require('assert');

const input = {
    ' set-cookie': 'a',
    'referer ': 'b',
    'USER-AGENT': 'c'
};

const normalized = normalizeHeaders(input);

assert(normalized['set-cookie'] === input[' set-cookie'], 'name was trimmed and value preserved - 1');
assert(normalized.referer === input['referer '], 'name was trimmed and value preserved - 2');
assert(normalized['user-agent'] === input['USER-AGENT'], 'name was changed to lower-case and value preserved');

const filtered1 = filterHeaders(input, ['user-agent']);

assert(Object.keys(filtered1).length === 1, 'Filtering removed entries that do not match.');
assert(filtered1['USER-AGENT'] === input['USER-AGENT'], 'Filtering kept entries that match.');

const filtered2 = filterHeaders(normalized, ['set-cookie', 'user-agent', 'referer']);

assert.deepEqual(Object.keys(filtered2), ['referer', 'set-cookie', 'user-agent'], `Filtering sorted entries. ${Object.keys(filtered2)}`);
