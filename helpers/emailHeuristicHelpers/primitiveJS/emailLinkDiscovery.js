(() => {

    // ── Config ────────────────────────────────────────────────────────────

    /**
     * Multilingual keywords matched against link TEXT (anchor text, aria-label).
     * Grouped by intent so you can maintain them independently.
     */
    const TEXT_KEYWORDS = {

        // ── Auth / account ────────────────────────────────────────────────
        login: [
            // English
            'log in', 'login', 'log-in', 'sign in', 'signin', 'sign-in',
            // Spanish
            'iniciar sesión', 'entrar', 'acceder', 'ingresar',
            // French
            "se connecter", "connexion", "s'identifier",
            // German
            'anmelden', 'einloggen', 'einloggen',
            // Portuguese
            'entrar', 'iniciar sessão',
            // Italian
            'accedi', 'accesso',
            // Japanese
            'ログイン', 'サインイン', 'ログイン',
            // Chinese (simplified + traditional)
            '登录', '登入', '登陆',
            // Korean
            '로그인',
            // Arabic
            'تسجيل الدخول', 'دخول',
            // Russian
            'войти', 'вход',
            // Uzbek
            'kirish',
            // Turkish
            'giriş', 'oturum aç',
            // Dutch
            'inloggen', 'aanmelden',
            // Polish
            'zaloguj', 'logowanie',
            // Swedish / Norwegian / Danish
            'logga in', 'logg inn', 'log ind',
        ],

        register: [
            // English
            'register', 'registration', 'sign up', 'signup', 'sign-up',
            'create account', 'create an account', 'get started', 'join',
            // Spanish
            'registrarse', 'registrar', 'crear cuenta', 'únete',
            // French
            "s'inscrire", 'inscription', 'créer un compte',
            // German
            'registrieren', 'konto erstellen', 'anmeldung', 'mitmachen',
            // Portuguese
            'cadastrar', 'cadastro', 'criar conta', 'inscrever',
            // Italian
            'registrati', 'iscrizione', 'crea account',
            // Japanese
            '登録', '会員登録', 'サインアップ', 'アカウント作成',
            // Chinese
            '注册', '注冊', '立即注册',
            // Korean
            '회원가입', '가입하기', '가입',
            // Arabic
            'تسجيل', 'إنشاء حساب', 'انضم',
            // Russian
            'зарегистрироваться', 'регистрация', 'создать аккаунт',
            // Uzbek
            "ro'yxatdan o'tish",
            // Turkish
            'kayıt ol', 'üye ol', 'hesap oluştur',
            // Dutch
            'registreren', 'aanmaken', 'inschrijven',
            // Polish
            'rejestracja', 'zarejestruj',
            // Swedish / Norwegian / Danish
            'registrera dig', 'registrer deg', 'tilmeld',
        ],

        subscribe: [
            // English
            'subscribe', 'subscription', 'newsletter', 'mailing', 'mailing list',
            'email updates', 'alerts', 'updates', 'notify me', 'waitlist',
            // Spanish
            'suscribirse', 'suscripción', 'boletín', 'novedades',
            // French
            "s'abonner", 'abonnement', 'lettre d\'information', 'newsletter',
            // German
            'abonnieren', 'newsletter', 'benachrichtigungen',
            // Portuguese
            'assinar', 'assine', 'boletim', 'newsletter',
            // Italian
            'iscriviti', 'abbonati', 'newsletter',
            // Japanese
            'メルマガ', 'ニュースレター', '登録する', '購読',
            // Chinese
            '订阅', '訂閱',
            // Korean
            '구독', '뉴스레터',
            // Arabic
            'اشتراك', 'النشرة البريدية',
            // Russian
            'подписаться', 'рассылка', 'новости',
            // Turkish
            'abone ol', 'bülten',
            // Dutch
            'abonneren', 'nieuwsbrief',
            // Polish
            'subskrybuj', 'newsletter',
        ],

        contact: [
            // English
            'contact', 'contact us', 'get in touch',
            // Spanish
            'contacto', 'contáctanos',
            // French
            'contact', 'nous contacter',
            // German
            'kontakt', 'kontaktieren',
            // Portuguese
            'contato', 'fale conosco',
            // Italian
            'contattaci', 'contatto',
            // Japanese
            'お問い合わせ', 'お問合せ', 'コンタクト',
            // Chinese
            '联系我们', '聯絡我們',
            // Korean
            '문의', '연락하기',
            // Arabic
            'اتصل بنا', 'تواصل معنا',
            // Russian
            'контакты', 'связаться',
            // Turkish
            'iletişim',
            // Dutch
            'contact', 'neem contact op',
            // Polish
            'kontakt', 'skontaktuj się',
        ],

        member: [
            // English
            'member', 'membership', 'account',
            // Spanish
            'miembro', 'membresía', 'cuenta',
            // French
            'membre', 'adhésion', 'compte',
            // German
            'mitglied', 'mitgliedschaft', 'konto',
            // Portuguese
            'membro', 'associação', 'conta',
            // Italian
            'membro', 'iscritto', 'account',
            // Japanese
            '会員', 'メンバー', 'アカウント',
            // Chinese
            '会员', '會員',
            // Korean
            '회원', '멤버',
            // Arabic
            'عضو', 'عضوية', 'حساب',
            // Russian
            'участник', 'членство', 'аккаунт',
            // Turkish
            'üye', 'üyelik', 'hesap',
        ],
    };

    /**
     * URL PATH keywords matched against the href pathname + search.
     * These are slug-style words that appear in URLs (no spaces, usually ASCII).
     * Kept separate from text keywords because URL slugs follow different conventions.
     *
     * IMPORTANT: Do NOT rely on CSS `i` flag for non-ASCII chars in URLs —
     * but URL slugs are almost always ASCII-transliterated, so this list stays ASCII.
     */
    const PATH_KEYWORDS = [
        // Auth
        'login', 'log-in', 'signin', 'sign-in', 'sign_in',
        'auth', 'oauth', 'sso',
        // Registration
        'register', 'registration', 'signup', 'sign-up', 'sign_up',
        'enroll', 'enroll',
        // Subscribe / newsletter
        'subscribe', 'subscription', 'newsletter', 'mailing',
        'waitlist', 'wait-list',
        // Account
        'account', 'accounts', 'profile', 'join',
        // Contact
        'contact',
        // Localized URL slugs (common ones)
        'anmelden',          // German login
        'registrieren',      // German register
        'inscription',       // French register
        'connexion',         // French login
        'registro',          // Spanish register
        'acceso',            // Spanish login
        'cadastro',          // Portuguese register
        'entrar',            // Portuguese/Spanish login
        'giris',             // Turkish login (ASCII of giriş)
        'uye-ol',            // Turkish register
        'kayit',             // Turkish register (ASCII of kayıt)
        'kirish',            // Uzbek login
        'войти',             // Russian (Cyrillic in URLs, rare but valid)
        'registraciya',      // Russian transliterated
        'abonner',           // French subscribe
        'abonnieren',        // German subscribe
        'inloggen',          // Dutch login
        'registreren',       // Dutch register
        'zaloguj',           // Polish login
        'rejestracja',       // Polish register
        'logga-in',          // Swedish login
        'registrera',        // Swedish register
    ];

    // Flat set of all text keywords for fast lookup
    const ALL_TEXT_KW = Object.values(TEXT_KEYWORDS).flat();

    // ── Helpers ───────────────────────────────────────────────────────────

    /**
     * Check if a string contains any keyword from the list.
     * Uses simple substring match — correct for all Unicode including CJK
     * (CJK has no word boundaries so \b would break).
     */
    function containsAnyKeyword(str, keywords) {
        if (!str) return false;
        const lower = str.toLowerCase();
        return keywords.some(k => lower.includes(k.toLowerCase()));
    }

    /**
     * Get all text signals from an anchor element:
     * - visible text content
     * - aria-label / aria-labelledby
     * - title attribute
     * - alt text of any child <img>
     */
    function anchorTextSignals(a) {
        const parts = [];
        // Visible text
        const t = (a.textContent || '').replace(/\s+/g, ' ').trim();
        if (t) parts.push(t);
        // ARIA
        if (a.getAttribute('aria-label')) parts.push(a.getAttribute('aria-label'));
        const lbId = a.getAttribute('aria-labelledby');
        if (lbId) {
            lbId.trim().split(/\s+/).forEach(id => {
                const el = document.getElementById(id);
                if (el) parts.push((el.textContent || '').trim());
            });
        }
        // Title
        if (a.getAttribute('title')) parts.push(a.getAttribute('title'));
        // Child img alt
        a.querySelectorAll('img[alt]').forEach(img => {
            if (img.alt) parts.push(img.alt);
        });
        return parts.join(' ');
    }

    /**
     * Resolve a URL and return its normalised href (no fragment) or null.
     * Also returns the pathname+search for path-keyword matching.
     */
    function resolveAnchor(a) {
        try {
            const abs = new URL(a.href, location.href);
            const href = abs.href.split('#')[0];
            const path = (abs.pathname + abs.search).toLowerCase();
            return { href, path, origin: abs.origin };
        } catch {
            return null;
        }
    }

    // ── Same-origin check (with subdomain option) ─────────────────────────

    /**
     * Get the registered domain (eTLD+1) from a hostname.
     * e.g. "auth.user.ameba.jp" → "ameba.jp"
     * e.g. "login.emaktab.uz"   → "emaktab.uz"
     *
     * This is a best-effort split on the last two hostname segments.
     * For proper eTLD handling you'd use a public suffix list, but
     * for typical login/auth subdomains this covers 95%+ of cases.
     */
    function registeredDomain(hostname) {
        const parts = hostname.split('.');
        // Handle common two-part TLDs: co.uk, com.br, com.au, co.jp etc.
        const twoPartTLDs = ['co.uk','co.jp','co.nz','co.za','co.kr',
                             'com.br','com.au','com.ar','com.mx',
                             'org.uk','net.uk','ac.uk','gov.uk'];
        const last2 = parts.slice(-2).join('.');
        const last3 = parts.slice(-3).join('.');
        if (twoPartTLDs.includes(last2)) return parts.slice(-3).join('.');
        return parts.slice(-2).join('.');
    }

    const pageDomain = registeredDomain(location.hostname);

    function isSameSite(origin) {
        try {
            const targetDomain = registeredDomain(new URL(origin).hostname);
            return targetDomain === pageDomain;
        } catch {
            return false;
        }
    }

    // ── Main scan ─────────────────────────────────────────────────────────

    const seen = new Set();
    const links = [];

    for (const a of document.querySelectorAll('a[href]')) {
        const resolved = resolveAnchor(a);
        if (!resolved) continue;

        const { href, path, origin } = resolved;

        // FIX 3: allow auth subdomains on the same registered domain,
        // not just same origin (fixes auth.user.ameba.jp, login.emaktab.uz)
        if (!isSameSite(origin)) continue;

        if (seen.has(href)) continue;

        // FIX 1 + 2: match against multilingual text AND localised URL path slugs
        const textSignal = anchorTextSignals(a);
        const matchesText = containsAnyKeyword(textSignal, ALL_TEXT_KW);
        const matchesPath = containsAnyKeyword(path, PATH_KEYWORDS);

        if (!matchesText && !matchesPath) continue;

        seen.add(href);
        links.push({
            href,
            // Expose which signal matched — useful for debugging
            matchedOn: matchesText ? 'text' : 'path',
            text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        });
    }

    // Return just hrefs to match original API, or return full objects for debugging:
    // return links;
    return links.map(l => l.href);
})();