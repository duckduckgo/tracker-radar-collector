/**
 * @returns {{promise: Promise, resolve: function, reject: function}}
 */
function createDeferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => {resolve = res; reject = rej;});

    return {
        promise,
        resolve,
        reject
    };
}

module.exports = createDeferred;