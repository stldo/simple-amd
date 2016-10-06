(function(window, document) {

    var modules = {
        require: { cache: require },
    };

    var defineQueue = [];

    var options = {
        dependencies: {}, /* Set dependencies for css (or js) files */
        onError: null, /* Redirect if an error occurs */
        rewrite: [], /* Rewrite specific paths */
        parameters: {},
        timeout: 13000, /* Timeout for pending requires */
    };

    var prefixes = {
        js: {
            extension: 'js',
            tagName: 'script', /* Element tagName */
            pathAttribute: 'src', /* Attribute to set the module path */
            attributes: { /* Additional element attributes */
                async: true,
            },
        },
        css: {
            define: false, /* Unresolvable modules don't have a factory */
            extension: 'css',
            tagName: 'link',
            pathAttribute: 'href',
            attributes: {
                rel: 'stylesheet',
            },
        },
    };

    var COMMONJS_REGEXP;
    var REWRITE_PARAMETERS_REGEXP;
    /* Slash expressions */
    var BOTH_SLASHES_REGEXP = /^\/+|\/+$/g;
    var HEAD_SLASHES_REGEXP = /^\/+/;
    var ONLY_SLASHES_REGEXP = /^\/+?/;
    /* Url expressions */
    var EMPTY_PARAMETERS_REGEXP = /(?:(\?)|&)[^&=]+=(?:&|$)/g;
    var LAST_SEGMENT_REGEXP = /\/[^/]*\/?$/;
    var NORMALIZE_DOT_REGEXP = /(^|\/|!)\.{1,2}(?:\/|$)/;
    var QUESTION_MARK_REPEAT_REGEXP = /(\?.*)\?/;
    var REQUEST_METHOD_REGEXP = /^(?:https?:)?\/\//;

    /**
     * Redirect to error page or throw an error
     */
    function redirectError() {

        var redirectUrl = options.onError;

        if (redirectUrl && !/[?&]e=1(&|$)/.test(location.search)) { /* RegExp should not be called often */
            location.href = (redirectUrl + '?e=1').replace(QUESTION_MARK_REPEAT_REGEXP, '$1&');
        } else {
            throw new Error('AMD error.'); /* Let the user known that an error happened */
        }

    }

    /**
     * Finish the module loading after the module was resolved,
     * calling the configure function and callbacks in the queue
     */
    function finish(module) {

        var configure = module.configure;
        var cache = module.cache;

        if (undefined === cache) {
            cache = null;
        }

        if ('function' === typeof configure) {
            var configureCache = configure(cache);
            if (undefined !== configureCache) {
                cache = configureCache;
            }
        }

        module.cache = cache;
        module.queue.forEach(function (callback) {
            callback();
        });

    }

    /**
     * After a module is included, resolve its dependencies before loading it
     */
    function resolve(module) {

        var optionsDependencies = options.dependencies[module.id];

        if (false === module.define) { /* For css and js scripts that hasn't called define */
            require(optionsDependencies, function () {
                finish(module);
            });
            return;
        }

        var basePath = module.basePath;
        var define = module.define;
        var factory = define.factory;
        var dependencies = (define.dependencies || []).concat(optionsDependencies || []);

        require.bind({ basePath: basePath })(dependencies, function () {

            var cache;

            if ('function' === typeof factory) {
                if (define.commonJs) {
                    var commonJsExports = {};
                    var commonJsModule = { exports: commonJsExports }; /* Configure CommonJS module */

                    cache = factory.call( /* Get the response from the return value or... */
                        factory,
                        require.bind({ basePath: basePath }),
                        commonJsModule.exports,
                        commonJsModule
                    );

                    if ( /* ...if module.exports was altered or exports has keys, get it from module */
                        (commonJsModule || {}).exports !== commonJsExports ||
                        Object.keys(commonJsExports || {}).length
                    ) {
                        cache = commonJsModule.exports;
                    }
                } else { /* Just apply the arguments if it is in AMD format */
                    cache = factory.apply(factory, arguments);
                }
            } else {
                cache = factory;
            }

            module.cache = cache;

            finish(module);

        });

    }

    /**
     * If the defined url could't be loaded, fallback will be called,
     * and will throw an error if no callbacks are available
     */
    function fallback(module) {

        document.head.removeChild(module.element);
        var path = (module.fallback || []).shift();

        if (!path) {
            return false;
        }

        module.path = path;
        load(module);

        return true;

    }

    /**
     * Action for when the script has loaded
     */
    function createEventListener(module) {

        /* Configure timeout */

        var expired = false;
        var timeout = setTimeout(function () {
            expired = fallback(module); /* If it's the last fallback, false will be returned; keep it active! */
        }, options.timeout);

        /* The actual event listener */

        return function (event) {

            clearTimeout(timeout);

            if (expired) { /* A fallback may be working right now */
                module.define && defineQueue.shift(); /* Remove callback inserted by expired define() call */
                return;
            } else if ('error' === event.type) {
                if (!fallback(module)) { /* If no callbacks are available, throw an Error */
                    if ('undefined' === typeof __DEVELOPMENT__ || __DEVELOPMENT__) {
                        throw new Error('"' + module.id + '" couldn\'t be loaded.');
                    } else {
                        redirectError();
                        return;
                    }
                }
                return;
            }

            var path = module.path;
            var pathAttribute = module.prefix.pathAttribute;

            /* Check if the define call matches the current id */

            if (this.getAttribute(pathAttribute) !== path) {
                if ('undefined' === typeof __DEVELOPMENT__ || __DEVELOPMENT__) {
                    throw new Error('Path mismatch in "' + module.id + '".');
                } else {
                    redirectError();
                    return;
                }
            }

            if (!module.queue) { /* For bootstrap load or require calls in scripts without define */
                return;
            }

            /* Set basePath */

            var pathParser = document.createElement('a');
            pathParser.href = this[pathAttribute];

            module.basePath = pathParser.pathname
                .replace(LAST_SEGMENT_REGEXP, '/')
                .replace(ONLY_SLASHES_REGEXP, '/'); /* Fixes IE */

            /* Break here for modules that doesn't call define */

            if (false === module.define) {
                resolve(module);
                return;
            }

            /* The module should call define, so work on it */

            var lastDefineCall = defineQueue.shift();

            if (defineQueue.length) { /* There should be only one define call in queue... */
                if ('undefined' === typeof __DEVELOPMENT__ || __DEVELOPMENT__) {
                    throw new Error('"' + path + '" has multiple define() calls.');
                } else {
                    redirectError();
                    return;
                }
            } else if (undefined === lastDefineCall) { /* ...and at least one  */
                if ('undefined' === typeof __DEVELOPMENT__ || __DEVELOPMENT__) {
                    throw new Error('"' + module.id + '" wasn\'t defined.');
                } else {
                    redirectError();
                    return;
                }
            }

            module.define = lastDefineCall.define;

            if (lastDefineCall.id) { /* If the module sets its own id, link it to the current id */
                modules[lastDefineCall.id] = module;
            }

            resolve(module);

        };

    }

    /**
     * Prepare path and prefix for use in module loading and set if it is resolvable
     */
    function prepare(module) {

        var path = module.path;
        var prefix = 'js';
        var pathPrefix = path.split('!');
        var optionsRewrite = [];

        if (2 <= pathPrefix.length) { /* Get prefix from path, it has higher priority */
            prefix = pathPrefix.shift();
            path = pathPrefix.join('!');
            pathPrefix = true;
        } else { /* Check for a rewrite rule and get prefix from it, if exists */
            pathPrefix = false;
        }

        options.rewrite.forEach(function (rewrite) {
            if (0 === path.indexOf(rewrite.path)) {
                if (!pathPrefix && rewrite.prefix) {
                    prefix = rewrite.prefix;
                }
                optionsRewrite.push(rewrite.template);
            }
        });

        /* Configure prefix */

        if (!prefixes[prefix]) {
            if ('undefined' === typeof __DEVELOPMENT__ || __DEVELOPMENT__) {
                throw new Error('"' + module.id + '" has an invalid prefix: "' + prefix + '".');
            } else {
                redirectError();
                return;
            }
        }

        prefix = prefixes[prefix]; /* Should be set here, or Error about it will show undefined as prefix name */

        module.prefix = prefix;

        /* Configure path */

        if (path === module.id && !REQUEST_METHOD_REGEXP.exec(path)) {
            prefix.regExp = prefix.regExp || new RegExp('(?:\.' + prefix.extension + ')?$');
            path = path.replace(prefix.regExp, '.' + prefix.extension); /* ...if it isn't already set */
        }

        if (!REQUEST_METHOD_REGEXP.test(path)) {
            REWRITE_PARAMETERS_REGEXP = REWRITE_PARAMETERS_REGEXP || /{ *([^ }]+) *}/g;
            path = optionsRewrite.reduce(function (result, template) {
                return template.replace(REWRITE_PARAMETERS_REGEXP, function (ignore, key) {
                    return 'path' === key ? result : (options.parameters[key] || '');
                }).replace(QUESTION_MARK_REPEAT_REGEXP, '$1&').replace(EMPTY_PARAMETERS_REGEXP, '$1');
            }, path);
        }

        module.path = path;

        /* Configure if module is resolvable */

        module.define = false !== (prefix.hasOwnProperty('define') ? prefix.define : module.define);

    }

    /**
     * Loads modules through DOM element injection
     */
    function load(module, callback) {

        if (callback) {
            if (undefined !== module.cache) { /* Module is loaded */
                callback();
                return;
            } else if (module.queue) { /* Module is loading */
                module.queue.push(callback);
                return;
            } else { /* Module should load */
                module.queue = [callback];
            }
        }

        prepare(module);

        /* Configure element attributes based on module prefix */

        var prefix = module.prefix;
        var element = document.createElement(prefix.tagName); /* Element that injects the module into the document */
        var eventListener = createEventListener(module); /* It must be called just once! */

        element.addEventListener('load', eventListener, false);
        element.addEventListener('error', eventListener, false);

        var attributes = prefix.attributes || {};

        for (var attribute in attributes) {
            if (attributes.hasOwnProperty(attribute)) {
                element.setAttribute(attribute, attributes[attribute]);
            }
        }

        /* Activate element with module path, so it will start loading */

        document.head.appendChild(element);
        module.element = element;

        element.setAttribute(prefix.pathAttribute, module.path);

    }

    /**
     * Normalize ids that are relative paths
     */
    function normalize(id, basePath) {

        var match = NORMALIZE_DOT_REGEXP.exec(id);
        var prefix = '';

        if (!match) {
            return id.replace(BOTH_SLASHES_REGEXP, '');
        } else if ('' === match[1]) {
            id = (basePath || '') + id;
        }

        id = id.split('!');

        if (2 <= id.length) {
            prefix = id.shift() + '!';
        }

        return prefix + id.join('!').split('/').reduce(function (result, segment) {
            if ('..' === segment) {
                result = result.replace(LAST_SEGMENT_REGEXP, '');
            } else if (segment && '.' !== segment) {
                result += '/' + segment;
            }
            return result;
        }, '').replace(HEAD_SLASHES_REGEXP, '');

    }

    /**
     * Map modules to paths and configure them
     */
    function map(id, module) {

        /* Set module with path and id*/

        if (!module || 'string' === typeof module) {
            module = { path: module || id };
        } else {
            module.path = module.path || id;
        }

        module.id = id;

        /* Store and return module */

        modules[id] = module;

        return module;

    }

    /**
     * Define is called from required scripts
     */
    function define(id, dependencies, factory) {

        /* define(dependencies, factory) */

        if (undefined === factory) {
            factory = dependencies;
            dependencies = id;
            id = undefined;
        }

        /* define(factory): search for CommonJS style requires */

        if (undefined === factory) {
            factory = dependencies;
            dependencies = [];

            COMMONJS_REGEXP = COMMONJS_REGEXP || /^ *function *\( *([a-zA-Z_]\w* *)(?: *, *[a-zA-Z_]\w* *){0,2} *\)/;

            var factoryString = factory.toString();
            var commonJs = COMMONJS_REGEXP.exec(factoryString);

            if (commonJs) {

                var requireVar = commonJs[1]; /* The source may be minified, so we can't just search for require */

                var requireRegExp = new RegExp('\\b' + requireVar + ' *\\( *[\'"](.+?)[\'"] *\\)', 'g');
                var dependency;

                while ((dependency = requireRegExp.exec(factoryString))) {
                    dependencies.push(dependency[1]);
                }

            }

            commonJs = !!commonJs;
        }

        /* define(): a factory is required */

        if (undefined === factory) {
            if ('undefined' === typeof __DEVELOPMENT__ || __DEVELOPMENT__) {
                throw new Error('define() was called without a factory.');
            } else {
                redirectError();
                return;
            }
        }

        defineQueue.push({
            id: id,
            define: {
                commonJs: commonJs,
                dependencies: dependencies,
                factory: factory,
            }
        });

    }

    /**
     * Instantiate dependencies and send to callback function
     */
    function require(dependencies, callback) {

        var basePath = this && this.basePath ? this.basePath : undefined;

        if (!Array.isArray(dependencies)) {
            dependencies = dependencies ? [dependencies] : [];
        }

        if (!callback) { /* For require calls in CommonJS style */
            dependencies = dependencies.map(function (id) {
                id = normalize(id, basePath);

                var module = (modules[id] || {}).cache;

                if (undefined === module) {
                    if ('undefined' === typeof __DEVELOPMENT__ || __DEVELOPMENT__) {
                        throw new Error('"' + id + '" must be loaded with a callback.');
                    } else {
                        redirectError();
                        return;
                    }
                }

                return 'require' === id ? module.bind({ basePath: basePath }) : module;
            });

            return 1 === dependencies.length ? dependencies[0] : dependencies;
        }

        /* Set pending requires count */

        var pending = dependencies.length;

        if (!pending) {
            callback();
            return;
        }

        /* Process dependencies */

        dependencies.forEach(function (id, index) {
            id = normalize(id, basePath);

            var module = modules[id] || map(id);

            load(module, function () {
                dependencies[index] = 'require' === id ? module.cache.bind({ basePath: basePath }) : module.cache;
                !--pending && callback.apply(callback, dependencies);
            });
        });

    }

    /**
     * Set global objects properties
     */

    define.amd = { /* To conform with standards */
        jQuery: true, /* To conform with jQuery */
    };

    require.configure = function (configuration) {

        options.dependencies = configuration.dependencies || options.dependencies;
        options.onError = configuration.onError || options.onError;

        var configurationModules = configuration.modules || {};

        for (var id in configurationModules) {
            if (configurationModules.hasOwnProperty(id)) {
                map(id, configurationModules[id]);
            }
        }

        var configurationParameters = configuration.parameters || {};

        for (var parameter in configurationParameters) {
            if (configurationParameters.hasOwnProperty(parameter)) {
                options.parameters[parameter] = configurationParameters[parameter];
            }
        }

        var configurationRewrite = configuration.rewrite || {};

        for (var path in configurationRewrite) {
            if (configurationRewrite.hasOwnProperty(path)) {
                var template = configurationRewrite[path].split('!');
                options.rewrite.push({
                    prefix: 2 <= template.length ? template.shift() : null,
                    path: path.replace(HEAD_SLASHES_REGEXP, ''),
                    template: template.join('!'),
                });
            }
        }

        var configurationTimeout = configuration.timeout;

        if (configurationTimeout) {
            if (1000 > configurationTimeout) {
                if ('undefined' === typeof __DEVELOPMENT__ || __DEVELOPMENT__) {
                    throw new Error('Minimum timeout is 1s.');
                } else {
                    redirectError();
                    return;
                }
            }
            options.timeout = parseInt(configurationTimeout);
        }

    };

    require.parameters = options.parameters;

    window.define = define;
    window.require = require;

    /**
     * Launch bootstrap
     */

    var bootstrap;
    var baseUrl = '';
    var cacheKey = '';
    var script = [].slice.call(document.getElementsByTagName('script'), -1)[0];
    var parameters = [].reduce.call(script.attributes, function(result, attribute) {
        var name = attribute.name;
        var value = attribute.value;

        if ('data-base-url' === name) {
            baseUrl = value.replace(BOTH_SLASHES_REGEXP, '');
        } else if ('data-bootstrap' === name) {
            bootstrap = value;
        } else if ('data-version' === name) {
            cacheKey = '?v=' + value;
        } else if (0 === name.indexOf('data-')) {
            result[name.substr(5)] = value;
        }

        return result;
    }, {});

    require.configure({
        parameters: parameters,
        rewrite: (baseUrl || cacheKey) ? { '': baseUrl + '/{path}' + cacheKey } : {}
    });

    bootstrap && load(map(bootstrap));

}(window, document));
