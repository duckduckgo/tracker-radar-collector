/**
 * @template T
 * @returns {Deferred<T>}
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

/**
 * @template T
 * @typedef {{promise: Promise<T>, resolve: (value: T) => void, reject: (value: any) => void}} Deferred
 */

module.exports = createDeferred;