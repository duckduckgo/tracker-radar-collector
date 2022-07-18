/**
 * @param {() => Promise<boolean> | boolean} predicate
 * @param {number} maxTimes
 * @param {number} interval
 * @returns {Promise<boolean>}
 */
async function waitFor(predicate, maxTimes, interval) {
    const result = await predicate();
    if (!result && maxTimes > 0) {
        return new Promise(resolve => {
            setTimeout(() => {
                resolve(waitFor(predicate, maxTimes - 1, interval));
            }, interval);
        });
    }
    return Promise.resolve(result);
}


module.exports = waitFor;
