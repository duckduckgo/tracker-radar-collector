/**
 * @param {import('devtools-protocol').Protocol.Runtime.StackTrace} stack
 * @returns {string[]}
 */
function getInitiatorsFromStack(stack) {
    /**
     * @type {string[]}
     */
    const currentInitiators = [];
    /**
     * @type {string[]}
     */
    let parentInitiators = [];

    stack.callFrames.forEach(frame => {
        if (frame.url) {
            currentInitiators.push(frame.url);
        }
    });

    if (stack.parent) {
        parentInitiators = getInitiatorsFromStack(stack.parent);
    }

    return currentInitiators.concat(parentInitiators);
}

/**
 * @param {import('devtools-protocol').Protocol.Network.Initiator} initiator
 * @returns {Set<string>}
 */
function getAllInitiators(initiator) {
    const allInitiators = new Set();

    if (!initiator) {
        return allInitiators;
    }

    if (initiator.url) {
        allInitiators.add(initiator.url);
    }

    if (initiator.stack) {
        getInitiatorsFromStack(initiator.stack)
            .forEach(url => allInitiators.add(url));
    }

    return allInitiators;
}

module.exports = {
    getAllInitiators
};
