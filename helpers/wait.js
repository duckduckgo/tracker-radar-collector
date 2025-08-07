class TimeoutError extends Error {}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} maxMs
 * @param {string} timeoutMessage
 * @returns {Promise<T>}
 */
function wait(promise, maxMs, timeoutMessage = 'Operation timed out') {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new TimeoutError(timeoutMessage));
        }, maxMs);

        promise
            .then((result) => {
                clearTimeout(timeout);
                resolve(result);
            })
            .catch((e) => {
                clearTimeout(timeout);
                reject(e);
            });
    });
}

module.exports = {
    TimeoutError,
    wait,
};
