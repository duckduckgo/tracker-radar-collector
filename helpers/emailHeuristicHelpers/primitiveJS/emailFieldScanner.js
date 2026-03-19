(async () => {

    // ── Config ────────────────────────────────────────────────────────────

    /**
     * "Login-style" field names/ids that are generic credential fields —
     * they accept email as one of the valid inputs even though they say "login".
     * Treat them as candidate email fields and let context decide.
     */
    const LOGIN_FIELD_PATTERNS = [
        /^login$/i, /^username$/i, /^user$/i,
        /^account$/i, /^accountname$/i,
        /^credential$/i, /^identifier$/i,
        /^логин$/i, /^пользователь/i,         // Russian
        /^kirish$/i,                            // Uzbek "entrance/login"
    ];

    /**
     * Multilingual email keywords for attribute-level matching.
     * IMPORTANT: Do NOT rely on CSS `i` flag for non-ASCII — do JS matching instead.
     */
    const EMAIL_ATTR_KEYWORDS = [
        'email', 'e-mail', 'mail',
        'correo', 'courriel',
        'eposta', 'e-posta',
        'почта', 'эл.почта',
    ];

    /**
     * Regex patterns for label / placeholder / visible text matching.
     * These handle multi-word phrases and non-ASCII scripts.
     */
    const EMAIL_TEXT_PATTERNS = [
        /\bemail\b/i, /\be-mail\b/i,
        /correo\s+electr[oó]nico/i,
        /adresse\s+e-?mail/i,
        /e-mail-adresse/i,
        /indirizzo\s+e-?mail/i,
        /endere[cç]o\s+de\s+e-?mail/i,
        /e-?mailadres/i,
        /adres\s+e-mail/i,
        /электронн\w*\s*почт/i,
        /эл\.?\s*почт/i,
        // Japanese — メール or メールアドレス anywhere in the string
        /メール/,
        // Chinese
        /邮[箱件地址]/,
        /電郵/,
        // Korean
        /이메일/,
        // Arabic
        /البريد\s+الإلكتروني/,
        /بريد\s+إلكتروني/,
    ];

    // ── Helpers ───────────────────────────────────────────────────────────

    function visibleText(el) {
        if (!el) return '';
        return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function isVisible(el) {
        try {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        } catch { return false; }
    }

    function emailFieldMeta(input, index, reason) {
        return {
            index,
            name: input.name || '',
            id: input.id || '',
            placeholder: input.placeholder || '',
            autocomplete: input.autocomplete || '',
            visible: isVisible(input),
            detectionReason: reason,   // ← helps you debug which rule fired
        };
    }

    /** Get the associated label text for an input via all standard methods. */
    function getLabelText(input) {
        if (input.getAttribute('aria-label')) return input.getAttribute('aria-label');
        const lbId = input.getAttribute('aria-labelledby');
        if (lbId) {
            const parts = lbId.trim().split(/\s+/)
                .map(id => document.getElementById(id))
                .filter(Boolean)
                .map(el => visibleText(el));
            if (parts.length) return parts.join(' ');
        }
        if (input.id) {
            const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
            if (label) return visibleText(label);
        }
        const wrapping = input.closest('label');
        if (wrapping) return visibleText(wrapping);
        // Nearest preceding text node / sibling label
        const parent = input.parentElement;
        if (parent) {
            const sibLabel = parent.querySelector('label');
            if (sibLabel) return visibleText(sibLabel);
            return visibleText(parent);
        }
        return '';
    }

    /** JS-side attribute keyword check (avoids broken CSS `i` flag on non-ASCII). */
    function attrMatchesEmail(str) {
        if (!str) return false;
        const low = str.toLowerCase();
        return EMAIL_ATTR_KEYWORDS.some(k => low.includes(k));
    }

    /** Check any freeform text (label, placeholder, aria) against multilingual patterns. */
    function textMatchesEmail(str) {
        if (!str) return false;
        return EMAIL_TEXT_PATTERNS.some(re => re.test(str));
    }

    /**
     * Main classifier. Returns a reason string if the input looks like an email
     * field, or null if it doesn't.
     *
     * Order of precedence (most → least explicit):
     *   1. type="email"
     *   2. autocomplete contains "email"
     *   3. name/id attributes contain an email keyword
     *   4. placeholder text matches email pattern
     *   5. Associated label text matches email pattern
     *   6. name/id matches a generic LOGIN_FIELD_PATTERN AND there's no
     *      separate dedicated email field in the same form — caller decides this.
     */
    function emailInputReason(input) {
        const type = (input.type || '').toLowerCase();
        if (type === 'email') return 'type=email';

        const ac = (input.autocomplete || '').toLowerCase();
        if (ac.includes('email') || ac === 'username') return 'autocomplete';

        if (attrMatchesEmail(input.name) || attrMatchesEmail(input.id))
            return 'attr-name/id';

        const ph = input.placeholder || '';
        if (attrMatchesEmail(ph) || textMatchesEmail(ph))
            return 'placeholder';

        const labelText = getLabelText(input);
        if (textMatchesEmail(labelText))
            return 'label-text';

        // Generic "login" field — flag it but mark reason so caller can filter
        if (LOGIN_FIELD_PATTERNS.some(re =>
            re.test(input.name) || re.test(input.id) || re.test(ph) || re.test(labelText)
        )) return 'login-field';

        return null;
    }

    // ── Build orphan selector (ASCII keywords only — CSS `i` flag is ASCII-only) ──
    function buildOrphanSelector() {
        const attrChecks = EMAIL_ATTR_KEYWORDS.flatMap(k => [
            `input[name*="${k}" i]`,
            `input[id*="${k}" i]`,
            `input[placeholder*="${k}" i]`,
        ]);
        return ['input[type=email]', ...attrChecks].join(', ');
    }

    // ── Scan document.forms ───────────────────────────────────────────────
    const results = [];

    Array.from(document.forms).forEach((form, formIndex) => {
        const inputs = Array.from(form.elements).filter(
            el => el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
        );

        const classified = inputs.map((el, i) => {
            const reason = emailInputReason(el);
            return reason ? { meta: emailFieldMeta(el, i, reason), reason } : null;
        }).filter(Boolean);

        if (classified.length === 0) return;

        // If a proper email field (reason !== 'login-field') exists, drop bare login fields
        const hasProperEmail = classified.some(c => c.reason !== 'login-field');
        const emailFields = hasProperEmail
            ? classified.filter(c => c.reason !== 'login-field').map(c => c.meta)
            : classified.map(c => c.meta);  // only login-type fields found, keep them

        const hasPassword = inputs.some(el => (el.type || '').toLowerCase() === 'password');
        const submitEls = Array.from(
            form.querySelectorAll('button[type=submit], input[type=submit], button:not([type]), [role=button]')
        );

        results.push({
            formIndex,
            action: form.action || '',
            method: form.method || '',
            id: form.id || '',
            classes: form.className || '',
            labels: [visibleText(form)].filter(Boolean),
            inputSummary: inputs.map(el => (el.type || el.tagName).toLowerCase() + ':' + (el.name || el.id || '')),
            hasPassword,
            submitTexts: submitEls.map(el => visibleText(el)).filter(Boolean),
            emailFields,
        });
    });

    // ── Orphan inputs ─────────────────────────────────────────────────────
    const inForm = new Set(Array.from(document.forms).flatMap(f => Array.from(f.elements)));

    // CSS selector handles ASCII keywords
    const orphanCandidates = new Set(
        Array.from(document.querySelectorAll(buildOrphanSelector()))
    );

    // JS pass handles non-ASCII (Japanese, Arabic, CJK, etc.) and label-text matches
    document.querySelectorAll('input:not([type=hidden])').forEach(input => {
        if (!inForm.has(input) && emailInputReason(input)) {
            orphanCandidates.add(input);
        }
    });

    const orphans = [...orphanCandidates].filter(el => !inForm.has(el));

    if (orphans.length > 0) {
        results.push({
            formIndex: -1,
            action: '', method: '', id: '', classes: '',
            labels: [],
            inputSummary: orphans.map(el => 'email:' + (el.name || el.id || '')),
            hasPassword: false,
            submitTexts: [],
            emailFields: orphans.map((el, i) => {
                const reason = emailInputReason(el) || 'selector';
                return emailFieldMeta(el, i, reason);
            }),
        });
    }

    return results;
})();