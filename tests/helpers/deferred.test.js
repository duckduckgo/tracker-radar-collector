const createDeferred = require('../../helpers/deferred');
const assert = require('assert');

const one = createDeferred();

assert(one.promise instanceof Promise, 'deferred.promise is a Promise');
assert(one.resolve instanceof Function, 'deferred.resolve is a function');
assert(one.reject instanceof Function, 'deferred.reject is a function');

const original = {};

one.promise.then(data => {
    assert(data === original, `deferred.resolve returns data (data: ${data})`);
}).catch(e => {
    assert(false, `deferred.resolve failed (${e})`);
});

one.resolve(original);
one.reject(); // should be a noop

const two = createDeferred();

two.promise.then(() => {
    assert(false, `deferred.reject failed`);
}).catch(error => {
    assert(error === original, `deferred.reject returns data (data: ${error})`);
});

two.reject(original);
two.resolve(); // should be a noop

Promise.all([one, two]);
