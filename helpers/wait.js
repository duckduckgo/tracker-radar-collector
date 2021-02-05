/**
 * @param {Promise<any>} promise 
 * @param {number} maxMs 
 */
function wait(promise, maxMs) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Operation timed out'));
        }, maxMs);

        promise.then(result => {
            clearTimeout(timeout);
            resolve(result);
        }).catch(e => reject(e));
    });
}

module.exports = wait;