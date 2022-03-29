/*******************************************************************************
* Copyright (c) Microsoft Corporation.
* All rights reserved. See LICENSE in the project root for license information.
*******************************************************************************/


const path = require('path');
const paths = require('../paths');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const ModuleDefinitionGeneratorPlugin = require('@msdyn365-commerce/definition-generator-internal');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const StatsPlugin = require('stats-webpack-plugin');
const VersionGenerator = require('../../version-generator/version-generator');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const fs = require('fs');
const { MSDyn365BuildScriptPlugin } = require('@msdyn365-commerce/build-scripts-internal/dist/lib');
const ExtraWatchPlugin = require('extra-watch-webpack-plugin');
const babelOptionsGenerator = require('../../configs/babel-options');
const utilities = require('@msdyn365-commerce/utilities-internal');
const { getExcludedModuleImportPath } = require('../../helper/module-exclude-helper');
const { getPlatformSettings } = require('../../helper/utils');
const { updateCacheGroup, MIN_CHUNK_SIZE, generateAllModulesList } = require('../../helper/chunking-helper');
const getExecutionEnv = require('../helpers').getExecutionEnv;

const USE_SUBMISSION_V2_BUILD = (process.argv.find(arg => arg.match(/--use-submission-v2(=|$)/)) && true) || false;

module.exports = async (
    originalConfig,
    { target, dev, useTslint, disableLinter }, // eslint-disable-next-line no-unused-vars
    webpack,
    { host = 'localhost', port = 3000, devPort = 3001 }
) => {
    const KEYSTONE_ENTRY_PATH = path.resolve(__dirname, '..', '..', 'entry');
    const updatedConfig = {
        ...originalConfig
    };

    let moduleEntryPointsEnabled = false;
    updatedConfig.entry = map(entry => entry.replace(paths.appSrc, path.resolve(KEYSTONE_ENTRY_PATH)), originalConfig.entry);

    if (target === 'web') {
        const platformSettings = getPlatformSettings();
        const excludedModules = (platformSettings && platformSettings.excludedModules) || [];
        moduleEntryPointsEnabled = utilities.isModuleEntryPointsEnabled();
        if (moduleEntryPointsEnabled) {
            const dotenv = getExecutionEnv(target, { host, port });
            const devServerPort = parseInt(devPort, 10);
            const preRunEntryPoints = async () => {
                const modulePackageSet = await generateAllModulesList();
                const entries = {};
                modulePackageSet.add('__local__');
                for (const modulePackage of modulePackageSet) {
                    const currentModulePackage = modulePackage;

                    // filter excluded modules
                    if (currentModulePackage && !excludedModules.includes(currentModulePackage)) {
                        const registrationPath = path.resolve(
                            path.join(paths.appPath, 'lib', currentModulePackage, 'module-registration.js')
                        );
                        entries[currentModulePackage] = registrationPath;
                    }
                }

                const hoistedPath = path.resolve(
                    path.join(
                        paths.appPath,
                        '..',
                        '..',
                        'node_modules',
                        '@msdyn365-commerce',
                        'bootloader',
                        'entry',
                        'module-entrypoints-client.js'
                    )
                );
                const clientPath = path.resolve(
                    path.join(paths.appPath, 'node_modules', '@msdyn365-commerce', 'bootloader', 'entry', 'module-entrypoints-client.js')
                );

                if (process.env.NODE_ENV === 'development') {
                    entries['client'] = entries['client'] || [];
                    entries['client'].unshift(`webpack-dev-server/client?http://${dotenv.raw.HOST}:${devServerPort}/`);
                }
                
                if (fs.existsSync(hoistedPath)) {
                    entries['client'] = [require.resolve(path.resolve(KEYSTONE_ENTRY_PATH, 'webpack-public-path')), hoistedPath];
                } else {
                    entries['client'] = [require.resolve(path.resolve(KEYSTONE_ENTRY_PATH, 'webpack-public-path')), clientPath];
                }

                updatedConfig.entry = entries;
            };

            await preRunEntryPoints();
        } else {
            // In production builds we set the webpack public path at runtime with this file. Must be before other entry points!
            updatedConfig.entry.client.unshift(require.resolve(path.resolve(KEYSTONE_ENTRY_PATH, 'webpack-public-path')));
        }
    }

    updatedConfig.resolve.extensions = updatedConfig.resolve.extensions.concat(['.ts', '.tsx', '.js']);
    updatedConfig.resolve.alias.partner = paths.appSrc;
    updatedConfig.resolve.alias.build = paths.appBuild;
    updatedConfig.resolve.alias.lib = path.resolve(path.join(paths.appPath, 'lib'));
    updatedConfig.resolve.alias.tmp = path.resolve(path.join(paths.appPath, '.tmp'));
    updatedConfig.resolve.alias.node_modules = paths.appNodeModules;
    updatedConfig.resolve.alias['core-js'] = path.resolve(path.dirname(require.resolve('core-js')));
    updatedConfig.resolve.alias.path = path.resolve(path.dirname(require.resolve('path-browserify')));
    // updatedConfig.resolve.alias.fs = path.resolve(path.dirname(require.resolve('browserify-fs')));
    // updatedConfig.resolve.alias.stream = path.resolve(path.dirname(require.resolve('stream-browserify')));
    // updatedConfig.resolve.alias['__local__'] = path.resolve(__dirname, 'build');
    updatedConfig.stats = {
        errorDetails: true
    };

    let sdkVersion = '--';
    let sskVersion = '--';
    let rcsuVersion = '--';
    try {
        const pathToBootloader = path.join(paths.appNodeModules, '@msdyn365-commerce', 'bootloader');
        // try to resolve lerna workspace style
        const pathToBootloaderHoisted = path.resolve(paths.appNodeModules, '../../../node_modules/', '@msdyn365-commerce', 'bootloader');

        console.log(`\n${pathToBootloader}\n`);
        if (fs.existsSync(pathToBootloader)) {
            if (fs.lstatSync(pathToBootloader).isSymbolicLink()) {
                console.log(`>> You are running in symlink mode for '@msdyn365-commerce/bootloader'`);
                // we're symlinked, set path aliases from current __dirname
                // ensure all dependencies can resolve RUC from bootloader node_modules folder
                updatedConfig.resolve.alias['react-universal-component'] = path.join(
                    __dirname,
                    'node_modules',
                    'react-universal-component'
                );
                updatedConfig.resolve.alias['@babel/runtime'] = path.join(__dirname, 'node_modules', '@babel', 'runtime');
                updatedConfig.resolve.alias['core-js'] = path.join(__dirname, 'node_modules', 'core-js');
            }
        } else if (fs.existsSync(pathToBootloaderHoisted)) {
            // need to add reference to hoisted/ so that we can resolve everything in local dev
            updatedConfig.resolve.alias.hoisted = path.resolve(paths.appNodeModules, '../../../node_modules');
            console.log(`Detected a hoisted environment.`);
        }
    } catch (e) {
        console.error(`Error in resolving paths to @msdyn365-commerce/bootloader directory\n${e}`);
    }

    // Fallback version is 2.0.0
    let retailServerProxyVersion = '2.0.0';
    // Resolve current TSProxy version
    retailServerProxyVersion = utilities.getVersionForPackage('@msdyn365-commerce', 'retail-proxy', { errorOnFailure: true });
    if (target === 'node') {
        // Resolve current SDK version
        sdkVersion = utilities.getVersionForPackage('@msdyn365-commerce', 'bootloader', { errorOnFailure: true });
        // Resolve current SSK version
        sskVersion = utilities.getVersionForPackage('@msdyn365-commerce-modules', 'starter-pack', { errorOnFailure: false });
    }
    // Note: This alias is designed to point to the package name for the starter-pack, if starter pack package name changes, this must also change.
    updatedConfig.resolve.alias.starterPackSrc = path.join(paths.appNodeModules, '/@msdyn365-commerce-modules/starter-pack');
    const copywebpackPluginOptions = require('../../configs/webpack-copy-options');
    const forkTsCheckerOptions = {
        // set config path to resolve from actual source dir
        typescript: {
            enabled: true,
            configFile: path.resolve(paths.appSrc, '..', 'tsconfig.json'),
            memoryLimit: 4096
        },
        formatter: 'basic'
    };
    if (!disableLinter) {
        useTslint
            ? (forkTsCheckerOptions.tslint = path.resolve(paths.appSrc, '..', 'tslint.json'))
            : (forkTsCheckerOptions.eslint = {
                  enabled: true,
                  files: './src/**/*.{ts,tsx,js,jsx}'
              });
    }
    updatedConfig.plugins = [
        new webpack.WatchIgnorePlugin({
            paths: [
                // this is needed to avoid circular loop as files are written by MSDyn365BuildScriptPlugin
                // TODO: kopik ravik need to get rid of lib and output files into build directory, but make sure to
                // ignore that part of the folder
                updatedConfig.resolve.alias.lib,
                updatedConfig.resolve.alias.tmp
            ]
        }),
        new ExtraWatchPlugin({
            files: [
                // module definitions
                path.join('src', 'modules', '**', '*.definition.json'),
                // module data definitions
                path.join('src', 'modules', '**', '*.data.ts'),

                // local site styles
                path.join('src', 'styles', '**', '*.scss'),
                // local themes
                path.join('src', '**', 'themes', '**', '*.scss')
            ]
        }),
        new ModuleDefinitionGeneratorPlugin(),
        new MSDyn365BuildScriptPlugin(),

        ...updatedConfig.plugins,
        // new WriteFilePlugin(),
        // include linting on both client & server bundles - bundles will be slightly different
        new ForkTsCheckerWebpackPlugin(forkTsCheckerOptions),
        new webpack.DefinePlugin({
            'process.env.MSDyn365Commerce_BASEURL': JSON.stringify(process.env.MSDyn365Commerce_BASEURL),
            'process.env.MSDyn365Commerce_CHANNELID': JSON.stringify(Number(process.env.MSDyn365Commerce_CHANNELID)),
            'process.env.MSDyn365Commerce_CATALOGID': JSON.stringify(Number(process.env.MSDyn365Commerce_CATALOGID)),
            'process.env.MSDyn365Commerce_OUN': JSON.stringify(process.env.MSDyn365Commerce_OUN),
            'process.env.MSDyn365Commerce_BASEIMAGEURL': JSON.stringify(process.env.MSDyn365Commerce_BASEIMAGEURL),
            'process.env.MSDyn365Commerce_RSVERSION': JSON.stringify(retailServerProxyVersion),
            'process.env.MSDyn365Commerce_SDK_VERSION': JSON.stringify(sdkVersion),
            'process.env.MSDyn365Commerce_SSK_VERSION': JSON.stringify(sskVersion),
            'process.env.MSDyn365Commerce_RATINGSREVIEWS_URL': JSON.stringify(process.env.MSDyn365Commerce_RATINGSREVIEWS_URL),
            'process.env.MSDyn365Commerce_RATINGSREVIEWS_ID': JSON.stringify(process.env.MSDyn365Commerce_RATINGSREVIEWS_ID),
            'process.env.MSDyn365Commerce_RCSUVERSION': JSON.stringify(rcsuVersion),
            'process.env.REACT_VERSION': JSON.stringify(process.env.REACT_VERSION),
            'process.env.REACT_DOM_VERSION': JSON.stringify(process.env.REACT_DOM_VERSION),

            // default log level if one is not set
            'process.env.SDK_MIN_LOG_LEVEL': Number(process.env.SDK_MIN_LOG_LEVEL || 0),
            ...(!USE_SUBMISSION_V2_BUILD && {
                'process.env.SUBMISSIONID': JSON.stringify(
                    process.env.SUBMISSIONID === undefined ? '00000-00000-00000-00000-00000' : process.env.SUBMISSIONID
                )
            })
        })
    ];

    if (target === 'node') {
        updatedConfig.plugins.push(new VersionGenerator(paths.appNodeModules, paths.appBuild));
        updatedConfig.plugins.push(new CopyWebpackPlugin({ patterns: copywebpackPluginOptions }));
    }

    const babelOptions = {
        // babel options
        ...babelOptionsGenerator(target, dev),
        // babel-loader options
        cacheDirectory: true,
        cacheCompression: false
    };

    // remove loaders we don't care about (file loaders, etc)
    updatedConfig.module.rules = [];
    updatedConfig.module.rules.push(
        {
            test: /\.svg$/,
            use: [
                {
                    loader: require.resolve('react-svg-loader'),
                    options: {
                        svgo: {
                            // adding this because SVG loader will remove viewBox property when it matchs the height and weight
                            // we need viewBox information to change SVG's size.
                            plugins: [{ removeViewBox: false }]
                        }
                    }
                }
            ]
        },
        {
            test: /\.(s?css|d\.tsx?|md|js\.map)$/,
            loader: require.resolve('null-loader')
        },
        {
            test: /\.(t|j)sx?$/,
            loader: require.resolve('source-map-loader'),
            enforce: 'pre'
        },
        {
            test: /\.tsx?$/,
            exclude: /node_modules/,
            use: [
                {
                    loader: require.resolve('babel-loader'),
                    options: babelOptions
                },
                {
                    loader: require.resolve('ts-loader'),
                    options: {
                        transpileOnly: true
                    }
                }
            ]
        },
        {
            test: /script-injector$/,
            resolve: {
                fullySpecified: true // disable the behaviour
            }
        },
        {
            test: /\.jsx?$/,
            resolve: {
                fullySpecified: false // disable the behaviour
            },
            include: fileName => {
                return (
                    // from node_modules
                    /@msdyn365-commerce(-modules)?[\\/]?.+[\\/](dist|build)/.test(fileName) ||
                    // from symlinked scenarios but with paths matching out build pattern
                    /dist[\\/]lib/.test(fileName) ||
                    // /module-registration\.js/.test(fileName) ||
                    // from  bootloader
                    (/bootloader[\\/](entry|common)/.test(fileName) && !/__tests__/.test(fileName)) ||
                    // exclude node_modules by default
                    !/node_modules/.test(fileName)
                );
            },
            use: [
                {
                    loader: require.resolve('babel-loader'),
                    options: babelOptions
                }
            ]
        }
    );
    const platformSettings = getPlatformSettings();
    const excludeModule = platformSettings.excludedModules;
    const excludedModulePathList = await getExcludedModuleImportPath(excludeModule);
    if (target === 'web') {
        // find the excluded modules from platform setting
        updatedConfig.externals = {
            react: 'React',
            'react-dom': 'ReactDOM',
            async_hooks: {},
            bootstrap: 'bootstrap'
        };
    } else {
        updatedConfig.externals = {
            react: 'react',
            'react-dom': 'react-dom',
            'react-dom/server': 'react-dom/server',
            'node-sass': 'commonjs2 node-sass',
            bootstrap: 'commonjs2 bootstrap',
            long: 'long',
            'uglify-es': 'uglify-es',
            'uglify-es/package.json': 'uglify-es/package.json',
            'fast-json-stringify': 'fast-json-stringify'
        };
    }
    for (const modulePath of excludedModulePathList) {
        updatedConfig.externals[modulePath] = `commonjs2 ${modulePath}`;
    }

    updatedConfig.output = {
        ...updatedConfig.output,
        sourceMapFilename: '[file].map',
        devtoolModuleFilenameTemplate: 'webpack://[namespace]/[resource-path]?[hash]'
    };

    // reset provided optimizations, only set them for target = 'web'
    if (target === 'web') {
        // This is to make sure the logger will still work on client
        // [webpack5] updatedConfig.node = { fs: 'empty' };
        updatedConfig.resolve.fallback = { util: false, fs: false, stream: false };

        if (!dev) {
            // fix naming our chunks for humans and removing devtoolModuleFilenameTemplate attribute in the process
            updatedConfig.output = {
                ...updatedConfig.output,
                chunkFilename: 'static/js/[id].[contenthash].chunk.js'
            };
        }

        updatedConfig.output = {
            ...updatedConfig.output,
            publicPath: '/'
        };

        let cacheGroups = {
            // starterpack: {
            //     test: /keystone-starter-pack/,
            //     priority: -5,
            //     name: 'starter-pack'
            // },
            defaultVendors: {
                // TODO: we should exclude other namespace (defined in platform.settings) as well.
                test: webpackModule =>
                    /node_modules/.test(webpackModule.resource) &&
                    !/@msdyn365-commerce-(themes|modules)/.test(webpackModule.resource) &&
                    !/retail-proxy/.test(webpackModule.resource) &&
                    !/dompurify/.test(webpackModule.resource) &&
                    !/chart\.js/.test(webpackModule.resource) &&
                    !/commerce-performance-analyzer/.test(webpackModule.resource),
                name: 'vendors',
                priority: -10
            },
            'retail-proxy': {
                // TODO: we should exclude other namespace (defined in platform.settings) as well.
                test: webpackModule =>
                    /retail-proxy/.test(webpackModule.resource) &&
                    !/@msdyn365-commerce-(themes|modules)/.test(webpackModule.resource) &&
                    !/dompurify/.test(webpackModule.resource) &&
                    !/chart\.js/.test(webpackModule.resource) &&
                    !/commerce-performance-analyzer/.test(webpackModule.resource),
                name: 'retail-proxy',
                priority: -10
            }
        };
        let chunkGroupNumber = 0;
        const minClientChunkSize = platformSettings.minClientChunkSize || MIN_CHUNK_SIZE;
        const enableChunkByModulePackage = platformSettings.enableChunkByModulePackage;
        if (enableChunkByModulePackage) {
            /*
            create cacheGroups grouping modules from same module pacakge.
            return number of groups as chunkGroupNumber.
            chunkGroupNumber should be used in maxAsyncRequests and maxInitialRequests to have webpack
            properly generate groups based on each cacheGroup rule. */
            chunkGroupNumber = await updateCacheGroup(cacheGroups, platformSettings);
        }
        updatedConfig.optimization = {
            ...updatedConfig.optimization,
            // mostly default universal config below
            runtimeChunk: moduleEntryPointsEnabled ? 'single' : { name: 'bootstrap' },
            // [webpack5] occurrenceOrder: true,
            chunkIds: 'total-size',
            moduleIds: 'size',
            flagIncludedChunks: true,
            concatenateModules: true,
            splitChunks: {
                chunks: 'all',
                minSize: minClientChunkSize,
                maxSize: platformSettings.maxClientChunkSize,
                minChunks: 1,
                // default value is 5
                maxAsyncRequests: moduleEntryPointsEnabled ? 20 : chunkGroupNumber + 5,
                // default value is 3
                maxInitialRequests: moduleEntryPointsEnabled ? 20 : chunkGroupNumber + 3,
                automaticNameDelimiter: '~',
                // don't use path info to name chunks
                hidePathInfo: true,
                // name: dev, // name chunks in dev only, in prod use ids/hashes
                // @TODO @kopik: keep the following commented out for now, levers for optimization
                cacheGroups: {
                    ...cacheGroups,
                    'msdyn365-dompurify-chunk': {
                        test: webpackModule => /node_modules/.test(webpackModule.resource) && /dompurify/.test(webpackModule.resource),
                        name: 'msdyn365-dompurify-chunk',
                        priority: -10
                    },
                    'msdyn365-performance-chunk': {
                        test: webpackModule =>
                            /node_modules/.test(webpackModule.resource) &&
                            (/commerce-performance-analyzer/.test(webpackModule.resource) || /chart\.js/.test(webpackModule.resource)),
                        name: 'msdyn365-performance-chunk',
                        priority: -10
                    }
                }
            }
        };
    } else {
        // eslint-disable-next-line no-unused-vars
        let cacheGroups = {
            default: false,
            vendors: false,
            // starterpack: {
            //     test: /keystone-starter-pack/,
            //     priority: -5,
            //     name: 'starter-pack'
            // },
            msdyn365: {
                chunks: 'all',
                enforce: true,
                // TODO: we should exclude other namespace (defined in platform.settings) as well.
                test: webpackModule => /@msdyn365-commerce\\/.test(webpackModule.resource),
                name: 'msdyn365',
                priority: -10
            }
            /* partners: {
                chunks: 'async',
                enforce: true,
                // TODO: we should exclude other namespace (defined in platform.settings) as well.
                test: webpackModule =>
                    /@msdyn365-commerce-partners/.test(webpackModule.resource),
                name: 'partners',
                priority: -10
            },
            modules: {
                chunks: 'async',
                enforce: true,
                // TODO: we should exclude other namespace (defined in platform.settings) as well.
                test: webpackModule =>
                    /@msdyn365-commerce-modules/.test(webpackModule.resource),
                name: 'modules',
                priority: -10
            } */
        };

        /* updatedConfig.optimization = {
            ...updatedConfig.optimization,
            // mostly default universal config below
            // runtimeChunk: 'single',
            // [webpack5]
            // moduleIds: 'hashed',
            // [webpack5] occurrenceOrder: true,
            // chunkIds: 'total-size',
            // moduleIds: 'size',
            flagIncludedChunks: true,
            concatenateModules: true,
            splitChunks: {
                chunks: 'all',
                automaticNameDelimiter: '~',
                // don't use path info to name chunks
                hidePathInfo: true,
                // name: dev, // name chunks in dev only, in prod use ids/hashes
                // @TODO @kopik: keep the following commented out for now, levers for optimization
                cacheGroups: cacheGroups
            }
        }; */
    }

    // force write stats.json, always
    updatedConfig.plugins = (updatedConfig.plugins || []).concat(
        new StatsPlugin(`stats-${target}.json`, require('../../configs/webpack-stats-options'))
    );

    if (process.env.ANALYZE_BUNDLE) {
        updatedConfig.plugins.push(
            new BundleAnalyzerPlugin({
                analyzerMode: 'static',
                reportFilename: `bundle-${target}-analysis.html`
            })
        );
    }

    // console.log(`------------------ updated config -------------------------------`);
    // console.log(updatedConfig);
    // console.log(updatedConfig.module);
    // Print current SDK and SSK versions. Check if target is node to avoid printing the version information
    // twice for when we run with target web
    if (target === 'node') {
        console.log('------------------ VERSION INFORMATION -------------------------------');
        console.log(`Using SDK version: ${sdkVersion}`);
        console.log(`Using module library version: ${sskVersion}`);
        console.log('----------------------------------------------------------------------');
    }

    if (moduleEntryPointsEnabled) {
        updatedConfig.performance = {
            maxEntrypointSize: 4000000,
            maxAssetSize: 400000
        };
    }

    return updatedConfig;
};

/**
 * Helper function that maps the contents of an array or array of objects
 * @param {Function} func function to apply
 * @param {Array | Object} target object to map entries over
 */
function map(func, target) {
    if (Array.isArray(target)) {
        return target.map(func);
    }

    return Object.keys(target || {}).reduce((newObject, key) => {
        newObject[key] = target[key].map(func);
        return newObject;
    }, {});
}
