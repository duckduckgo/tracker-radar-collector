const wait = require('../../helpers/wait');
const assert = require('assert');

const p = wait(Promise.resolve('x'), 1000)
    .then(d => assert(d === 'x',  `Promise doesn't resovle with expected data (${d})`))
    .catch(() => assert(false, 'Wait failed'));

assert(p instanceof Promise, 'wait returns a promise');

const p2 = wait(new Promise(() => {}), 10)
    .then(() => assert(false, 'Promise unexpectedly resovled'))
    .catch(e => assert(e.message === 'Operation timed out', `Unexpected timeout error (${e.message})`));

const p3 = wait(Promise.reject(new Error('rejected')), 1000)
    .then(() => assert(false, 'Promise unexpectedly resovled'))
    .catch(e => assert(e.message === 'rejected', `Unexpected error (${e})`));

Promise.all([p, p2, p3]);
