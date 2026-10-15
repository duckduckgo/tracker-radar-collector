const assert = require('assert');
const {
    FRAME_LLM_MODEL,
    FRAME_LLM_PROMPT,
    POPUP_LLM_MODEL,
    POPUP_LLM_PROMPT,
    checkHeuristicPatterns,
    classifyButtonTextRegex,
    classifyButtons,
    classifyFrameTextLLM,
    classifyFrameTextRegex,
    classifyPopupTextLLM,
    classifyPopupTextRegex,
    cleanButtonText,
    isRejectButton,
    shouldClassifyFrame,
} = require('../../post-processing/generate-autoconsent-rules/detection');

// Patterns and their accuracy are tested in autoconsent; these only check the wiring to @duckduckgo/autoconsent/heuristics.
describe('detection', () => {
    it('detects cookie popup text', () => {
        assert.strictEqual(checkHeuristicPatterns('We use cookies to improve your experience'), true);
        assert.strictEqual(checkHeuristicPatterns('Sign up for our newsletter'), false);
    });

    it('classifies button texts', () => {
        assert.strictEqual(classifyButtonTextRegex('Reject all'), 'reject');
        assert.strictEqual(classifyButtonTextRegex('Accept all'), 'accept');
        assert.strictEqual(classifyButtonTextRegex('Cookie settings'), 'settings');
        assert.strictEqual(classifyButtonTextRegex('Got it'), 'acknowledge');
        assert.strictEqual(isRejectButton('Reject all'), true);
        assert.strictEqual(cleanButtonText('  Reject\nALL  '), 'reject all');
    });

    it('splits buttons into reject and other', () => {
        const reject = { text: 'Reject all', selector: '#reject' };
        const accept = { text: 'Accept all', selector: '#accept' };
        assert.deepStrictEqual(classifyButtons([reject, accept]), { rejectButtons: [reject], otherButtons: [accept] });
    });

    it('applies the popup exclusions only at popup level', () => {
        const ageGate = 'You must be 18 or older to enter. We use cookies to improve your experience.';
        assert.strictEqual(classifyPopupTextRegex(ageGate), false);
        assert.strictEqual(classifyFrameTextRegex(ageGate), true);
    });

    it('skips iframes without buttons', () => {
        assert.strictEqual(shouldClassifyFrame({ cleanedText: 'text', isTop: true, buttons: [] }), true);
        assert.strictEqual(shouldClassifyFrame({ cleanedText: 'text', isTop: false, buttons: [] }), false);
        assert.strictEqual(shouldClassifyFrame({ cleanedText: 'text', isTop: false, buttons: [{}] }), true);
        assert.strictEqual(shouldClassifyFrame({ cleanedText: '', isTop: true, buttons: [{}] }), false);
    });

    describe('LLM classifiers', () => {
        /**
         * @param {boolean | Error} result
         */
        function fakeOpenAI(result) {
            /** @type {any[]} */
            const requests = [];
            const openai = {
                beta: {
                    chat: {
                        completions: {
                            /** @param {any} request */
                            parse: async (request) => {
                                requests.push(request);
                                if (result instanceof Error) {
                                    throw result;
                                }
                                return { choices: [{ message: { parsed: { isCookieConsentNotice: result } } }] };
                            },
                        },
                    },
                },
            };
            return { openai: /** @type {any} */ (openai), requests };
        }

        it('uses the production model and prompt by default', async () => {
            const popup = fakeOpenAI(true);
            assert.strictEqual(await classifyPopupTextLLM(popup.openai, 'popup text'), true);
            assert.strictEqual(await classifyPopupTextLLM(popup.openai, '  popup text \n'), true);
            assert.strictEqual(popup.requests[1].messages[1].content, 'popup text');
            assert.strictEqual(popup.requests[0].model, POPUP_LLM_MODEL);
            assert.strictEqual(POPUP_LLM_MODEL, 'gpt-4o-mini');
            assert.strictEqual(popup.requests[0].messages[0].content, POPUP_LLM_PROMPT);
            assert.strictEqual('temperature' in popup.requests[0], false);

            const frame = fakeOpenAI(false);
            assert.strictEqual(await classifyFrameTextLLM(frame.openai, 'frame text'), false);
            assert.strictEqual(frame.requests[0].model, FRAME_LLM_MODEL);
            assert.strictEqual(FRAME_LLM_MODEL, 'gpt-4.1-nano-2025-04-14');
            assert.strictEqual(frame.requests[0].messages[0].content, FRAME_LLM_PROMPT);
            assert.strictEqual(frame.requests[0].messages[1].content, 'frame text');
        });

        it('accepts model, prompt and temperature overrides', async () => {
            const { openai, requests } = fakeOpenAI(true);
            await classifyFrameTextLLM(openai, 'text', { model: 'other-model', systemPrompt: 'prompt', temperature: 0 });
            assert.strictEqual(requests[0].model, 'other-model');
            assert.strictEqual(requests[0].messages[0].content, 'prompt');
            assert.strictEqual(requests[0].temperature, 0);
        });

        it('returns false on API errors unless throwOnError is set', async () => {
            const { openai } = fakeOpenAI(new Error('rate limited'));
            const consoleError = console.error;
            console.error = () => {};
            try {
                assert.strictEqual(await classifyPopupTextLLM(openai, 'text'), false);
            } finally {
                console.error = consoleError;
            }
            await assert.rejects(classifyPopupTextLLM(openai, 'text', { throwOnError: true }), /rate limited/);
        });
    });
});
