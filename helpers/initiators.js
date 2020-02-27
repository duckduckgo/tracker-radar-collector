/**
 * @param {{ callFrames: StackFrame[]; parent: any; }} stack
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
 * @param {RequestInitiator} initiator
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

/**
 * @typedef {object} RequestInitiator
 * @property {string} type
 * @property {{callFrames: StackFrame[], parent: object}=} stack
 * @property {string=} url
 * @property {number=} lineNumber
 */

/**
 * @typedef {object} StackFrame
 * @property {string} functionName
 * @property {string} scriptId
 * @property {string} url
 * @property {number} lineNumber
 * @property {number} columnNumber
 */