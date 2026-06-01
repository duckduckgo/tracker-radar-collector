/**
 * @param {Array<number>} hrtime
 * @returns {string}
 */
function parseHrtimeToSeconds(hrtime) {
    return (hrtime[0] + hrtime[1] / 1e9).toFixed(3);
}

function createTimer() {
    const startTime = process.hrtime();

    return {
        getElapsedTime: () => parseHrtimeToSeconds(process.hrtime(startTime)),
        getElapsedTimeMs: () => {
            const hrtime = process.hrtime(startTime);
            return hrtime[0] * 1000 + hrtime[1] / 1e6;
        },
    };
}

module.exports = {
    createTimer,
};
