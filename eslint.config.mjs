import tseslint from 'typescript-eslint';
import ddgConfig from '@duckduckgo/eslint-config';
import globals from 'globals';

export default [
    ...tseslint.configs.recommended,
    ...ddgConfig,

    {
        ignores: ['collectors/APICalls/breakpointScript.template.js'],
    },

    {
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.mocha,
                ...globals.browser,
            },
        },
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
            '@typescript-eslint/ban-ts-comment': 'off',
            'no-redeclare': [
                'error',
                {
                    builtinGlobals: false,
                },
            ],
            'no-labels': 'off',
        },
    },
];
