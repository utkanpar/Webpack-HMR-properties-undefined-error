/*******************************************************************************
* Copyright (c) Microsoft Corporation.
* All rights reserved. See LICENSE in the project root for license information.
*******************************************************************************/


const path = require('path');
const paths = require('../paths');
const ModuleDefinitionGeneratorPlugin = require('@msdyn365-commerce/definition-generator-internal');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const StatsPlugin = require('stats-webpack-plugin');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const { MSDyn365BuildScriptPlugin } = require('@msdyn365-commerce/build-scripts-internal/dist/lib');
const ExtraWatchPlugin = require('extra-watch-webpack-plugin');
const babelOptionsGenerator = require('../../configs/babel-options');
const getExecutionEnv = require('../helpers').getExecutionEnv;


module.exports = async (
    { target, dev, useTslint, disableLinter, env= 'dev' },
    webpack,
) => {
    const KEYSTONE_ENTRY_PATH = path.resolve(__dirname, '..', '..', 'entry');
    const clientPublicPath = dotenv.raw.CLIENT_PUBLIC_PATH || (env === 'dev' ? `http://${dotenv.raw.HOST}:${devServerPort}/` : '/');

    const webpackConfig = {
        entry: map(entry => entry.replace(paths.appSrc, path.resolve(KEYSTONE_ENTRY_PATH)), paths.appClientIndexJs),
        stats: {
            errorDetails: true
        }
    }

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

    webpackConfig.plugins = [
        new webpack.WatchIgnorePlugin({
            paths: [
                webpackConfig.resolve.alias.lib,
                webpackConfig.resolve.alias.tmp
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

        ...webpackConfig.plugins,
        new ForkTsCheckerWebpackPlugin(forkTsCheckerOptions),
        new webpack.DefinePlugin({
            'process.env.REACT_VERSION': JSON.stringify(process.env.REACT_VERSION),
            'process.env.REACT_DOM_VERSION': JSON.stringify(process.env.REACT_DOM_VERSION),
        })
    ];

    const babelOptions = {
        // babel options
        ...babelOptionsGenerator(target, dev),
        // babel-loader options
        cacheDirectory: true,
        cacheCompression: false
    };

    webpackConfig.output = {
        path: paths.appBuild,
        publicPath: clientPublicPath,
        filename: 'server.js',
        libraryTarget: 'commonjs2',
        sourceMapFilename: '[file].map',
        devtoolModuleFilenameTemplate: 'webpack://[namespace]/[resource-path]?[hash]'
    };

    webpackConfig.module.rules = [];
    webpackConfig.module.rules.push(
        {
            test: /\.svg$/,
            use: [
                {
                    loader: require.resolve('react-svg-loader'),
                    options: {
                        svgo: {
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
    if (target === 'web') {
        const dotenv = getExecutionEnv(target, { host, port });
        const devServerPort = parseInt(devPort, 10);

        // In production builds we set the webpack public path at runtime with this file. Must be before other entrypoints!
        webpackConfig.entry.client.unshift(require.resolve(path.resolve(KEYSTONE_ENTRY_PATH, 'webpack-public-path')));

        if (env === 'dev') {
            webpackConfig.entry.client.unshift(`webpack-dev-server/client?http://${dotenv.raw.HOST}:${devServerPort}/`);
            webpackConfig.output = {
                path: paths.appBuildPublic,
                publicPath: clientPublicPath,
                pathinfo: true,
                // libraryTarget: 'var',
                filename: 'static/js/[name].bundle.js',
                chunkFilename: 'static/js/[name].chunk.js',
                devtoolModuleFilenameTemplate: info => path.resolve(info.resourcePath).replace(/\\/g, '/')
            };
            // Setting verbose flag to log webpack info during server start only in verbose mode
            let noWebpackInfoFlag = true;
            if (process.env.verbose === '--verbose') {
                noWebpackInfoFlag = false;
            }
            webpackConfig.devServer = {
                writeToDisk: true,
                disableHostCheck: true,
                clientLogLevel: 'info',
                compress: true,
                headers: {
                    'Access-Control-Allow-Origin': '*'
                },
                host: dotenv.raw.HOST,
                // hot: true,
                // inline: false,
                overlay: true,
                port: devServerPort,
                https: {
                    ...createCertificate()
                },
                quiet: false,
                watchOptions: {
                    ignored: /node_modules/
                },
                noInfo: noWebpackInfoFlag
            };
            webpackConfig.plugins = [
                ...(webpackConfig.plugins || []),
                new webpack.HotModuleReplacementPlugin({
                    // TODO: keep for now & see perf. has to do with multi-reload with definition generator
                    // multiStep: true
                }),
                new webpack.ProvidePlugin({
                    process: 'process/browser',
                    Buffer: ['buffer', 'Buffer']
                })
            ];

            webpackConfig.optimization = {
                ...webpackConfig.optimization,
                runtimeChunk: { name: 'bootstrap' },
                chunkIds: 'total-size',
                moduleIds: 'size',
                flagIncludedChunks: true,
                concatenateModules: true,
                splitChunks: {
                    chunks: 'all',
                    minChunks: 1,
                    // default value is 5
                    maxAsyncRequests:  5,
                    // default value is 3
                    maxInitialRequests:  3,
                    automaticNameDelimiter: '~',
                    hidePathInfo: true,
                }
            };
        } else {
            // fix naming our chunks for humans and removing devtoolModuleFilenameTemplate attribute in the process
            webpackConfig.output = {
                ...webpackConfig.output,
                chunkFilename: 'static/js/[id].[contenthash].chunk.js'
            };
        }

        // This is to make sure the logger will still work on client
        webpackConfig.resolve.fallback = { util: false, fs: false, stream: false };

        // find the excluded modules from platform setting
        webpackConfig.externals = {
            react: 'React',
            'react-dom': 'ReactDOM',
            async_hooks: {},
            bootstrap: 'bootstrap'
        };

        webpackConfig.output.publicPath = '/';
    } else {
        webpackConfig.externals = {
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

    // force write stats.json, always
    webpackConfig.plugins = (webpackConfig.plugins || []).concat(
        new StatsPlugin(`stats-${target}.json`, require('../../configs/webpack-stats-options'))
    );

    if (process.env.ANALYZE_BUNDLE) {
        webpackConfig.plugins.push(
            new BundleAnalyzerPlugin({
                analyzerMode: 'static',
                reportFilename: `bundle-${target}-analysis.html`
            })
        );
    }

    return webpackConfig;
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
