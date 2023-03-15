const stack = (new Error()).stack;
if (typeof stack === "string") {
    const lines = stack.split('\n');
    const STACK_SOURCE_REGEX = /(\()?(https?:\/\/([^)/]+)[^)]*):[0-9]+:[0-9]+(\))?/i;
    const JQUERY_REGEX = /jquery/i;
    const REACT_REGEX = /react/i;
    let url = null;
    let jqueryDomain = '';
    let reactDomain = '';

    for (let line of lines) {
        const lineData = line.match(STACK_SOURCE_REGEX);

        if (lineData) {
            if (JQUERY_REGEX.test(line)) {
                jqueryDomain = lineData[3];
                continue;
            }
            if (REACT_REGEX.test(line)) {
                reactDomain = lineData[3];
                continue;
            }
            url = lineData[2];
            break;
        }
    }

    if (url || SAVE_ARGUMENTS) {
        const data = {
            description: 'DESCRIPTION',
            stack,
            url,
            args: ARGUMENT_COLLECTION,
            jqueryDomain,
            reactDomain,
        };
        window.registerAPICall(JSON.stringify(data));
    }

    if (!url) {
        shouldPause = true;
    }
} else {
    shouldPause = true;
}
