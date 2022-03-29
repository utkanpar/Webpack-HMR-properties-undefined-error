module.exports = {
    extends: '@msdyn365-commerce/eslint-config',
    ignorePatterns: ['.eslintrc.js', '*.html', '*.data.ts', '*.props.autogenerated.ts', 'test/**/*', 'scripts/**/*'],
    parserOptions: {
        project: ['tsconfig.json'],
        sourceType: 'module',
        ecmaFeatures: {
            jsx: true // Allows for the parsing of JSX
        },
        tsconfigRootDir: __dirname
    },
    rules: {
        // Generally disallow imports that are not used, exceptions listed below have side effects from import and are allowed
        'import/no-unassigned-import': ['error', { allow: ['jest', 'lazysizes', 'lazysizes/plugins/attrchange/ls.attrchange', 'testcafe'] }]
    }
};
