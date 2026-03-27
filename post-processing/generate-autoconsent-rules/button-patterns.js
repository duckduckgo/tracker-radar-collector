const REJECT_PATTERNS_ENGLISH = [
    // e.g. "i reject cookies", "reject all", "reject all cookies", "reject cookies", "deny all", "deny all cookies", "refuse", "refuse all", "refuse cookies", "refuse all cookies", "deny", "reject all and close", "deny all and close", "reject non-essential cookies", "reject all non-essential cookies and continue", "reject optional cookies", "reject additional cookies", "reject targeting cookies", "reject marketing cookies", "reject analytics cookies", "reject tracking cookies", "reject advertising cookies", "reject all and close", "deny all and close"
    // note that "reject and subscribe" and "reject and pay" are excluded
    /^\s*(i)?\s*(reject|deny|refuse|decline|disable)\s*(all)?\s*(non-essential|optional|additional|targeting|analytics|marketing|unrequired|non-necessary|non-functional|extra|tracking|advertising)?\s*(cookies)?\s*$/is,

    // e.g. "i do not accept", "i do not accept cookies", "do not accept", "do not accept cookies"
    /^\s*(i)?\s*do\s+not\s+accept\s*(cookies)?\s*$/is,

    // e.g. "continue without accepting", "continue without agreeing", "continue without agreeing →"
    /^\s*(continue|proceed|continue\s+browsing)\s+without\s+(accepting|agreeing|consent|cookies|tracking)(\s*→)?\s*$/is,

    // e.g. "strictly necessary cookies only", "essential cookies only", "required only", "use necessary cookies only", "essentials only"
    // note that "only" is required
    /^\s*(use|accept|allow|continue\s+with)?\s*(strictly)?\s*(necessary|essentials?|required)?\s*(cookies)?\s*only\s*$/is,

    // e.g. "allow essential cookies", "allow necessary", "allow essentials", "allow essentials only"
    // note that "essential" is required
    /^\s*(use|accept|allow|continue\s+with)?\s*(strictly)?\s*(necessary|essentials?|required)\s*(cookies)?\s*$/is,

    // e.g. "accept only essential cookies", "use only necessary cookies", "allow only essential", "only essentials", "continue with only essential cookies"
    // note that "only" is required
    /^\s*(use|accept|allow|continue\s+with)?\s*only\s*(strictly)?\s*(necessary|essentials?|required)?\s*(cookies)?\s*$/is,

    // e.g. "do not sell or share my personal information", "do not sell my personal information"
    // often used in CCPA
    /^\s*do\s+not\s+sell(\s+or\s+share)?\s*my\s*personal\s*information\s*$/is,

    'allow selection',

    // These are impactful, but look error-prone
    // // e.g. "disagree"
    // /^\s*(i)?\s*disagree\s*(and\s+close)?\s*$/i,
    // // e.g. "i do not agree"
    // /^\s*(i\s+)?do\s+not\s+agree\s*$/i,
];

const REJECT_PATTERNS_DUTCH = [
    'weigeren',
    'alles afwijzen',
    'alleen noodzakelijke cookies',
    'afwijzen',
    'alles weigeren',
    'cookies weigeren',
    'alleen noodzakelijk',
    'weiger',
    'weiger cookies',
    'selectie toestaan',
    'doorgaan zonder te accepteren',
    'alleen functionele cookies',
    'alleen functioneel',
    'alleen noodzakelijke',
    'alleen essentiële cookies',
    'functioneel',
    'alle cookies verwerpen',
    'doorgaan zonder akkoord te gaan',
    'weiger alles',
    'nee, bedankt',
    'alle cookies weigeren',
    'weiger alle cookies',
    'alleen noodzakelijke cookies accepteren',
    'alleen strikt noodzakelijk',
    'ik weiger',
    'optionele cookies weigeren',
    'alle weigeren',
    'accepteer alleen noodzakelijke cookies',
    'alleen functionele cookies accepteren',
    'enkel noodzakelijke cookies',
    'niet accepteren',
    'weiger niet-essentiële cookies',
    'weiger niet-noodzakelijke cookies',
    'wijs alles af',
    'alle cookies afwijzen',
    'alleen vereiste cookies',
    'cookies afwijzen',
    'doorgaan zonder accepteren',
    'hier weigeren',
    'weiger alle',
    'aanvaard enkel essentiële cookies',
    'aanvullende cookies weigeren',
    'accepteren weigeren',
    'alle afwijzen',
    'alle niet functionele afwijzen',
    'alle optionele weigeren',
    'alleen noodzakelijke accepteren',
    'alleen strikt noodzakelijke cookies',
    'allen afwijzen',
    'clear weigeren',
    'enkel functioneel',
    'enkel noodzakelijke cookies aanvaarden',
    'functioneel altijd actief',
    'nee, accepteer alleen de noodzakelijke',
    'nee, geen cookies a.u.b.',
    'nee, weiger cookies',
    'nee, weigeren',
    'niet-noodzakelijke cookies weigeren',
    'optioneel afwijzen',
    'tracking cookies weigeren',
    'weigeren cookies',
    'weigeren?',
    'weigeren.',
    'strikt noodzakelijk',
    'weiger optionele cookies',
    'noodzakelijke cookies',
    'essentiële cookies',
    'ga verder zonder aanvaarden',
    'doorgaan zonder cookies',
    'accepteer noodzakelijke cookies',
    'noodzakelijke',
    'indien je enkel technisch noodzakelijke cookies wenst te accepteren, klik dan hier',
    'weiger',
    'alleen de noodzakelijke cookies',
    'alleen noodzakelijk',
    'alleen verplichte cookies',
    'ik wil alleen minimale cookies',
    'doorgaan zonder te accepteren',
    'geen cookies toestaan',
    'liever geen cookies',
    'nee, geen persoonlijke cookies',
    'nee, liever geen cookies',
    'ga door zonder te accepteren',
    'verder zonder accepteren',
    'essentiële accepteren',
    'functionele cookies',
    'strikt noodzakelijke cookies',
    'alleen basic cookies',
    'alleen basiscookies',
    'alleen standaard cookies',
    'alle cookies verwerpen',
    'noodzakelijk',
    'noodzakelijk cookies accepteren',
    'noodzakelijke cookies accepteren',
    'accepteer alleen noodzakelijk',
    'enkel noodzakelijke toestaan',
    'enkel strikt noodzakelijke cookies',
    'ik wijs ze liever af',
    'ik weiger cookies',
    'ik weiger optionele cookies',
    'weiger alle cookies',
    'weiger alle niet-noodzakelijke cookies',
    'weiger alle onnodige cookies',
    'weiger alle optionele',
    'weiger alles',
    'weiger targeting en third party cookies.',
];

const REJECT_PATTERNS_FRENCH = [
    'continuer sans accepter',
    'tout refuser',
    'refuser',
    'refuser tous les cookies',
    'non merci',
    'interdire tous les cookies',
    'je refuse',
    'refuser tout',
    'tout rejeter',
    'refuser et continuer',
    'rejeter',
    'refuser les cookies',
    'cookies nécessaires uniquement',
    'seulement nécessaires',
    'rejeter tout',
    'refuser les cookies optionnels',
    'je désactive les finalités non essentielles',
    'refuser les cookies non nécessaires',
    'rejeter tous les cookies',
    'cookies essentiels uniquement',
    'nécessaires uniquement',
    'refuser les cookies non essentiels',
    'tout refuser et fermer',
    'tout refuser sauf les cookies techniques',
    'continuer sans accepter x',
    'je refuse lutilisation de cookies',
    'non merci, seulement des cookies techniques',
    'non, tout refuser',
    'refuser tous les cookies non nécessaires',
    'rejeter les cookies',
    'uniquement les essentiels',
    'refuser tous',
    'accepter uniquement les nécessaires',
    'allow anonymous analytics',
    'autoriser les cookies essentiels uniquement',
    'autoriser uniquement les nécessaires',
    'cookies essentiels seulement',
    'cookies nécessaires seulement',
    'cookies techniques uniquement',
    'je préfère les rejeter',
    'je refuse :(',
    'je refuse les cookies',
    'je refuse tous les cookies',
    'je refuse tout',
    'ne pas accepter',
    'non, accepter les nécessaires uniquement',
    'refuser (sauf cookies nécessaires)',
    'refuser ce cookie',
    'refuser les coockies',
    'refuser les cookies facultatifs',
    'refuser tout, sauf les cookies techniques',
    'refuser toutes',
    'refuser toutes les options',
    'rejeter la bannière',
    'rejeter les cookies non essentiels',
    'rejeter les cookies optionnels',
    'rejeter tous les non fonctionnels',
    'rejeter tout optionnel',
    'tout refuser, sauf les cookies techniques',
    'uniquement nécessaires',
    'x continuer sans accepter',
    'strictement nécessaires',
    'utiliser uniquement les cookies nécessaires',
    'cookies nécessaires',
    'accepter uniquement les cookies essentiels',
    'accepter les cookies nécessaires',
    'uniquement les cookies nécessaires',
    'autoriser uniquement les cookies essentiels',
    'autoriser uniquement les cookies nécessaires',
    'si vous ne souhaitez pas accepter les cookies à lexception des cookies techniquement nécessaires, veuillez cliquer ici',
    'cookies strictement nécessaires',
    'accepter les cookies strictement nécessaires',
    'autoriser les cookies essentiels',
    'non, merci, uniquement les cookies nécessaires',
    'indispensable uniquement',
    'uniquement autoriser les cookies essentiels',
    'utiliser que les cookies nécessaires',
    'uniquement les sdk nécessaires',
    'uniquement nécessaire',
    'utiliser uniquement les cookies fonctionnels',
    'refus',
    'refusez',
    'naccepter que les cookies indispensables',
    'naccepter que les cookies nécessaires',
    'naccepter que les cookies techniques',
    'nécessaires seulement',
];

const REJECT_PATTERNS_GERMAN = [
    'ablehnen',
    'alle ablehnen',
    'nur notwendige cookies',
    'nur essenzielle cookies akzeptieren',
    'nur notwendige cookies verwenden',
    'alles ablehnen',
    'nur notwendige',
    'alle cookies ablehnen',
    'weiter ohne einwilligung',
    'mit diesem button wird der dialog geschlossen. seine funktionalität ist identisch mit der des buttons nur essenzielle cookies akzeptieren.',
    'cookies ablehnen',
    'optionale cookies ablehnen',
    'nur erforderliche cookies',
    'nur technisch notwendige',
    'einwilligung ablehnen',
    'nur erforderliche',
    'nur notwendige cookies zulassen',
    'nur funktionale cookies akzeptieren',
    'nur notwendige cookies akzeptieren',
    'nur notwendige technologien',
    'verweigern',
    'webanalyse ablehnen',
    'weiter ohne zustimmung',
    'optionale ablehnen',
    'nur notwendige akzeptieren',
    'nur funktionale cookies',
    'mit diesem button wird der dialog geschlossen. seine funktionalität ist identisch mit der des buttons ablehnen.',
    'nur notwendige cookies erlauben',
    'zustimmung verweigern',
    'nein, danke',
    'nur erforderliche cookies akzeptieren',
    'zusätzliche cookies ablehnen',
    'ablehnen und nur essenzielle cookies akzeptieren',
    'nicht erforderliche ablehnen',
    'nicht essenzielle cookies daten ablehnen',
    'nur technisch notwendige cookies',
    'nur technisch notwendige cookies akzeptieren',
    'ablehnen speichern',
    'alle funktionen ablehnen',
    'alle optionalen cookies ablehnen',
    'alles verweigern',
    'mit erforderlichen einstellungen fortfahren',
    'nicht notwendige ablehnen',
    'notwendige cookies akzeptieren',
    'nur erforderliche technologien',
    'nur essenzielle cookies',
    'nur essenzielle cookies erlauben',
    'technisch nicht notwendige cookies ablehnen',
    'tippen sie zum ablehnen bitte hier',
    'ablehnen deny',
    'fortfahren ohne zu akzeptieren',
    'nur erforderliche akzeptieren',
    'nur notwendige erlauben',
    'ablehnen ...nur technisch notwendige cookies verwendet werden',
    'ablehnen (außer notwendige cookies)',
    'ablehnen und fortfahren',
    'ablehnen und schließen',
    'ablehnen: nur grundfunktionen',
    'akzeptieren nur notwendige cookies',
    'alle ablehnen (außer notwendige cookies)',
    'alle nicht essenziellen cookies ablehnen',
    'alle nicht notwendigen cookies ablehnen',
    'alle optionale ablehnen',
    'alle optionalen ablehnen',
    'alle verweigern',
    'analyse cookies ablehnen',
    'cookie einstellungenablehnen',
    'erforderliche cookies akzeptieren',
    'erforderliche cookies zulassen',
    'externe inhalte ablehnen',
    'mit diesem button wird der dialog geschlossen. seine funktionalität ist identisch mit der des buttons ablehnen und nur essenzielle cookies akzeptieren.',
    'mit diesem button wird der dialog geschlossen. seine funktionalität ist identisch mit der des buttons nicht-essenzielle cookies verweigern.',
    'mit diesem button wird der dialog geschlossen. seine funktionalität ist identisch mit der des buttons nur essenzielle akzeptieren.',
    'mit erforderlichen cookies fortfahren',
    'mit notwendigen fortfahren',
    'nein, bitte nicht',
    'nein, ich stimme nicht zu',
    'nicht funktionale cookies ablehnen',
    'nicht notwendige cookies ablehnen',
    'nicht-essenzielle cookies ablehnen',
    'nicht-essenzielle cookies verweigern',
    'notwendige cookies zulassen',
    'nur erforderliche cookies erlauben',
    'nur erforderliche cookies setzen',
    'nur erforderliche cookies verwenden',
    'nur essenzielle akzeptieren',
    'nur notwendige cookies annehmen',
    'nur notwendige cookies speichern',
    'nur notwendige cookies verwenden.',
    'nur notwendige funktionscookies akzeptieren',
    'nur notwendigen cookies zustimmen',
    'nur notwendiges akzeptieren',
    'nur wesentliche cookies annehmen',
    'opt. cookies ablehnen',
    'optionale dienste ablehnen',
    'optionale tools ablehnen',
    'sie alle cookies ablehnen',
    'technisch notwendige annehmen',
    'nur essentielle cookies',
    'nur essentielle',
    'nur funktionale akzeptieren',
    'nur technisch notwendige akzeptieren',
    'nur technisch notwendige daten und cookies ...',
    'nur technisch notwendige zulassen',
    'nur wesentliche',
    'ohne einverständnis fortfahren',
    'ohne einwilligung',
    'ohne zustimmung fortfahren',
    'ohne zustimmung weiter',
    'weiter mit essentiellen cookies',
    'weiter ohne annahme',
    'weiter ohne statistische analyse-cookies',
    'weiter ohne statistische cookies',
    'wesentliche cookies',
    'fortfahren ohne zustimmung',
];

const REJECT_PATTERNS_ITALIAN = [
    'rifiuta',
    'rifiuta cookies',
    'rifiuta i cookie',
    'rifiuta i cookies',
    'rifiuta tutti i cookie',
    'rifiuta tutti i cookies',
    'rifiuta cookie non necessari',
    'rifiuta i cookie non tecnici',
    'rifiuta non necessari',
    'rifiuta tutto',
    'rifiuta tutti',
    'rifiuta e chiudi',
    'chiudi rifiuta tutti i cookie',
    'chiudi e rifiuta tutti i cookie',
    'chiudi e rifiuta tutto',
    'nega',
    'nega tutti',
    'negare',
    'non accetto',
    'accetta solo i necessari',
    'usa solo i cookie necessari',
    'accetta solo necessari',
    'solo necessari',
    'continua senza accettare x',
    'continua senza accettare',
    'rifiutare',
    'rifiutare i cookie',
    'rifiutare tutti i cookie',
    'rifiutare tutti',
    'rifiutare e continuare',
    'installa solo i cookie strettamente necessari',
    'solo cookies tecnici',
    'accetta necessari',
    'solo cookie tecnici',
    'solo cookie necessari',
    'strettamente necessari',
    'tecnici',
    'accetta solo cookie di navigazione',
    'chiudi e prosegui solo con i cookies tecnici necessari',
    'consenti solo i cookie tecnici',
    'solo cookie essenziali',
    'blocca i cookie non essenziali',
    'accetta i cookie necessari',
    'accetta solo cookie tecnici',
    'accetta solo i cookie essenziali',
    'accetta solo i cookie necessari',
    'accetta solo i necessary',
    'accetta i cookie essenziali',
    'accetta cookie tecnici',
    'necessari',
    'usa solo i cookie tecnici',
    'usa solo i necessari',
    'rifiuto',
    'essenziali',
    'accetta cookie essenziali',
    'accetta cookie necessari',
    'accetta solo cookie essenziali',
    'accetta solo cookie necessari',
    'rifiuta cookie non necessari',
    'rifiuta cookie non essenziali',
    'rifiuta i cookie non necessari',
    'rifiuta i cookie non essenziali',
    'rifiuta tutti i cookie e chiudi',
    'rifiuta tutto e chiudi',
    'rifiuta tutti i cookie chiudi',
    'continuare senza accettare',
    'rifiutare cookies',
    'rifiutare i cookies',
    'rifiutare non necessari',
    'rifiutare tutto',
    'rifiutare e chiudere',
    'solo essenziali',
    'solo tecnici',
    'negare tutti',
];

const REJECT_PATTERNS_BRAZILIAN_PORTUGUESE = [
    // (deny)
    /^\s*(rejeitar|recusar|desativar|bloquear|negar|não\s*aceito|não \s*aceitar)\s*$/is,

    // (proceed) (without accepting)
    /^\s*(continuar|prosseguir|seguir)\s*(sem\s*aceitar)\s*$/is,

    // (deny) (everything) (optional)
    /^\s*(rejeitar|recusar|desativar|bloquear|negar|não\s*aceito|não \s*aceitar)\s*(tudo|o)?\s*(opcional|(não[-\s](essencial|funcional|obrigatório|necessário)))?\s*$/is,

    // (deny) (all) (the) (optional) (cookies)
    /^\s*(rejeitar|recusar|desativar|bloquear|negar|não\s*aceito|não \s*aceitar)\s*(todos)?\s*(os)?\s*(cookies)?\s*(opcionais|(não[-\s](essenciais|funcionais|obrigatórios|necessários)))?\s*$/is,

    // (accept) (only) (the) (essential)
    /^\s*(aceitar|utilizar)?\s*(apenas|somente|só)?\s*(o)?\s*(essencial|funcional|obrigatório|necessário)\s*$/is,

    // (accept) (only) (the) (essential) (cookies)
    /^\s*(aceitar|utilizar)?\s*(apenas|somente|só)?\s*(os)?\s*(cookies)?\s*(essenciais|funcionais|obrigatórios|necessários)\s*$/is,
];

const REJECT_PATTERNS_SPANISH = [
    'rechazar',
    'rechazar todo',
    'rechazar todas',
    'denegar',
    'rechazar cookies',
    'rechazarlas todas',
    'no acepto',
    'rechazar todas las cookies',
    'rechazar y cerrar',
    'denegar todas',
    'solo necesarias',
    'rechazar cookies opcionales',
    'rechazar opcionales',
    'cookies estrictamente necesarias',
    'aceptar sólo necesarias',
    'denegar todo',
    'clear rechazar cookies',
    'configurar rechazar cookies',
    'denegar cookies',
    'rechazar y continuar',
    'rechazar las cookies',
    'clear rechazar',
    'denegar todas las cookies',
    'rechazar cookies no esenciales',
    'rechazarlas',
    'no, no acepto',
    'permitir sólo necesarias',
    'rechazar cookies adicionales',
    'rechazar cookies analíticas',
    'rechazar no necesarias',
    'rechazar opcional',
    'rechazar todo lo opcional',
    'solo cookies estrictamente necesarias',
    'solo esenciales',
    'x rechazar todas las cookies',
    'solo usar cookies necesarias',
    'solo cookies necesarias',
    'declinar',
    'aceptar solo las cookies esenciales',
    'necesarias',
    'aceptar cookies opcionales',
    'aceptar solo lo necesario',
    'solo funcionales',
    'declinar y cerrar',
    'déclin',
    'declina',
    'declinar consentimiento',
    'declinar todas',
    'solo las cookies necesarias',
    'només sutilitzen cookies quan és necessari',
    'no, sólo las estrictamente necesarias',
    'solo las necesarias',
    'acceptar només les necessàries',
    'acepta solo las necesarias',
    'aceptar solo lo esencial',
    'aceptar las obligatorias',
    'permitir solo cookies técnicas',
    'cookies técnicas',
    'permitir solo cookies técnicas',
    'usar solo cookies técnicas',
    'aceptar solo las esenciales',
];

const REJECT_PATTERNS_SWEDISH = [
    'avvisa',
    'endast nödvändiga',
    'avvisa alla',
    'endast nödvändiga cookies',
    'neka',
    'neka alla',
    'avvisa allt',
    'avvisa alla cookies',
    'tillåt bara nödvändiga cookies',
    'bara nödvändiga',
    'bara nödvändiga cookies',
    'tillåt bara nödvändiga kakor',
    'endast nödvändiga kakor',
    'tillåt endast nödvändiga',
    'fortsätt utan att acceptera',
    'godkänn endast nödvändiga',
    'acceptera endast nödvändiga',
    'avvisa cookies',
    'tillåt endast nödvändiga kakor',
    'acceptera endast nödvändiga cookies',
    'neka kakor',
    'bara nödvändiga kakor',
    'neka alla cookies',
    'använd endast nödvändiga',
    'avvisa alla utom nödvändiga',
    'hantera eller avvisa',
    'neka alla utom nödvändiga kakor',
    'neka och stäng',
    'tillåt bara nödvändiga tjänster',
    'avvisa alla utom nödvändiga kakor',
    'avvisa alla valfria',
    'godkänn bara nödvändiga cookies',
    'acceptera endast nödvändiga kakor',
    'använd endast nödvändiga cookies',
    'avvisa alla kakor',
    'avvisa alla valmöjligheter',
    'avvisa ej nödvändiga',
    'avvisa icke-nödvändiga',
    'förneka',
    'godkänn bara nödvändiga',
    'godkänn bara nödvändiga kakor',
    'godkänn endast nödvändiga cookies',
    'godkänn endast nödvändiga kakor',
    'godta endast nödvändiga',
    'jag godkänner bara nödvändiga kakor',
    'nej, avvisa alla',
    'nej, bara nödvändiga',
    'nej, bara nödvändiga cookies',
    'neka alla utom nödvändiga',
    'neka alla.',
    'neka cookies',
    'neka samtliga',
    'ok, endast nödvändiga',
    'spara endast nödvändiga',
    'stäng och avvisa',
    'tillåt bara nödvändiga',
    'godkänn nödvändiga kakor',
    'godkänn nödvändiga',
    'acceptera nödvändiga',
    'strikt nödvändigt',
    'tillåt nödvändiga',
    'nödvändiga',
    'enbart nödvändiga',
    'jag godkänner nödvändiga kakor',
    'acceptera nödvändiga kakor',
    'godkänn enbart nödvändiga kakor',
    'godkänn nödvändiga cookies',
    'om du inte vill acceptera andra cookies än de som är tekniskt nödvändiga klickar du här',
    'acceptera enbart nödvändiga',
    'nödvändiga cookies',
    'jag godkänner enbart att ni använder nödvändiga cookies',
    '+ strikt nödvändiga cookies',
    'använd enbart nödvändiga cookies',
    'enbart nödvändiga cookies',
    'godkänn nödvändiga kakor stäng',
    'ok till nödvändiga',
    'strikt nödvändiga',
    'fortsätt utan att godkänna',
    'avböj alla cookies',
    'jag accepterar endast grundläggande kakor',
    'nej, jag avböjer',
    'tillåt inte cookies',
];

// Extra patterns for this run, provided via environment variable, comma-separated
const REJECT_PATTERNS_EXTRA = process.env.REJECT_PATTERNS_EXTRA
    ? process.env.REJECT_PATTERNS_EXTRA.split(',')
          .map((s) => s.trim())
          .filter(Boolean)
    : [];

/**
 * @type {Array<string|RegExp>}
 */
const REJECT_PATTERNS = [
    ...REJECT_PATTERNS_ENGLISH,
    ...REJECT_PATTERNS_DUTCH,
    ...REJECT_PATTERNS_FRENCH,
    ...REJECT_PATTERNS_GERMAN,
    ...REJECT_PATTERNS_ITALIAN,
    ...REJECT_PATTERNS_BRAZILIAN_PORTUGUESE,
    ...REJECT_PATTERNS_SPANISH,
    ...REJECT_PATTERNS_SWEDISH,
    ...REJECT_PATTERNS_EXTRA,
];

const REJECT_NEVER_MATCH_PATTERNS = [
    /pay|subscribe/is,
    /abonneer/is,
    /abonnier/is,
    /abonner/is,
    /abbonati/is,
    /iscriviti/is,
    /abbonare/is,
    /iscrivere/is,
    /sostienici/is,
    /suscribir/is,
];


const SETTINGS_NEVER_MATCH_PATTERNS = [
    // Use Recommended Settings
    // OK to use our recommended settings
    /recommended/i,
    // Save preferences and the like
    /save|submit|close|accept|agree/i,
];

const SETTINGS_PATTERNS = [
    // Adjust cookie settings
    // Adjust settings
    // Advanced Settings
    // Change cookie settings
    // Change my preferences
    // Change Preferences
    // Change Settings
    // Change your cookie settings
    // Choose Cookies
    // Customise Cookies
    // Customise my choices
    // Customise settings
    // Customize Choices
    // Customize cookie settings
    // Customize Cookies
    // Customize Cookies Settings
    // Customize Preferences
    // Customize settings
    // Customize your choice
    // Manage Choices
    // Manage Consent Preferences
    // Manage Cookie & Tracking Settings
    // Manage Cookie Preferences
    // Manage Cookie Settings
    // Manage Cookies
    // Manage Cookies
    // Manage Cookies Settings
    // Manage Individual preferences
    // Manage My Cookies
    // Manage my preferences
    // Manage My Preferences
    // MANAGE MY SETTINGS
    // Manage opt out preferences
    // Manage options
    // Manage or reject Cookies
    // Manage Preferences
    // Manage privacy settings
    // Manage Settings
    // manage specific collection and sharing preferences
    // Manage Your Cookies
    // Manage your preferences
    // Manage Your Privacy Choices
    // Manage your privacy settings
    // Set Choices
    // Set preferences
    // Set your choices
    // View Cookies Settings
    // View options
    // View preferences
    /^(?:ad|choose|adjust|customize|customise|change|set|manage|configure|view).{0,100}(?:your)?.{0,100}(?:cookie)?.{0,100}(?:cookie|cookies|settings|preferences|choices?|options)$/i,

    // CONFIGURE
    // Customise
    // Customize
    // Manage
    /^(?:adjust|customize|customise|manage|configure)$/i,

    // Consent Preferences
    // Consent Settings
    // Cookie Choices
    // Cookie Consent Options
    // cookie preferences
    // Cookie Preferences
    // Cookie Setting
    // Cookie Settings
    // Cookie/Consent Preferences
    // Cookies Preferences
    // Cookies Settings
    // CUSTOM SETTINGS
    // Customise my choices
    // Customise settings
    // Customize Choices
    // Customize cookie settings
    // Customize Cookies Settings
    // Customize Preferences
    // Customize settings
    // MORE OPTIONS
    /^(?:(?:cookie\s+)?consent|cookie|custom|more).{0,100}(?:preferences|settings?|choices|options)$/i,

    // My settings
    // Options
    // Preferences
    // Settings
    // Your Privacy Choices
    /^((?:my|your).{0,100})?(?:settings|preferences|choices|options)$/i,
    'let me choose',
    'show purposes',
    'privacy settings',
    'privacy manager',
    'reject and manage',
    'edit settings',
    'no, manage cookies',
    'no, customize settings',
    'edit preferences',
    'select your cookie preferences',
    'no, take me to cookie settings',
    'no, customise',
    'let me choose my cookies',
    'update cookie preferences',
    'show cookie preferences',
    'edit cookie settings',
    'personalize',

    // FR
    'personnaliser',
    'paramètres',
    'paramètres des cookies',
    'paramétrer',
    'préférences',


    // DE
    'einstellungen',
    'speichern',
    'konfigurieren',
    'cookie-einstellungen',
    'personalisierte werbung und inhalte, messung von werbeleistung und der performance von inhalten, zielgruppenforschung sowie entwicklung und verbesserung von angeboten',
    'individuelle datenschutzeinstellungen',

    // NL
    'aanpassen',
    'instellingen',
    'cookie instellingen',
    'cookie-instellingen',
    'voorkeuren',
    'bekijk voorkeuren',
    'meer opties',
    'zelf instellen',
];

const SAVE_PATTERNS = [
    /^(?:confirm|save|set|submit).{0,100}(?:my|cookie)*.{0,100}(?:preferences|settings|choices|options)?.{0,100}(?:and|&)?.{0,100}(?:close|continue)?$/i,
    'accept selection',
    'accept selected',
];

module.exports = {
    REJECT_PATTERNS,
    REJECT_NEVER_MATCH_PATTERNS,
    SETTINGS_PATTERNS,
    SETTINGS_NEVER_MATCH_PATTERNS,
    SAVE_PATTERNS,
};
