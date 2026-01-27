(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // node_modules/react/cjs/react.development.js
  var require_react_development = __commonJS({
    "node_modules/react/cjs/react.development.js"(exports, module) {
      "use strict";
      if (true) {
        (function() {
          "use strict";
          if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ !== "undefined" && typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart === "function") {
            __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart(new Error());
          }
          var ReactVersion = "18.3.1";
          var REACT_ELEMENT_TYPE = Symbol.for("react.element");
          var REACT_PORTAL_TYPE = Symbol.for("react.portal");
          var REACT_FRAGMENT_TYPE = Symbol.for("react.fragment");
          var REACT_STRICT_MODE_TYPE = Symbol.for("react.strict_mode");
          var REACT_PROFILER_TYPE = Symbol.for("react.profiler");
          var REACT_PROVIDER_TYPE = Symbol.for("react.provider");
          var REACT_CONTEXT_TYPE = Symbol.for("react.context");
          var REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref");
          var REACT_SUSPENSE_TYPE = Symbol.for("react.suspense");
          var REACT_SUSPENSE_LIST_TYPE = Symbol.for("react.suspense_list");
          var REACT_MEMO_TYPE = Symbol.for("react.memo");
          var REACT_LAZY_TYPE = Symbol.for("react.lazy");
          var REACT_OFFSCREEN_TYPE = Symbol.for("react.offscreen");
          var MAYBE_ITERATOR_SYMBOL = Symbol.iterator;
          var FAUX_ITERATOR_SYMBOL = "@@iterator";
          function getIteratorFn(maybeIterable) {
            if (maybeIterable === null || typeof maybeIterable !== "object") {
              return null;
            }
            var maybeIterator = MAYBE_ITERATOR_SYMBOL && maybeIterable[MAYBE_ITERATOR_SYMBOL] || maybeIterable[FAUX_ITERATOR_SYMBOL];
            if (typeof maybeIterator === "function") {
              return maybeIterator;
            }
            return null;
          }
          var ReactCurrentDispatcher = {
            /**
             * @internal
             * @type {ReactComponent}
             */
            current: null
          };
          var ReactCurrentBatchConfig = {
            transition: null
          };
          var ReactCurrentActQueue = {
            current: null,
            // Used to reproduce behavior of `batchedUpdates` in legacy mode.
            isBatchingLegacy: false,
            didScheduleLegacyUpdate: false
          };
          var ReactCurrentOwner = {
            /**
             * @internal
             * @type {ReactComponent}
             */
            current: null
          };
          var ReactDebugCurrentFrame = {};
          var currentExtraStackFrame = null;
          function setExtraStackFrame(stack) {
            {
              currentExtraStackFrame = stack;
            }
          }
          {
            ReactDebugCurrentFrame.setExtraStackFrame = function(stack) {
              {
                currentExtraStackFrame = stack;
              }
            };
            ReactDebugCurrentFrame.getCurrentStack = null;
            ReactDebugCurrentFrame.getStackAddendum = function() {
              var stack = "";
              if (currentExtraStackFrame) {
                stack += currentExtraStackFrame;
              }
              var impl = ReactDebugCurrentFrame.getCurrentStack;
              if (impl) {
                stack += impl() || "";
              }
              return stack;
            };
          }
          var enableScopeAPI = false;
          var enableCacheElement = false;
          var enableTransitionTracing = false;
          var enableLegacyHidden = false;
          var enableDebugTracing = false;
          var ReactSharedInternals = {
            ReactCurrentDispatcher,
            ReactCurrentBatchConfig,
            ReactCurrentOwner
          };
          {
            ReactSharedInternals.ReactDebugCurrentFrame = ReactDebugCurrentFrame;
            ReactSharedInternals.ReactCurrentActQueue = ReactCurrentActQueue;
          }
          function warn(format) {
            {
              {
                for (var _len = arguments.length, args = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
                  args[_key - 1] = arguments[_key];
                }
                printWarning("warn", format, args);
              }
            }
          }
          function error(format) {
            {
              {
                for (var _len2 = arguments.length, args = new Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) {
                  args[_key2 - 1] = arguments[_key2];
                }
                printWarning("error", format, args);
              }
            }
          }
          function printWarning(level, format, args) {
            {
              var ReactDebugCurrentFrame2 = ReactSharedInternals.ReactDebugCurrentFrame;
              var stack = ReactDebugCurrentFrame2.getStackAddendum();
              if (stack !== "") {
                format += "%s";
                args = args.concat([stack]);
              }
              var argsWithFormat = args.map(function(item) {
                return String(item);
              });
              argsWithFormat.unshift("Warning: " + format);
              Function.prototype.apply.call(console[level], console, argsWithFormat);
            }
          }
          var didWarnStateUpdateForUnmountedComponent = {};
          function warnNoop(publicInstance, callerName) {
            {
              var _constructor = publicInstance.constructor;
              var componentName = _constructor && (_constructor.displayName || _constructor.name) || "ReactClass";
              var warningKey = componentName + "." + callerName;
              if (didWarnStateUpdateForUnmountedComponent[warningKey]) {
                return;
              }
              error("Can't call %s on a component that is not yet mounted. This is a no-op, but it might indicate a bug in your application. Instead, assign to `this.state` directly or define a `state = {};` class property with the desired state in the %s component.", callerName, componentName);
              didWarnStateUpdateForUnmountedComponent[warningKey] = true;
            }
          }
          var ReactNoopUpdateQueue = {
            /**
             * Checks whether or not this composite component is mounted.
             * @param {ReactClass} publicInstance The instance we want to test.
             * @return {boolean} True if mounted, false otherwise.
             * @protected
             * @final
             */
            isMounted: function(publicInstance) {
              return false;
            },
            /**
             * Forces an update. This should only be invoked when it is known with
             * certainty that we are **not** in a DOM transaction.
             *
             * You may want to call this when you know that some deeper aspect of the
             * component's state has changed but `setState` was not called.
             *
             * This will not invoke `shouldComponentUpdate`, but it will invoke
             * `componentWillUpdate` and `componentDidUpdate`.
             *
             * @param {ReactClass} publicInstance The instance that should rerender.
             * @param {?function} callback Called after component is updated.
             * @param {?string} callerName name of the calling function in the public API.
             * @internal
             */
            enqueueForceUpdate: function(publicInstance, callback, callerName) {
              warnNoop(publicInstance, "forceUpdate");
            },
            /**
             * Replaces all of the state. Always use this or `setState` to mutate state.
             * You should treat `this.state` as immutable.
             *
             * There is no guarantee that `this.state` will be immediately updated, so
             * accessing `this.state` after calling this method may return the old value.
             *
             * @param {ReactClass} publicInstance The instance that should rerender.
             * @param {object} completeState Next state.
             * @param {?function} callback Called after component is updated.
             * @param {?string} callerName name of the calling function in the public API.
             * @internal
             */
            enqueueReplaceState: function(publicInstance, completeState, callback, callerName) {
              warnNoop(publicInstance, "replaceState");
            },
            /**
             * Sets a subset of the state. This only exists because _pendingState is
             * internal. This provides a merging strategy that is not available to deep
             * properties which is confusing. TODO: Expose pendingState or don't use it
             * during the merge.
             *
             * @param {ReactClass} publicInstance The instance that should rerender.
             * @param {object} partialState Next partial state to be merged with state.
             * @param {?function} callback Called after component is updated.
             * @param {?string} Name of the calling function in the public API.
             * @internal
             */
            enqueueSetState: function(publicInstance, partialState, callback, callerName) {
              warnNoop(publicInstance, "setState");
            }
          };
          var assign = Object.assign;
          var emptyObject = {};
          {
            Object.freeze(emptyObject);
          }
          function Component(props, context, updater) {
            this.props = props;
            this.context = context;
            this.refs = emptyObject;
            this.updater = updater || ReactNoopUpdateQueue;
          }
          Component.prototype.isReactComponent = {};
          Component.prototype.setState = function(partialState, callback) {
            if (typeof partialState !== "object" && typeof partialState !== "function" && partialState != null) {
              throw new Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.");
            }
            this.updater.enqueueSetState(this, partialState, callback, "setState");
          };
          Component.prototype.forceUpdate = function(callback) {
            this.updater.enqueueForceUpdate(this, callback, "forceUpdate");
          };
          {
            var deprecatedAPIs = {
              isMounted: ["isMounted", "Instead, make sure to clean up subscriptions and pending requests in componentWillUnmount to prevent memory leaks."],
              replaceState: ["replaceState", "Refactor your code to use setState instead (see https://github.com/facebook/react/issues/3236)."]
            };
            var defineDeprecationWarning = function(methodName, info) {
              Object.defineProperty(Component.prototype, methodName, {
                get: function() {
                  warn("%s(...) is deprecated in plain JavaScript React classes. %s", info[0], info[1]);
                  return void 0;
                }
              });
            };
            for (var fnName in deprecatedAPIs) {
              if (deprecatedAPIs.hasOwnProperty(fnName)) {
                defineDeprecationWarning(fnName, deprecatedAPIs[fnName]);
              }
            }
          }
          function ComponentDummy() {
          }
          ComponentDummy.prototype = Component.prototype;
          function PureComponent(props, context, updater) {
            this.props = props;
            this.context = context;
            this.refs = emptyObject;
            this.updater = updater || ReactNoopUpdateQueue;
          }
          var pureComponentPrototype = PureComponent.prototype = new ComponentDummy();
          pureComponentPrototype.constructor = PureComponent;
          assign(pureComponentPrototype, Component.prototype);
          pureComponentPrototype.isPureReactComponent = true;
          function createRef() {
            var refObject = {
              current: null
            };
            {
              Object.seal(refObject);
            }
            return refObject;
          }
          var isArrayImpl = Array.isArray;
          function isArray(a) {
            return isArrayImpl(a);
          }
          function typeName(value) {
            {
              var hasToStringTag = typeof Symbol === "function" && Symbol.toStringTag;
              var type = hasToStringTag && value[Symbol.toStringTag] || value.constructor.name || "Object";
              return type;
            }
          }
          function willCoercionThrow(value) {
            {
              try {
                testStringCoercion(value);
                return false;
              } catch (e) {
                return true;
              }
            }
          }
          function testStringCoercion(value) {
            return "" + value;
          }
          function checkKeyStringCoercion(value) {
            {
              if (willCoercionThrow(value)) {
                error("The provided key is an unsupported type %s. This value must be coerced to a string before before using it here.", typeName(value));
                return testStringCoercion(value);
              }
            }
          }
          function getWrappedName(outerType, innerType, wrapperName) {
            var displayName = outerType.displayName;
            if (displayName) {
              return displayName;
            }
            var functionName = innerType.displayName || innerType.name || "";
            return functionName !== "" ? wrapperName + "(" + functionName + ")" : wrapperName;
          }
          function getContextName(type) {
            return type.displayName || "Context";
          }
          function getComponentNameFromType(type) {
            if (type == null) {
              return null;
            }
            {
              if (typeof type.tag === "number") {
                error("Received an unexpected object in getComponentNameFromType(). This is likely a bug in React. Please file an issue.");
              }
            }
            if (typeof type === "function") {
              return type.displayName || type.name || null;
            }
            if (typeof type === "string") {
              return type;
            }
            switch (type) {
              case REACT_FRAGMENT_TYPE:
                return "Fragment";
              case REACT_PORTAL_TYPE:
                return "Portal";
              case REACT_PROFILER_TYPE:
                return "Profiler";
              case REACT_STRICT_MODE_TYPE:
                return "StrictMode";
              case REACT_SUSPENSE_TYPE:
                return "Suspense";
              case REACT_SUSPENSE_LIST_TYPE:
                return "SuspenseList";
            }
            if (typeof type === "object") {
              switch (type.$$typeof) {
                case REACT_CONTEXT_TYPE:
                  var context = type;
                  return getContextName(context) + ".Consumer";
                case REACT_PROVIDER_TYPE:
                  var provider = type;
                  return getContextName(provider._context) + ".Provider";
                case REACT_FORWARD_REF_TYPE:
                  return getWrappedName(type, type.render, "ForwardRef");
                case REACT_MEMO_TYPE:
                  var outerName = type.displayName || null;
                  if (outerName !== null) {
                    return outerName;
                  }
                  return getComponentNameFromType(type.type) || "Memo";
                case REACT_LAZY_TYPE: {
                  var lazyComponent = type;
                  var payload = lazyComponent._payload;
                  var init = lazyComponent._init;
                  try {
                    return getComponentNameFromType(init(payload));
                  } catch (x) {
                    return null;
                  }
                }
              }
            }
            return null;
          }
          var hasOwnProperty = Object.prototype.hasOwnProperty;
          var RESERVED_PROPS = {
            key: true,
            ref: true,
            __self: true,
            __source: true
          };
          var specialPropKeyWarningShown, specialPropRefWarningShown, didWarnAboutStringRefs;
          {
            didWarnAboutStringRefs = {};
          }
          function hasValidRef(config) {
            {
              if (hasOwnProperty.call(config, "ref")) {
                var getter = Object.getOwnPropertyDescriptor(config, "ref").get;
                if (getter && getter.isReactWarning) {
                  return false;
                }
              }
            }
            return config.ref !== void 0;
          }
          function hasValidKey(config) {
            {
              if (hasOwnProperty.call(config, "key")) {
                var getter = Object.getOwnPropertyDescriptor(config, "key").get;
                if (getter && getter.isReactWarning) {
                  return false;
                }
              }
            }
            return config.key !== void 0;
          }
          function defineKeyPropWarningGetter(props, displayName) {
            var warnAboutAccessingKey = function() {
              {
                if (!specialPropKeyWarningShown) {
                  specialPropKeyWarningShown = true;
                  error("%s: `key` is not a prop. Trying to access it will result in `undefined` being returned. If you need to access the same value within the child component, you should pass it as a different prop. (https://reactjs.org/link/special-props)", displayName);
                }
              }
            };
            warnAboutAccessingKey.isReactWarning = true;
            Object.defineProperty(props, "key", {
              get: warnAboutAccessingKey,
              configurable: true
            });
          }
          function defineRefPropWarningGetter(props, displayName) {
            var warnAboutAccessingRef = function() {
              {
                if (!specialPropRefWarningShown) {
                  specialPropRefWarningShown = true;
                  error("%s: `ref` is not a prop. Trying to access it will result in `undefined` being returned. If you need to access the same value within the child component, you should pass it as a different prop. (https://reactjs.org/link/special-props)", displayName);
                }
              }
            };
            warnAboutAccessingRef.isReactWarning = true;
            Object.defineProperty(props, "ref", {
              get: warnAboutAccessingRef,
              configurable: true
            });
          }
          function warnIfStringRefCannotBeAutoConverted(config) {
            {
              if (typeof config.ref === "string" && ReactCurrentOwner.current && config.__self && ReactCurrentOwner.current.stateNode !== config.__self) {
                var componentName = getComponentNameFromType(ReactCurrentOwner.current.type);
                if (!didWarnAboutStringRefs[componentName]) {
                  error('Component "%s" contains the string ref "%s". Support for string refs will be removed in a future major release. This case cannot be automatically converted to an arrow function. We ask you to manually fix this case by using useRef() or createRef() instead. Learn more about using refs safely here: https://reactjs.org/link/strict-mode-string-ref', componentName, config.ref);
                  didWarnAboutStringRefs[componentName] = true;
                }
              }
            }
          }
          var ReactElement = function(type, key, ref, self, source, owner, props) {
            var element = {
              // This tag allows us to uniquely identify this as a React Element
              $$typeof: REACT_ELEMENT_TYPE,
              // Built-in properties that belong on the element
              type,
              key,
              ref,
              props,
              // Record the component responsible for creating this element.
              _owner: owner
            };
            {
              element._store = {};
              Object.defineProperty(element._store, "validated", {
                configurable: false,
                enumerable: false,
                writable: true,
                value: false
              });
              Object.defineProperty(element, "_self", {
                configurable: false,
                enumerable: false,
                writable: false,
                value: self
              });
              Object.defineProperty(element, "_source", {
                configurable: false,
                enumerable: false,
                writable: false,
                value: source
              });
              if (Object.freeze) {
                Object.freeze(element.props);
                Object.freeze(element);
              }
            }
            return element;
          };
          function createElement(type, config, children) {
            var propName;
            var props = {};
            var key = null;
            var ref = null;
            var self = null;
            var source = null;
            if (config != null) {
              if (hasValidRef(config)) {
                ref = config.ref;
                {
                  warnIfStringRefCannotBeAutoConverted(config);
                }
              }
              if (hasValidKey(config)) {
                {
                  checkKeyStringCoercion(config.key);
                }
                key = "" + config.key;
              }
              self = config.__self === void 0 ? null : config.__self;
              source = config.__source === void 0 ? null : config.__source;
              for (propName in config) {
                if (hasOwnProperty.call(config, propName) && !RESERVED_PROPS.hasOwnProperty(propName)) {
                  props[propName] = config[propName];
                }
              }
            }
            var childrenLength = arguments.length - 2;
            if (childrenLength === 1) {
              props.children = children;
            } else if (childrenLength > 1) {
              var childArray = Array(childrenLength);
              for (var i = 0; i < childrenLength; i++) {
                childArray[i] = arguments[i + 2];
              }
              {
                if (Object.freeze) {
                  Object.freeze(childArray);
                }
              }
              props.children = childArray;
            }
            if (type && type.defaultProps) {
              var defaultProps = type.defaultProps;
              for (propName in defaultProps) {
                if (props[propName] === void 0) {
                  props[propName] = defaultProps[propName];
                }
              }
            }
            {
              if (key || ref) {
                var displayName = typeof type === "function" ? type.displayName || type.name || "Unknown" : type;
                if (key) {
                  defineKeyPropWarningGetter(props, displayName);
                }
                if (ref) {
                  defineRefPropWarningGetter(props, displayName);
                }
              }
            }
            return ReactElement(type, key, ref, self, source, ReactCurrentOwner.current, props);
          }
          function cloneAndReplaceKey(oldElement, newKey) {
            var newElement = ReactElement(oldElement.type, newKey, oldElement.ref, oldElement._self, oldElement._source, oldElement._owner, oldElement.props);
            return newElement;
          }
          function cloneElement(element, config, children) {
            if (element === null || element === void 0) {
              throw new Error("React.cloneElement(...): The argument must be a React element, but you passed " + element + ".");
            }
            var propName;
            var props = assign({}, element.props);
            var key = element.key;
            var ref = element.ref;
            var self = element._self;
            var source = element._source;
            var owner = element._owner;
            if (config != null) {
              if (hasValidRef(config)) {
                ref = config.ref;
                owner = ReactCurrentOwner.current;
              }
              if (hasValidKey(config)) {
                {
                  checkKeyStringCoercion(config.key);
                }
                key = "" + config.key;
              }
              var defaultProps;
              if (element.type && element.type.defaultProps) {
                defaultProps = element.type.defaultProps;
              }
              for (propName in config) {
                if (hasOwnProperty.call(config, propName) && !RESERVED_PROPS.hasOwnProperty(propName)) {
                  if (config[propName] === void 0 && defaultProps !== void 0) {
                    props[propName] = defaultProps[propName];
                  } else {
                    props[propName] = config[propName];
                  }
                }
              }
            }
            var childrenLength = arguments.length - 2;
            if (childrenLength === 1) {
              props.children = children;
            } else if (childrenLength > 1) {
              var childArray = Array(childrenLength);
              for (var i = 0; i < childrenLength; i++) {
                childArray[i] = arguments[i + 2];
              }
              props.children = childArray;
            }
            return ReactElement(element.type, key, ref, self, source, owner, props);
          }
          function isValidElement(object) {
            return typeof object === "object" && object !== null && object.$$typeof === REACT_ELEMENT_TYPE;
          }
          var SEPARATOR = ".";
          var SUBSEPARATOR = ":";
          function escape(key) {
            var escapeRegex = /[=:]/g;
            var escaperLookup = {
              "=": "=0",
              ":": "=2"
            };
            var escapedString = key.replace(escapeRegex, function(match) {
              return escaperLookup[match];
            });
            return "$" + escapedString;
          }
          var didWarnAboutMaps = false;
          var userProvidedKeyEscapeRegex = /\/+/g;
          function escapeUserProvidedKey(text) {
            return text.replace(userProvidedKeyEscapeRegex, "$&/");
          }
          function getElementKey(element, index) {
            if (typeof element === "object" && element !== null && element.key != null) {
              {
                checkKeyStringCoercion(element.key);
              }
              return escape("" + element.key);
            }
            return index.toString(36);
          }
          function mapIntoArray(children, array, escapedPrefix, nameSoFar, callback) {
            var type = typeof children;
            if (type === "undefined" || type === "boolean") {
              children = null;
            }
            var invokeCallback = false;
            if (children === null) {
              invokeCallback = true;
            } else {
              switch (type) {
                case "string":
                case "number":
                  invokeCallback = true;
                  break;
                case "object":
                  switch (children.$$typeof) {
                    case REACT_ELEMENT_TYPE:
                    case REACT_PORTAL_TYPE:
                      invokeCallback = true;
                  }
              }
            }
            if (invokeCallback) {
              var _child = children;
              var mappedChild = callback(_child);
              var childKey = nameSoFar === "" ? SEPARATOR + getElementKey(_child, 0) : nameSoFar;
              if (isArray(mappedChild)) {
                var escapedChildKey = "";
                if (childKey != null) {
                  escapedChildKey = escapeUserProvidedKey(childKey) + "/";
                }
                mapIntoArray(mappedChild, array, escapedChildKey, "", function(c) {
                  return c;
                });
              } else if (mappedChild != null) {
                if (isValidElement(mappedChild)) {
                  {
                    if (mappedChild.key && (!_child || _child.key !== mappedChild.key)) {
                      checkKeyStringCoercion(mappedChild.key);
                    }
                  }
                  mappedChild = cloneAndReplaceKey(
                    mappedChild,
                    // Keep both the (mapped) and old keys if they differ, just as
                    // traverseAllChildren used to do for objects as children
                    escapedPrefix + // $FlowFixMe Flow incorrectly thinks React.Portal doesn't have a key
                    (mappedChild.key && (!_child || _child.key !== mappedChild.key) ? (
                      // $FlowFixMe Flow incorrectly thinks existing element's key can be a number
                      // eslint-disable-next-line react-internal/safe-string-coercion
                      escapeUserProvidedKey("" + mappedChild.key) + "/"
                    ) : "") + childKey
                  );
                }
                array.push(mappedChild);
              }
              return 1;
            }
            var child;
            var nextName;
            var subtreeCount = 0;
            var nextNamePrefix = nameSoFar === "" ? SEPARATOR : nameSoFar + SUBSEPARATOR;
            if (isArray(children)) {
              for (var i = 0; i < children.length; i++) {
                child = children[i];
                nextName = nextNamePrefix + getElementKey(child, i);
                subtreeCount += mapIntoArray(child, array, escapedPrefix, nextName, callback);
              }
            } else {
              var iteratorFn = getIteratorFn(children);
              if (typeof iteratorFn === "function") {
                var iterableChildren = children;
                {
                  if (iteratorFn === iterableChildren.entries) {
                    if (!didWarnAboutMaps) {
                      warn("Using Maps as children is not supported. Use an array of keyed ReactElements instead.");
                    }
                    didWarnAboutMaps = true;
                  }
                }
                var iterator = iteratorFn.call(iterableChildren);
                var step;
                var ii = 0;
                while (!(step = iterator.next()).done) {
                  child = step.value;
                  nextName = nextNamePrefix + getElementKey(child, ii++);
                  subtreeCount += mapIntoArray(child, array, escapedPrefix, nextName, callback);
                }
              } else if (type === "object") {
                var childrenString = String(children);
                throw new Error("Objects are not valid as a React child (found: " + (childrenString === "[object Object]" ? "object with keys {" + Object.keys(children).join(", ") + "}" : childrenString) + "). If you meant to render a collection of children, use an array instead.");
              }
            }
            return subtreeCount;
          }
          function mapChildren(children, func, context) {
            if (children == null) {
              return children;
            }
            var result = [];
            var count = 0;
            mapIntoArray(children, result, "", "", function(child) {
              return func.call(context, child, count++);
            });
            return result;
          }
          function countChildren(children) {
            var n = 0;
            mapChildren(children, function() {
              n++;
            });
            return n;
          }
          function forEachChildren(children, forEachFunc, forEachContext) {
            mapChildren(children, function() {
              forEachFunc.apply(this, arguments);
            }, forEachContext);
          }
          function toArray(children) {
            return mapChildren(children, function(child) {
              return child;
            }) || [];
          }
          function onlyChild(children) {
            if (!isValidElement(children)) {
              throw new Error("React.Children.only expected to receive a single React element child.");
            }
            return children;
          }
          function createContext(defaultValue) {
            var context = {
              $$typeof: REACT_CONTEXT_TYPE,
              // As a workaround to support multiple concurrent renderers, we categorize
              // some renderers as primary and others as secondary. We only expect
              // there to be two concurrent renderers at most: React Native (primary) and
              // Fabric (secondary); React DOM (primary) and React ART (secondary).
              // Secondary renderers store their context values on separate fields.
              _currentValue: defaultValue,
              _currentValue2: defaultValue,
              // Used to track how many concurrent renderers this context currently
              // supports within in a single renderer. Such as parallel server rendering.
              _threadCount: 0,
              // These are circular
              Provider: null,
              Consumer: null,
              // Add these to use same hidden class in VM as ServerContext
              _defaultValue: null,
              _globalName: null
            };
            context.Provider = {
              $$typeof: REACT_PROVIDER_TYPE,
              _context: context
            };
            var hasWarnedAboutUsingNestedContextConsumers = false;
            var hasWarnedAboutUsingConsumerProvider = false;
            var hasWarnedAboutDisplayNameOnConsumer = false;
            {
              var Consumer = {
                $$typeof: REACT_CONTEXT_TYPE,
                _context: context
              };
              Object.defineProperties(Consumer, {
                Provider: {
                  get: function() {
                    if (!hasWarnedAboutUsingConsumerProvider) {
                      hasWarnedAboutUsingConsumerProvider = true;
                      error("Rendering <Context.Consumer.Provider> is not supported and will be removed in a future major release. Did you mean to render <Context.Provider> instead?");
                    }
                    return context.Provider;
                  },
                  set: function(_Provider) {
                    context.Provider = _Provider;
                  }
                },
                _currentValue: {
                  get: function() {
                    return context._currentValue;
                  },
                  set: function(_currentValue) {
                    context._currentValue = _currentValue;
                  }
                },
                _currentValue2: {
                  get: function() {
                    return context._currentValue2;
                  },
                  set: function(_currentValue2) {
                    context._currentValue2 = _currentValue2;
                  }
                },
                _threadCount: {
                  get: function() {
                    return context._threadCount;
                  },
                  set: function(_threadCount) {
                    context._threadCount = _threadCount;
                  }
                },
                Consumer: {
                  get: function() {
                    if (!hasWarnedAboutUsingNestedContextConsumers) {
                      hasWarnedAboutUsingNestedContextConsumers = true;
                      error("Rendering <Context.Consumer.Consumer> is not supported and will be removed in a future major release. Did you mean to render <Context.Consumer> instead?");
                    }
                    return context.Consumer;
                  }
                },
                displayName: {
                  get: function() {
                    return context.displayName;
                  },
                  set: function(displayName) {
                    if (!hasWarnedAboutDisplayNameOnConsumer) {
                      warn("Setting `displayName` on Context.Consumer has no effect. You should set it directly on the context with Context.displayName = '%s'.", displayName);
                      hasWarnedAboutDisplayNameOnConsumer = true;
                    }
                  }
                }
              });
              context.Consumer = Consumer;
            }
            {
              context._currentRenderer = null;
              context._currentRenderer2 = null;
            }
            return context;
          }
          var Uninitialized = -1;
          var Pending = 0;
          var Resolved = 1;
          var Rejected = 2;
          function lazyInitializer(payload) {
            if (payload._status === Uninitialized) {
              var ctor = payload._result;
              var thenable = ctor();
              thenable.then(function(moduleObject2) {
                if (payload._status === Pending || payload._status === Uninitialized) {
                  var resolved = payload;
                  resolved._status = Resolved;
                  resolved._result = moduleObject2;
                }
              }, function(error2) {
                if (payload._status === Pending || payload._status === Uninitialized) {
                  var rejected = payload;
                  rejected._status = Rejected;
                  rejected._result = error2;
                }
              });
              if (payload._status === Uninitialized) {
                var pending = payload;
                pending._status = Pending;
                pending._result = thenable;
              }
            }
            if (payload._status === Resolved) {
              var moduleObject = payload._result;
              {
                if (moduleObject === void 0) {
                  error("lazy: Expected the result of a dynamic import() call. Instead received: %s\n\nYour code should look like: \n  const MyComponent = lazy(() => import('./MyComponent'))\n\nDid you accidentally put curly braces around the import?", moduleObject);
                }
              }
              {
                if (!("default" in moduleObject)) {
                  error("lazy: Expected the result of a dynamic import() call. Instead received: %s\n\nYour code should look like: \n  const MyComponent = lazy(() => import('./MyComponent'))", moduleObject);
                }
              }
              return moduleObject.default;
            } else {
              throw payload._result;
            }
          }
          function lazy(ctor) {
            var payload = {
              // We use these fields to store the result.
              _status: Uninitialized,
              _result: ctor
            };
            var lazyType = {
              $$typeof: REACT_LAZY_TYPE,
              _payload: payload,
              _init: lazyInitializer
            };
            {
              var defaultProps;
              var propTypes;
              Object.defineProperties(lazyType, {
                defaultProps: {
                  configurable: true,
                  get: function() {
                    return defaultProps;
                  },
                  set: function(newDefaultProps) {
                    error("React.lazy(...): It is not supported to assign `defaultProps` to a lazy component import. Either specify them where the component is defined, or create a wrapping component around it.");
                    defaultProps = newDefaultProps;
                    Object.defineProperty(lazyType, "defaultProps", {
                      enumerable: true
                    });
                  }
                },
                propTypes: {
                  configurable: true,
                  get: function() {
                    return propTypes;
                  },
                  set: function(newPropTypes) {
                    error("React.lazy(...): It is not supported to assign `propTypes` to a lazy component import. Either specify them where the component is defined, or create a wrapping component around it.");
                    propTypes = newPropTypes;
                    Object.defineProperty(lazyType, "propTypes", {
                      enumerable: true
                    });
                  }
                }
              });
            }
            return lazyType;
          }
          function forwardRef(render) {
            {
              if (render != null && render.$$typeof === REACT_MEMO_TYPE) {
                error("forwardRef requires a render function but received a `memo` component. Instead of forwardRef(memo(...)), use memo(forwardRef(...)).");
              } else if (typeof render !== "function") {
                error("forwardRef requires a render function but was given %s.", render === null ? "null" : typeof render);
              } else {
                if (render.length !== 0 && render.length !== 2) {
                  error("forwardRef render functions accept exactly two parameters: props and ref. %s", render.length === 1 ? "Did you forget to use the ref parameter?" : "Any additional parameter will be undefined.");
                }
              }
              if (render != null) {
                if (render.defaultProps != null || render.propTypes != null) {
                  error("forwardRef render functions do not support propTypes or defaultProps. Did you accidentally pass a React component?");
                }
              }
            }
            var elementType = {
              $$typeof: REACT_FORWARD_REF_TYPE,
              render
            };
            {
              var ownName;
              Object.defineProperty(elementType, "displayName", {
                enumerable: false,
                configurable: true,
                get: function() {
                  return ownName;
                },
                set: function(name) {
                  ownName = name;
                  if (!render.name && !render.displayName) {
                    render.displayName = name;
                  }
                }
              });
            }
            return elementType;
          }
          var REACT_MODULE_REFERENCE;
          {
            REACT_MODULE_REFERENCE = Symbol.for("react.module.reference");
          }
          function isValidElementType(type) {
            if (typeof type === "string" || typeof type === "function") {
              return true;
            }
            if (type === REACT_FRAGMENT_TYPE || type === REACT_PROFILER_TYPE || enableDebugTracing || type === REACT_STRICT_MODE_TYPE || type === REACT_SUSPENSE_TYPE || type === REACT_SUSPENSE_LIST_TYPE || enableLegacyHidden || type === REACT_OFFSCREEN_TYPE || enableScopeAPI || enableCacheElement || enableTransitionTracing) {
              return true;
            }
            if (typeof type === "object" && type !== null) {
              if (type.$$typeof === REACT_LAZY_TYPE || type.$$typeof === REACT_MEMO_TYPE || type.$$typeof === REACT_PROVIDER_TYPE || type.$$typeof === REACT_CONTEXT_TYPE || type.$$typeof === REACT_FORWARD_REF_TYPE || // This needs to include all possible module reference object
              // types supported by any Flight configuration anywhere since
              // we don't know which Flight build this will end up being used
              // with.
              type.$$typeof === REACT_MODULE_REFERENCE || type.getModuleId !== void 0) {
                return true;
              }
            }
            return false;
          }
          function memo(type, compare) {
            {
              if (!isValidElementType(type)) {
                error("memo: The first argument must be a component. Instead received: %s", type === null ? "null" : typeof type);
              }
            }
            var elementType = {
              $$typeof: REACT_MEMO_TYPE,
              type,
              compare: compare === void 0 ? null : compare
            };
            {
              var ownName;
              Object.defineProperty(elementType, "displayName", {
                enumerable: false,
                configurable: true,
                get: function() {
                  return ownName;
                },
                set: function(name) {
                  ownName = name;
                  if (!type.name && !type.displayName) {
                    type.displayName = name;
                  }
                }
              });
            }
            return elementType;
          }
          function resolveDispatcher() {
            var dispatcher = ReactCurrentDispatcher.current;
            {
              if (dispatcher === null) {
                error("Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for one of the following reasons:\n1. You might have mismatching versions of React and the renderer (such as React DOM)\n2. You might be breaking the Rules of Hooks\n3. You might have more than one copy of React in the same app\nSee https://reactjs.org/link/invalid-hook-call for tips about how to debug and fix this problem.");
              }
            }
            return dispatcher;
          }
          function useContext(Context) {
            var dispatcher = resolveDispatcher();
            {
              if (Context._context !== void 0) {
                var realContext = Context._context;
                if (realContext.Consumer === Context) {
                  error("Calling useContext(Context.Consumer) is not supported, may cause bugs, and will be removed in a future major release. Did you mean to call useContext(Context) instead?");
                } else if (realContext.Provider === Context) {
                  error("Calling useContext(Context.Provider) is not supported. Did you mean to call useContext(Context) instead?");
                }
              }
            }
            return dispatcher.useContext(Context);
          }
          function useState2(initialState) {
            var dispatcher = resolveDispatcher();
            return dispatcher.useState(initialState);
          }
          function useReducer(reducer, initialArg, init) {
            var dispatcher = resolveDispatcher();
            return dispatcher.useReducer(reducer, initialArg, init);
          }
          function useRef(initialValue) {
            var dispatcher = resolveDispatcher();
            return dispatcher.useRef(initialValue);
          }
          function useEffect2(create, deps) {
            var dispatcher = resolveDispatcher();
            return dispatcher.useEffect(create, deps);
          }
          function useInsertionEffect(create, deps) {
            var dispatcher = resolveDispatcher();
            return dispatcher.useInsertionEffect(create, deps);
          }
          function useLayoutEffect(create, deps) {
            var dispatcher = resolveDispatcher();
            return dispatcher.useLayoutEffect(create, deps);
          }
          function useCallback(callback, deps) {
            var dispatcher = resolveDispatcher();
            return dispatcher.useCallback(callback, deps);
          }
          function useMemo2(create, deps) {
            var dispatcher = resolveDispatcher();
            return dispatcher.useMemo(create, deps);
          }
          function useImperativeHandle(ref, create, deps) {
            var dispatcher = resolveDispatcher();
            return dispatcher.useImperativeHandle(ref, create, deps);
          }
          function useDebugValue(value, formatterFn) {
            {
              var dispatcher = resolveDispatcher();
              return dispatcher.useDebugValue(value, formatterFn);
            }
          }
          function useTransition() {
            var dispatcher = resolveDispatcher();
            return dispatcher.useTransition();
          }
          function useDeferredValue(value) {
            var dispatcher = resolveDispatcher();
            return dispatcher.useDeferredValue(value);
          }
          function useId() {
            var dispatcher = resolveDispatcher();
            return dispatcher.useId();
          }
          function useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
            var dispatcher = resolveDispatcher();
            return dispatcher.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
          }
          var disabledDepth = 0;
          var prevLog;
          var prevInfo;
          var prevWarn;
          var prevError;
          var prevGroup;
          var prevGroupCollapsed;
          var prevGroupEnd;
          function disabledLog() {
          }
          disabledLog.__reactDisabledLog = true;
          function disableLogs() {
            {
              if (disabledDepth === 0) {
                prevLog = console.log;
                prevInfo = console.info;
                prevWarn = console.warn;
                prevError = console.error;
                prevGroup = console.group;
                prevGroupCollapsed = console.groupCollapsed;
                prevGroupEnd = console.groupEnd;
                var props = {
                  configurable: true,
                  enumerable: true,
                  value: disabledLog,
                  writable: true
                };
                Object.defineProperties(console, {
                  info: props,
                  log: props,
                  warn: props,
                  error: props,
                  group: props,
                  groupCollapsed: props,
                  groupEnd: props
                });
              }
              disabledDepth++;
            }
          }
          function reenableLogs() {
            {
              disabledDepth--;
              if (disabledDepth === 0) {
                var props = {
                  configurable: true,
                  enumerable: true,
                  writable: true
                };
                Object.defineProperties(console, {
                  log: assign({}, props, {
                    value: prevLog
                  }),
                  info: assign({}, props, {
                    value: prevInfo
                  }),
                  warn: assign({}, props, {
                    value: prevWarn
                  }),
                  error: assign({}, props, {
                    value: prevError
                  }),
                  group: assign({}, props, {
                    value: prevGroup
                  }),
                  groupCollapsed: assign({}, props, {
                    value: prevGroupCollapsed
                  }),
                  groupEnd: assign({}, props, {
                    value: prevGroupEnd
                  })
                });
              }
              if (disabledDepth < 0) {
                error("disabledDepth fell below zero. This is a bug in React. Please file an issue.");
              }
            }
          }
          var ReactCurrentDispatcher$1 = ReactSharedInternals.ReactCurrentDispatcher;
          var prefix;
          function describeBuiltInComponentFrame(name, source, ownerFn) {
            {
              if (prefix === void 0) {
                try {
                  throw Error();
                } catch (x) {
                  var match = x.stack.trim().match(/\n( *(at )?)/);
                  prefix = match && match[1] || "";
                }
              }
              return "\n" + prefix + name;
            }
          }
          var reentry = false;
          var componentFrameCache;
          {
            var PossiblyWeakMap = typeof WeakMap === "function" ? WeakMap : Map;
            componentFrameCache = new PossiblyWeakMap();
          }
          function describeNativeComponentFrame(fn, construct) {
            if (!fn || reentry) {
              return "";
            }
            {
              var frame = componentFrameCache.get(fn);
              if (frame !== void 0) {
                return frame;
              }
            }
            var control;
            reentry = true;
            var previousPrepareStackTrace = Error.prepareStackTrace;
            Error.prepareStackTrace = void 0;
            var previousDispatcher;
            {
              previousDispatcher = ReactCurrentDispatcher$1.current;
              ReactCurrentDispatcher$1.current = null;
              disableLogs();
            }
            try {
              if (construct) {
                var Fake = function() {
                  throw Error();
                };
                Object.defineProperty(Fake.prototype, "props", {
                  set: function() {
                    throw Error();
                  }
                });
                if (typeof Reflect === "object" && Reflect.construct) {
                  try {
                    Reflect.construct(Fake, []);
                  } catch (x) {
                    control = x;
                  }
                  Reflect.construct(fn, [], Fake);
                } else {
                  try {
                    Fake.call();
                  } catch (x) {
                    control = x;
                  }
                  fn.call(Fake.prototype);
                }
              } else {
                try {
                  throw Error();
                } catch (x) {
                  control = x;
                }
                fn();
              }
            } catch (sample) {
              if (sample && control && typeof sample.stack === "string") {
                var sampleLines = sample.stack.split("\n");
                var controlLines = control.stack.split("\n");
                var s = sampleLines.length - 1;
                var c = controlLines.length - 1;
                while (s >= 1 && c >= 0 && sampleLines[s] !== controlLines[c]) {
                  c--;
                }
                for (; s >= 1 && c >= 0; s--, c--) {
                  if (sampleLines[s] !== controlLines[c]) {
                    if (s !== 1 || c !== 1) {
                      do {
                        s--;
                        c--;
                        if (c < 0 || sampleLines[s] !== controlLines[c]) {
                          var _frame = "\n" + sampleLines[s].replace(" at new ", " at ");
                          if (fn.displayName && _frame.includes("<anonymous>")) {
                            _frame = _frame.replace("<anonymous>", fn.displayName);
                          }
                          {
                            if (typeof fn === "function") {
                              componentFrameCache.set(fn, _frame);
                            }
                          }
                          return _frame;
                        }
                      } while (s >= 1 && c >= 0);
                    }
                    break;
                  }
                }
              }
            } finally {
              reentry = false;
              {
                ReactCurrentDispatcher$1.current = previousDispatcher;
                reenableLogs();
              }
              Error.prepareStackTrace = previousPrepareStackTrace;
            }
            var name = fn ? fn.displayName || fn.name : "";
            var syntheticFrame = name ? describeBuiltInComponentFrame(name) : "";
            {
              if (typeof fn === "function") {
                componentFrameCache.set(fn, syntheticFrame);
              }
            }
            return syntheticFrame;
          }
          function describeFunctionComponentFrame(fn, source, ownerFn) {
            {
              return describeNativeComponentFrame(fn, false);
            }
          }
          function shouldConstruct(Component2) {
            var prototype = Component2.prototype;
            return !!(prototype && prototype.isReactComponent);
          }
          function describeUnknownElementTypeFrameInDEV(type, source, ownerFn) {
            if (type == null) {
              return "";
            }
            if (typeof type === "function") {
              {
                return describeNativeComponentFrame(type, shouldConstruct(type));
              }
            }
            if (typeof type === "string") {
              return describeBuiltInComponentFrame(type);
            }
            switch (type) {
              case REACT_SUSPENSE_TYPE:
                return describeBuiltInComponentFrame("Suspense");
              case REACT_SUSPENSE_LIST_TYPE:
                return describeBuiltInComponentFrame("SuspenseList");
            }
            if (typeof type === "object") {
              switch (type.$$typeof) {
                case REACT_FORWARD_REF_TYPE:
                  return describeFunctionComponentFrame(type.render);
                case REACT_MEMO_TYPE:
                  return describeUnknownElementTypeFrameInDEV(type.type, source, ownerFn);
                case REACT_LAZY_TYPE: {
                  var lazyComponent = type;
                  var payload = lazyComponent._payload;
                  var init = lazyComponent._init;
                  try {
                    return describeUnknownElementTypeFrameInDEV(init(payload), source, ownerFn);
                  } catch (x) {
                  }
                }
              }
            }
            return "";
          }
          var loggedTypeFailures = {};
          var ReactDebugCurrentFrame$1 = ReactSharedInternals.ReactDebugCurrentFrame;
          function setCurrentlyValidatingElement(element) {
            {
              if (element) {
                var owner = element._owner;
                var stack = describeUnknownElementTypeFrameInDEV(element.type, element._source, owner ? owner.type : null);
                ReactDebugCurrentFrame$1.setExtraStackFrame(stack);
              } else {
                ReactDebugCurrentFrame$1.setExtraStackFrame(null);
              }
            }
          }
          function checkPropTypes(typeSpecs, values, location, componentName, element) {
            {
              var has = Function.call.bind(hasOwnProperty);
              for (var typeSpecName in typeSpecs) {
                if (has(typeSpecs, typeSpecName)) {
                  var error$1 = void 0;
                  try {
                    if (typeof typeSpecs[typeSpecName] !== "function") {
                      var err = Error((componentName || "React class") + ": " + location + " type `" + typeSpecName + "` is invalid; it must be a function, usually from the `prop-types` package, but received `" + typeof typeSpecs[typeSpecName] + "`.This often happens because of typos such as `PropTypes.function` instead of `PropTypes.func`.");
                      err.name = "Invariant Violation";
                      throw err;
                    }
                    error$1 = typeSpecs[typeSpecName](values, typeSpecName, componentName, location, null, "SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED");
                  } catch (ex) {
                    error$1 = ex;
                  }
                  if (error$1 && !(error$1 instanceof Error)) {
                    setCurrentlyValidatingElement(element);
                    error("%s: type specification of %s `%s` is invalid; the type checker function must return `null` or an `Error` but returned a %s. You may have forgotten to pass an argument to the type checker creator (arrayOf, instanceOf, objectOf, oneOf, oneOfType, and shape all require an argument).", componentName || "React class", location, typeSpecName, typeof error$1);
                    setCurrentlyValidatingElement(null);
                  }
                  if (error$1 instanceof Error && !(error$1.message in loggedTypeFailures)) {
                    loggedTypeFailures[error$1.message] = true;
                    setCurrentlyValidatingElement(element);
                    error("Failed %s type: %s", location, error$1.message);
                    setCurrentlyValidatingElement(null);
                  }
                }
              }
            }
          }
          function setCurrentlyValidatingElement$1(element) {
            {
              if (element) {
                var owner = element._owner;
                var stack = describeUnknownElementTypeFrameInDEV(element.type, element._source, owner ? owner.type : null);
                setExtraStackFrame(stack);
              } else {
                setExtraStackFrame(null);
              }
            }
          }
          var propTypesMisspellWarningShown;
          {
            propTypesMisspellWarningShown = false;
          }
          function getDeclarationErrorAddendum() {
            if (ReactCurrentOwner.current) {
              var name = getComponentNameFromType(ReactCurrentOwner.current.type);
              if (name) {
                return "\n\nCheck the render method of `" + name + "`.";
              }
            }
            return "";
          }
          function getSourceInfoErrorAddendum(source) {
            if (source !== void 0) {
              var fileName = source.fileName.replace(/^.*[\\\/]/, "");
              var lineNumber = source.lineNumber;
              return "\n\nCheck your code at " + fileName + ":" + lineNumber + ".";
            }
            return "";
          }
          function getSourceInfoErrorAddendumForProps(elementProps) {
            if (elementProps !== null && elementProps !== void 0) {
              return getSourceInfoErrorAddendum(elementProps.__source);
            }
            return "";
          }
          var ownerHasKeyUseWarning = {};
          function getCurrentComponentErrorInfo(parentType) {
            var info = getDeclarationErrorAddendum();
            if (!info) {
              var parentName = typeof parentType === "string" ? parentType : parentType.displayName || parentType.name;
              if (parentName) {
                info = "\n\nCheck the top-level render call using <" + parentName + ">.";
              }
            }
            return info;
          }
          function validateExplicitKey(element, parentType) {
            if (!element._store || element._store.validated || element.key != null) {
              return;
            }
            element._store.validated = true;
            var currentComponentErrorInfo = getCurrentComponentErrorInfo(parentType);
            if (ownerHasKeyUseWarning[currentComponentErrorInfo]) {
              return;
            }
            ownerHasKeyUseWarning[currentComponentErrorInfo] = true;
            var childOwner = "";
            if (element && element._owner && element._owner !== ReactCurrentOwner.current) {
              childOwner = " It was passed a child from " + getComponentNameFromType(element._owner.type) + ".";
            }
            {
              setCurrentlyValidatingElement$1(element);
              error('Each child in a list should have a unique "key" prop.%s%s See https://reactjs.org/link/warning-keys for more information.', currentComponentErrorInfo, childOwner);
              setCurrentlyValidatingElement$1(null);
            }
          }
          function validateChildKeys(node, parentType) {
            if (typeof node !== "object") {
              return;
            }
            if (isArray(node)) {
              for (var i = 0; i < node.length; i++) {
                var child = node[i];
                if (isValidElement(child)) {
                  validateExplicitKey(child, parentType);
                }
              }
            } else if (isValidElement(node)) {
              if (node._store) {
                node._store.validated = true;
              }
            } else if (node) {
              var iteratorFn = getIteratorFn(node);
              if (typeof iteratorFn === "function") {
                if (iteratorFn !== node.entries) {
                  var iterator = iteratorFn.call(node);
                  var step;
                  while (!(step = iterator.next()).done) {
                    if (isValidElement(step.value)) {
                      validateExplicitKey(step.value, parentType);
                    }
                  }
                }
              }
            }
          }
          function validatePropTypes(element) {
            {
              var type = element.type;
              if (type === null || type === void 0 || typeof type === "string") {
                return;
              }
              var propTypes;
              if (typeof type === "function") {
                propTypes = type.propTypes;
              } else if (typeof type === "object" && (type.$$typeof === REACT_FORWARD_REF_TYPE || // Note: Memo only checks outer props here.
              // Inner props are checked in the reconciler.
              type.$$typeof === REACT_MEMO_TYPE)) {
                propTypes = type.propTypes;
              } else {
                return;
              }
              if (propTypes) {
                var name = getComponentNameFromType(type);
                checkPropTypes(propTypes, element.props, "prop", name, element);
              } else if (type.PropTypes !== void 0 && !propTypesMisspellWarningShown) {
                propTypesMisspellWarningShown = true;
                var _name = getComponentNameFromType(type);
                error("Component %s declared `PropTypes` instead of `propTypes`. Did you misspell the property assignment?", _name || "Unknown");
              }
              if (typeof type.getDefaultProps === "function" && !type.getDefaultProps.isReactClassApproved) {
                error("getDefaultProps is only used on classic React.createClass definitions. Use a static property named `defaultProps` instead.");
              }
            }
          }
          function validateFragmentProps(fragment) {
            {
              var keys = Object.keys(fragment.props);
              for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                if (key !== "children" && key !== "key") {
                  setCurrentlyValidatingElement$1(fragment);
                  error("Invalid prop `%s` supplied to `React.Fragment`. React.Fragment can only have `key` and `children` props.", key);
                  setCurrentlyValidatingElement$1(null);
                  break;
                }
              }
              if (fragment.ref !== null) {
                setCurrentlyValidatingElement$1(fragment);
                error("Invalid attribute `ref` supplied to `React.Fragment`.");
                setCurrentlyValidatingElement$1(null);
              }
            }
          }
          function createElementWithValidation(type, props, children) {
            var validType = isValidElementType(type);
            if (!validType) {
              var info = "";
              if (type === void 0 || typeof type === "object" && type !== null && Object.keys(type).length === 0) {
                info += " You likely forgot to export your component from the file it's defined in, or you might have mixed up default and named imports.";
              }
              var sourceInfo = getSourceInfoErrorAddendumForProps(props);
              if (sourceInfo) {
                info += sourceInfo;
              } else {
                info += getDeclarationErrorAddendum();
              }
              var typeString;
              if (type === null) {
                typeString = "null";
              } else if (isArray(type)) {
                typeString = "array";
              } else if (type !== void 0 && type.$$typeof === REACT_ELEMENT_TYPE) {
                typeString = "<" + (getComponentNameFromType(type.type) || "Unknown") + " />";
                info = " Did you accidentally export a JSX literal instead of a component?";
              } else {
                typeString = typeof type;
              }
              {
                error("React.createElement: type is invalid -- expected a string (for built-in components) or a class/function (for composite components) but got: %s.%s", typeString, info);
              }
            }
            var element = createElement.apply(this, arguments);
            if (element == null) {
              return element;
            }
            if (validType) {
              for (var i = 2; i < arguments.length; i++) {
                validateChildKeys(arguments[i], type);
              }
            }
            if (type === REACT_FRAGMENT_TYPE) {
              validateFragmentProps(element);
            } else {
              validatePropTypes(element);
            }
            return element;
          }
          var didWarnAboutDeprecatedCreateFactory = false;
          function createFactoryWithValidation(type) {
            var validatedFactory = createElementWithValidation.bind(null, type);
            validatedFactory.type = type;
            {
              if (!didWarnAboutDeprecatedCreateFactory) {
                didWarnAboutDeprecatedCreateFactory = true;
                warn("React.createFactory() is deprecated and will be removed in a future major release. Consider using JSX or use React.createElement() directly instead.");
              }
              Object.defineProperty(validatedFactory, "type", {
                enumerable: false,
                get: function() {
                  warn("Factory.type is deprecated. Access the class directly before passing it to createFactory.");
                  Object.defineProperty(this, "type", {
                    value: type
                  });
                  return type;
                }
              });
            }
            return validatedFactory;
          }
          function cloneElementWithValidation(element, props, children) {
            var newElement = cloneElement.apply(this, arguments);
            for (var i = 2; i < arguments.length; i++) {
              validateChildKeys(arguments[i], newElement.type);
            }
            validatePropTypes(newElement);
            return newElement;
          }
          function startTransition(scope, options) {
            var prevTransition = ReactCurrentBatchConfig.transition;
            ReactCurrentBatchConfig.transition = {};
            var currentTransition = ReactCurrentBatchConfig.transition;
            {
              ReactCurrentBatchConfig.transition._updatedFibers = /* @__PURE__ */ new Set();
            }
            try {
              scope();
            } finally {
              ReactCurrentBatchConfig.transition = prevTransition;
              {
                if (prevTransition === null && currentTransition._updatedFibers) {
                  var updatedFibersCount = currentTransition._updatedFibers.size;
                  if (updatedFibersCount > 10) {
                    warn("Detected a large number of updates inside startTransition. If this is due to a subscription please re-write it to use React provided hooks. Otherwise concurrent mode guarantees are off the table.");
                  }
                  currentTransition._updatedFibers.clear();
                }
              }
            }
          }
          var didWarnAboutMessageChannel = false;
          var enqueueTaskImpl = null;
          function enqueueTask(task) {
            if (enqueueTaskImpl === null) {
              try {
                var requireString = ("require" + Math.random()).slice(0, 7);
                var nodeRequire = module && module[requireString];
                enqueueTaskImpl = nodeRequire.call(module, "timers").setImmediate;
              } catch (_err) {
                enqueueTaskImpl = function(callback) {
                  {
                    if (didWarnAboutMessageChannel === false) {
                      didWarnAboutMessageChannel = true;
                      if (typeof MessageChannel === "undefined") {
                        error("This browser does not have a MessageChannel implementation, so enqueuing tasks via await act(async () => ...) will fail. Please file an issue at https://github.com/facebook/react/issues if you encounter this warning.");
                      }
                    }
                  }
                  var channel = new MessageChannel();
                  channel.port1.onmessage = callback;
                  channel.port2.postMessage(void 0);
                };
              }
            }
            return enqueueTaskImpl(task);
          }
          var actScopeDepth = 0;
          var didWarnNoAwaitAct = false;
          function act(callback) {
            {
              var prevActScopeDepth = actScopeDepth;
              actScopeDepth++;
              if (ReactCurrentActQueue.current === null) {
                ReactCurrentActQueue.current = [];
              }
              var prevIsBatchingLegacy = ReactCurrentActQueue.isBatchingLegacy;
              var result;
              try {
                ReactCurrentActQueue.isBatchingLegacy = true;
                result = callback();
                if (!prevIsBatchingLegacy && ReactCurrentActQueue.didScheduleLegacyUpdate) {
                  var queue = ReactCurrentActQueue.current;
                  if (queue !== null) {
                    ReactCurrentActQueue.didScheduleLegacyUpdate = false;
                    flushActQueue(queue);
                  }
                }
              } catch (error2) {
                popActScope(prevActScopeDepth);
                throw error2;
              } finally {
                ReactCurrentActQueue.isBatchingLegacy = prevIsBatchingLegacy;
              }
              if (result !== null && typeof result === "object" && typeof result.then === "function") {
                var thenableResult = result;
                var wasAwaited = false;
                var thenable = {
                  then: function(resolve, reject) {
                    wasAwaited = true;
                    thenableResult.then(function(returnValue2) {
                      popActScope(prevActScopeDepth);
                      if (actScopeDepth === 0) {
                        recursivelyFlushAsyncActWork(returnValue2, resolve, reject);
                      } else {
                        resolve(returnValue2);
                      }
                    }, function(error2) {
                      popActScope(prevActScopeDepth);
                      reject(error2);
                    });
                  }
                };
                {
                  if (!didWarnNoAwaitAct && typeof Promise !== "undefined") {
                    Promise.resolve().then(function() {
                    }).then(function() {
                      if (!wasAwaited) {
                        didWarnNoAwaitAct = true;
                        error("You called act(async () => ...) without await. This could lead to unexpected testing behaviour, interleaving multiple act calls and mixing their scopes. You should - await act(async () => ...);");
                      }
                    });
                  }
                }
                return thenable;
              } else {
                var returnValue = result;
                popActScope(prevActScopeDepth);
                if (actScopeDepth === 0) {
                  var _queue = ReactCurrentActQueue.current;
                  if (_queue !== null) {
                    flushActQueue(_queue);
                    ReactCurrentActQueue.current = null;
                  }
                  var _thenable = {
                    then: function(resolve, reject) {
                      if (ReactCurrentActQueue.current === null) {
                        ReactCurrentActQueue.current = [];
                        recursivelyFlushAsyncActWork(returnValue, resolve, reject);
                      } else {
                        resolve(returnValue);
                      }
                    }
                  };
                  return _thenable;
                } else {
                  var _thenable2 = {
                    then: function(resolve, reject) {
                      resolve(returnValue);
                    }
                  };
                  return _thenable2;
                }
              }
            }
          }
          function popActScope(prevActScopeDepth) {
            {
              if (prevActScopeDepth !== actScopeDepth - 1) {
                error("You seem to have overlapping act() calls, this is not supported. Be sure to await previous act() calls before making a new one. ");
              }
              actScopeDepth = prevActScopeDepth;
            }
          }
          function recursivelyFlushAsyncActWork(returnValue, resolve, reject) {
            {
              var queue = ReactCurrentActQueue.current;
              if (queue !== null) {
                try {
                  flushActQueue(queue);
                  enqueueTask(function() {
                    if (queue.length === 0) {
                      ReactCurrentActQueue.current = null;
                      resolve(returnValue);
                    } else {
                      recursivelyFlushAsyncActWork(returnValue, resolve, reject);
                    }
                  });
                } catch (error2) {
                  reject(error2);
                }
              } else {
                resolve(returnValue);
              }
            }
          }
          var isFlushing = false;
          function flushActQueue(queue) {
            {
              if (!isFlushing) {
                isFlushing = true;
                var i = 0;
                try {
                  for (; i < queue.length; i++) {
                    var callback = queue[i];
                    do {
                      callback = callback(true);
                    } while (callback !== null);
                  }
                  queue.length = 0;
                } catch (error2) {
                  queue = queue.slice(i + 1);
                  throw error2;
                } finally {
                  isFlushing = false;
                }
              }
            }
          }
          var createElement$1 = createElementWithValidation;
          var cloneElement$1 = cloneElementWithValidation;
          var createFactory = createFactoryWithValidation;
          var Children = {
            map: mapChildren,
            forEach: forEachChildren,
            count: countChildren,
            toArray,
            only: onlyChild
          };
          exports.Children = Children;
          exports.Component = Component;
          exports.Fragment = REACT_FRAGMENT_TYPE;
          exports.Profiler = REACT_PROFILER_TYPE;
          exports.PureComponent = PureComponent;
          exports.StrictMode = REACT_STRICT_MODE_TYPE;
          exports.Suspense = REACT_SUSPENSE_TYPE;
          exports.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = ReactSharedInternals;
          exports.act = act;
          exports.cloneElement = cloneElement$1;
          exports.createContext = createContext;
          exports.createElement = createElement$1;
          exports.createFactory = createFactory;
          exports.createRef = createRef;
          exports.forwardRef = forwardRef;
          exports.isValidElement = isValidElement;
          exports.lazy = lazy;
          exports.memo = memo;
          exports.startTransition = startTransition;
          exports.unstable_act = act;
          exports.useCallback = useCallback;
          exports.useContext = useContext;
          exports.useDebugValue = useDebugValue;
          exports.useDeferredValue = useDeferredValue;
          exports.useEffect = useEffect2;
          exports.useId = useId;
          exports.useImperativeHandle = useImperativeHandle;
          exports.useInsertionEffect = useInsertionEffect;
          exports.useLayoutEffect = useLayoutEffect;
          exports.useMemo = useMemo2;
          exports.useReducer = useReducer;
          exports.useRef = useRef;
          exports.useState = useState2;
          exports.useSyncExternalStore = useSyncExternalStore;
          exports.useTransition = useTransition;
          exports.version = ReactVersion;
          if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ !== "undefined" && typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop === "function") {
            __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop(new Error());
          }
        })();
      }
    }
  });

  // node_modules/react/index.js
  var require_react = __commonJS({
    "node_modules/react/index.js"(exports, module) {
      "use strict";
      if (false) {
        module.exports = null;
      } else {
        module.exports = require_react_development();
      }
    }
  });

  // <stdin>
  var import_react = __toESM(require_react());
  function Field({ label, children, hint }) {
    return /* @__PURE__ */ import_react.default.createElement("div", { className: "space-y-1" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "text-xs text-gray-600" }, label), /* @__PURE__ */ import_react.default.createElement("div", null, children), hint ? /* @__PURE__ */ import_react.default.createElement("div", { className: "text-[11px] text-gray-500" }, hint) : null);
  }
  function Prompts() {
    const API_BASE = (0, import_react.useMemo)(() => {
      try {
        if (typeof window !== "undefined" && window && window.location) {
          const p = window.location.pathname || "";
          if (p.startsWith("/mcp-dev-prestashop/"))
            return "/mcp/mcp-dev-prestashop";
          if (p.startsWith("/mcp/"))
            return "/mcp";
        }
      } catch {
      }
      return "/api";
    }, []);
    const [note] = (0, import_react.useState)("Local Prompt repository \u2014 reusable across chatbots.");
    const [bots, setBots] = (0, import_react.useState)([]);
    const [items, setItems] = (0, import_react.useState)([]);
    const [selectedId, setSelectedId] = (0, import_react.useState)("");
    const [loadingList, setLoadingList] = (0, import_react.useState)(false);
    const [form, setForm] = (0, import_react.useState)({ name: "", dev_message: "", openai_api_key: "", prompt_id: "", prompt_version: "", vector_store_id: "", messages: [], tools: { file_search: false, code_interpreter: false, function: false, web_search: false } });
    const [saving, setSaving] = (0, import_react.useState)(false);
    const [deleting, setDeleting] = (0, import_react.useState)(false);
    const [assignBusy, setAssignBusy] = (0, import_react.useState)(false);
    const [assigned, setAssigned] = (0, import_react.useState)([]);
    const [assignSel, setAssignSel] = (0, import_react.useState)({});
    const [testMsg, setTestMsg] = (0, import_react.useState)("");
    const [testBusy, setTestBusy] = (0, import_react.useState)(false);
    const [testOut, setTestOut] = (0, import_react.useState)("");
    const [testReq, setTestReq] = (0, import_react.useState)("");
    const [orgHasKey, setOrgHasKey] = (0, import_react.useState)(false);
    (0, import_react.useEffect)(() => {
      (async () => {
        try {
          const r = await fetch("/api/orgs/me", { credentials: "include" });
          const j = await r.json();
          if (r.ok && j?.ok && j.item)
            setOrgHasKey(!!j.item.has_key);
        } catch {
        }
      })();
    }, []);
    const [srvList, setSrvList] = (0, import_react.useState)([]);
    const [srvLoading, setSrvLoading] = (0, import_react.useState)(false);
    const [srvAssigned, setSrvAssigned] = (0, import_react.useState)([]);
    const [srvSel, setSrvSel] = (0, import_react.useState)({});
    const [srvAssignBusy, setSrvAssignBusy] = (0, import_react.useState)(false);
    const [srvLinked, setSrvLinked] = (0, import_react.useState)([]);
    const [srvLinkedBusy, setSrvLinkedBusy] = (0, import_react.useState)(false);
    const [srvLinkSel, setSrvLinkSel] = (0, import_react.useState)("");
    const [srvLinkBusy, setSrvLinkBusy] = (0, import_react.useState)(false);
    const [srvUploadTarget, setSrvUploadTarget] = (0, import_react.useState)("");
    const [srvUploadMsg, setSrvUploadMsg] = (0, import_react.useState)("");
    const [srvUploadFiles, setSrvUploadFiles] = (0, import_react.useState)([]);
    const [srvUploading, setSrvUploading] = (0, import_react.useState)(false);
    const [srvFiles, setSrvFiles] = (0, import_react.useState)({});
    const [srvAllowed, setSrvAllowed] = (0, import_react.useState)({});
    const [srvTransport, setSrvTransport] = (0, import_react.useState)({});
    const [useAdminTokenFallback, setUseAdminTokenFallback] = (0, import_react.useState)(() => {
      try {
        return localStorage.getItem("useAdminMcpTokenFallback") === "1";
      } catch {
        return false;
      }
    });
    (0, import_react.useEffect)(() => {
      try {
        if (useAdminTokenFallback)
          localStorage.setItem("useAdminMcpTokenFallback", "1");
        else
          localStorage.removeItem("useAdminMcpTokenFallback");
      } catch {
      }
    }, [useAdminTokenFallback]);
    const copy = async (text) => {
      try {
        await navigator.clipboard.writeText(String(text || ""));
      } catch {
      }
    };
    const formatBytes = (b) => {
      const n = Number(b || 0);
      if (!isFinite(n))
        return "";
      if (n < 1024)
        return `${n} B`;
      const units = ["KB", "MB", "GB", "TB"];
      let v = n;
      let i = -1;
      do {
        v /= 1024;
        i++;
      } while (v >= 1024 && i < units.length - 1);
      return `${v.toFixed(1)} ${units[i]}`;
    };
    const formatIso = (iso) => {
      try {
        return new Date(iso).toLocaleString();
      } catch {
        return "";
      }
    };
    const serverPathForKind = (kind) => String(kind || "").toLowerCase() === "dev" ? "/mcp-dev" : "/mcp";
    const buildServerUrl = (s, path) => {
      const base = s?.http_base && /^https?:\/\//i.test(s.http_base) ? s.http_base.replace(/\/$/, "") : "";
      return base ? `${base}${path}` : path;
    };
    const getServerToken = (s) => {
      try {
        const saved = (srvList || []).find((x) => x.id === s.id);
        return saved?.token || "";
      } catch {
        return "";
      }
    };
    const loadFilesForServer = async (s) => {
      if (!s || !s.id)
        return;
      setSrvFiles((m) => ({ ...m, [s.id]: { ...m[s.id] || {}, loading: true, error: "" } }));
      try {
        const kind = String(s.kind || "").toLowerCase();
        if (kind === "dev-prestashop") {
          setSrvFiles((m) => ({ ...m, [s.id]: { loading: false, files: [], error: "Files not supported for PrestaShop dev" } }));
          return;
        }
        const basePath = serverPathForKind(kind);
        const urlPath = `${basePath}/files?limit=50`;
        let token = getServerToken(s);
        if (useAdminTokenFallback && !token) {
          try {
            const url2 = kind === "dev" ? "/api/admin/mcp-dev/token" : "/api/admin/mcp/token";
            const rTok = await fetch(url2, { credentials: "include" });
            const jTok = await rTok.json();
            if (rTok.ok && jTok?.ok != null)
              token = jTok.token || "";
          } catch {
          }
        }
        let url = buildServerUrl(s, urlPath);
        const sep = url.includes("?") ? "&" : "?";
        if (token)
          url = `${url}${sep}token=${encodeURIComponent(token)}`;
        let creds = "include";
        try {
          const uo = new URL(url, window.location.href);
          if (uo.origin !== window.location.origin)
            creds = "omit";
        } catch {
        }
        const r = await fetch(url, { credentials: creds });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j?.ok === false)
          throw new Error(j?.message || j?.error || `http_${r.status}`);
        const files = Array.isArray(j.files) ? j.files : [];
        setSrvFiles((m) => ({ ...m, [s.id]: { loading: false, files, error: "" } }));
      } catch (e) {
        setSrvFiles((m) => ({ ...m, [s.id]: { loading: false, files: m[s.id]?.files || [], error: String(e?.message || e) } }));
      }
    };
    const downloadUrlFor = (s, fileId) => {
      const kind = String(s.kind || "").toLowerCase();
      const basePath = serverPathForKind(kind);
      const token = getServerToken(s);
      let url = buildServerUrl(s, `${basePath}/file/${encodeURIComponent(fileId)}/download`);
      if (token)
        url += (url.includes("?") ? "&" : "?") + `token=${encodeURIComponent(token)}`;
      return url;
    };
    const loadBots = async () => {
      try {
        const r = await fetch(`${API_BASE}/automations/chatbots`, { credentials: "include" });
        const j = await r.json();
        setBots(Array.isArray(j) ? j : []);
      } catch {
      }
    };
    const loadPrompts = async () => {
      setLoadingList(true);
      try {
        const r = await fetch(`${API_BASE}/prompt-configs`, { credentials: "include" });
        const j = await r.json();
        if (r.ok && j?.ok)
          setItems(Array.isArray(j.items) ? j.items : []);
      } catch {
      } finally {
        setLoadingList(false);
      }
    };
    const loadServers = async () => {
      setSrvLoading(true);
      try {
        const r = await fetch(`/api/mcp-servers`, { credentials: "include" });
        const j = await r.json();
        setSrvList(r.ok && j?.ok ? Array.isArray(j.items) ? j.items : [] : []);
      } catch {
        setSrvList([]);
      } finally {
        setSrvLoading(false);
      }
    };
    (0, import_react.useEffect)(() => {
      loadBots();
      loadPrompts();
      loadServers();
    }, []);
    (0, import_react.useEffect)(() => {
      (async () => {
        if (!selectedId) {
          setSrvLinked([]);
          setSrvAllowed({});
          setSrvTransport({});
          return;
        }
        try {
          setSrvLinkedBusy(true);
          const r = await fetch(`/api/prompt-configs/${encodeURIComponent(selectedId)}/mcp-servers`, { credentials: "include" });
          const j = await r.json();
          const list = r.ok && j?.ok ? Array.isArray(j.servers) ? j.servers : [] : [];
          setSrvLinked(list);
          const map = {};
          const tmap = {};
          list.forEach((s) => {
            const def = Array.isArray(s.allowed_tools) ? s.allowed_tools : Array.isArray(s.tools) ? s.tools.map((t) => t.name) : [];
            map[s.id] = new Set(def);
            const pref = s.options && typeof s.options === "object" && s.options.server_url_pref === "stream" ? "stream" : "sse";
            tmap[s.id] = pref;
          });
          setSrvAllowed(map);
          setSrvTransport(tmap);
        } catch {
          setSrvLinked([]);
        } finally {
          setSrvLinkedBusy(false);
        }
      })();
    }, [selectedId]);
    const availableServers = (0, import_react.useMemo)(() => {
      try {
        const linkedIds = new Set((srvLinked || []).map((s) => s && s.id));
        return (srvList || []).filter((sv) => sv && !linkedIds.has(sv.id));
      } catch {
        return srvList || [];
      }
    }, [srvList, srvLinked]);
    const linkServer = async (id) => {
      if (!selectedId || !id)
        return;
      setSrvLinkBusy(true);
      try {
        const r = await fetch(`/api/prompt-configs/${encodeURIComponent(selectedId)}/mcp-servers/assign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ server_ids: [id] })
        });
        if (!r.ok) {
          try {
            const j = await r.json();
            alert(j?.message || j?.error || "Link failed");
          } catch {
            alert("Link failed");
          }
        }
        try {
          setSrvLinkedBusy(true);
          const rr = await fetch(`/api/prompt-configs/${encodeURIComponent(selectedId)}/mcp-servers`, { credentials: "include" });
          const jj = await rr.json();
          const list = rr.ok && jj?.ok ? Array.isArray(jj.servers) ? jj.servers : [] : [];
          setSrvLinked(list);
        } catch {
          setSrvLinked([]);
        } finally {
          setSrvLinkedBusy(false);
        }
      } catch (e) {
        alert(String(e?.message || e));
      } finally {
        setSrvLinkBusy(false);
      }
    };
    const pick = async (id) => {
      setSelectedId(id);
      if (!id) {
        setForm({ name: "", dev_message: "", openai_api_key: "", prompt_id: "", prompt_version: "", vector_store_id: "", tools: { file_search: false, code_interpreter: false, function: false, web_search: false } });
        setAssigned([]);
        setAssignSel({});
        return;
      }
      try {
        const r = await fetch(`${API_BASE}/prompt-configs/${encodeURIComponent(id)}`, { credentials: "include" });
        const j = await r.json();
        if (r.ok && j?.ok) {
          const it = j.item;
          setForm({
            name: it.name || "",
            dev_message: it.dev_message || "",
            openai_api_key: it.openai_api_key || "",
            prompt_id: it.prompt_id || "",
            prompt_version: it.prompt_version || "",
            vector_store_id: it.vector_store_id || "",
            messages: Array.isArray(it.messages) ? it.messages : [],
            tools: {
              file_search: !!(it.tools && it.tools.file_search),
              code_interpreter: !!(it.tools && it.tools.code_interpreter),
              function: !!(it.tools && it.tools.function),
              web_search: !!(it.tools && it.tools.web_search)
            }
          });
        }
      } catch {
      }
      try {
        const r2 = await fetch(`${API_BASE}/prompt-configs/${encodeURIComponent(id)}/chatbots`, { credentials: "include" });
        const j2 = await r2.json();
        if (r2.ok && j2?.ok) {
          setAssigned(Array.isArray(j2.chatbot_ids) ? j2.chatbot_ids : []);
          const map = {};
          (j2.chatbot_ids || []).forEach((x) => map[x] = true);
          setAssignSel(map);
        }
      } catch {
      }
      try {
        const r3 = await fetch(`/api/prompt-configs/${encodeURIComponent(id)}/mcp-servers`, { credentials: "include" });
        const j3 = await r3.json();
        if (r3.ok && j3?.ok) {
          const list = Array.isArray(j3.servers) ? j3.servers : [];
          setSrvLinked(list);
          const ids = list.map((s) => s.id);
          setSrvAssigned(ids);
          const smap = {};
          ids.forEach((x) => smap[x] = true);
          setSrvSel(smap);
        } else {
          setSrvLinked([]);
          setSrvAssigned([]);
          setSrvSel({});
        }
      } catch {
        setSrvLinked([]);
        setSrvAssigned([]);
        setSrvSel({});
      }
    };
    const createNew = async () => {
      const name = prompt("Prompt name");
      if (!name)
        return;
      try {
        const r = await fetch(`${API_BASE}/prompt-configs`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ name }) });
        const j = await r.json();
        if (r.ok && j?.ok) {
          await loadPrompts();
          pick(j.item.id);
        } else
          alert("Create failed");
      } catch (e) {
        alert("Create failed: " + (e?.message || e));
      }
    };
    const saveServerAssignments = async () => {
      if (!selectedId) {
        alert("Select a prompt first");
        return;
      }
      setSrvAssignBusy(true);
      try {
        const want = Object.entries(srvSel).filter(([, v]) => !!v).map(([k]) => k);
        const curr = new Set(srvAssigned);
        const add = want.filter((id) => !curr.has(id));
        const rem = srvAssigned.filter((id) => !want.includes(id));
        if (add.length)
          await fetch(`/api/prompt-configs/${encodeURIComponent(selectedId)}/mcp-servers/assign`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ server_ids: add }) });
        if (rem.length)
          await fetch(`/api/prompt-configs/${encodeURIComponent(selectedId)}/mcp-servers/unassign`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ server_ids: rem }) });
        setSrvAssigned(want);
        try {
          setSrvLinkedBusy(true);
          const r = await fetch(`/api/prompt-configs/${encodeURIComponent(selectedId)}/mcp-servers`, { credentials: "include" });
          const j = await r.json();
          setSrvLinked(r.ok && j?.ok ? Array.isArray(j.servers) ? j.servers : [] : []);
        } catch {
          setSrvLinked([]);
        } finally {
          setSrvLinkedBusy(false);
        }
      } catch (e) {
        alert("Save failed: " + (e?.message || e));
      } finally {
        setSrvAssignBusy(false);
      }
    };
    const savePrompt = async () => {
      if (!selectedId) {
        alert("Select a prompt first");
        return;
      }
      setSaving(true);
      try {
        const r = await fetch(`${API_BASE}/prompt-configs/${encodeURIComponent(selectedId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(form) });
        const j = await r.json();
        if (!r.ok || !j?.ok)
          throw new Error(j?.message || j?.error || "save_failed");
        await loadPrompts();
      } catch (e) {
        alert("Save failed: " + (e?.message || e));
      } finally {
        setSaving(false);
      }
    };
    const addMsg = () => setForm((f) => ({ ...f, messages: [...Array.isArray(f.messages) ? f.messages : [], { role: "user", content: "" }] }));
    const updateMsg = (idx, patch) => setForm((f) => {
      const arr = Array.isArray(f.messages) ? [...f.messages] : [];
      arr[idx] = { ...arr[idx] || { role: "user", content: "" }, ...patch };
      return { ...f, messages: arr };
    });
    const removeMsg = (idx) => setForm((f) => {
      const arr = Array.isArray(f.messages) ? [...f.messages] : [];
      arr.splice(idx, 1);
      return { ...f, messages: arr };
    });
    const moveMsg = (idx, dir) => setForm((f) => {
      const arr = Array.isArray(f.messages) ? [...f.messages] : [];
      const j = idx + dir;
      if (j < 0 || j >= arr.length)
        return f;
      const tmp = arr[idx];
      arr[idx] = arr[j];
      arr[j] = tmp;
      return { ...f, messages: arr };
    });
    const copyOpenAIJson = async () => {
      const payload = { developer_message: form.dev_message || "", messages: Array.isArray(form.messages) ? form.messages : [], tools: form.tools || {} };
      try {
        await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
        alert("Copied.");
      } catch {
        alert("Copy failed");
      }
    };
    const deletePrompt = async () => {
      if (!selectedId)
        return;
      if (!confirm("Delete this prompt?"))
        return;
      setDeleting(true);
      try {
        const r = await fetch(`${API_BASE}/prompt-configs/${encodeURIComponent(selectedId)}`, { method: "DELETE", credentials: "include" });
        if (!r.ok)
          throw new Error("delete_failed");
        setSelectedId("");
        await loadPrompts();
      } catch (e) {
        alert("Delete failed: " + (e?.message || e));
      } finally {
        setDeleting(false);
      }
    };
    const saveAssignments = async () => {
      if (!selectedId) {
        alert("Select a prompt first");
        return;
      }
      setAssignBusy(true);
      try {
        const want = Object.entries(assignSel).filter(([, v]) => !!v).map(([k]) => k);
        const curr = new Set(assigned);
        const add = want.filter((id) => !curr.has(id));
        const rem = assigned.filter((id) => !want.includes(id));
        if (add.length)
          await fetch(`${API_BASE}/prompt-configs/${encodeURIComponent(selectedId)}/assign`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ chatbot_ids: add }) });
        if (rem.length)
          await fetch(`${API_BASE}/prompt-configs/${encodeURIComponent(selectedId)}/unassign`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ chatbot_ids: rem }) });
        setAssigned(want);
      } catch (e) {
        alert("Assign failed: " + (e?.message || e));
      } finally {
        setAssignBusy(false);
      }
    };
    const testThisPrompt = async () => {
      if (!selectedId) {
        alert("Select a prompt first");
        return;
      }
      if (!testMsg.trim()) {
        alert("Enter a message");
        return;
      }
      setTestBusy(true);
      setTestOut("");
      setTestReq("");
      try {
        const r = await fetch(`${API_BASE}/prompt-configs/${encodeURIComponent(selectedId)}/test`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ input: testMsg }) });
        const j = await r.json();
        if (r.ok && j?.ok) {
          setTestOut(j.text || JSON.stringify(j));
          try {
            setTestReq(JSON.stringify(j.request_body || j.request || {}, null, 2));
          } catch {
            setTestReq("");
          }
        } else {
          setTestOut(j?.message || j?.error || "test_failed");
          try {
            setTestReq(JSON.stringify(j.request_body || j.request || {}, null, 2));
          } catch {
            setTestReq("");
          }
        }
      } catch (e) {
        setTestOut(String(e?.message || e));
      } finally {
        setTestBusy(false);
      }
    };
    const previewObj = (0, import_react.useMemo)(() => {
      const toolsMap = form.tools || {};
      const messages = Array.isArray(form.messages) ? form.messages : [];
      return {
        instructions: form.dev_message || "",
        seed_messages: messages,
        tools: toolsMap,
        input: "<user input>"
      };
    }, [form.dev_message, form.messages, form.tools]);
    const approxTokens = (0, import_react.useMemo)(() => {
      const messages = Array.isArray(form.messages) ? form.messages : [];
      const chars = (form.dev_message || "").length + messages.reduce((n, m) => n + (m?.content || "").length + (m?.role || "").length, 0);
      return Math.max(1, Math.ceil(chars / 4)) + messages.length + 10;
    }, [form.dev_message, form.messages]);
    const copyPreview = async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(previewObj, null, 2));
        alert("Preview copied");
      } catch {
        alert("Copy failed");
      }
    };
    const [mcp, setMcp] = (0, import_react.useState)(null);
    const [mcpBusy, setMcpBusy] = (0, import_react.useState)(false);
    const [mcpMain, setMcpMain] = (0, import_react.useState)(null);
    const [mcpMainBusy, setMcpMainBusy] = (0, import_react.useState)(false);
    const [mcpToken, setMcpToken] = (0, import_react.useState)("");
    const [vecBusy, setVecBusy] = (0, import_react.useState)(false);
    const [vecMsg, setVecMsg] = (0, import_react.useState)("");
    const [vecFiles, setVecFiles] = (0, import_react.useState)([]);
    const [vecLoading, setVecLoading] = (0, import_react.useState)(false);
    const [vecError, setVecError] = (0, import_react.useState)("");
    const [uploadMsg, setUploadMsg] = (0, import_react.useState)("");
    const fileToBase64 = (file) => new Promise((resolve, reject) => {
      try {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("read_failed"));
        reader.onload = () => {
          try {
            const res = String(reader.result || "");
            const comma = res.indexOf(",");
            resolve(comma >= 0 ? res.slice(comma + 1) : res);
          } catch (e) {
            reject(e);
          }
        };
        reader.readAsDataURL(file);
      } catch (e) {
        reject(e);
      }
    });
    const loadMcp = async () => {
      setMcpBusy(true);
      try {
        const r = await fetch(`${API_BASE}/local-prompts/mcp/dev-prestashop`, { credentials: "include" });
        const j = await r.json();
        if (r.ok && j?.ok)
          setMcp(j);
        else
          setMcp(null);
      } catch {
        setMcp(null);
      } finally {
        setMcpBusy(false);
      }
    };
    const loadMcpMain = async () => {
      setMcpMainBusy(true);
      try {
        const r = await fetch(`/mcp/status`, { credentials: "include" });
        const j = await r.json();
        setMcpMain(r.ok && j?.ok ? j : null);
      } catch {
        setMcpMain(null);
      } finally {
        setMcpMainBusy(false);
      }
    };
    const loadMcpToken = async () => {
      try {
        const r = await fetch(`/api/admin/mcp/token`, { credentials: "include" });
        const j = await r.json();
        setMcpToken(r.ok && j?.ok ? j.token || "" : "");
      } catch {
        setMcpToken("");
      }
    };
    (0, import_react.useEffect)(() => {
      loadMcp();
      loadMcpMain();
      loadMcpToken();
    }, []);
    const [vecPickLoading, setVecPickLoading] = (0, import_react.useState)(false);
    const [vecPickError, setVecPickError] = (0, import_react.useState)("");
    const [vecPickList, setVecPickList] = (0, import_react.useState)([]);
    const linkedVectorIds = (0, import_react.useMemo)(() => {
      try {
        const set = /* @__PURE__ */ new Set();
        const arr = Array.isArray(form.vector_store_ids) ? form.vector_store_ids : [];
        for (const id of arr) {
          const s = String(id || "").trim();
          if (s)
            set.add(s);
        }
        const single = String(form.vector_store_id || "").trim();
        if (single)
          set.add(single);
        return Array.from(set);
      } catch {
        return [];
      }
    }, [form.vector_store_ids, form.vector_store_id]);
    const loadVectorStores = async () => {
      setVecPickLoading(true);
      setVecPickError("");
      try {
        const r = await fetch(`/api/vector-stores?limit=100&org=me`, { credentials: "include" });
        const j = await r.json();
        if (!r.ok || j?.ok === false)
          throw new Error(j?.message || j?.error || r.status);
        setVecPickList(Array.isArray(j.items) ? j.items : []);
      } catch (e) {
        setVecPickError(String(e?.message || e));
      } finally {
        setVecPickLoading(false);
      }
    };
    (0, import_react.useEffect)(() => {
      loadVectorStores();
    }, []);
    const linkSelectedVector = async (id) => {
      if (!selectedId || !id)
        return;
      try {
        const r = await fetch(`/api/prompt-configs/${encodeURIComponent(selectedId)}/vector-stores/link`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ id }) });
        const j = await r.json();
        if (r.ok && j?.ok)
          setForm((f) => ({ ...f, vector_store_ids: Array.isArray(j.vector_store_ids) ? j.vector_store_ids : (Array.isArray(f.vector_store_ids) ? f.vector_store_ids : []).concat(id) }));
        else
          alert(j?.message || j?.error || "Link failed");
      } catch (e) {
        alert(String(e?.message || e));
      }
    };
    const unlinkVectorStoreId = async (idToRemove) => {
      if (!selectedId || !idToRemove)
        return;
      try {
        const r = await fetch(`/api/prompt-configs/${encodeURIComponent(selectedId)}/vector-stores/unlink`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ id: idToRemove }) });
        const j = await r.json();
        if (r.ok && j?.ok)
          setForm((f) => ({ ...f, vector_store_ids: Array.isArray(j.vector_store_ids) ? j.vector_store_ids : Array.isArray(f.vector_store_ids) ? f.vector_store_ids.filter((x) => x !== idToRemove) : [] }));
        else
          alert(j?.message || j?.error || "Unlink failed");
      } catch (e) {
        alert(String(e?.message || e));
      }
    };
    const loadVectorInfo = async () => {
      if (!selectedId) {
        setVecFiles([]);
        return;
      }
      setVecLoading(true);
      setVecError("");
      try {
        const r = await fetch(`${API_BASE}/prompt-configs/${encodeURIComponent(selectedId)}/vector-store`, { credentials: "include" });
        const j = await r.json();
        if (!r.ok || j?.ok === false)
          throw new Error(j?.message || j?.error || r.status);
        const files = Array.isArray(j?.files) ? j.files : [];
        setVecFiles(files);
        if (j?.vector_store_id && j.vector_store_id !== (form.vector_store_id || "")) {
          setForm((f) => ({ ...f, vector_store_id: j.vector_store_id }));
        }
      } catch (e) {
        setVecError(String(e?.message || e));
      } finally {
        setVecLoading(false);
      }
    };
    (0, import_react.useEffect)(() => {
      loadVectorInfo();
    }, [selectedId]);
    (0, import_react.useEffect)(() => {
      const run = async () => {
        if (!selectedId)
          return;
        try {
          const r = await fetch(`${API_BASE}/prompt-configs/${encodeURIComponent(selectedId)}/vector-store`, { credentials: "include" });
          const j = await r.json();
          if (r.ok && j?.ok && Array.isArray(j.vector_store_ids)) {
            setForm((f) => ({ ...f, vector_store_ids: j.vector_store_ids }));
          }
        } catch {
        }
      };
      run();
    }, [selectedId]);
    (0, import_react.useEffect)(() => {
      if (selectedId)
        loadVectorInfo();
    }, [form.vector_store_id]);
    const [mcpUploadFiles, setMcpUploadFiles] = (0, import_react.useState)([]);
    const [mcpUploading, setMcpUploading] = (0, import_react.useState)(false);
    const uploadToMcp = async () => {
      if (!mcpUploadFiles.length) {
        alert("Choose files first.");
        return;
      }
      if (!mcpToken) {
        alert("MCP token missing. See Admin \u2192 Development to set one.");
        return;
      }
      setMcpUploading(true);
      setUploadMsg("");
      try {
        let uploaded = 0;
        for (const f of mcpUploadFiles) {
          const b64 = await fileToBase64(f);
          const body = { filename: f.name, content_base64: b64, content_type: f.type || "application/octet-stream" };
          const r = await fetch(`/mcp/files/base64?token=${encodeURIComponent(mcpToken)}`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
          const j = await r.json();
          if (r.ok && j?.ok)
            uploaded++;
          else
            throw new Error(j?.message || j?.error || "upload_failed");
        }
        setUploadMsg(`Uploaded ${uploaded} file(s) to MCP`);
        setMcpUploadFiles([]);
      } catch (e) {
        setUploadMsg(String(e?.message || e));
      } finally {
        setMcpUploading(false);
      }
    };
    const [vecLinkSel, setVecLinkSel] = (0, import_react.useState)("");
    return /* @__PURE__ */ import_react.default.createElement("div", { className: "h-full w-full flex min-h-0" }, /* @__PURE__ */ import_react.default.createElement("aside", { className: "w-72 border-r bg-white p-3 flex flex-col" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "flex items-center justify-between mb-2" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "text-sm font-semibold" }, "Prompts"), /* @__PURE__ */ import_react.default.createElement("button", { className: "text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50", onClick: createNew }, "New")), /* @__PURE__ */ import_react.default.createElement("div", { className: "flex-1 overflow-y-auto scroll-area" }, loadingList && /* @__PURE__ */ import_react.default.createElement("div", { className: "text-xs text-gray-500 p-2" }, "Chargement\u2026"), (items || []).map((it) => /* @__PURE__ */ import_react.default.createElement("button", { key: it.id, onClick: () => pick(it.id), className: `w-full text-left px-3 py-2 rounded mb-1 hover:bg-gray-50 ${selectedId === it.id ? "bg-blue-50" : ""}` }, /* @__PURE__ */ import_react.default.createElement("div", { className: "font-medium text-sm" }, it.name), /* @__PURE__ */ import_react.default.createElement("div", { className: "text-[11px] text-gray-500" }, it.id))), !items?.length && !loadingList && /* @__PURE__ */ import_react.default.createElement("div", { className: "text-xs text-gray-500 p-2" }, "Aucun."))), /* @__PURE__ */ import_react.default.createElement("main", { className: "flex-1 p-4 min-h-0 overflow-y-auto scroll-area" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "text-lg font-semibold mb-2" }, "Prompt configuration"), /* @__PURE__ */ import_react.default.createElement("div", { className: "p-3 border rounded bg-amber-50 text-[13px] text-amber-800 mb-3" }, note), !selectedId && /* @__PURE__ */ import_react.default.createElement("div", { className: "text-sm text-gray-500" }, "Select a prompt on the left, or click New."), selectedId && /* @__PURE__ */ import_react.default.createElement("div", { className: "space-y-4 max-w-3xl" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "flex items-center justify-between" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "text-lg font-semibold" }, form.name || "Sans nom"), /* @__PURE__ */ import_react.default.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "text-xs px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60", onClick: savePrompt, disabled: saving }, saving ? "Saving\u2026" : "Save"), /* @__PURE__ */ import_react.default.createElement("button", { className: "text-xs px-3 py-1 rounded border bg-white hover:bg-gray-50 disabled:opacity-60", onClick: deletePrompt, disabled: deleting }, "Delete"))), /* @__PURE__ */ import_react.default.createElement("div", { className: "space-y-3" }, /* @__PURE__ */ import_react.default.createElement(Field, { label: "Prompts name" }, /* @__PURE__ */ import_react.default.createElement("input", { className: "w-full border rounded px-3 py-2", value: form.name, onChange: (e) => setForm({ ...form, name: e.target.value }) })), /* @__PURE__ */ import_react.default.createElement(Field, { label: "OpenAI API Key (serveur)" }, /* @__PURE__ */ import_react.default.createElement("input", { className: "w-full border rounded px-3 py-2", value: form.openai_api_key || "", onChange: (e) => setForm({ ...form, openai_api_key: e.target.value }), placeholder: "sk-..." })), /* @__PURE__ */ import_react.default.createElement("div", { className: "text-[11px] text-gray-600 -mt-2" }, "Organization key: ", orgHasKey ? "set" : "not set"), /* @__PURE__ */ import_react.default.createElement("div", { className: "grid grid-cols-2 gap-3" }, /* @__PURE__ */ import_react.default.createElement(Field, { label: "Prompt ID (Responses)" }, /* @__PURE__ */ import_react.default.createElement("input", { className: "w-full border rounded px-3 py-2", value: form.prompt_id || "", onChange: (e) => setForm({ ...form, prompt_id: e.target.value }), placeholder: "pmpt_..." })), /* @__PURE__ */ import_react.default.createElement(Field, { label: "Prompt version" }, /* @__PURE__ */ import_react.default.createElement("input", { className: "w-full border rounded px-3 py-2", value: form.prompt_version || "", onChange: (e) => setForm({ ...form, prompt_version: e.target.value }), placeholder: "1" }))), /* @__PURE__ */ import_react.default.createElement(Field, { label: "Developer message" }, /* @__PURE__ */ import_react.default.createElement("textarea", { className: "w-full border rounded px-3 py-2", rows: 5, value: form.dev_message || "", onChange: (e) => setForm({ ...form, dev_message: e.target.value }), placeholder: "You are a helpful assistant..." })), /* @__PURE__ */ import_react.default.createElement("div", { className: "space-y-2" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "text-xs text-gray-600" }, "Prompt messages (few\u2011shot)"), /* @__PURE__ */ import_react.default.createElement("div", { className: "space-y-2" }, (Array.isArray(form.messages) ? form.messages : []).map((m, idx) => /* @__PURE__ */ import_react.default.createElement("div", { key: idx, className: "p-2 border rounded bg-gray-50" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "flex items-center gap-2 mb-1" }, /* @__PURE__ */ import_react.default.createElement("select", { className: "border rounded px-2 py-1 text-sm", value: m.role || "user", onChange: (e) => updateMsg(idx, { role: e.target.value }) }, /* @__PURE__ */ import_react.default.createElement("option", { value: "system" }, "system"), /* @__PURE__ */ import_react.default.createElement("option", { value: "user" }, "user"), /* @__PURE__ */ import_react.default.createElement("option", { value: "assistant" }, "assistant")), /* @__PURE__ */ import_react.default.createElement("div", { className: "flex-1" }), /* @__PURE__ */ import_react.default.createElement("button", { className: "text-xs px-2 py-0.5 rounded border bg-white hover:bg-gray-100", onClick: () => moveMsg(idx, -1), disabled: idx === 0 }, "\u2191"), /* @__PURE__ */ import_react.default.createElement("button", { className: "text-xs px-2 py-0.5 rounded border bg-white hover:bg-gray-100", onClick: () => moveMsg(idx, 1), disabled: idx === form.messages.length - 1 }, "\u2193"), /* @__PURE__ */ import_react.default.createElement("button", { className: "text-xs px-2 py-0.5 rounded border bg-white hover:bg-gray-100 text-red-700", onClick: () => removeMsg(idx) }, "Remove")), /* @__PURE__ */ import_react.default.createElement("textarea", { className: "w-full border rounded px-2 py-1 text-sm", rows: 3, value: m.content || "", onChange: (e) => updateMsg(idx, { content: e.target.value }), placeholder: "Example message content..." }))), !form.messages?.length && /* @__PURE__ */ import_react.default.createElement("div", { className: "text-[11px] text-gray-500" }, "No messages. Add few\u2011shot examples below.")), /* @__PURE__ */ import_react.default.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "text-xs px-3 py-1 rounded border bg-white hover:bg-gray-50", onClick: addMsg }, "Add message"), /* @__PURE__ */ import_react.default.createElement("button", { className: "text-xs px-3 py-1 rounded border bg-white hover:bg-gray-50", onClick: copyOpenAIJson }, "Copy OpenAI UI JSON")))), /* @__PURE__ */ import_react.default.createElement("div", { className: "p-3 border rounded bg-white" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "font-medium mb-2" }, "Test this prompt"), /* @__PURE__ */ import_react.default.createElement("textarea", { className: "w-full border rounded px-3 py-2", rows: 4, value: testMsg, onChange: (e) => setTestMsg(e.target.value), placeholder: "Write a test message..." }), /* @__PURE__ */ import_react.default.createElement("div", { className: "mt-2 flex items-center gap-2" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "text-xs px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60", onClick: testThisPrompt, disabled: testBusy || !testMsg.trim() || !selectedId }, testBusy ? "Testing." : "Test"), /* @__PURE__ */ import_react.default.createElement("button", { className: "text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50", onClick: () => {
      setTestOut("");
      setTestReq("");
    } }, "Clear")), !!testOut && /* @__PURE__ */ import_react.default.createElement("pre", { className: "mt-2 text-sm bg-gray-50 border rounded p-2 whitespace-pre-wrap max-h-64 overflow-auto" }, testOut), !!testReq && /* @__PURE__ */ import_react.default.createElement("div", { className: "mt-3" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "flex items-center justify-between mb-1" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "text-sm font-medium" }, "OpenAI Request (effective)"), /* @__PURE__ */ import_react.default.createElement("button", { className: "text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50", onClick: () => navigator.clipboard.writeText(testReq) }, "Copy")), /* @__PURE__ */ import_react.default.createElement("pre", { className: "text-xs bg-gray-50 border rounded p-2 whitespace-pre-wrap max-h-64 overflow-auto" }, testReq))), /* @__PURE__ */ import_react.default.createElement("div", { className: "p-3 border rounded bg-white" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "font-medium mb-1" }, "Summary"), /* @__PURE__ */ import_react.default.createElement("div", { className: "text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 inline-block mb-2" }, "OpenAI API is not ready yet, you need to make set from OpenAI UI"), /* @__PURE__ */ import_react.default.createElement("div", { className: "text-sm space-y-2" }, Array.isArray(srvLinked) && srvLinked.length > 0 && /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("div", { className: "text-xs font-medium mb-1" }, "Associated MCP Servers"), /* @__PURE__ */ import_react.default.createElement("div", { className: "space-y-1" }, srvLinked.map((s) => {
      const pref = srvTransport?.[s.id] || ((s.options && s.options.server_url_pref) === "stream" ? "stream" : "sse");
      const url = pref === "stream" ? s.stream_url || "" : s.sse_url || "";
      return /* @__PURE__ */ import_react.default.createElement("div", { key: s.id, className: "text-[12px]" }, /* @__PURE__ */ import_react.default.createElement("span", { className: "font-medium mr-1" }, s.name || s.id), /* @__PURE__ */ import_react.default.createElement("code", { className: "px-1 py-0.5 bg-gray-50 border rounded mr-1" }, pref.toUpperCase()), /* @__PURE__ */ import_react.default.createElement("code", { className: "px-1 py-0.5 bg-gray-50 border rounded mr-1 break-all" }, url || "(no URL)"), s.token && /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("code", { className: "px-1 py-0.5 bg-gray-50 border rounded mr-1" }, s.token), /* @__PURE__ */ import_react.default.createElement("button", { className: "text-[11px] px-1 py-0.5 border rounded", onClick: () => navigator.clipboard.writeText(s.token) }, "Copy token")));
    }))), form?.tools?.file_search && /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("div", { className: "text-xs font-medium mb-1" }, "File Search"), /* @__PURE__ */ import_react.default.createElement("div", { className: "text-[12px] space-y-1" }, linkedVectorIds.length ? linkedVectorIds.map((id) => {
      const v = (vecPickList || []).find((x) => x.id === id);
      const name = v?.name || id;
      return /* @__PURE__ */ import_react.default.createElement("div", { key: id }, /* @__PURE__ */ import_react.default.createElement("span", { className: "mr-2" }, name), /* @__PURE__ */ import_react.default.createElement("code", { className: "px-1 py-0.5 bg-gray-50 border rounded mr-1" }, id), /* @__PURE__ */ import_react.default.createElement("button", { className: "text-[11px] px-1 py-0.5 border rounded", onClick: () => navigator.clipboard.writeText(id) }, "Copy ID"));
    }) : /* @__PURE__ */ import_react.default.createElement("div", { className: "text-gray-500" }, "No linked vector stores."))), form?.tools?.web_search && /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("div", { className: "text-xs font-medium mb-1" }, "Web Search"), /* @__PURE__ */ import_react.default.createElement("div", { className: "text-[12px] space-y-1" }, (Array.isArray(form.tools?.web_search_allowed_domains) ? form.tools.web_search_allowed_domains : []).map((d) => /* @__PURE__ */ import_react.default.createElement("div", { key: d, className: "flex items-center gap-2" }, /* @__PURE__ */ import_react.default.createElement("code", { className: "px-1 py-0.5 bg-gray-50 border rounded" }, d), /* @__PURE__ */ import_react.default.createElement("button", { className: "text-[11px] px-1 py-0.5 border rounded", onClick: () => navigator.clipboard.writeText(d) }, "Copy"))), !(Array.isArray(form.tools?.web_search_allowed_domains) && form.tools.web_search_allowed_domains.length) && /* @__PURE__ */ import_react.default.createElement("div", { className: "text-gray-500" }, "No domains; unrestricted."))), form?.tools?.code_interpreter && /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("div", { className: "text-xs font-medium" }, "Code interpreter"), /* @__PURE__ */ import_react.default.createElement("div", { className: "text-[12px]" }, "Enabled")), form?.tools?.image_generation && /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("div", { className: "text-xs font-medium" }, "Image Generation"), /* @__PURE__ */ import_react.default.createElement("div", { className: "text-[12px]" }, "Enabled")))), "            ", /* @__PURE__ */ import_react.default.createElement("div", { className: "p-3 border rounded bg-white" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "font-medium mb-2" }, "Associated MCP Servers (linked)"), /* @__PURE__ */ import_react.default.createElement("div", { className: "text-xs text-gray-600 mb-2" }, "Servers linked to this prompt. Click a row to expand details."), /* @__PURE__ */ import_react.default.createElement("div", { className: "flex items-center gap-2 mb-2" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "text-xs px-2 py-1 rounded border", onClick: async () => {
      if (!selectedId)
        return;
      try {
        setSrvLinkedBusy(true);
        const r = await fetch(`/api/prompt-configs/${encodeURIComponent(selectedId)}/mcp-servers`, { credentials: "include" });
        const j = await r.json();
        const list = r.ok && j?.ok ? Array.isArray(j.servers) ? j.servers : [] : [];
        setSrvLinked(list);
        const map = {};
        const tmap = {};
        list.forEach((s) => {
          const def = Array.isArray(s.allowed_tools) ? s.allowed_tools : Array.isArray(s.tools) ? s.tools.map((t) => t.name) : [];
          map[s.id] = new Set(def);
          const pref = s.options && typeof s.options === "object" && s.options.server_url_pref === "stream" ? "stream" : "sse";
          tmap[s.id] = pref;
        });
        setSrvAllowed(map);
        setSrvTransport(tmap);
      } catch {
        setSrvLinked([]);
      } finally {
        setSrvLinkedBusy(false);
      }
    } }, "Refresh"), srvLinkedBusy && /* @__PURE__ */ import_react.default.createElement("span", { className: "text-[11px] text-gray-600" }, "Loading\u2026")), /* @__PURE__ */ import_react.default.createElement("div", { className: "flex flex-wrap items-center gap-2 mb-3" }, /* @__PURE__ */ import_react.default.createElement("select", { className: "border rounded px-2 py-1 text-sm min-w-[220px]", value: srvLinkSel, onChange: (e) => setSrvLinkSel(e.target.value) }, /* @__PURE__ */ import_react.default.createElement("option", { value: "" }, "Select server to link\u2026"), srvList.filter((sv) => !(srvLinked || []).some((ls) => ls.id === sv.id)).map((sv) => /* @__PURE__ */ import_react.default.createElement("option", { key: sv.id, value: sv.id }, sv.name || sv.id, " ", sv.kind ? `(${sv.kind})` : ""))), /* @__PURE__ */ import_react.default.createElement("button", { className: "text-xs px-2 py-1 rounded border disabled:opacity-60", disabled: !srvLinkSel || srvLinkBusy || !selectedId, onClick: async () => {
      if (!selectedId || !srvLinkSel)
        return;
      setSrvLinkBusy(true);
      try {
        const r = await fetch(`/api/prompt-configs/${encodeURIComponent(selectedId)}/mcp-servers/assign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ server_ids: [srvLinkSel] })
        });
        if (!r.ok) {
          try {
            const j = await r.json();
            alert(j?.message || j?.error || "Link failed");
          } catch {
            alert("Link failed");
          }
        }
        try {
          setSrvLinkedBusy(true);
          const rr = await fetch(`/api/prompt-configs/${encodeURIComponent(selectedId)}/mcp-servers`, { credentials: "include" });
          const jj = await rr.json();
          const list = rr.ok && jj?.ok ? Array.isArray(jj.servers) ? jj.servers : [] : [];
          setSrvLinked(list);
          const map = {};
          list.forEach((sv) => {
            const def = Array.isArray(sv.allowed_tools) ? sv.allowed_tools : Array.isArray(sv.tools) ? sv.tools.map((t) => t.name) : [];
            map[sv.id] = new Set(def);
          });
          setSrvAllowed(map);
        } catch {
          setSrvLinked([]);
        } finally {
          setSrvLinkedBusy(false);
        }
        setSrvLinkSel("");
      } catch (e) {
        alert(String(e?.message || e));
      } finally {
        setSrvLinkBusy(false);
      }
    } }, srvLinkBusy ? "Linking\u2026" : "Link")), (!srvLinked || !srvLinked.length) && /* @__PURE__ */ import_react.default.createElement("div", { className: "text-sm text-gray-500" }, "No linked MCP servers."), !!(srvLinked && srvLinked.length) && /* @__PURE__ */ import_react.default.createElement("div", { className: "border rounded bg-white" }, /* @__PURE__ */ import_react.default.createElement("table", { className: "min-w-full text-sm" }, /* @__PURE__ */ import_react.default.createElement("thead", { className: "bg-gray-50" }, /* @__PURE__ */ import_react.default.createElement("tr", null, /* @__PURE__ */ import_react.default.createElement("th", { className: "text-left px-3 py-2" }, "Name"), /* @__PURE__ */ import_react.default.createElement("th", { className: "text-left px-3 py-2" }, "Group"), /* @__PURE__ */ import_react.default.createElement("th", { className: "text-left px-3 py-2" }, "Server Type"), /* @__PURE__ */ import_react.default.createElement("th", { className: "text-left px-3 py-2" }, "Status"), /* @__PURE__ */ import_react.default.createElement("th", { className: "text-right px-3 py-2" }, "Actions"))), /* @__PURE__ */ import_react.default.createElement("tbody", null, srvLinked.map((s, idx) => /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, { key: s.id }, /* @__PURE__ */ import_react.default.createElement("tr", { className: "border-t hover:bg-gray-50 cursor-pointer", onClick: () => {
      setSrvFiles((m) => ({ ...m, [`exp_${s.id}`]: !m[`exp_${s.id}`] }));
      setSrvAllowed((prev) => {
        if (prev && prev[s.id])
          return prev;
        const def = Array.isArray(s.allowed_tools) ? s.allowed_tools : Array.isArray(s.tools) ? s.tools.map((t) => t.name) : [];
        return { ...prev || {}, [s.id]: new Set(def) };
      });
      setSrvTransport((prev) => {
        if (prev && prev[s.id])
          return prev;
        const pref = s.options && typeof s.options === "object" && s.options.server_url_pref === "stream" ? "stream" : "sse";
        return { ...prev || {}, [s.id]: pref };
      });
    } }, /* @__PURE__ */ import_react.default.createElement("td", { className: "px-3 py-2" }, s.name || s.id), /* @__PURE__ */ import_react.default.createElement("td", { className: "px-3 py-2" }, s.group_name || "-"), /* @__PURE__ */ import_react.default.createElement("td", { className: "px-3 py-2" }, s.server_type || s.kind || "-"), /* @__PURE__ */ import_react.default.createElement("td", { className: "px-3 py-2" }, s.enabled ? "Enabled" : "Disabled"), /* @__PURE__ */ import_react.default.createElement("td", { className: "px-3 py-2 text-right", onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        className: "text-[11px] px-2 py-0.5 border rounded text-red-700 hover:bg-red-50",
        onClick: async () => {
          if (!selectedId)
            return;
          if (!confirm(`Unlink ${s.name || s.id} from this prompt?`))
            return;
          try {
            await fetch(`/api/prompt-configs/${encodeURIComponent(selectedId)}/mcp-servers/unassign`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ server_ids: [s.id] })
            });
          } catch {
          }
          try {
            setSrvLinkedBusy(true);
            const r = await fetch(`/api/prompt-configs/${encodeURIComponent(selectedId)}/mcp-servers`, { credentials: "include" });
            const j = await r.json();
            const list = r.ok && j?.ok ? Array.isArray(j.servers) ? j.servers : [] : [];
            setSrvLinked(list);
            const map = {};
            list.forEach((s2) => {
              const def = Array.isArray(s2.allowed_tools) ? s2.allowed_tools : Array.isArray(s2.tools) ? s2.tools.map((t) => t.name) : [];
              map[s2.id] = new Set(def);
            });
            setSrvAllowed(map);
          } catch {
            setSrvLinked([]);
          } finally {
            setSrvLinkedBusy(false);
          }
        }
      },
      "Unlink"
    ))), srvFiles[`exp_${s.id}`] && /* @__PURE__ */ import_react.default.createElement("tr", { className: "bg-gray-50" }, /* @__PURE__ */ import_react.default.createElement("td", { colSpan: 5, className: "px-4 py-3" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-3" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("div", { className: "text-xs text-gray-600 mb-1" }, "Streamable HTTP (Inspector)"), /* @__PURE__ */ import_react.default.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ import_react.default.createElement("code", { className: "flex-1 text-xs bg-white border rounded px-2 py-1 break-all" }, s.stream_url || "-"), /* @__PURE__ */ import_react.default.createElement("button", { className: "text-[11px] px-2 py-0.5 border rounded", onClick: () => copy(s.stream_url || "") }, "Copy"))), /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("div", { className: "text-xs text-gray-600 mb-1" }, "SSE URL (OpenAI Responses server_url)"), /* @__PURE__ */ import_react.default.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ import_react.default.createElement("code", { className: "flex-1 text-xs bg-white border rounded px-2 py-1 break-all" }, s.sse_url || "-"), /* @__PURE__ */ import_react.default.createElement("button", { className: "text-[11px] px-2 py-0.5 border rounded", onClick: () => copy(s.sse_url || "") }, "Copy"))), /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("div", { className: "text-xs text-gray-600 mb-1" }, "Token"), /* @__PURE__ */ import_react.default.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ import_react.default.createElement("code", { className: "flex-1 text-xs bg-white border rounded px-2 py-1 break-all" }, s.token || "(none)"), /* @__PURE__ */ import_react.default.createElement("button", { className: "text-[11px] px-2 py-0.5 border rounded", onClick: () => copy(s.token || "") }, "Copy"))), /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("div", { className: "text-xs text-gray-600 mb-1" }, "OpenAI Responses URL"), /* @__PURE__ */ import_react.default.createElement("div", { className: "flex items-center gap-3 text-sm" }, /* @__PURE__ */ import_react.default.createElement("label", { className: "inline-flex items-center gap-1" }, /* @__PURE__ */ import_react.default.createElement("input", { type: "radio", name: `tx_${s.id}`, checked: (srvTransport?.[s.id] || "sse") === "sse", onChange: () => setSrvTransport((m) => ({ ...m || {}, [s.id]: "sse" })) }), " SSE (server_url)"), /* @__PURE__ */ import_react.default.createElement("label", { className: "inline-flex items-center gap-1" }, /* @__PURE__ */ import_react.default.createElement("input", { type: "radio", name: `tx_${s.id}`, checked: (srvTransport?.[s.id] || "sse") === "stream", onChange: () => setSrvTransport((m) => ({ ...m || {}, [s.id]: "stream" })) }), " Streamable HTTP"))), /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("div", { className: "text-xs text-gray-600 mb-1" }, "Tools"), /* @__PURE__ */ import_react.default.createElement("div", { className: "text-xs bg-white border rounded p-2 max-h-40 overflow-auto space-y-1" }, Array.isArray(s.tools) && s.tools.length ? s.tools.map((t) => {
      const sid = s.id;
      const set = srvAllowed[sid] || /* @__PURE__ */ new Set();
      const on = set.has(t.name);
      return /* @__PURE__ */ import_react.default.createElement("label", { key: t.name, className: "flex items-center justify-between gap-2" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ import_react.default.createElement("input", { type: "checkbox", checked: on, onChange: (e) => {
        setSrvAllowed((prev) => {
          const copyMap = { ...prev };
          const curr = new Set(copyMap[sid] || []);
          if (e.target.checked)
            curr.add(t.name);
          else
            curr.delete(t.name);
          copyMap[sid] = curr;
          return copyMap;
        });
      } }), /* @__PURE__ */ import_react.default.createElement("code", { className: "px-1" }, t.name)), /* @__PURE__ */ import_react.default.createElement("span", { className: "text-[11px] text-gray-500 flex-1" }, t.description || ""));
    }) : /* @__PURE__ */ import_react.default.createElement("div", { className: "text-gray-500" }, "(none)")), /* @__PURE__ */ import_react.default.createElement("div", { className: "mt-2 flex items-center gap-2" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "text-[11px] px-2 py-0.5 border rounded", onClick: async () => {
      try {
        const names = Array.from(srvAllowed[s.id] || []);
        const opts = s.options && typeof s.options === "object" ? s.options : {};
        const body = { options: { ...opts, allowed_tools: names, server_url_pref: srvTransport?.[s.id] || "sse" } };
        const r = await fetch(`/api/mcp-servers/${encodeURIComponent(s.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j?.ok === false)
          alert(j?.message || j?.error || "Save failed");
        else {
          try {
            setSrvLinkedBusy(true);
            const rr = await fetch(`/api/prompt-configs/${encodeURIComponent(selectedId)}/mcp-servers`, { credentials: "include" });
            const jj = await rr.json();
            const list = rr.ok && jj?.ok ? Array.isArray(jj.servers) ? jj.servers : [] : [];
            setSrvLinked(list);
            const map = {};
            const tmap = {};
            list.forEach((sv) => {
              const def = Array.isArray(sv.allowed_tools) ? sv.allowed_tools : Array.isArray(sv.tools) ? sv.tools.map((t) => t.name) : [];
              map[sv.id] = new Set(def);
              tmap[sv.id] = sv.options && typeof sv.options === "object" && sv.options.server_url_pref ? sv.options.server_url_pref === "stream" ? "stream" : "sse" : "sse";
            });
            setSrvAllowed(map);
            setSrvTransport(tmap);
          } catch {
          } finally {
            setSrvLinkedBusy(false);
          }
        }
      } catch (e) {
        alert(String(e?.message || e));
      }
    } }, "Save settings"), /* @__PURE__ */ import_react.default.createElement("span", { className: "text-[11px] text-gray-500" }, "Applied server-wide")))))))))), "                "), /* @__PURE__ */ import_react.default.createElement("div", { className: "mt-3" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "text-xs font-medium mb-1" }, "Available MCP Servers"), /* @__PURE__ */ import_react.default.createElement("div", { className: "border rounded bg-white" }, /* @__PURE__ */ import_react.default.createElement("table", { className: "min-w-full text-sm" }, /* @__PURE__ */ import_react.default.createElement("thead", { className: "bg-gray-50" }, /* @__PURE__ */ import_react.default.createElement("tr", null, /* @__PURE__ */ import_react.default.createElement("th", { className: "text-left px-3 py-2" }, "Name"), /* @__PURE__ */ import_react.default.createElement("th", { className: "text-left px-3 py-2" }, "Group"), /* @__PURE__ */ import_react.default.createElement("th", { className: "text-left px-3 py-2" }, "Type"), /* @__PURE__ */ import_react.default.createElement("th", { className: "text-left px-3 py-2" }, "Actions"))), /* @__PURE__ */ import_react.default.createElement("tbody", null, !availableServers || !availableServers.length ? /* @__PURE__ */ import_react.default.createElement("tr", null, /* @__PURE__ */ import_react.default.createElement("td", { className: "px-3 py-2 text-sm text-gray-500", colSpan: 4 }, "No available servers.")) : availableServers.map((s) => /* @__PURE__ */ import_react.default.createElement("tr", { key: s.id }, /* @__PURE__ */ import_react.default.createElement("td", { className: "px-3 py-2" }, s.name || s.id), /* @__PURE__ */ import_react.default.createElement("td", { className: "px-3 py-2" }, s.group_name || s.group || "-"), /* @__PURE__ */ import_react.default.createElement("td", { className: "px-3 py-2" }, s.kind || "custom"), /* @__PURE__ */ import_react.default.createElement("td", { className: "px-3 py-2" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "text-xs px-2 py-1 border rounded", onClick: () => linkServer(s.id) }, "Link"))))))))), false, /* @__PURE__ */ import_react.default.createElement("div", { className: "p-3 border rounded bg-white" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "font-medium mb-2" }, "Associated Vector Stores (linked)"), /* @__PURE__ */ import_react.default.createElement("div", { className: "flex items-center gap-2 mb-3" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "text-xs px-3 py-1 rounded-full border", onClick: loadVectorStores }, "Refresh")), /* @__PURE__ */ import_react.default.createElement("div", { className: "mb-2" }, /* @__PURE__ */ import_react.default.createElement("label", { className: "inline-flex items-center gap-2 text-sm" }, /* @__PURE__ */ import_react.default.createElement("input", { type: "checkbox", checked: !!(form.tools && form.tools.file_search), onChange: (e) => setForm((f) => ({ ...f, tools: { ...f.tools || {}, file_search: !!e.target.checked } })) }), /* @__PURE__ */ import_react.default.createElement("span", null, "Enable File Search"))), Array.isArray(form.vector_store_ids) && form.vector_store_ids.length > 0 ? /* @__PURE__ */ import_react.default.createElement("div", { className: "border rounded bg-white" }, /* @__PURE__ */ import_react.default.createElement("table", { className: "min-w-full text-sm" }, /* @__PURE__ */ import_react.default.createElement("thead", { className: "bg-gray-50" }, /* @__PURE__ */ import_react.default.createElement("tr", null, /* @__PURE__ */ import_react.default.createElement("th", { className: "text-left px-3 py-2" }, "Name"), /* @__PURE__ */ import_react.default.createElement("th", { className: "text-left px-3 py-2" }, "ID"), /* @__PURE__ */ import_react.default.createElement("th", { className: "text-right px-3 py-2" }, "Actions"))), /* @__PURE__ */ import_react.default.createElement("tbody", null, form.vector_store_ids.map((id) => {
      const v = (vecPickList || []).find((x) => x.id === id) || { id, name: id };
      return /* @__PURE__ */ import_react.default.createElement("tr", { key: id, className: "border-t" }, /* @__PURE__ */ import_react.default.createElement("td", { className: "px-3 py-2" }, v.name || id), /* @__PURE__ */ import_react.default.createElement("td", { className: "px-3 py-2 font-mono" }, id), /* @__PURE__ */ import_react.default.createElement("td", { className: "px-3 py-2 text-right" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "text-[11px] px-3 py-0.5 border rounded-full", onClick: () => navigator.clipboard.writeText(id) }, "Copy ID"), /* @__PURE__ */ import_react.default.createElement("button", { className: "ml-2 text-[11px] px-3 py-0.5 border rounded-full text-red-700 hover:bg-red-50", onClick: () => unlinkVectorStoreId(id) }, "Unlink")));
    })))) : /* @__PURE__ */ import_react.default.createElement("div", { className: "text-sm text-gray-500" }, "No linked vector stores."), /* @__PURE__ */ import_react.default.createElement("div", { className: "mt-3" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "text-xs font-medium mb-1" }, "Available Vector Stores"), /* @__PURE__ */ import_react.default.createElement("div", { className: "border rounded bg-white" }, /* @__PURE__ */ import_react.default.createElement("table", { className: "min-w-full text-sm" }, /* @__PURE__ */ import_react.default.createElement("thead", { className: "bg-gray-50" }, /* @__PURE__ */ import_react.default.createElement("tr", null, /* @__PURE__ */ import_react.default.createElement("th", { className: "text-left px-3 py-2" }, "Name"), /* @__PURE__ */ import_react.default.createElement("th", { className: "text-left px-3 py-2" }, "ID"), /* @__PURE__ */ import_react.default.createElement("th", { className: "text-left px-3 py-2" }, "Actions"))), /* @__PURE__ */ import_react.default.createElement("tbody", null, (() => {
      const linked = new Set(Array.isArray(form.vector_store_ids) ? form.vector_store_ids : []);
      const avail = (vecPickList || []).filter((v) => v && !linked.has(v.id));
      if (!avail.length)
        return /* @__PURE__ */ import_react.default.createElement("tr", null, /* @__PURE__ */ import_react.default.createElement("td", { className: "px-3 py-2 text-sm text-gray-500", colSpan: 3 }, "No available vector stores."));
      return avail.map((v) => /* @__PURE__ */ import_react.default.createElement("tr", { key: v.id, className: "border-t" }, /* @__PURE__ */ import_react.default.createElement("td", { className: "px-3 py-2" }, v.name || v.id), /* @__PURE__ */ import_react.default.createElement("td", { className: "px-3 py-2 font-mono" }, v.id), /* @__PURE__ */ import_react.default.createElement("td", { className: "px-3 py-2" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "text-xs px-3 py-1 border rounded-full", onClick: () => linkSelectedVector(v.id) }, "Link"))));
    })())))), /* @__PURE__ */ import_react.default.createElement("div", { className: "font-medium mb-2 mt-4" }, "File Search"), /* @__PURE__ */ import_react.default.createElement("div", { className: "mb-2" }, /* @__PURE__ */ import_react.default.createElement("label", { className: "inline-flex items-center gap-2 text-sm" }, /* @__PURE__ */ import_react.default.createElement(
      "input",
      {
        type: "checkbox",
        checked: !!(form.tools && form.tools.file_search),
        onChange: (e) => setForm((f) => ({ ...f, tools: { ...f.tools || {}, file_search: !!e.target.checked } }))
      }
    ), /* @__PURE__ */ import_react.default.createElement("span", null, "Enable File Search"))), /* @__PURE__ */ import_react.default.createElement("div", { className: "p-3 border rounded bg-white" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "font-medium mb-1" }, "Function"), /* @__PURE__ */ import_react.default.createElement("div", { className: "text-xs text-gray-500" }, "(\xE0 faire)")), /* @__PURE__ */ import_react.default.createElement("div", { className: "p-3 border rounded bg-white" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "font-medium mb-1" }, "Web Search"), /* @__PURE__ */ import_react.default.createElement("div", { className: "mb-1" }, /* @__PURE__ */ import_react.default.createElement("label", { className: "inline-flex items-center gap-2 text-sm" }, /* @__PURE__ */ import_react.default.createElement(
      "input",
      {
        type: "checkbox",
        checked: !!(form.tools && form.tools.web_search),
        onChange: (e) => setForm((f) => ({ ...f, tools: { ...f.tools || {}, web_search: !!e.target.checked } }))
      }
    ), /* @__PURE__ */ import_react.default.createElement("span", null, "Enable Web Search"))), /* @__PURE__ */ import_react.default.createElement("div", { className: "text-xs text-gray-500" }, "Toggle on to allow the model to use web_search.")), /* @__PURE__ */ import_react.default.createElement("div", { className: "p-3 border rounded bg-white" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "font-medium mb-1" }, "Code interpreter"), /* @__PURE__ */ import_react.default.createElement("div", { className: "text-xs text-gray-500" }, "(\xE0 faire)")), /* @__PURE__ */ import_react.default.createElement("div", { className: "p-3 border rounded bg-white" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "font-medium mb-1" }, "Image Generation"), /* @__PURE__ */ import_react.default.createElement("div", { className: "text-xs text-gray-500" }, "(\xE0 faire)")), /* @__PURE__ */ import_react.default.createElement("div", { className: "p-3 border rounded bg-white" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "font-medium mb-1" }, "Custom"), /* @__PURE__ */ import_react.default.createElement("div", { className: "text-xs text-gray-500" }, "(\xE0 faire)")), /* @__PURE__ */ import_react.default.createElement("div", { className: "p-3 border rounded bg-white" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "flex items-center justify-between mb-1" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "font-medium" }, "Preview (Request Payload)"), /* @__PURE__ */ import_react.default.createElement("div", { className: "text-[11px] text-gray-600" }, "~", approxTokens, " tokens (approx)")), /* @__PURE__ */ import_react.default.createElement("pre", { className: "text-xs bg-gray-50 border rounded p-2 whitespace-pre-wrap max-h-64 overflow-auto" }, JSON.stringify(previewObj, null, 2)), /* @__PURE__ */ import_react.default.createElement("div", { className: "flex items-center justify-end mt-2" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50", onClick: copyPreview }, "Copy preview")))))));
  }
})();
/*! Bundled license information:

react/cjs/react.development.js:
  (**
   * @license React
   * react.development.js
   *
   * Copyright (c) Facebook, Inc. and its affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)
*/
