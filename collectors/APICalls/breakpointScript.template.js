// @ts-nocheck
/* eslint-disable no-undef */
const stack = (new Error()).stack;
if (typeof stack === "string") {
    const lines = stack.split('\n');
    const STACK_SOURCE_REGEX = /(\()?(https?:[^)]+):[0-9]+:[0-9]+(\))?/i;
    let url = null;

    for (let line of lines) {
        const lineData = line.match(STACK_SOURCE_REGEX);

        if (lineData) {
            url = lineData[2];
            break;
        }
    }

    if (url || SAVE_ARGUMENTS) {
        const data = {
            description: 'DESCRIPTION',
            stack,
            url,
            ARGUMENT_COLLECTION
        };
        window.registerAPICall(JSON.stringify(data));
    }

    if (!url) {
        shouldPause = true;
    }
} else {
    shouldPause = true;
}
