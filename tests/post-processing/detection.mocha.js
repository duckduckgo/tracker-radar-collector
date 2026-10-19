const assert = require('assert');
const {
    checkHeuristicPatterns,
    classifyButtonTextRegex,
    classifyButtons,
    cleanButtonText,
    isRejectButton,
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

    it('drops page text next to an age gate', () => {
        const ageGate = 'You must be 18 or older to enter. We use cookies to improve your experience.';
        assert.strictEqual(checkHeuristicPatterns(ageGate, 'page'), false);
        // a consent notice with its own controls still counts on the page
        const withBanner = `${ageGate}\nAccept all\nReject all`;
        assert.strictEqual(checkHeuristicPatterns(withBanner, 'page'), true);
    });
});
