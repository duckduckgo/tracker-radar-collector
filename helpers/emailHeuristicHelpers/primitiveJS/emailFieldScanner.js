(async () => {
    // ── Helpers ──────────────────────────────────────────────────────────────

    /** Return the visible text of an element, collapsed and lowercased. */
    function visibleText(el) {
        if (!el) return '';
        return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    /** True if the element occupies space in the layout. */
    function isVisible(el) {
        try {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        } catch {
            return false;
        }
    }

    /** Build an EmailFieldMeta object for one input element. */
    function emailFieldMeta(input, index) {
        return {
            index,
            name: input.name || '',
            id: input.id || '',
            placeholder: input.placeholder || '',
            autocomplete: input.autocomplete || '',
            visible: isVisible(input),
        };
    }

    /**
     * True if the input is, or looks like, an email field.
     * Matches type=email explicitly, or name/id/placeholder/autocomplete
     * containing the word "email" as a whole word.
     */
    function isEmailInput(input) {
        const type = (input.type || '').toLowerCase();
        if (type === 'email') return true;
        const hint = [input.name, input.id, input.placeholder, input.autocomplete].join(' ').toLowerCase();
        return /\bemail\b/.test(hint);
    }

    // ── Scan document.forms ───────────────────────────────────────────────────
    const results = [];

    Array.from(document.forms).forEach((form, formIndex) => {
        const inputs = Array.from(form.elements).filter((el) => el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');

        const emailFields = inputs.map((el, i) => (isEmailInput(el) ? emailFieldMeta(el, i) : null)).filter(Boolean);

        if (emailFields.length === 0) return;

        const hasPassword = inputs.some((el) => (el.type || '').toLowerCase() === 'password');

        const submitEls = Array.from(form.querySelectorAll('button[type=submit], input[type=submit], button:not([type]), [role=button]'));

        results.push({
            formIndex,
            action: form.action || '',
            method: form.method || '',
            id: form.id || '',
            classes: form.className || '',
            labels: [visibleText(form)].filter(Boolean),
            inputSummary: inputs.map((el) => (el.type || el.tagName).toLowerCase() + ':' + (el.name || el.id || '')),
            hasPassword,
            submitTexts: submitEls.map((el) => visibleText(el)).filter(Boolean),
            emailFields,
        });
    });

    // ── Orphan email inputs (not inside any <form>) ───────────────────────────

    const allEmailInputs = Array.from(
        document.querySelectorAll(
            'input[type=email], ' + 'input[name*=email i], ' + 'input[id*=email i], ' + 'input[placeholder*=email i]',
        ),
    );

    const inForm = new Set(Array.from(document.forms).flatMap((f) => Array.from(f.elements)));

    const orphans = allEmailInputs.filter((el) => !inForm.has(el));

    if (orphans.length > 0) {
        results.push({
            formIndex: -1,
            action: '',
            method: '',
            id: '',
            classes: '',
            labels: [],
            inputSummary: orphans.map((el) => 'email:' + (el.name || el.id || '')),
            hasPassword: false,
            submitTexts: [],
            emailFields: orphans.map((el, i) => emailFieldMeta(el, i)),
        });
    }

    return results;
})();
