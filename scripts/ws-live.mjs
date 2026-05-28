import { createRequire } from "module"; const require = createRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
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

// node_modules/ws/lib/constants.js
var require_constants = __commonJS({
  "node_modules/ws/lib/constants.js"(exports, module) {
    "use strict";
    var BINARY_TYPES = ["nodebuffer", "arraybuffer", "fragments"];
    var hasBlob = typeof Blob !== "undefined";
    if (hasBlob) BINARY_TYPES.push("blob");
    module.exports = {
      BINARY_TYPES,
      CLOSE_TIMEOUT: 3e4,
      EMPTY_BUFFER: Buffer.alloc(0),
      GUID: "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      hasBlob,
      kForOnEventAttribute: Symbol("kIsForOnEventAttribute"),
      kListener: Symbol("kListener"),
      kStatusCode: Symbol("status-code"),
      kWebSocket: Symbol("websocket"),
      NOOP: () => {
      }
    };
  }
});

// node_modules/ws/lib/buffer-util.js
var require_buffer_util = __commonJS({
  "node_modules/ws/lib/buffer-util.js"(exports, module) {
    "use strict";
    var { EMPTY_BUFFER } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    function concat(list, totalLength) {
      if (list.length === 0) return EMPTY_BUFFER;
      if (list.length === 1) return list[0];
      const target = Buffer.allocUnsafe(totalLength);
      let offset = 0;
      for (let i = 0; i < list.length; i++) {
        const buf = list[i];
        target.set(buf, offset);
        offset += buf.length;
      }
      if (offset < totalLength) {
        return new FastBuffer(target.buffer, target.byteOffset, offset);
      }
      return target;
    }
    function _mask(source, mask, output, offset, length) {
      for (let i = 0; i < length; i++) {
        output[offset + i] = source[i] ^ mask[i & 3];
      }
    }
    function _unmask(buffer, mask) {
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] ^= mask[i & 3];
      }
    }
    function toArrayBuffer(buf) {
      if (buf.length === buf.buffer.byteLength) {
        return buf.buffer;
      }
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
    }
    function toBuffer(data) {
      toBuffer.readOnly = true;
      if (Buffer.isBuffer(data)) return data;
      let buf;
      if (data instanceof ArrayBuffer) {
        buf = new FastBuffer(data);
      } else if (ArrayBuffer.isView(data)) {
        buf = new FastBuffer(data.buffer, data.byteOffset, data.byteLength);
      } else {
        buf = Buffer.from(data);
        toBuffer.readOnly = false;
      }
      return buf;
    }
    module.exports = {
      concat,
      mask: _mask,
      toArrayBuffer,
      toBuffer,
      unmask: _unmask
    };
    if (!process.env.WS_NO_BUFFER_UTIL) {
      try {
        const bufferUtil = __require("bufferutil");
        module.exports.mask = function(source, mask, output, offset, length) {
          if (length < 48) _mask(source, mask, output, offset, length);
          else bufferUtil.mask(source, mask, output, offset, length);
        };
        module.exports.unmask = function(buffer, mask) {
          if (buffer.length < 32) _unmask(buffer, mask);
          else bufferUtil.unmask(buffer, mask);
        };
      } catch (e) {
      }
    }
  }
});

// node_modules/ws/lib/limiter.js
var require_limiter = __commonJS({
  "node_modules/ws/lib/limiter.js"(exports, module) {
    "use strict";
    var kDone = Symbol("kDone");
    var kRun = Symbol("kRun");
    var Limiter = class {
      /**
       * Creates a new `Limiter`.
       *
       * @param {Number} [concurrency=Infinity] The maximum number of jobs allowed
       *     to run concurrently
       */
      constructor(concurrency) {
        this[kDone] = () => {
          this.pending--;
          this[kRun]();
        };
        this.concurrency = concurrency || Infinity;
        this.jobs = [];
        this.pending = 0;
      }
      /**
       * Adds a job to the queue.
       *
       * @param {Function} job The job to run
       * @public
       */
      add(job) {
        this.jobs.push(job);
        this[kRun]();
      }
      /**
       * Removes a job from the queue and runs it if possible.
       *
       * @private
       */
      [kRun]() {
        if (this.pending === this.concurrency) return;
        if (this.jobs.length) {
          const job = this.jobs.shift();
          this.pending++;
          job(this[kDone]);
        }
      }
    };
    module.exports = Limiter;
  }
});

// node_modules/ws/lib/permessage-deflate.js
var require_permessage_deflate = __commonJS({
  "node_modules/ws/lib/permessage-deflate.js"(exports, module) {
    "use strict";
    var zlib = __require("zlib");
    var bufferUtil = require_buffer_util();
    var Limiter = require_limiter();
    var { kStatusCode } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    var TRAILER = Buffer.from([0, 0, 255, 255]);
    var kPerMessageDeflate = Symbol("permessage-deflate");
    var kTotalLength = Symbol("total-length");
    var kCallback = Symbol("callback");
    var kBuffers = Symbol("buffers");
    var kError = Symbol("error");
    var zlibLimiter;
    var PerMessageDeflate2 = class {
      /**
       * Creates a PerMessageDeflate instance.
       *
       * @param {Object} [options] Configuration options
       * @param {(Boolean|Number)} [options.clientMaxWindowBits] Advertise support
       *     for, or request, a custom client window size
       * @param {Boolean} [options.clientNoContextTakeover=false] Advertise/
       *     acknowledge disabling of client context takeover
       * @param {Number} [options.concurrencyLimit=10] The number of concurrent
       *     calls to zlib
       * @param {Boolean} [options.isServer=false] Create the instance in either
       *     server or client mode
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {(Boolean|Number)} [options.serverMaxWindowBits] Request/confirm the
       *     use of a custom server window size
       * @param {Boolean} [options.serverNoContextTakeover=false] Request/accept
       *     disabling of server context takeover
       * @param {Number} [options.threshold=1024] Size (in bytes) below which
       *     messages should not be compressed if context takeover is disabled
       * @param {Object} [options.zlibDeflateOptions] Options to pass to zlib on
       *     deflate
       * @param {Object} [options.zlibInflateOptions] Options to pass to zlib on
       *     inflate
       */
      constructor(options) {
        this._options = options || {};
        this._threshold = this._options.threshold !== void 0 ? this._options.threshold : 1024;
        this._maxPayload = this._options.maxPayload | 0;
        this._isServer = !!this._options.isServer;
        this._deflate = null;
        this._inflate = null;
        this.params = null;
        if (!zlibLimiter) {
          const concurrency = this._options.concurrencyLimit !== void 0 ? this._options.concurrencyLimit : 10;
          zlibLimiter = new Limiter(concurrency);
        }
      }
      /**
       * @type {String}
       */
      static get extensionName() {
        return "permessage-deflate";
      }
      /**
       * Create an extension negotiation offer.
       *
       * @return {Object} Extension parameters
       * @public
       */
      offer() {
        const params = {};
        if (this._options.serverNoContextTakeover) {
          params.server_no_context_takeover = true;
        }
        if (this._options.clientNoContextTakeover) {
          params.client_no_context_takeover = true;
        }
        if (this._options.serverMaxWindowBits) {
          params.server_max_window_bits = this._options.serverMaxWindowBits;
        }
        if (this._options.clientMaxWindowBits) {
          params.client_max_window_bits = this._options.clientMaxWindowBits;
        } else if (this._options.clientMaxWindowBits == null) {
          params.client_max_window_bits = true;
        }
        return params;
      }
      /**
       * Accept an extension negotiation offer/response.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Object} Accepted configuration
       * @public
       */
      accept(configurations) {
        configurations = this.normalizeParams(configurations);
        this.params = this._isServer ? this.acceptAsServer(configurations) : this.acceptAsClient(configurations);
        return this.params;
      }
      /**
       * Releases all resources used by the extension.
       *
       * @public
       */
      cleanup() {
        if (this._inflate) {
          this._inflate.close();
          this._inflate = null;
        }
        if (this._deflate) {
          const callback = this._deflate[kCallback];
          this._deflate.close();
          this._deflate = null;
          if (callback) {
            callback(
              new Error(
                "The deflate stream was closed while data was being processed"
              )
            );
          }
        }
      }
      /**
       *  Accept an extension negotiation offer.
       *
       * @param {Array} offers The extension negotiation offers
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsServer(offers) {
        const opts = this._options;
        const accepted = offers.find((params) => {
          if (opts.serverNoContextTakeover === false && params.server_no_context_takeover || params.server_max_window_bits && (opts.serverMaxWindowBits === false || typeof opts.serverMaxWindowBits === "number" && opts.serverMaxWindowBits > params.server_max_window_bits) || typeof opts.clientMaxWindowBits === "number" && !params.client_max_window_bits) {
            return false;
          }
          return true;
        });
        if (!accepted) {
          throw new Error("None of the extension offers can be accepted");
        }
        if (opts.serverNoContextTakeover) {
          accepted.server_no_context_takeover = true;
        }
        if (opts.clientNoContextTakeover) {
          accepted.client_no_context_takeover = true;
        }
        if (typeof opts.serverMaxWindowBits === "number") {
          accepted.server_max_window_bits = opts.serverMaxWindowBits;
        }
        if (typeof opts.clientMaxWindowBits === "number") {
          accepted.client_max_window_bits = opts.clientMaxWindowBits;
        } else if (accepted.client_max_window_bits === true || opts.clientMaxWindowBits === false) {
          delete accepted.client_max_window_bits;
        }
        return accepted;
      }
      /**
       * Accept the extension negotiation response.
       *
       * @param {Array} response The extension negotiation response
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsClient(response) {
        const params = response[0];
        if (this._options.clientNoContextTakeover === false && params.client_no_context_takeover) {
          throw new Error('Unexpected parameter "client_no_context_takeover"');
        }
        if (!params.client_max_window_bits) {
          if (typeof this._options.clientMaxWindowBits === "number") {
            params.client_max_window_bits = this._options.clientMaxWindowBits;
          }
        } else if (this._options.clientMaxWindowBits === false || typeof this._options.clientMaxWindowBits === "number" && params.client_max_window_bits > this._options.clientMaxWindowBits) {
          throw new Error(
            'Unexpected or invalid parameter "client_max_window_bits"'
          );
        }
        return params;
      }
      /**
       * Normalize parameters.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Array} The offers/response with normalized parameters
       * @private
       */
      normalizeParams(configurations) {
        configurations.forEach((params) => {
          Object.keys(params).forEach((key) => {
            let value = params[key];
            if (value.length > 1) {
              throw new Error(`Parameter "${key}" must have only a single value`);
            }
            value = value[0];
            if (key === "client_max_window_bits") {
              if (value !== true) {
                const num = +value;
                if (!Number.isInteger(num) || num < 8 || num > 15) {
                  throw new TypeError(
                    `Invalid value for parameter "${key}": ${value}`
                  );
                }
                value = num;
              } else if (!this._isServer) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else if (key === "server_max_window_bits") {
              const num = +value;
              if (!Number.isInteger(num) || num < 8 || num > 15) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
              value = num;
            } else if (key === "client_no_context_takeover" || key === "server_no_context_takeover") {
              if (value !== true) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else {
              throw new Error(`Unknown parameter "${key}"`);
            }
            params[key] = value;
          });
        });
        return configurations;
      }
      /**
       * Decompress data. Concurrency limited.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      decompress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._decompress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Compress data. Concurrency limited.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      compress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._compress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Decompress data.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _decompress(data, fin, callback) {
        const endpoint = this._isServer ? "client" : "server";
        if (!this._inflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._inflate = zlib.createInflateRaw({
            ...this._options.zlibInflateOptions,
            windowBits
          });
          this._inflate[kPerMessageDeflate] = this;
          this._inflate[kTotalLength] = 0;
          this._inflate[kBuffers] = [];
          this._inflate.on("error", inflateOnError);
          this._inflate.on("data", inflateOnData);
        }
        this._inflate[kCallback] = callback;
        this._inflate.write(data);
        if (fin) this._inflate.write(TRAILER);
        this._inflate.flush(() => {
          const err = this._inflate[kError];
          if (err) {
            this._inflate.close();
            this._inflate = null;
            callback(err);
            return;
          }
          const data2 = bufferUtil.concat(
            this._inflate[kBuffers],
            this._inflate[kTotalLength]
          );
          if (this._inflate._readableState.endEmitted) {
            this._inflate.close();
            this._inflate = null;
          } else {
            this._inflate[kTotalLength] = 0;
            this._inflate[kBuffers] = [];
            if (fin && this.params[`${endpoint}_no_context_takeover`]) {
              this._inflate.reset();
            }
          }
          callback(null, data2);
        });
      }
      /**
       * Compress data.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _compress(data, fin, callback) {
        const endpoint = this._isServer ? "server" : "client";
        if (!this._deflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._deflate = zlib.createDeflateRaw({
            ...this._options.zlibDeflateOptions,
            windowBits
          });
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          this._deflate.on("data", deflateOnData);
        }
        this._deflate[kCallback] = callback;
        this._deflate.write(data);
        this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
          if (!this._deflate) {
            return;
          }
          let data2 = bufferUtil.concat(
            this._deflate[kBuffers],
            this._deflate[kTotalLength]
          );
          if (fin) {
            data2 = new FastBuffer(data2.buffer, data2.byteOffset, data2.length - 4);
          }
          this._deflate[kCallback] = null;
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          if (fin && this.params[`${endpoint}_no_context_takeover`]) {
            this._deflate.reset();
          }
          callback(null, data2);
        });
      }
    };
    module.exports = PerMessageDeflate2;
    function deflateOnData(chunk) {
      this[kBuffers].push(chunk);
      this[kTotalLength] += chunk.length;
    }
    function inflateOnData(chunk) {
      this[kTotalLength] += chunk.length;
      if (this[kPerMessageDeflate]._maxPayload < 1 || this[kTotalLength] <= this[kPerMessageDeflate]._maxPayload) {
        this[kBuffers].push(chunk);
        return;
      }
      this[kError] = new RangeError("Max payload size exceeded");
      this[kError].code = "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH";
      this[kError][kStatusCode] = 1009;
      this.removeListener("data", inflateOnData);
      this.reset();
    }
    function inflateOnError(err) {
      this[kPerMessageDeflate]._inflate = null;
      if (this[kError]) {
        this[kCallback](this[kError]);
        return;
      }
      err[kStatusCode] = 1007;
      this[kCallback](err);
    }
  }
});

// node_modules/ws/lib/validation.js
var require_validation = __commonJS({
  "node_modules/ws/lib/validation.js"(exports, module) {
    "use strict";
    var { isUtf8 } = __require("buffer");
    var { hasBlob } = require_constants();
    var tokenChars = [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 0 - 15
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 16 - 31
      0,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      1,
      1,
      0,
      1,
      1,
      0,
      // 32 - 47
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      // 48 - 63
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 64 - 79
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      // 80 - 95
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 96 - 111
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      1,
      0,
      1,
      0
      // 112 - 127
    ];
    function isValidStatusCode(code) {
      return code >= 1e3 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006 || code >= 3e3 && code <= 4999;
    }
    function _isValidUTF8(buf) {
      const len = buf.length;
      let i = 0;
      while (i < len) {
        if ((buf[i] & 128) === 0) {
          i++;
        } else if ((buf[i] & 224) === 192) {
          if (i + 1 === len || (buf[i + 1] & 192) !== 128 || (buf[i] & 254) === 192) {
            return false;
          }
          i += 2;
        } else if ((buf[i] & 240) === 224) {
          if (i + 2 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || buf[i] === 224 && (buf[i + 1] & 224) === 128 || // Overlong
          buf[i] === 237 && (buf[i + 1] & 224) === 160) {
            return false;
          }
          i += 3;
        } else if ((buf[i] & 248) === 240) {
          if (i + 3 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || (buf[i + 3] & 192) !== 128 || buf[i] === 240 && (buf[i + 1] & 240) === 128 || // Overlong
          buf[i] === 244 && buf[i + 1] > 143 || buf[i] > 244) {
            return false;
          }
          i += 4;
        } else {
          return false;
        }
      }
      return true;
    }
    function isBlob(value) {
      return hasBlob && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.type === "string" && typeof value.stream === "function" && (value[Symbol.toStringTag] === "Blob" || value[Symbol.toStringTag] === "File");
    }
    module.exports = {
      isBlob,
      isValidStatusCode,
      isValidUTF8: _isValidUTF8,
      tokenChars
    };
    if (isUtf8) {
      module.exports.isValidUTF8 = function(buf) {
        return buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf);
      };
    } else if (!process.env.WS_NO_UTF_8_VALIDATE) {
      try {
        const isValidUTF8 = __require("utf-8-validate");
        module.exports.isValidUTF8 = function(buf) {
          return buf.length < 32 ? _isValidUTF8(buf) : isValidUTF8(buf);
        };
      } catch (e) {
      }
    }
  }
});

// node_modules/ws/lib/receiver.js
var require_receiver = __commonJS({
  "node_modules/ws/lib/receiver.js"(exports, module) {
    "use strict";
    var { Writable } = __require("stream");
    var PerMessageDeflate2 = require_permessage_deflate();
    var {
      BINARY_TYPES,
      EMPTY_BUFFER,
      kStatusCode,
      kWebSocket
    } = require_constants();
    var { concat, toArrayBuffer, unmask } = require_buffer_util();
    var { isValidStatusCode, isValidUTF8 } = require_validation();
    var FastBuffer = Buffer[Symbol.species];
    var GET_INFO = 0;
    var GET_PAYLOAD_LENGTH_16 = 1;
    var GET_PAYLOAD_LENGTH_64 = 2;
    var GET_MASK = 3;
    var GET_DATA = 4;
    var INFLATING = 5;
    var DEFER_EVENT = 6;
    var Receiver2 = class extends Writable {
      /**
       * Creates a Receiver instance.
       *
       * @param {Object} [options] Options object
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {String} [options.binaryType=nodebuffer] The type for binary data
       * @param {Object} [options.extensions] An object containing the negotiated
       *     extensions
       * @param {Boolean} [options.isServer=false] Specifies whether to operate in
       *     client or server mode
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       */
      constructor(options = {}) {
        super();
        this._allowSynchronousEvents = options.allowSynchronousEvents !== void 0 ? options.allowSynchronousEvents : true;
        this._binaryType = options.binaryType || BINARY_TYPES[0];
        this._extensions = options.extensions || {};
        this._isServer = !!options.isServer;
        this._maxPayload = options.maxPayload | 0;
        this._skipUTF8Validation = !!options.skipUTF8Validation;
        this[kWebSocket] = void 0;
        this._bufferedBytes = 0;
        this._buffers = [];
        this._compressed = false;
        this._payloadLength = 0;
        this._mask = void 0;
        this._fragmented = 0;
        this._masked = false;
        this._fin = false;
        this._opcode = 0;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragments = [];
        this._errored = false;
        this._loop = false;
        this._state = GET_INFO;
      }
      /**
       * Implements `Writable.prototype._write()`.
       *
       * @param {Buffer} chunk The chunk of data to write
       * @param {String} encoding The character encoding of `chunk`
       * @param {Function} cb Callback
       * @private
       */
      _write(chunk, encoding, cb) {
        if (this._opcode === 8 && this._state == GET_INFO) return cb();
        this._bufferedBytes += chunk.length;
        this._buffers.push(chunk);
        this.startLoop(cb);
      }
      /**
       * Consumes `n` bytes from the buffered data.
       *
       * @param {Number} n The number of bytes to consume
       * @return {Buffer} The consumed bytes
       * @private
       */
      consume(n) {
        this._bufferedBytes -= n;
        if (n === this._buffers[0].length) return this._buffers.shift();
        if (n < this._buffers[0].length) {
          const buf = this._buffers[0];
          this._buffers[0] = new FastBuffer(
            buf.buffer,
            buf.byteOffset + n,
            buf.length - n
          );
          return new FastBuffer(buf.buffer, buf.byteOffset, n);
        }
        const dst = Buffer.allocUnsafe(n);
        do {
          const buf = this._buffers[0];
          const offset = dst.length - n;
          if (n >= buf.length) {
            dst.set(this._buffers.shift(), offset);
          } else {
            dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
            this._buffers[0] = new FastBuffer(
              buf.buffer,
              buf.byteOffset + n,
              buf.length - n
            );
          }
          n -= buf.length;
        } while (n > 0);
        return dst;
      }
      /**
       * Starts the parsing loop.
       *
       * @param {Function} cb Callback
       * @private
       */
      startLoop(cb) {
        this._loop = true;
        do {
          switch (this._state) {
            case GET_INFO:
              this.getInfo(cb);
              break;
            case GET_PAYLOAD_LENGTH_16:
              this.getPayloadLength16(cb);
              break;
            case GET_PAYLOAD_LENGTH_64:
              this.getPayloadLength64(cb);
              break;
            case GET_MASK:
              this.getMask();
              break;
            case GET_DATA:
              this.getData(cb);
              break;
            case INFLATING:
            case DEFER_EVENT:
              this._loop = false;
              return;
          }
        } while (this._loop);
        if (!this._errored) cb();
      }
      /**
       * Reads the first two bytes of a frame.
       *
       * @param {Function} cb Callback
       * @private
       */
      getInfo(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        const buf = this.consume(2);
        if ((buf[0] & 48) !== 0) {
          const error = this.createError(
            RangeError,
            "RSV2 and RSV3 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_2_3"
          );
          cb(error);
          return;
        }
        const compressed = (buf[0] & 64) === 64;
        if (compressed && !this._extensions[PerMessageDeflate2.extensionName]) {
          const error = this.createError(
            RangeError,
            "RSV1 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_1"
          );
          cb(error);
          return;
        }
        this._fin = (buf[0] & 128) === 128;
        this._opcode = buf[0] & 15;
        this._payloadLength = buf[1] & 127;
        if (this._opcode === 0) {
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (!this._fragmented) {
            const error = this.createError(
              RangeError,
              "invalid opcode 0",
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._opcode = this._fragmented;
        } else if (this._opcode === 1 || this._opcode === 2) {
          if (this._fragmented) {
            const error = this.createError(
              RangeError,
              `invalid opcode ${this._opcode}`,
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._compressed = compressed;
        } else if (this._opcode > 7 && this._opcode < 11) {
          if (!this._fin) {
            const error = this.createError(
              RangeError,
              "FIN must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_FIN"
            );
            cb(error);
            return;
          }
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (this._payloadLength > 125 || this._opcode === 8 && this._payloadLength === 1) {
            const error = this.createError(
              RangeError,
              `invalid payload length ${this._payloadLength}`,
              true,
              1002,
              "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH"
            );
            cb(error);
            return;
          }
        } else {
          const error = this.createError(
            RangeError,
            `invalid opcode ${this._opcode}`,
            true,
            1002,
            "WS_ERR_INVALID_OPCODE"
          );
          cb(error);
          return;
        }
        if (!this._fin && !this._fragmented) this._fragmented = this._opcode;
        this._masked = (buf[1] & 128) === 128;
        if (this._isServer) {
          if (!this._masked) {
            const error = this.createError(
              RangeError,
              "MASK must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_MASK"
            );
            cb(error);
            return;
          }
        } else if (this._masked) {
          const error = this.createError(
            RangeError,
            "MASK must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_MASK"
          );
          cb(error);
          return;
        }
        if (this._payloadLength === 126) this._state = GET_PAYLOAD_LENGTH_16;
        else if (this._payloadLength === 127) this._state = GET_PAYLOAD_LENGTH_64;
        else this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+16).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength16(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        this._payloadLength = this.consume(2).readUInt16BE(0);
        this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+64).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength64(cb) {
        if (this._bufferedBytes < 8) {
          this._loop = false;
          return;
        }
        const buf = this.consume(8);
        const num = buf.readUInt32BE(0);
        if (num > Math.pow(2, 53 - 32) - 1) {
          const error = this.createError(
            RangeError,
            "Unsupported WebSocket frame: payload length > 2^53 - 1",
            false,
            1009,
            "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH"
          );
          cb(error);
          return;
        }
        this._payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4);
        this.haveLength(cb);
      }
      /**
       * Payload length has been read.
       *
       * @param {Function} cb Callback
       * @private
       */
      haveLength(cb) {
        if (this._payloadLength && this._opcode < 8) {
          this._totalPayloadLength += this._payloadLength;
          if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
            const error = this.createError(
              RangeError,
              "Max payload size exceeded",
              false,
              1009,
              "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
            );
            cb(error);
            return;
          }
        }
        if (this._masked) this._state = GET_MASK;
        else this._state = GET_DATA;
      }
      /**
       * Reads mask bytes.
       *
       * @private
       */
      getMask() {
        if (this._bufferedBytes < 4) {
          this._loop = false;
          return;
        }
        this._mask = this.consume(4);
        this._state = GET_DATA;
      }
      /**
       * Reads data bytes.
       *
       * @param {Function} cb Callback
       * @private
       */
      getData(cb) {
        let data = EMPTY_BUFFER;
        if (this._payloadLength) {
          if (this._bufferedBytes < this._payloadLength) {
            this._loop = false;
            return;
          }
          data = this.consume(this._payloadLength);
          if (this._masked && (this._mask[0] | this._mask[1] | this._mask[2] | this._mask[3]) !== 0) {
            unmask(data, this._mask);
          }
        }
        if (this._opcode > 7) {
          this.controlMessage(data, cb);
          return;
        }
        if (this._compressed) {
          this._state = INFLATING;
          this.decompress(data, cb);
          return;
        }
        if (data.length) {
          this._messageLength = this._totalPayloadLength;
          this._fragments.push(data);
        }
        this.dataMessage(cb);
      }
      /**
       * Decompresses data.
       *
       * @param {Buffer} data Compressed data
       * @param {Function} cb Callback
       * @private
       */
      decompress(data, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        perMessageDeflate.decompress(data, this._fin, (err, buf) => {
          if (err) return cb(err);
          if (buf.length) {
            this._messageLength += buf.length;
            if (this._messageLength > this._maxPayload && this._maxPayload > 0) {
              const error = this.createError(
                RangeError,
                "Max payload size exceeded",
                false,
                1009,
                "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
              );
              cb(error);
              return;
            }
            this._fragments.push(buf);
          }
          this.dataMessage(cb);
          if (this._state === GET_INFO) this.startLoop(cb);
        });
      }
      /**
       * Handles a data message.
       *
       * @param {Function} cb Callback
       * @private
       */
      dataMessage(cb) {
        if (!this._fin) {
          this._state = GET_INFO;
          return;
        }
        const messageLength = this._messageLength;
        const fragments = this._fragments;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragmented = 0;
        this._fragments = [];
        if (this._opcode === 2) {
          let data;
          if (this._binaryType === "nodebuffer") {
            data = concat(fragments, messageLength);
          } else if (this._binaryType === "arraybuffer") {
            data = toArrayBuffer(concat(fragments, messageLength));
          } else if (this._binaryType === "blob") {
            data = new Blob(fragments);
          } else {
            data = fragments;
          }
          if (this._allowSynchronousEvents) {
            this.emit("message", data, true);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", data, true);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        } else {
          const buf = concat(fragments, messageLength);
          if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
            const error = this.createError(
              Error,
              "invalid UTF-8 sequence",
              true,
              1007,
              "WS_ERR_INVALID_UTF8"
            );
            cb(error);
            return;
          }
          if (this._state === INFLATING || this._allowSynchronousEvents) {
            this.emit("message", buf, false);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", buf, false);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        }
      }
      /**
       * Handles a control message.
       *
       * @param {Buffer} data Data to handle
       * @return {(Error|RangeError|undefined)} A possible error
       * @private
       */
      controlMessage(data, cb) {
        if (this._opcode === 8) {
          if (data.length === 0) {
            this._loop = false;
            this.emit("conclude", 1005, EMPTY_BUFFER);
            this.end();
          } else {
            const code = data.readUInt16BE(0);
            if (!isValidStatusCode(code)) {
              const error = this.createError(
                RangeError,
                `invalid status code ${code}`,
                true,
                1002,
                "WS_ERR_INVALID_CLOSE_CODE"
              );
              cb(error);
              return;
            }
            const buf = new FastBuffer(
              data.buffer,
              data.byteOffset + 2,
              data.length - 2
            );
            if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
              const error = this.createError(
                Error,
                "invalid UTF-8 sequence",
                true,
                1007,
                "WS_ERR_INVALID_UTF8"
              );
              cb(error);
              return;
            }
            this._loop = false;
            this.emit("conclude", code, buf);
            this.end();
          }
          this._state = GET_INFO;
          return;
        }
        if (this._allowSynchronousEvents) {
          this.emit(this._opcode === 9 ? "ping" : "pong", data);
          this._state = GET_INFO;
        } else {
          this._state = DEFER_EVENT;
          setImmediate(() => {
            this.emit(this._opcode === 9 ? "ping" : "pong", data);
            this._state = GET_INFO;
            this.startLoop(cb);
          });
        }
      }
      /**
       * Builds an error object.
       *
       * @param {function(new:Error|RangeError)} ErrorCtor The error constructor
       * @param {String} message The error message
       * @param {Boolean} prefix Specifies whether or not to add a default prefix to
       *     `message`
       * @param {Number} statusCode The status code
       * @param {String} errorCode The exposed error code
       * @return {(Error|RangeError)} The error
       * @private
       */
      createError(ErrorCtor, message, prefix, statusCode, errorCode) {
        this._loop = false;
        this._errored = true;
        const err = new ErrorCtor(
          prefix ? `Invalid WebSocket frame: ${message}` : message
        );
        Error.captureStackTrace(err, this.createError);
        err.code = errorCode;
        err[kStatusCode] = statusCode;
        return err;
      }
    };
    module.exports = Receiver2;
  }
});

// node_modules/ws/lib/sender.js
var require_sender = __commonJS({
  "node_modules/ws/lib/sender.js"(exports, module) {
    "use strict";
    var { Duplex } = __require("stream");
    var { randomFillSync } = __require("crypto");
    var {
      types: { isUint8Array }
    } = __require("util");
    var PerMessageDeflate2 = require_permessage_deflate();
    var { EMPTY_BUFFER, kWebSocket, NOOP } = require_constants();
    var { isBlob, isValidStatusCode } = require_validation();
    var { mask: applyMask, toBuffer } = require_buffer_util();
    var kByteLength = Symbol("kByteLength");
    var maskBuffer = Buffer.alloc(4);
    var RANDOM_POOL_SIZE = 8 * 1024;
    var randomPool;
    var randomPoolPointer = RANDOM_POOL_SIZE;
    var DEFAULT = 0;
    var DEFLATING = 1;
    var GET_BLOB_DATA = 2;
    var Sender2 = class _Sender {
      /**
       * Creates a Sender instance.
       *
       * @param {Duplex} socket The connection socket
       * @param {Object} [extensions] An object containing the negotiated extensions
       * @param {Function} [generateMask] The function used to generate the masking
       *     key
       */
      constructor(socket, extensions, generateMask) {
        this._extensions = extensions || {};
        if (generateMask) {
          this._generateMask = generateMask;
          this._maskBuffer = Buffer.alloc(4);
        }
        this._socket = socket;
        this._firstFragment = true;
        this._compress = false;
        this._bufferedBytes = 0;
        this._queue = [];
        this._state = DEFAULT;
        this.onerror = NOOP;
        this[kWebSocket] = void 0;
      }
      /**
       * Frames a piece of data according to the HyBi WebSocket protocol.
       *
       * @param {(Buffer|String)} data The data to frame
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @return {(Buffer|String)[]} The framed data
       * @public
       */
      static frame(data, options) {
        let mask;
        let merge = false;
        let offset = 2;
        let skipMasking = false;
        if (options.mask) {
          mask = options.maskBuffer || maskBuffer;
          if (options.generateMask) {
            options.generateMask(mask);
          } else {
            if (randomPoolPointer === RANDOM_POOL_SIZE) {
              if (randomPool === void 0) {
                randomPool = Buffer.alloc(RANDOM_POOL_SIZE);
              }
              randomFillSync(randomPool, 0, RANDOM_POOL_SIZE);
              randomPoolPointer = 0;
            }
            mask[0] = randomPool[randomPoolPointer++];
            mask[1] = randomPool[randomPoolPointer++];
            mask[2] = randomPool[randomPoolPointer++];
            mask[3] = randomPool[randomPoolPointer++];
          }
          skipMasking = (mask[0] | mask[1] | mask[2] | mask[3]) === 0;
          offset = 6;
        }
        let dataLength;
        if (typeof data === "string") {
          if ((!options.mask || skipMasking) && options[kByteLength] !== void 0) {
            dataLength = options[kByteLength];
          } else {
            data = Buffer.from(data);
            dataLength = data.length;
          }
        } else {
          dataLength = data.length;
          merge = options.mask && options.readOnly && !skipMasking;
        }
        let payloadLength = dataLength;
        if (dataLength >= 65536) {
          offset += 8;
          payloadLength = 127;
        } else if (dataLength > 125) {
          offset += 2;
          payloadLength = 126;
        }
        const target = Buffer.allocUnsafe(merge ? dataLength + offset : offset);
        target[0] = options.fin ? options.opcode | 128 : options.opcode;
        if (options.rsv1) target[0] |= 64;
        target[1] = payloadLength;
        if (payloadLength === 126) {
          target.writeUInt16BE(dataLength, 2);
        } else if (payloadLength === 127) {
          target[2] = target[3] = 0;
          target.writeUIntBE(dataLength, 4, 6);
        }
        if (!options.mask) return [target, data];
        target[1] |= 128;
        target[offset - 4] = mask[0];
        target[offset - 3] = mask[1];
        target[offset - 2] = mask[2];
        target[offset - 1] = mask[3];
        if (skipMasking) return [target, data];
        if (merge) {
          applyMask(data, mask, target, offset, dataLength);
          return [target];
        }
        applyMask(data, mask, data, 0, dataLength);
        return [target, data];
      }
      /**
       * Sends a close message to the other peer.
       *
       * @param {Number} [code] The status code component of the body
       * @param {(String|Buffer)} [data] The message component of the body
       * @param {Boolean} [mask=false] Specifies whether or not to mask the message
       * @param {Function} [cb] Callback
       * @public
       */
      close(code, data, mask, cb) {
        let buf;
        if (code === void 0) {
          buf = EMPTY_BUFFER;
        } else if (typeof code !== "number" || !isValidStatusCode(code)) {
          throw new TypeError("First argument must be a valid error code number");
        } else if (data === void 0 || !data.length) {
          buf = Buffer.allocUnsafe(2);
          buf.writeUInt16BE(code, 0);
        } else {
          const length = Buffer.byteLength(data);
          if (length > 123) {
            throw new RangeError("The message must not be greater than 123 bytes");
          }
          buf = Buffer.allocUnsafe(2 + length);
          buf.writeUInt16BE(code, 0);
          if (typeof data === "string") {
            buf.write(data, 2);
          } else if (isUint8Array(data)) {
            buf.set(data, 2);
          } else {
            throw new TypeError("Second argument must be a string or a Uint8Array");
          }
        }
        const options = {
          [kByteLength]: buf.length,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 8,
          readOnly: false,
          rsv1: false
        };
        if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, buf, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(buf, options), cb);
        }
      }
      /**
       * Sends a ping message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      ping(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 9,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a pong message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      pong(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 10,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a data message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Object} options Options object
       * @param {Boolean} [options.binary=false] Specifies whether `data` is binary
       *     or text
       * @param {Boolean} [options.compress=false] Specifies whether or not to
       *     compress `data`
       * @param {Boolean} [options.fin=false] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Function} [cb] Callback
       * @public
       */
      send(data, options, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        let opcode = options.binary ? 2 : 1;
        let rsv1 = options.compress;
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (this._firstFragment) {
          this._firstFragment = false;
          if (rsv1 && perMessageDeflate && perMessageDeflate.params[perMessageDeflate._isServer ? "server_no_context_takeover" : "client_no_context_takeover"]) {
            rsv1 = byteLength >= perMessageDeflate._threshold;
          }
          this._compress = rsv1;
        } else {
          rsv1 = false;
          opcode = 0;
        }
        if (options.fin) this._firstFragment = true;
        const opts = {
          [kByteLength]: byteLength,
          fin: options.fin,
          generateMask: this._generateMask,
          mask: options.mask,
          maskBuffer: this._maskBuffer,
          opcode,
          readOnly,
          rsv1
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, this._compress, opts, cb]);
          } else {
            this.getBlobData(data, this._compress, opts, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, this._compress, opts, cb]);
        } else {
          this.dispatch(data, this._compress, opts, cb);
        }
      }
      /**
       * Gets the contents of a blob as binary data.
       *
       * @param {Blob} blob The blob
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     the data
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      getBlobData(blob, compress, options, cb) {
        this._bufferedBytes += options[kByteLength];
        this._state = GET_BLOB_DATA;
        blob.arrayBuffer().then((arrayBuffer) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while the blob was being read"
            );
            process.nextTick(callCallbacks, this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          const data = toBuffer(arrayBuffer);
          if (!compress) {
            this._state = DEFAULT;
            this.sendFrame(_Sender.frame(data, options), cb);
            this.dequeue();
          } else {
            this.dispatch(data, compress, options, cb);
          }
        }).catch((err) => {
          process.nextTick(onError, this, err, cb);
        });
      }
      /**
       * Dispatches a message.
       *
       * @param {(Buffer|String)} data The message to send
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     `data`
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      dispatch(data, compress, options, cb) {
        if (!compress) {
          this.sendFrame(_Sender.frame(data, options), cb);
          return;
        }
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        this._bufferedBytes += options[kByteLength];
        this._state = DEFLATING;
        perMessageDeflate.compress(data, options.fin, (_, buf) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while data was being compressed"
            );
            callCallbacks(this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          this._state = DEFAULT;
          options.readOnly = false;
          this.sendFrame(_Sender.frame(buf, options), cb);
          this.dequeue();
        });
      }
      /**
       * Executes queued send operations.
       *
       * @private
       */
      dequeue() {
        while (this._state === DEFAULT && this._queue.length) {
          const params = this._queue.shift();
          this._bufferedBytes -= params[3][kByteLength];
          Reflect.apply(params[0], this, params.slice(1));
        }
      }
      /**
       * Enqueues a send operation.
       *
       * @param {Array} params Send operation parameters.
       * @private
       */
      enqueue(params) {
        this._bufferedBytes += params[3][kByteLength];
        this._queue.push(params);
      }
      /**
       * Sends a frame.
       *
       * @param {(Buffer | String)[]} list The frame to send
       * @param {Function} [cb] Callback
       * @private
       */
      sendFrame(list, cb) {
        if (list.length === 2) {
          this._socket.cork();
          this._socket.write(list[0]);
          this._socket.write(list[1], cb);
          this._socket.uncork();
        } else {
          this._socket.write(list[0], cb);
        }
      }
    };
    module.exports = Sender2;
    function callCallbacks(sender, err, cb) {
      if (typeof cb === "function") cb(err);
      for (let i = 0; i < sender._queue.length; i++) {
        const params = sender._queue[i];
        const callback = params[params.length - 1];
        if (typeof callback === "function") callback(err);
      }
    }
    function onError(sender, err, cb) {
      callCallbacks(sender, err, cb);
      sender.onerror(err);
    }
  }
});

// node_modules/ws/lib/event-target.js
var require_event_target = __commonJS({
  "node_modules/ws/lib/event-target.js"(exports, module) {
    "use strict";
    var { kForOnEventAttribute, kListener } = require_constants();
    var kCode = Symbol("kCode");
    var kData = Symbol("kData");
    var kError = Symbol("kError");
    var kMessage = Symbol("kMessage");
    var kReason = Symbol("kReason");
    var kTarget = Symbol("kTarget");
    var kType = Symbol("kType");
    var kWasClean = Symbol("kWasClean");
    var Event = class {
      /**
       * Create a new `Event`.
       *
       * @param {String} type The name of the event
       * @throws {TypeError} If the `type` argument is not specified
       */
      constructor(type) {
        this[kTarget] = null;
        this[kType] = type;
      }
      /**
       * @type {*}
       */
      get target() {
        return this[kTarget];
      }
      /**
       * @type {String}
       */
      get type() {
        return this[kType];
      }
    };
    Object.defineProperty(Event.prototype, "target", { enumerable: true });
    Object.defineProperty(Event.prototype, "type", { enumerable: true });
    var CloseEvent = class extends Event {
      /**
       * Create a new `CloseEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {Number} [options.code=0] The status code explaining why the
       *     connection was closed
       * @param {String} [options.reason=''] A human-readable string explaining why
       *     the connection was closed
       * @param {Boolean} [options.wasClean=false] Indicates whether or not the
       *     connection was cleanly closed
       */
      constructor(type, options = {}) {
        super(type);
        this[kCode] = options.code === void 0 ? 0 : options.code;
        this[kReason] = options.reason === void 0 ? "" : options.reason;
        this[kWasClean] = options.wasClean === void 0 ? false : options.wasClean;
      }
      /**
       * @type {Number}
       */
      get code() {
        return this[kCode];
      }
      /**
       * @type {String}
       */
      get reason() {
        return this[kReason];
      }
      /**
       * @type {Boolean}
       */
      get wasClean() {
        return this[kWasClean];
      }
    };
    Object.defineProperty(CloseEvent.prototype, "code", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "reason", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "wasClean", { enumerable: true });
    var ErrorEvent = class extends Event {
      /**
       * Create a new `ErrorEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.error=null] The error that generated this event
       * @param {String} [options.message=''] The error message
       */
      constructor(type, options = {}) {
        super(type);
        this[kError] = options.error === void 0 ? null : options.error;
        this[kMessage] = options.message === void 0 ? "" : options.message;
      }
      /**
       * @type {*}
       */
      get error() {
        return this[kError];
      }
      /**
       * @type {String}
       */
      get message() {
        return this[kMessage];
      }
    };
    Object.defineProperty(ErrorEvent.prototype, "error", { enumerable: true });
    Object.defineProperty(ErrorEvent.prototype, "message", { enumerable: true });
    var MessageEvent = class extends Event {
      /**
       * Create a new `MessageEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.data=null] The message content
       */
      constructor(type, options = {}) {
        super(type);
        this[kData] = options.data === void 0 ? null : options.data;
      }
      /**
       * @type {*}
       */
      get data() {
        return this[kData];
      }
    };
    Object.defineProperty(MessageEvent.prototype, "data", { enumerable: true });
    var EventTarget = {
      /**
       * Register an event listener.
       *
       * @param {String} type A string representing the event type to listen for
       * @param {(Function|Object)} handler The listener to add
       * @param {Object} [options] An options object specifies characteristics about
       *     the event listener
       * @param {Boolean} [options.once=false] A `Boolean` indicating that the
       *     listener should be invoked at most once after being added. If `true`,
       *     the listener would be automatically removed when invoked.
       * @public
       */
      addEventListener(type, handler, options = {}) {
        for (const listener of this.listeners(type)) {
          if (!options[kForOnEventAttribute] && listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            return;
          }
        }
        let wrapper;
        if (type === "message") {
          wrapper = function onMessage(data, isBinary) {
            const event = new MessageEvent("message", {
              data: isBinary ? data : data.toString()
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "close") {
          wrapper = function onClose(code, message) {
            const event = new CloseEvent("close", {
              code,
              reason: message.toString(),
              wasClean: this._closeFrameReceived && this._closeFrameSent
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "error") {
          wrapper = function onError(error) {
            const event = new ErrorEvent("error", {
              error,
              message: error.message
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "open") {
          wrapper = function onOpen() {
            const event = new Event("open");
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else {
          return;
        }
        wrapper[kForOnEventAttribute] = !!options[kForOnEventAttribute];
        wrapper[kListener] = handler;
        if (options.once) {
          this.once(type, wrapper);
        } else {
          this.on(type, wrapper);
        }
      },
      /**
       * Remove an event listener.
       *
       * @param {String} type A string representing the event type to remove
       * @param {(Function|Object)} handler The listener to remove
       * @public
       */
      removeEventListener(type, handler) {
        for (const listener of this.listeners(type)) {
          if (listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            this.removeListener(type, listener);
            break;
          }
        }
      }
    };
    module.exports = {
      CloseEvent,
      ErrorEvent,
      Event,
      EventTarget,
      MessageEvent
    };
    function callListener(listener, thisArg, event) {
      if (typeof listener === "object" && listener.handleEvent) {
        listener.handleEvent.call(listener, event);
      } else {
        listener.call(thisArg, event);
      }
    }
  }
});

// node_modules/ws/lib/extension.js
var require_extension = __commonJS({
  "node_modules/ws/lib/extension.js"(exports, module) {
    "use strict";
    var { tokenChars } = require_validation();
    function push(dest, name, elem) {
      if (dest[name] === void 0) dest[name] = [elem];
      else dest[name].push(elem);
    }
    function parse(header) {
      const offers = /* @__PURE__ */ Object.create(null);
      let params = /* @__PURE__ */ Object.create(null);
      let mustUnescape = false;
      let isEscaping = false;
      let inQuotes = false;
      let extensionName;
      let paramName;
      let start = -1;
      let code = -1;
      let end = -1;
      let i = 0;
      for (; i < header.length; i++) {
        code = header.charCodeAt(i);
        if (extensionName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (i !== 0 && (code === 32 || code === 9)) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            const name = header.slice(start, end);
            if (code === 44) {
              push(offers, name, params);
              params = /* @__PURE__ */ Object.create(null);
            } else {
              extensionName = name;
            }
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else if (paramName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (code === 32 || code === 9) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            push(params, header.slice(start, end), true);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            start = end = -1;
          } else if (code === 61 && start !== -1 && end === -1) {
            paramName = header.slice(start, i);
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else {
          if (isEscaping) {
            if (tokenChars[code] !== 1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (start === -1) start = i;
            else if (!mustUnescape) mustUnescape = true;
            isEscaping = false;
          } else if (inQuotes) {
            if (tokenChars[code] === 1) {
              if (start === -1) start = i;
            } else if (code === 34 && start !== -1) {
              inQuotes = false;
              end = i;
            } else if (code === 92) {
              isEscaping = true;
            } else {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
          } else if (code === 34 && header.charCodeAt(i - 1) === 61) {
            inQuotes = true;
          } else if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (start !== -1 && (code === 32 || code === 9)) {
            if (end === -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            let value = header.slice(start, end);
            if (mustUnescape) {
              value = value.replace(/\\/g, "");
              mustUnescape = false;
            }
            push(params, paramName, value);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            paramName = void 0;
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        }
      }
      if (start === -1 || inQuotes || code === 32 || code === 9) {
        throw new SyntaxError("Unexpected end of input");
      }
      if (end === -1) end = i;
      const token = header.slice(start, end);
      if (extensionName === void 0) {
        push(offers, token, params);
      } else {
        if (paramName === void 0) {
          push(params, token, true);
        } else if (mustUnescape) {
          push(params, paramName, token.replace(/\\/g, ""));
        } else {
          push(params, paramName, token);
        }
        push(offers, extensionName, params);
      }
      return offers;
    }
    function format(extensions) {
      return Object.keys(extensions).map((extension2) => {
        let configurations = extensions[extension2];
        if (!Array.isArray(configurations)) configurations = [configurations];
        return configurations.map((params) => {
          return [extension2].concat(
            Object.keys(params).map((k) => {
              let values = params[k];
              if (!Array.isArray(values)) values = [values];
              return values.map((v) => v === true ? k : `${k}=${v}`).join("; ");
            })
          ).join("; ");
        }).join(", ");
      }).join(", ");
    }
    module.exports = { format, parse };
  }
});

// node_modules/ws/lib/websocket.js
var require_websocket = __commonJS({
  "node_modules/ws/lib/websocket.js"(exports, module) {
    "use strict";
    var EventEmitter = __require("events");
    var https = __require("https");
    var http = __require("http");
    var net = __require("net");
    var tls = __require("tls");
    var { randomBytes, createHash } = __require("crypto");
    var { Duplex, Readable } = __require("stream");
    var { URL } = __require("url");
    var PerMessageDeflate2 = require_permessage_deflate();
    var Receiver2 = require_receiver();
    var Sender2 = require_sender();
    var { isBlob } = require_validation();
    var {
      BINARY_TYPES,
      CLOSE_TIMEOUT,
      EMPTY_BUFFER,
      GUID,
      kForOnEventAttribute,
      kListener,
      kStatusCode,
      kWebSocket,
      NOOP
    } = require_constants();
    var {
      EventTarget: { addEventListener, removeEventListener }
    } = require_event_target();
    var { format, parse } = require_extension();
    var { toBuffer } = require_buffer_util();
    var kAborted = Symbol("kAborted");
    var protocolVersions = [8, 13];
    var readyStates = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
    var subprotocolRegex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;
    var WebSocket2 = class _WebSocket extends EventEmitter {
      /**
       * Create a new `WebSocket`.
       *
       * @param {(String|URL)} address The URL to which to connect
       * @param {(String|String[])} [protocols] The subprotocols
       * @param {Object} [options] Connection options
       */
      constructor(address, protocols, options) {
        super();
        this._binaryType = BINARY_TYPES[0];
        this._closeCode = 1006;
        this._closeFrameReceived = false;
        this._closeFrameSent = false;
        this._closeMessage = EMPTY_BUFFER;
        this._closeTimer = null;
        this._errorEmitted = false;
        this._extensions = {};
        this._paused = false;
        this._protocol = "";
        this._readyState = _WebSocket.CONNECTING;
        this._receiver = null;
        this._sender = null;
        this._socket = null;
        if (address !== null) {
          this._bufferedAmount = 0;
          this._isServer = false;
          this._redirects = 0;
          if (protocols === void 0) {
            protocols = [];
          } else if (!Array.isArray(protocols)) {
            if (typeof protocols === "object" && protocols !== null) {
              options = protocols;
              protocols = [];
            } else {
              protocols = [protocols];
            }
          }
          initAsClient(this, address, protocols, options);
        } else {
          this._autoPong = options.autoPong;
          this._closeTimeout = options.closeTimeout;
          this._isServer = true;
        }
      }
      /**
       * For historical reasons, the custom "nodebuffer" type is used by the default
       * instead of "blob".
       *
       * @type {String}
       */
      get binaryType() {
        return this._binaryType;
      }
      set binaryType(type) {
        if (!BINARY_TYPES.includes(type)) return;
        this._binaryType = type;
        if (this._receiver) this._receiver._binaryType = type;
      }
      /**
       * @type {Number}
       */
      get bufferedAmount() {
        if (!this._socket) return this._bufferedAmount;
        return this._socket._writableState.length + this._sender._bufferedBytes;
      }
      /**
       * @type {String}
       */
      get extensions() {
        return Object.keys(this._extensions).join();
      }
      /**
       * @type {Boolean}
       */
      get isPaused() {
        return this._paused;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onclose() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onerror() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onopen() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onmessage() {
        return null;
      }
      /**
       * @type {String}
       */
      get protocol() {
        return this._protocol;
      }
      /**
       * @type {Number}
       */
      get readyState() {
        return this._readyState;
      }
      /**
       * @type {String}
       */
      get url() {
        return this._url;
      }
      /**
       * Set up the socket and the internal resources.
       *
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Object} options Options object
       * @param {Boolean} [options.allowSynchronousEvents=false] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Number} [options.maxPayload=0] The maximum allowed message size
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @private
       */
      setSocket(socket, head, options) {
        const receiver = new Receiver2({
          allowSynchronousEvents: options.allowSynchronousEvents,
          binaryType: this.binaryType,
          extensions: this._extensions,
          isServer: this._isServer,
          maxPayload: options.maxPayload,
          skipUTF8Validation: options.skipUTF8Validation
        });
        const sender = new Sender2(socket, this._extensions, options.generateMask);
        this._receiver = receiver;
        this._sender = sender;
        this._socket = socket;
        receiver[kWebSocket] = this;
        sender[kWebSocket] = this;
        socket[kWebSocket] = this;
        receiver.on("conclude", receiverOnConclude);
        receiver.on("drain", receiverOnDrain);
        receiver.on("error", receiverOnError);
        receiver.on("message", receiverOnMessage);
        receiver.on("ping", receiverOnPing);
        receiver.on("pong", receiverOnPong);
        sender.onerror = senderOnError;
        if (socket.setTimeout) socket.setTimeout(0);
        if (socket.setNoDelay) socket.setNoDelay();
        if (head.length > 0) socket.unshift(head);
        socket.on("close", socketOnClose);
        socket.on("data", socketOnData);
        socket.on("end", socketOnEnd);
        socket.on("error", socketOnError);
        this._readyState = _WebSocket.OPEN;
        this.emit("open");
      }
      /**
       * Emit the `'close'` event.
       *
       * @private
       */
      emitClose() {
        if (!this._socket) {
          this._readyState = _WebSocket.CLOSED;
          this.emit("close", this._closeCode, this._closeMessage);
          return;
        }
        if (this._extensions[PerMessageDeflate2.extensionName]) {
          this._extensions[PerMessageDeflate2.extensionName].cleanup();
        }
        this._receiver.removeAllListeners();
        this._readyState = _WebSocket.CLOSED;
        this.emit("close", this._closeCode, this._closeMessage);
      }
      /**
       * Start a closing handshake.
       *
       *          +----------+   +-----------+   +----------+
       *     - - -|ws.close()|-->|close frame|-->|ws.close()|- - -
       *    |     +----------+   +-----------+   +----------+     |
       *          +----------+   +-----------+         |
       * CLOSING  |ws.close()|<--|close frame|<--+-----+       CLOSING
       *          +----------+   +-----------+   |
       *    |           |                        |   +---+        |
       *                +------------------------+-->|fin| - - - -
       *    |         +---+                      |   +---+
       *     - - - - -|fin|<---------------------+
       *              +---+
       *
       * @param {Number} [code] Status code explaining why the connection is closing
       * @param {(String|Buffer)} [data] The reason why the connection is
       *     closing
       * @public
       */
      close(code, data) {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this.readyState === _WebSocket.CLOSING) {
          if (this._closeFrameSent && (this._closeFrameReceived || this._receiver._writableState.errorEmitted)) {
            this._socket.end();
          }
          return;
        }
        this._readyState = _WebSocket.CLOSING;
        this._sender.close(code, data, !this._isServer, (err) => {
          if (err) return;
          this._closeFrameSent = true;
          if (this._closeFrameReceived || this._receiver._writableState.errorEmitted) {
            this._socket.end();
          }
        });
        setCloseTimer(this);
      }
      /**
       * Pause the socket.
       *
       * @public
       */
      pause() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = true;
        this._socket.pause();
      }
      /**
       * Send a ping.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the ping is sent
       * @public
       */
      ping(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.ping(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Send a pong.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the pong is sent
       * @public
       */
      pong(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.pong(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Resume the socket.
       *
       * @public
       */
      resume() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = false;
        if (!this._receiver._writableState.needDrain) this._socket.resume();
      }
      /**
       * Send a data message.
       *
       * @param {*} data The message to send
       * @param {Object} [options] Options object
       * @param {Boolean} [options.binary] Specifies whether `data` is binary or
       *     text
       * @param {Boolean} [options.compress] Specifies whether or not to compress
       *     `data`
       * @param {Boolean} [options.fin=true] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when data is written out
       * @public
       */
      send(data, options, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof options === "function") {
          cb = options;
          options = {};
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        const opts = {
          binary: typeof data !== "string",
          mask: !this._isServer,
          compress: true,
          fin: true,
          ...options
        };
        if (!this._extensions[PerMessageDeflate2.extensionName]) {
          opts.compress = false;
        }
        this._sender.send(data || EMPTY_BUFFER, opts, cb);
      }
      /**
       * Forcibly close the connection.
       *
       * @public
       */
      terminate() {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this._socket) {
          this._readyState = _WebSocket.CLOSING;
          this._socket.destroy();
        }
      }
    };
    Object.defineProperty(WebSocket2, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket2.prototype, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket2, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket2.prototype, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket2, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket2.prototype, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket2, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    Object.defineProperty(WebSocket2.prototype, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    [
      "binaryType",
      "bufferedAmount",
      "extensions",
      "isPaused",
      "protocol",
      "readyState",
      "url"
    ].forEach((property) => {
      Object.defineProperty(WebSocket2.prototype, property, { enumerable: true });
    });
    ["open", "error", "close", "message"].forEach((method) => {
      Object.defineProperty(WebSocket2.prototype, `on${method}`, {
        enumerable: true,
        get() {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) return listener[kListener];
          }
          return null;
        },
        set(handler) {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) {
              this.removeListener(method, listener);
              break;
            }
          }
          if (typeof handler !== "function") return;
          this.addEventListener(method, handler, {
            [kForOnEventAttribute]: true
          });
        }
      });
    });
    WebSocket2.prototype.addEventListener = addEventListener;
    WebSocket2.prototype.removeEventListener = removeEventListener;
    module.exports = WebSocket2;
    function initAsClient(websocket, address, protocols, options) {
      const opts = {
        allowSynchronousEvents: true,
        autoPong: true,
        closeTimeout: CLOSE_TIMEOUT,
        protocolVersion: protocolVersions[1],
        maxPayload: 100 * 1024 * 1024,
        skipUTF8Validation: false,
        perMessageDeflate: true,
        followRedirects: false,
        maxRedirects: 10,
        ...options,
        socketPath: void 0,
        hostname: void 0,
        protocol: void 0,
        timeout: void 0,
        method: "GET",
        host: void 0,
        path: void 0,
        port: void 0
      };
      websocket._autoPong = opts.autoPong;
      websocket._closeTimeout = opts.closeTimeout;
      if (!protocolVersions.includes(opts.protocolVersion)) {
        throw new RangeError(
          `Unsupported protocol version: ${opts.protocolVersion} (supported versions: ${protocolVersions.join(", ")})`
        );
      }
      let parsedUrl;
      if (address instanceof URL) {
        parsedUrl = address;
      } else {
        try {
          parsedUrl = new URL(address);
        } catch {
          throw new SyntaxError(`Invalid URL: ${address}`);
        }
      }
      if (parsedUrl.protocol === "http:") {
        parsedUrl.protocol = "ws:";
      } else if (parsedUrl.protocol === "https:") {
        parsedUrl.protocol = "wss:";
      }
      websocket._url = parsedUrl.href;
      const isSecure = parsedUrl.protocol === "wss:";
      const isIpcUrl = parsedUrl.protocol === "ws+unix:";
      let invalidUrlMessage;
      if (parsedUrl.protocol !== "ws:" && !isSecure && !isIpcUrl) {
        invalidUrlMessage = `The URL's protocol must be one of "ws:", "wss:", "http:", "https:", or "ws+unix:"`;
      } else if (isIpcUrl && !parsedUrl.pathname) {
        invalidUrlMessage = "The URL's pathname is empty";
      } else if (parsedUrl.hash) {
        invalidUrlMessage = "The URL contains a fragment identifier";
      }
      if (invalidUrlMessage) {
        const err = new SyntaxError(invalidUrlMessage);
        if (websocket._redirects === 0) {
          throw err;
        } else {
          emitErrorAndClose(websocket, err);
          return;
        }
      }
      const defaultPort = isSecure ? 443 : 80;
      const key = randomBytes(16).toString("base64");
      const request = isSecure ? https.request : http.request;
      const protocolSet = /* @__PURE__ */ new Set();
      let perMessageDeflate;
      opts.createConnection = opts.createConnection || (isSecure ? tlsConnect : netConnect);
      opts.defaultPort = opts.defaultPort || defaultPort;
      opts.port = parsedUrl.port || defaultPort;
      opts.host = parsedUrl.hostname.startsWith("[") ? parsedUrl.hostname.slice(1, -1) : parsedUrl.hostname;
      opts.headers = {
        ...opts.headers,
        "Sec-WebSocket-Version": opts.protocolVersion,
        "Sec-WebSocket-Key": key,
        Connection: "Upgrade",
        Upgrade: "websocket"
      };
      opts.path = parsedUrl.pathname + parsedUrl.search;
      opts.timeout = opts.handshakeTimeout;
      if (opts.perMessageDeflate) {
        perMessageDeflate = new PerMessageDeflate2({
          ...opts.perMessageDeflate,
          isServer: false,
          maxPayload: opts.maxPayload
        });
        opts.headers["Sec-WebSocket-Extensions"] = format({
          [PerMessageDeflate2.extensionName]: perMessageDeflate.offer()
        });
      }
      if (protocols.length) {
        for (const protocol of protocols) {
          if (typeof protocol !== "string" || !subprotocolRegex.test(protocol) || protocolSet.has(protocol)) {
            throw new SyntaxError(
              "An invalid or duplicated subprotocol was specified"
            );
          }
          protocolSet.add(protocol);
        }
        opts.headers["Sec-WebSocket-Protocol"] = protocols.join(",");
      }
      if (opts.origin) {
        if (opts.protocolVersion < 13) {
          opts.headers["Sec-WebSocket-Origin"] = opts.origin;
        } else {
          opts.headers.Origin = opts.origin;
        }
      }
      if (parsedUrl.username || parsedUrl.password) {
        opts.auth = `${parsedUrl.username}:${parsedUrl.password}`;
      }
      if (isIpcUrl) {
        const parts = opts.path.split(":");
        opts.socketPath = parts[0];
        opts.path = parts[1];
      }
      let req;
      if (opts.followRedirects) {
        if (websocket._redirects === 0) {
          websocket._originalIpc = isIpcUrl;
          websocket._originalSecure = isSecure;
          websocket._originalHostOrSocketPath = isIpcUrl ? opts.socketPath : parsedUrl.host;
          const headers = options && options.headers;
          options = { ...options, headers: {} };
          if (headers) {
            for (const [key2, value] of Object.entries(headers)) {
              options.headers[key2.toLowerCase()] = value;
            }
          }
        } else if (websocket.listenerCount("redirect") === 0) {
          const isSameHost = isIpcUrl ? websocket._originalIpc ? opts.socketPath === websocket._originalHostOrSocketPath : false : websocket._originalIpc ? false : parsedUrl.host === websocket._originalHostOrSocketPath;
          if (!isSameHost || websocket._originalSecure && !isSecure) {
            delete opts.headers.authorization;
            delete opts.headers.cookie;
            if (!isSameHost) delete opts.headers.host;
            opts.auth = void 0;
          }
        }
        if (opts.auth && !options.headers.authorization) {
          options.headers.authorization = "Basic " + Buffer.from(opts.auth).toString("base64");
        }
        req = websocket._req = request(opts);
        if (websocket._redirects) {
          websocket.emit("redirect", websocket.url, req);
        }
      } else {
        req = websocket._req = request(opts);
      }
      if (opts.timeout) {
        req.on("timeout", () => {
          abortHandshake(websocket, req, "Opening handshake has timed out");
        });
      }
      req.on("error", (err) => {
        if (req === null || req[kAborted]) return;
        req = websocket._req = null;
        emitErrorAndClose(websocket, err);
      });
      req.on("response", (res) => {
        const location = res.headers.location;
        const statusCode = res.statusCode;
        if (location && opts.followRedirects && statusCode >= 300 && statusCode < 400) {
          if (++websocket._redirects > opts.maxRedirects) {
            abortHandshake(websocket, req, "Maximum redirects exceeded");
            return;
          }
          req.abort();
          let addr;
          try {
            addr = new URL(location, address);
          } catch (e) {
            const err = new SyntaxError(`Invalid URL: ${location}`);
            emitErrorAndClose(websocket, err);
            return;
          }
          initAsClient(websocket, addr, protocols, options);
        } else if (!websocket.emit("unexpected-response", req, res)) {
          abortHandshake(
            websocket,
            req,
            `Unexpected server response: ${res.statusCode}`
          );
        }
      });
      req.on("upgrade", (res, socket, head) => {
        websocket.emit("upgrade", res);
        if (websocket.readyState !== WebSocket2.CONNECTING) return;
        req = websocket._req = null;
        const upgrade = res.headers.upgrade;
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          abortHandshake(websocket, socket, "Invalid Upgrade header");
          return;
        }
        const digest = createHash("sha1").update(key + GUID).digest("base64");
        if (res.headers["sec-websocket-accept"] !== digest) {
          abortHandshake(websocket, socket, "Invalid Sec-WebSocket-Accept header");
          return;
        }
        const serverProt = res.headers["sec-websocket-protocol"];
        let protError;
        if (serverProt !== void 0) {
          if (!protocolSet.size) {
            protError = "Server sent a subprotocol but none was requested";
          } else if (!protocolSet.has(serverProt)) {
            protError = "Server sent an invalid subprotocol";
          }
        } else if (protocolSet.size) {
          protError = "Server sent no subprotocol";
        }
        if (protError) {
          abortHandshake(websocket, socket, protError);
          return;
        }
        if (serverProt) websocket._protocol = serverProt;
        const secWebSocketExtensions = res.headers["sec-websocket-extensions"];
        if (secWebSocketExtensions !== void 0) {
          if (!perMessageDeflate) {
            const message = "Server sent a Sec-WebSocket-Extensions header but no extension was requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          let extensions;
          try {
            extensions = parse(secWebSocketExtensions);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          const extensionNames = Object.keys(extensions);
          if (extensionNames.length !== 1 || extensionNames[0] !== PerMessageDeflate2.extensionName) {
            const message = "Server indicated an extension that was not requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          try {
            perMessageDeflate.accept(extensions[PerMessageDeflate2.extensionName]);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          websocket._extensions[PerMessageDeflate2.extensionName] = perMessageDeflate;
        }
        websocket.setSocket(socket, head, {
          allowSynchronousEvents: opts.allowSynchronousEvents,
          generateMask: opts.generateMask,
          maxPayload: opts.maxPayload,
          skipUTF8Validation: opts.skipUTF8Validation
        });
      });
      if (opts.finishRequest) {
        opts.finishRequest(req, websocket);
      } else {
        req.end();
      }
    }
    function emitErrorAndClose(websocket, err) {
      websocket._readyState = WebSocket2.CLOSING;
      websocket._errorEmitted = true;
      websocket.emit("error", err);
      websocket.emitClose();
    }
    function netConnect(options) {
      options.path = options.socketPath;
      return net.connect(options);
    }
    function tlsConnect(options) {
      options.path = void 0;
      if (!options.servername && options.servername !== "") {
        options.servername = net.isIP(options.host) ? "" : options.host;
      }
      return tls.connect(options);
    }
    function abortHandshake(websocket, stream, message) {
      websocket._readyState = WebSocket2.CLOSING;
      const err = new Error(message);
      Error.captureStackTrace(err, abortHandshake);
      if (stream.setHeader) {
        stream[kAborted] = true;
        stream.abort();
        if (stream.socket && !stream.socket.destroyed) {
          stream.socket.destroy();
        }
        process.nextTick(emitErrorAndClose, websocket, err);
      } else {
        stream.destroy(err);
        stream.once("error", websocket.emit.bind(websocket, "error"));
        stream.once("close", websocket.emitClose.bind(websocket));
      }
    }
    function sendAfterClose(websocket, data, cb) {
      if (data) {
        const length = isBlob(data) ? data.size : toBuffer(data).length;
        if (websocket._socket) websocket._sender._bufferedBytes += length;
        else websocket._bufferedAmount += length;
      }
      if (cb) {
        const err = new Error(
          `WebSocket is not open: readyState ${websocket.readyState} (${readyStates[websocket.readyState]})`
        );
        process.nextTick(cb, err);
      }
    }
    function receiverOnConclude(code, reason) {
      const websocket = this[kWebSocket];
      websocket._closeFrameReceived = true;
      websocket._closeMessage = reason;
      websocket._closeCode = code;
      if (websocket._socket[kWebSocket] === void 0) return;
      websocket._socket.removeListener("data", socketOnData);
      process.nextTick(resume, websocket._socket);
      if (code === 1005) websocket.close();
      else websocket.close(code, reason);
    }
    function receiverOnDrain() {
      const websocket = this[kWebSocket];
      if (!websocket.isPaused) websocket._socket.resume();
    }
    function receiverOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket._socket[kWebSocket] !== void 0) {
        websocket._socket.removeListener("data", socketOnData);
        process.nextTick(resume, websocket._socket);
        websocket.close(err[kStatusCode]);
      }
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function receiverOnFinish() {
      this[kWebSocket].emitClose();
    }
    function receiverOnMessage(data, isBinary) {
      this[kWebSocket].emit("message", data, isBinary);
    }
    function receiverOnPing(data) {
      const websocket = this[kWebSocket];
      if (websocket._autoPong) websocket.pong(data, !this._isServer, NOOP);
      websocket.emit("ping", data);
    }
    function receiverOnPong(data) {
      this[kWebSocket].emit("pong", data);
    }
    function resume(stream) {
      stream.resume();
    }
    function senderOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket.readyState === WebSocket2.CLOSED) return;
      if (websocket.readyState === WebSocket2.OPEN) {
        websocket._readyState = WebSocket2.CLOSING;
        setCloseTimer(websocket);
      }
      this._socket.end();
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function setCloseTimer(websocket) {
      websocket._closeTimer = setTimeout(
        websocket._socket.destroy.bind(websocket._socket),
        websocket._closeTimeout
      );
    }
    function socketOnClose() {
      const websocket = this[kWebSocket];
      this.removeListener("close", socketOnClose);
      this.removeListener("data", socketOnData);
      this.removeListener("end", socketOnEnd);
      websocket._readyState = WebSocket2.CLOSING;
      if (!this._readableState.endEmitted && !websocket._closeFrameReceived && !websocket._receiver._writableState.errorEmitted && this._readableState.length !== 0) {
        const chunk = this.read(this._readableState.length);
        websocket._receiver.write(chunk);
      }
      websocket._receiver.end();
      this[kWebSocket] = void 0;
      clearTimeout(websocket._closeTimer);
      if (websocket._receiver._writableState.finished || websocket._receiver._writableState.errorEmitted) {
        websocket.emitClose();
      } else {
        websocket._receiver.on("error", receiverOnFinish);
        websocket._receiver.on("finish", receiverOnFinish);
      }
    }
    function socketOnData(chunk) {
      if (!this[kWebSocket]._receiver.write(chunk)) {
        this.pause();
      }
    }
    function socketOnEnd() {
      const websocket = this[kWebSocket];
      websocket._readyState = WebSocket2.CLOSING;
      websocket._receiver.end();
      this.end();
    }
    function socketOnError() {
      const websocket = this[kWebSocket];
      this.removeListener("error", socketOnError);
      this.on("error", NOOP);
      if (websocket) {
        websocket._readyState = WebSocket2.CLOSING;
        this.destroy();
      }
    }
  }
});

// node_modules/ws/lib/stream.js
var require_stream = __commonJS({
  "node_modules/ws/lib/stream.js"(exports, module) {
    "use strict";
    var WebSocket2 = require_websocket();
    var { Duplex } = __require("stream");
    function emitClose(stream) {
      stream.emit("close");
    }
    function duplexOnEnd() {
      if (!this.destroyed && this._writableState.finished) {
        this.destroy();
      }
    }
    function duplexOnError(err) {
      this.removeListener("error", duplexOnError);
      this.destroy();
      if (this.listenerCount("error") === 0) {
        this.emit("error", err);
      }
    }
    function createWebSocketStream2(ws, options) {
      let terminateOnDestroy = true;
      const duplex = new Duplex({
        ...options,
        autoDestroy: false,
        emitClose: false,
        objectMode: false,
        writableObjectMode: false
      });
      ws.on("message", function message(msg, isBinary) {
        const data = !isBinary && duplex._readableState.objectMode ? msg.toString() : msg;
        if (!duplex.push(data)) ws.pause();
      });
      ws.once("error", function error(err) {
        if (duplex.destroyed) return;
        terminateOnDestroy = false;
        duplex.destroy(err);
      });
      ws.once("close", function close() {
        if (duplex.destroyed) return;
        duplex.push(null);
      });
      duplex._destroy = function(err, callback) {
        if (ws.readyState === ws.CLOSED) {
          callback(err);
          process.nextTick(emitClose, duplex);
          return;
        }
        let called = false;
        ws.once("error", function error(err2) {
          called = true;
          callback(err2);
        });
        ws.once("close", function close() {
          if (!called) callback(err);
          process.nextTick(emitClose, duplex);
        });
        if (terminateOnDestroy) ws.terminate();
      };
      duplex._final = function(callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open() {
            duplex._final(callback);
          });
          return;
        }
        if (ws._socket === null) return;
        if (ws._socket._writableState.finished) {
          callback();
          if (duplex._readableState.endEmitted) duplex.destroy();
        } else {
          ws._socket.once("finish", function finish() {
            callback();
          });
          ws.close();
        }
      };
      duplex._read = function() {
        if (ws.isPaused) ws.resume();
      };
      duplex._write = function(chunk, encoding, callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open() {
            duplex._write(chunk, encoding, callback);
          });
          return;
        }
        ws.send(chunk, callback);
      };
      duplex.on("end", duplexOnEnd);
      duplex.on("error", duplexOnError);
      return duplex;
    }
    module.exports = createWebSocketStream2;
  }
});

// node_modules/ws/lib/subprotocol.js
var require_subprotocol = __commonJS({
  "node_modules/ws/lib/subprotocol.js"(exports, module) {
    "use strict";
    var { tokenChars } = require_validation();
    function parse(header) {
      const protocols = /* @__PURE__ */ new Set();
      let start = -1;
      let end = -1;
      let i = 0;
      for (i; i < header.length; i++) {
        const code = header.charCodeAt(i);
        if (end === -1 && tokenChars[code] === 1) {
          if (start === -1) start = i;
        } else if (i !== 0 && (code === 32 || code === 9)) {
          if (end === -1 && start !== -1) end = i;
        } else if (code === 44) {
          if (start === -1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (end === -1) end = i;
          const protocol2 = header.slice(start, end);
          if (protocols.has(protocol2)) {
            throw new SyntaxError(`The "${protocol2}" subprotocol is duplicated`);
          }
          protocols.add(protocol2);
          start = end = -1;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      }
      if (start === -1 || end !== -1) {
        throw new SyntaxError("Unexpected end of input");
      }
      const protocol = header.slice(start, i);
      if (protocols.has(protocol)) {
        throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
      }
      protocols.add(protocol);
      return protocols;
    }
    module.exports = { parse };
  }
});

// node_modules/ws/lib/websocket-server.js
var require_websocket_server = __commonJS({
  "node_modules/ws/lib/websocket-server.js"(exports, module) {
    "use strict";
    var EventEmitter = __require("events");
    var http = __require("http");
    var { Duplex } = __require("stream");
    var { createHash } = __require("crypto");
    var extension2 = require_extension();
    var PerMessageDeflate2 = require_permessage_deflate();
    var subprotocol2 = require_subprotocol();
    var WebSocket2 = require_websocket();
    var { CLOSE_TIMEOUT, GUID, kWebSocket } = require_constants();
    var keyRegex = /^[+/0-9A-Za-z]{22}==$/;
    var RUNNING = 0;
    var CLOSING = 1;
    var CLOSED = 2;
    var WebSocketServer2 = class extends EventEmitter {
      /**
       * Create a `WebSocketServer` instance.
       *
       * @param {Object} options Configuration options
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Boolean} [options.autoPong=true] Specifies whether or not to
       *     automatically send a pong in response to a ping
       * @param {Number} [options.backlog=511] The maximum length of the queue of
       *     pending connections
       * @param {Boolean} [options.clientTracking=true] Specifies whether or not to
       *     track clients
       * @param {Number} [options.closeTimeout=30000] Duration in milliseconds to
       *     wait for the closing handshake to finish after `websocket.close()` is
       *     called
       * @param {Function} [options.handleProtocols] A hook to handle protocols
       * @param {String} [options.host] The hostname where to bind the server
       * @param {Number} [options.maxPayload=104857600] The maximum allowed message
       *     size
       * @param {Boolean} [options.noServer=false] Enable no server mode
       * @param {String} [options.path] Accept only connections matching this path
       * @param {(Boolean|Object)} [options.perMessageDeflate=false] Enable/disable
       *     permessage-deflate
       * @param {Number} [options.port] The port where to bind the server
       * @param {(http.Server|https.Server)} [options.server] A pre-created HTTP/S
       *     server to use
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @param {Function} [options.verifyClient] A hook to reject connections
       * @param {Function} [options.WebSocket=WebSocket] Specifies the `WebSocket`
       *     class to use. It must be the `WebSocket` class or class that extends it
       * @param {Function} [callback] A listener for the `listening` event
       */
      constructor(options, callback) {
        super();
        options = {
          allowSynchronousEvents: true,
          autoPong: true,
          maxPayload: 100 * 1024 * 1024,
          skipUTF8Validation: false,
          perMessageDeflate: false,
          handleProtocols: null,
          clientTracking: true,
          closeTimeout: CLOSE_TIMEOUT,
          verifyClient: null,
          noServer: false,
          backlog: null,
          // use default (511 as implemented in net.js)
          server: null,
          host: null,
          path: null,
          port: null,
          WebSocket: WebSocket2,
          ...options
        };
        if (options.port == null && !options.server && !options.noServer || options.port != null && (options.server || options.noServer) || options.server && options.noServer) {
          throw new TypeError(
            'One and only one of the "port", "server", or "noServer" options must be specified'
          );
        }
        if (options.port != null) {
          this._server = http.createServer((req, res) => {
            const body = http.STATUS_CODES[426];
            res.writeHead(426, {
              "Content-Length": body.length,
              "Content-Type": "text/plain"
            });
            res.end(body);
          });
          this._server.listen(
            options.port,
            options.host,
            options.backlog,
            callback
          );
        } else if (options.server) {
          this._server = options.server;
        }
        if (this._server) {
          const emitConnection = this.emit.bind(this, "connection");
          this._removeListeners = addListeners(this._server, {
            listening: this.emit.bind(this, "listening"),
            error: this.emit.bind(this, "error"),
            upgrade: (req, socket, head) => {
              this.handleUpgrade(req, socket, head, emitConnection);
            }
          });
        }
        if (options.perMessageDeflate === true) options.perMessageDeflate = {};
        if (options.clientTracking) {
          this.clients = /* @__PURE__ */ new Set();
          this._shouldEmitClose = false;
        }
        this.options = options;
        this._state = RUNNING;
      }
      /**
       * Returns the bound address, the address family name, and port of the server
       * as reported by the operating system if listening on an IP socket.
       * If the server is listening on a pipe or UNIX domain socket, the name is
       * returned as a string.
       *
       * @return {(Object|String|null)} The address of the server
       * @public
       */
      address() {
        if (this.options.noServer) {
          throw new Error('The server is operating in "noServer" mode');
        }
        if (!this._server) return null;
        return this._server.address();
      }
      /**
       * Stop the server from accepting new connections and emit the `'close'` event
       * when all existing connections are closed.
       *
       * @param {Function} [cb] A one-time listener for the `'close'` event
       * @public
       */
      close(cb) {
        if (this._state === CLOSED) {
          if (cb) {
            this.once("close", () => {
              cb(new Error("The server is not running"));
            });
          }
          process.nextTick(emitClose, this);
          return;
        }
        if (cb) this.once("close", cb);
        if (this._state === CLOSING) return;
        this._state = CLOSING;
        if (this.options.noServer || this.options.server) {
          if (this._server) {
            this._removeListeners();
            this._removeListeners = this._server = null;
          }
          if (this.clients) {
            if (!this.clients.size) {
              process.nextTick(emitClose, this);
            } else {
              this._shouldEmitClose = true;
            }
          } else {
            process.nextTick(emitClose, this);
          }
        } else {
          const server = this._server;
          this._removeListeners();
          this._removeListeners = this._server = null;
          server.close(() => {
            emitClose(this);
          });
        }
      }
      /**
       * See if a given request should be handled by this server instance.
       *
       * @param {http.IncomingMessage} req Request object to inspect
       * @return {Boolean} `true` if the request is valid, else `false`
       * @public
       */
      shouldHandle(req) {
        if (this.options.path) {
          const index = req.url.indexOf("?");
          const pathname = index !== -1 ? req.url.slice(0, index) : req.url;
          if (pathname !== this.options.path) return false;
        }
        return true;
      }
      /**
       * Handle a HTTP Upgrade request.
       *
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @public
       */
      handleUpgrade(req, socket, head, cb) {
        socket.on("error", socketOnError);
        const key = req.headers["sec-websocket-key"];
        const upgrade = req.headers.upgrade;
        const version = +req.headers["sec-websocket-version"];
        if (req.method !== "GET") {
          const message = "Invalid HTTP method";
          abortHandshakeOrEmitwsClientError(this, req, socket, 405, message);
          return;
        }
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          const message = "Invalid Upgrade header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (key === void 0 || !keyRegex.test(key)) {
          const message = "Missing or invalid Sec-WebSocket-Key header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (version !== 13 && version !== 8) {
          const message = "Missing or invalid Sec-WebSocket-Version header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message, {
            "Sec-WebSocket-Version": "13, 8"
          });
          return;
        }
        if (!this.shouldHandle(req)) {
          abortHandshake(socket, 400);
          return;
        }
        const secWebSocketProtocol = req.headers["sec-websocket-protocol"];
        let protocols = /* @__PURE__ */ new Set();
        if (secWebSocketProtocol !== void 0) {
          try {
            protocols = subprotocol2.parse(secWebSocketProtocol);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Protocol header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        const secWebSocketExtensions = req.headers["sec-websocket-extensions"];
        const extensions = {};
        if (this.options.perMessageDeflate && secWebSocketExtensions !== void 0) {
          const perMessageDeflate = new PerMessageDeflate2({
            ...this.options.perMessageDeflate,
            isServer: true,
            maxPayload: this.options.maxPayload
          });
          try {
            const offers = extension2.parse(secWebSocketExtensions);
            if (offers[PerMessageDeflate2.extensionName]) {
              perMessageDeflate.accept(offers[PerMessageDeflate2.extensionName]);
              extensions[PerMessageDeflate2.extensionName] = perMessageDeflate;
            }
          } catch (err) {
            const message = "Invalid or unacceptable Sec-WebSocket-Extensions header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        if (this.options.verifyClient) {
          const info = {
            origin: req.headers[`${version === 8 ? "sec-websocket-origin" : "origin"}`],
            secure: !!(req.socket.authorized || req.socket.encrypted),
            req
          };
          if (this.options.verifyClient.length === 2) {
            this.options.verifyClient(info, (verified, code, message, headers) => {
              if (!verified) {
                return abortHandshake(socket, code || 401, message, headers);
              }
              this.completeUpgrade(
                extensions,
                key,
                protocols,
                req,
                socket,
                head,
                cb
              );
            });
            return;
          }
          if (!this.options.verifyClient(info)) return abortHandshake(socket, 401);
        }
        this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
      }
      /**
       * Upgrade the connection to WebSocket.
       *
       * @param {Object} extensions The accepted extensions
       * @param {String} key The value of the `Sec-WebSocket-Key` header
       * @param {Set} protocols The subprotocols
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @throws {Error} If called more than once with the same socket
       * @private
       */
      completeUpgrade(extensions, key, protocols, req, socket, head, cb) {
        if (!socket.readable || !socket.writable) return socket.destroy();
        if (socket[kWebSocket]) {
          throw new Error(
            "server.handleUpgrade() was called more than once with the same socket, possibly due to a misconfiguration"
          );
        }
        if (this._state > RUNNING) return abortHandshake(socket, 503);
        const digest = createHash("sha1").update(key + GUID).digest("base64");
        const headers = [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${digest}`
        ];
        const ws = new this.options.WebSocket(null, void 0, this.options);
        if (protocols.size) {
          const protocol = this.options.handleProtocols ? this.options.handleProtocols(protocols, req) : protocols.values().next().value;
          if (protocol) {
            headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
            ws._protocol = protocol;
          }
        }
        if (extensions[PerMessageDeflate2.extensionName]) {
          const params = extensions[PerMessageDeflate2.extensionName].params;
          const value = extension2.format({
            [PerMessageDeflate2.extensionName]: [params]
          });
          headers.push(`Sec-WebSocket-Extensions: ${value}`);
          ws._extensions = extensions;
        }
        this.emit("headers", headers, req);
        socket.write(headers.concat("\r\n").join("\r\n"));
        socket.removeListener("error", socketOnError);
        ws.setSocket(socket, head, {
          allowSynchronousEvents: this.options.allowSynchronousEvents,
          maxPayload: this.options.maxPayload,
          skipUTF8Validation: this.options.skipUTF8Validation
        });
        if (this.clients) {
          this.clients.add(ws);
          ws.on("close", () => {
            this.clients.delete(ws);
            if (this._shouldEmitClose && !this.clients.size) {
              process.nextTick(emitClose, this);
            }
          });
        }
        cb(ws, req);
      }
    };
    module.exports = WebSocketServer2;
    function addListeners(server, map) {
      for (const event of Object.keys(map)) server.on(event, map[event]);
      return function removeListeners() {
        for (const event of Object.keys(map)) {
          server.removeListener(event, map[event]);
        }
      };
    }
    function emitClose(server) {
      server._state = CLOSED;
      server.emit("close");
    }
    function socketOnError() {
      this.destroy();
    }
    function abortHandshake(socket, code, message, headers) {
      message = message || http.STATUS_CODES[code];
      headers = {
        Connection: "close",
        "Content-Type": "text/html",
        "Content-Length": Buffer.byteLength(message),
        ...headers
      };
      socket.once("finish", socket.destroy);
      socket.end(
        `HTTP/1.1 ${code} ${http.STATUS_CODES[code]}\r
` + Object.keys(headers).map((h) => `${h}: ${headers[h]}`).join("\r\n") + "\r\n\r\n" + message
      );
    }
    function abortHandshakeOrEmitwsClientError(server, req, socket, code, message, headers) {
      if (server.listenerCount("wsClientError")) {
        const err = new Error(message);
        Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);
        server.emit("wsClientError", err, socket, req);
      } else {
        abortHandshake(socket, code, message, headers);
      }
    }
  }
});

// node_modules/ws/wrapper.mjs
var import_stream = __toESM(require_stream(), 1);
var import_extension = __toESM(require_extension(), 1);
var import_permessage_deflate = __toESM(require_permessage_deflate(), 1);
var import_receiver = __toESM(require_receiver(), 1);
var import_sender = __toESM(require_sender(), 1);
var import_subprotocol = __toESM(require_subprotocol(), 1);
var import_websocket = __toESM(require_websocket(), 1);
var import_websocket_server = __toESM(require_websocket_server(), 1);
var wrapper_default = import_websocket.default;

// scripts/ws-live.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// src/indicators/technical.ts
function sma(values, period) {
  const result = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return result;
  let windowSum = 0;
  for (let i = 0; i < values.length; i++) {
    windowSum += values[i];
    if (i >= period) windowSum -= values[i - period];
    if (i + 1 >= period) result[i] = windowSum / period;
  }
  return result;
}
function ema(values, period) {
  const multiplier = 2 / (period + 1);
  let previous = null;
  return values.map((value, index) => {
    if (index + 1 < period) return null;
    if (previous === null) {
      const seed = values.slice(index + 1 - period, index + 1);
      previous = seed.reduce((sum, item) => sum + item, 0) / period;
      return previous;
    }
    previous = (value - previous) * multiplier + previous;
    return previous;
  });
}
function rsi(values, period) {
  const result = Array(values.length).fill(null);
  let avgGain = 0;
  let avgLoss = 0;
  for (let index = 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    if (index <= period) {
      avgGain += gain;
      avgLoss += loss;
      if (index === period) {
        avgGain /= period;
        avgLoss /= period;
      }
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    if (index >= period) {
      if (avgLoss === 0) {
        result[index] = 100;
      } else {
        const relativeStrength = avgGain / avgLoss;
        result[index] = 100 - 100 / (1 + relativeStrength);
      }
    }
  }
  return result;
}
function macd(values, fast = 12, slow = 26, signal = 9) {
  const fastEma = ema(values, fast);
  const slowEma = ema(values, slow);
  const macdLine = values.map((_, index) => {
    const fastValue = fastEma[index];
    const slowValue = slowEma[index];
    return fastValue === null || slowValue === null ? null : fastValue - slowValue;
  });
  const firstReal = macdLine.findIndex((v) => v !== null);
  const signalAligned = new Array(macdLine.length).fill(null);
  if (firstReal >= 0) {
    const realValues = macdLine.slice(firstReal);
    const signalFromReal = ema(realValues, signal);
    for (let i = 0; i < signalFromReal.length; i++) {
      signalAligned[firstReal + i] = signalFromReal[i];
    }
  }
  return {
    macdLine,
    signalLine: signalAligned,
    histogram: macdLine.map((value, index) => {
      const signalValue = signalAligned[index];
      return value === null || signalValue === null ? null : value - signalValue;
    })
  };
}
function bollinger(values, period, deviations) {
  const middle = sma(values, period);
  return values.map((_, index) => {
    const average = middle[index];
    if (average === null) return null;
    const slice = values.slice(index + 1 - period, index + 1);
    const variance = slice.reduce((sum, value) => sum + (value - average) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    return {
      lower: average - deviations * sd,
      middle: average,
      upper: average + deviations * sd,
      widthPct: average === 0 ? 0 : 2 * deviations * sd / average
    };
  });
}
function averageTrueRange(candles, period) {
  const trueRanges = candles.map((candle, index) => {
    if (index === 0) return candle.high - candle.low;
    const previousClose = candles[index - 1].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose)
    );
  });
  return sma(trueRanges, period);
}
function rateOfChange(values, period) {
  return values.map((value, index) => {
    if (index < period) return null;
    const previous = values[index - period];
    return previous === 0 ? 0 : (value - previous) / previous;
  });
}

// src/guideRules/evaluator.ts
var MIN_LOOKBACK = 80;
var movingAverageCache = /* @__PURE__ */ new WeakMap();
var atrCache = /* @__PURE__ */ new WeakMap();
function evaluateGuideRules({
  candleIndex,
  candles,
  decision,
  mode
}) {
  const trend = evaluateDowTheory(candles, candleIndex);
  const movingAverage = evaluateMovingAverages(candles, candleIndex);
  const supportResistance = evaluateSupportResistance(candles, candleIndex);
  const candleWarning = evaluateCandlestickWarnings(candles, candleIndex);
  if (mode === "ignored") {
    return {
      mode,
      passed: true,
      score: 1,
      reasons: ["guide-rules-ignored"],
      blockers: [],
      warnings: [],
      trend: trend.state,
      movingAverage: movingAverage.state
    };
  }
  if (decision.action === "hold") {
    return {
      mode,
      passed: true,
      score: 0,
      reasons: ["no-action"],
      blockers: [],
      warnings: [],
      trend: trend.state,
      movingAverage: movingAverage.state
    };
  }
  if (decision.action === "sell") {
    return {
      mode,
      passed: true,
      score: 1,
      reasons: ["sell-signal-allowed"],
      blockers: [],
      warnings: candleWarning.bearishTopWarning ? ["bearish-candle-warning"] : [],
      trend: trend.state,
      movingAverage: movingAverage.state
    };
  }
  const confirmations = [
    trend.state === "uptrend" ? "dow-uptrend" : null,
    movingAverage.state === "bullish" ? "ma-bullish" : null,
    supportResistance.nearSupport ? "near-support" : null,
    supportResistance.resistanceBreakout ? "resistance-breakout" : null,
    candleWarning.bullishReversalHint ? "bullish-reversal-candle" : null
  ].filter((value) => value !== null);
  const blockers = [
    trend.state === "downtrend" && !supportResistance.resistanceBreakout ? "dow-downtrend" : null,
    movingAverage.state === "bearish" && !supportResistance.nearSupport ? "ma-bearish" : null,
    supportResistance.nearResistance && !supportResistance.resistanceBreakout ? "near-resistance" : null,
    supportResistance.supportBreakdown ? "support-breakdown" : null,
    candleWarning.bearishTopWarning ? "bearish-candle-warning" : null
  ].filter((value) => value !== null);
  const hasEnoughData = candleIndex >= MIN_LOOKBACK;
  const passed = hasEnoughData && confirmations.length >= 2 && blockers.length === 0;
  const score = clamp01(confirmations.length / 4 - blockers.length * 0.3);
  return {
    mode,
    passed,
    score,
    reasons: confirmations.length > 0 ? confirmations : ["no-guide-confirmation"],
    blockers: hasEnoughData ? blockers : ["insufficient-guide-history"],
    warnings: candleWarning.bearishTopWarning ? ["bearish-candle-warning"] : [],
    trend: trend.state,
    movingAverage: movingAverage.state
  };
}
function evaluateDowTheory(candles, candleIndex) {
  const window = getWindow(candles, candleIndex, 60);
  if (window.length < 20) {
    return {
      state: "unknown",
      higherHigh: false,
      higherLow: false,
      lowerHigh: false,
      lowerLow: false
    };
  }
  const previous = window.slice(0, Math.floor(window.length / 2));
  const recent = window.slice(Math.floor(window.length / 2));
  const previousHigh = Math.max(...previous.map((candle) => candle.high));
  const previousLow = Math.min(...previous.map((candle) => candle.low));
  const recentHigh = Math.max(...recent.map((candle) => candle.high));
  const recentLow = Math.min(...recent.map((candle) => candle.low));
  const higherHigh = recentHigh > previousHigh;
  const higherLow = recentLow > previousLow;
  const lowerHigh = recentHigh < previousHigh;
  const lowerLow = recentLow < previousLow;
  const state = higherHigh && higherLow ? "uptrend" : lowerHigh && lowerLow ? "downtrend" : "sideways";
  return {
    state,
    higherHigh,
    higherLow,
    lowerHigh,
    lowerLow
  };
}
function evaluateMovingAverages(candles, candleIndex) {
  const { short, medium, long } = getMovingAverageSeries(candles);
  const shortValue = short[candleIndex];
  const mediumValue = medium[candleIndex];
  const longValue = long[candleIndex];
  const mediumPast = medium[Math.max(0, candleIndex - 10)];
  const longPast = long[Math.max(0, candleIndex - 10)];
  if (shortValue === null || mediumValue === null || longValue === null || mediumPast === null || longPast === null) {
    return {
      state: "unknown",
      shortAboveMedium: false,
      mediumAboveLong: false,
      mediumSlopeUp: false,
      longSlopeUp: false
    };
  }
  const shortAboveMedium = shortValue > mediumValue;
  const mediumAboveLong = mediumValue > longValue;
  const mediumSlopeUp = mediumValue > mediumPast;
  const longSlopeUp = longValue >= longPast;
  const state = shortAboveMedium && mediumAboveLong && mediumSlopeUp ? "bullish" : !shortAboveMedium && !mediumAboveLong && !mediumSlopeUp ? "bearish" : "mixed";
  return {
    state,
    shortAboveMedium,
    mediumAboveLong,
    mediumSlopeUp,
    longSlopeUp
  };
}
function getMovingAverageSeries(candles) {
  let byWindow = movingAverageCache.get(candles);
  if (!byWindow) {
    byWindow = /* @__PURE__ */ new Map();
    movingAverageCache.set(candles, byWindow);
  }
  const last = candles[candles.length - 1];
  const key = `${candles.length}:${last?.timestamp ?? 0}:${last?.close ?? 0}`;
  const cached = byWindow.get(key);
  if (cached) return cached;
  const closes = candles.map((candle) => candle.close);
  const series = {
    short: ema(closes, 10),
    medium: ema(closes, 50),
    long: ema(closes, 100)
  };
  byWindow.set(key, series);
  return series;
}
function evaluateSupportResistance(candles, candleIndex) {
  const current = candles[candleIndex];
  const previousWindow = getWindow(candles, candleIndex - 1, 48);
  if (!current || previousWindow.length < 12) {
    return {
      nearSupport: false,
      nearResistance: false,
      resistanceBreakout: false,
      supportBreakdown: false
    };
  }
  const support = Math.min(...previousWindow.map((candle) => candle.low));
  const resistance = Math.max(...previousWindow.map((candle) => candle.high));
  const threshold = Math.max(6e-3, averageTrueRangePct(previousWindow) * 0.8);
  const nearSupport = Math.abs(current.close - support) / current.close <= threshold;
  const nearResistance = Math.abs(resistance - current.close) / current.close <= threshold;
  const resistanceBreakout = current.close > resistance * 1.002;
  const supportBreakdown = current.close < support * 0.998;
  return {
    nearSupport,
    nearResistance,
    resistanceBreakout,
    supportBreakdown
  };
}
function evaluateCandlestickWarnings(candles, candleIndex) {
  const current = candles[candleIndex];
  const previous = candles[candleIndex - 1];
  const recent = getWindow(candles, candleIndex, 12);
  if (!current || !previous || recent.length < 4) {
    return {
      bearishTopWarning: false,
      bullishReversalHint: false
    };
  }
  const range = Math.max(current.high - current.low, Number.EPSILON);
  const body = Math.abs(current.close - current.open);
  const upperWick = current.high - Math.max(current.open, current.close);
  const lowerWick = Math.min(current.open, current.close) - current.low;
  const recentHigh = Math.max(...recent.map((candle) => candle.high));
  const nearRecentHigh = current.high >= recentHigh * 0.995;
  const bearishEngulfing = current.close < current.open && previous.close > previous.open && current.open >= previous.close && current.close <= previous.open;
  const shootingStar = nearRecentHigh && upperWick / range >= 0.55 && body / range <= 0.35;
  const longLowerReversal = lowerWick / range >= 0.5 && current.close > current.open;
  return {
    bearishTopWarning: bearishEngulfing || shootingStar,
    bullishReversalHint: longLowerReversal
  };
}
function getWindow(candles, candleIndex, size) {
  if (candleIndex < 0) return [];
  return candles.slice(Math.max(0, candleIndex + 1 - size), candleIndex + 1);
}
function averageTrueRangePct(candles) {
  if (candles.length === 0) return 0;
  let byKey = atrCache.get(candles);
  if (!byKey) {
    byKey = /* @__PURE__ */ new Map();
    atrCache.set(candles, byKey);
  }
  const last = candles[candles.length - 1];
  const key = `${candles.length}:${last?.timestamp ?? 0}:${last?.close ?? 0}`;
  const cached = byKey.get(key);
  if (cached !== void 0) return cached;
  const ranges = candles.map((candle) => (candle.high - candle.low) / candle.close);
  const values = sma(ranges, Math.min(14, ranges.length)).filter((value) => value !== null);
  const result = values.length === 0 ? 0 : values[values.length - 1];
  byKey.set(key, result);
  return result;
}
function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

// src/simulation/backtest.ts
var defaultBacktestConfig = {
  initialCash: 1e6,
  feeRate: 5e-4,
  slippageRate: 5e-4
};

// src/simulation/dailyOperation.ts
var defaultOptions = {
  minBuyScore: 0.55,
  rotationAdvantage: 0.12
};
function decideDailyOperation({
  currentPosition,
  now,
  options = {},
  signals
}) {
  const resolved = { ...defaultOptions, ...options };
  const rankedSignals = signals.slice().sort((a, b) => scoreSignal(b) - scoreSignal(a));
  const sellSignal = currentPosition ? rankedSignals.find((signal) => signal.market === currentPosition.market && signal.action === "sell") : void 0;
  const bestBuySignal = rankedSignals.find(
    (signal) => signal.action === "buy" && scoreSignal(signal) >= resolved.minBuyScore
  );
  if (currentPosition && sellSignal) {
    return {
      action: "sell",
      timestamp: now,
      sellMarket: currentPosition.market,
      selectedSignal: sellSignal,
      currentPosition,
      rankedSignals,
      reasonCodes: ["sell-signal-priority", ...sellSignal.reasonCodes]
    };
  }
  if (!currentPosition) {
    if (!bestBuySignal) {
      return {
        action: "hold",
        timestamp: now,
        rankedSignals,
        reasonCodes: ["no-qualified-buy-signal"]
      };
    }
    return {
      action: "buy",
      timestamp: now,
      buyMarket: bestBuySignal.market,
      selectedSignal: bestBuySignal,
      rankedSignals,
      reasonCodes: ["best-buy-signal", ...bestBuySignal.reasonCodes]
    };
  }
  if (bestBuySignal && bestBuySignal.market !== currentPosition.market) {
    const currentMarketBuy = rankedSignals.find(
      (signal) => signal.market === currentPosition.market && signal.action === "buy"
    );
    const currentScore = currentMarketBuy ? scoreSignal(currentMarketBuy) : resolved.minBuyScore;
    const challengerScore = scoreSignal(bestBuySignal);
    if (challengerScore >= currentScore + resolved.rotationAdvantage) {
      return {
        action: "rotate",
        timestamp: now,
        buyMarket: bestBuySignal.market,
        sellMarket: currentPosition.market,
        selectedSignal: bestBuySignal,
        currentPosition,
        rankedSignals,
        reasonCodes: ["stronger-buy-signal-rotation", ...bestBuySignal.reasonCodes]
      };
    }
  }
  return {
    action: "hold",
    timestamp: now,
    currentPosition,
    rankedSignals,
    reasonCodes: ["keep-current-position"]
  };
}
function scoreSignal(signal) {
  return clamp012(signal.strength * 0.65 + signal.qualityScore * 0.35);
}
function clamp012(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

// src/simulation/safety.ts
var MIN_CANDLE_RATIO = 1 / 6;
var MAX_REJECTED_SIGNAL_RATIO = 0.5;
function evaluateSafetyBlock(result, candles, currentReturn) {
  const reasons = [];
  const minCandles = Math.max(60, Math.round(candles.length * MIN_CANDLE_RATIO));
  if (candles.length < minCandles) reasons.push("insufficient-1m-data");
  if (currentReturn <= -0.03) reasons.push("rapid-intraday-drop");
  if (currentReturn >= 0.12) reasons.push("overextended-chase-risk");
  if (result.maxDrawdown >= 0.15) reasons.push("high-max-drawdown");
  if (result.returnRate <= 0) reasons.push("non-positive-backtest");
  const tradeCount = Math.max(1, result.tradeCount);
  if (result.guideRejectedSignals / tradeCount > MAX_REJECTED_SIGNAL_RATIO) reasons.push("many-rejected-signals");
  return {
    blocked: reasons.length > 0,
    reasons
  };
}
function getDailyReturnAtCandleIndex(candles, candleIndex) {
  const candle = candles[candleIndex];
  if (!candle) return 0;
  const dayStart = getKstDayStart(candle.timestamp);
  let lo = 0;
  let hi = candleIndex;
  while (lo < hi) {
    const mid = lo + hi >> 1;
    if (candles[mid].timestamp < dayStart) lo = mid + 1;
    else hi = mid;
  }
  const first = candles[lo];
  if (!first || first.timestamp > candle.timestamp || first.close === 0) return 0;
  return (candle.close - first.close) / first.close;
}
function getKstDayStart(timestamp) {
  const kstOffsetMs = 9 * 60 * 60 * 1e3;
  const dayMs = 24 * 60 * 60 * 1e3;
  return Math.floor((timestamp + kstOffsetMs) / dayMs) * dayMs - kstOffsetMs;
}

// src/simulation/paperTrading.ts
var defaultOptions2 = {
  autoBlockMode: "disabled",
  guideRuleMode: "strict",
  maxCandles: 288,
  startAt: null,
  config: defaultBacktestConfig
};
var PaperTradingSession = class {
  constructor(strategy, plan, options = {}) {
    this.strategy = strategy;
    this.plan = plan;
    const resolved = resolveOptions(options);
    this.config = resolved.config;
    this.guideRuleMode = resolved.guideRuleMode;
    this.autoBlockMode = resolved.autoBlockMode;
    this.initialCash = resolved.config.initialCash;
    this.cash = resolved.config.initialCash;
    this.selectedMarkets = plan.selectedMarkets;
    this.scenarioById = getScenarioById(strategy);
  }
  initialCash;
  selectedMarkets;
  cash;
  config;
  guideRuleMode;
  autoBlockMode;
  scenarioById;
  marketPointers = /* @__PURE__ */ new Map();
  position = null;
  lastSellPriceByMarket = /* @__PURE__ */ new Map();
  lastPositionCandleTimestamp = null;
  trades = [];
  decisions = [];
  equityCurve = [];
  safetyBlockedSignals = 0;
  safetyBlockedByMarket = {};
  blockedSignals = [];
  step(timestamp, candlesByMarket, options = {}) {
    const signals = [];
    const candlesAtTime = /* @__PURE__ */ new Map();
    for (const selected of this.selectedMarkets) {
      const candles = candlesByMarket[selected.market] ?? [];
      const candleIndex = findCandleIndexAtOrBefore(candles, timestamp, this.marketPointers.get(selected.market) ?? 0);
      if (candleIndex < 0) continue;
      this.marketPointers.set(selected.market, candleIndex);
      const candle = candles[candleIndex];
      candlesAtTime.set(selected.market, { candle, candleIndex });
    }
    const riskExitedMarkets = this.updateOpenPosition(candlesAtTime, timestamp, options.riskMarkets);
    if (riskExitedMarkets.size === 0) {
      for (const selected of this.selectedMarkets) {
        if (options.signalMarkets && !options.signalMarkets.has(selected.market)) continue;
        if (riskExitedMarkets.has(selected.market)) continue;
        const candleInfo = candlesAtTime.get(selected.market);
        if (!candleInfo) continue;
        const { candleIndex } = candleInfo;
        const candles = candlesByMarket[selected.market] ?? [];
        const scenario = this.scenarioById.get(selected.bestResult.scenarioId) ?? this.strategy.defaultScenario;
        const marketPosition = this.position?.market === selected.market ? this.position : null;
        const decision2 = this.strategy.decide(
          {
            market: selected.market,
            candles,
            candleIndex,
            lastSellPrice: this.lastSellPriceByMarket.get(selected.market),
            position: marketPosition,
            portfolioValue: this.getPortfolioValue(candlesAtTime)
          },
          scenario
        );
        const guideRuleEvaluation = evaluateGuideRules({
          candles,
          candleIndex,
          decision: decision2,
          mode: this.guideRuleMode
        });
        let finalAction = decision2.action;
        const guideBlocked = decision2.action === "buy" && this.guideRuleMode === "strict" && !guideRuleEvaluation.passed;
        if (guideBlocked) {
          finalAction = "hold";
          this.blockedSignals.push({
            market: selected.market,
            timestamp,
            reason: "guide-rule",
            reasonCodes: [...decision2.reasonCodes, ...guideRuleEvaluation.reasons],
            guideRuleMode: this.guideRuleMode,
            safetyMode: this.autoBlockMode
          });
        }
        if (decision2.action === "buy" && !guideBlocked && this.autoBlockMode === "enabled") {
          const candlesUntilDecision = candles.slice(0, candleIndex + 1);
          const currentReturn = getDailyReturnAtCandleIndex(candles, candleIndex);
          const safetyEvaluation = evaluateSafetyBlock(selected.bestResult, candlesUntilDecision, currentReturn);
          if (safetyEvaluation.blocked) {
            finalAction = "hold";
            this.safetyBlockedSignals += 1;
            this.safetyBlockedByMarket[selected.market] = (this.safetyBlockedByMarket[selected.market] ?? 0) + 1;
            this.blockedSignals.push({
              market: selected.market,
              timestamp,
              reason: "safety",
              reasonCodes: [...decision2.reasonCodes, ...guideRuleEvaluation.reasons, ...safetyEvaluation.reasons],
              guideRuleMode: this.guideRuleMode,
              safetyMode: this.autoBlockMode
            });
          }
        }
        if (finalAction !== "hold") {
          signals.push({
            market: selected.market,
            action: finalAction,
            strength: decision2.confidence,
            qualityScore: scoreSelectedMarket(selected.score, selected.bestResult.returnRate, selected.bestResult.maxDrawdown),
            timestamp,
            reasonCodes: [...decision2.reasonCodes, ...guideRuleEvaluation.reasons]
          });
        }
      }
    }
    const decision = decideDailyOperation({
      currentPosition: this.position ? {
        market: this.position.market,
        entryPrice: this.position.averagePrice,
        currentPrice: candlesAtTime.get(this.position.market)?.candle.close ?? this.position.averagePrice,
        quantity: this.position.quantity,
        openedAt: this.position.openedAt
      } : null,
      now: timestamp,
      options: this.strategy.id === "general-d" || this.strategy.id === "general-e" ? { rotationAdvantage: Number.POSITIVE_INFINITY } : void 0,
      signals
    });
    if ((decision.action === "sell" || decision.action === "rotate") && this.position) {
      const candle = candlesAtTime.get(this.position.market)?.candle;
      if (candle) {
        const basePrice = options.executionPrices?.get(this.position.market) ?? candle.close;
        const exitPrice = basePrice * (1 - this.config.slippageRate);
        this.cash += this.closePosition(this.position, exitPrice, timestamp, decision.reasonCodes);
        this.lastSellPriceByMarket.set(this.position.market, exitPrice);
        this.position = null;
        this.lastPositionCandleTimestamp = null;
      }
    }
    if ((decision.action === "buy" || decision.action === "rotate") && decision.buyMarket && !this.position) {
      const candle = candlesAtTime.get(decision.buyMarket)?.candle;
      if (candle && this.cash > 0) {
        const budget = this.cash;
        const basePrice = options.executionPrices?.get(decision.buyMarket) ?? candle.close;
        const fillPrice = basePrice * (1 + this.config.slippageRate);
        const fee = budget * this.config.feeRate;
        const quantity = Math.max(0, (budget - fee) / fillPrice);
        if (quantity > 0) {
          this.cash -= budget;
          this.position = {
            market: decision.buyMarket,
            quantity,
            averagePrice: fillPrice,
            openedAt: timestamp,
            highestPrice: fillPrice,
            holdCandles: 0
          };
          this.lastPositionCandleTimestamp = candlesAtTime.get(decision.buyMarket)?.candle.timestamp ?? null;
          this.trades.push({
            market: decision.buyMarket,
            side: "buy",
            timestamp,
            price: fillPrice,
            quantity,
            fee,
            reasonCodes: decision.reasonCodes,
            guideRuleMode: this.guideRuleMode
          });
        }
      }
    }
    const portfolioValue = this.getPortfolioValue(candlesAtTime);
    this.decisions.push({
      timestamp,
      action: decision.action,
      buyMarket: decision.buyMarket,
      sellMarket: decision.sellMarket,
      portfolioValue,
      cash: this.cash,
      positionMarket: this.position?.market,
      reasonCodes: decision.reasonCodes
    });
    this.equityCurve.push({ timestamp, value: portfolioValue });
    return decision;
  }
  finalize(candlesByMarket, closeOpenPosition) {
    if (closeOpenPosition && this.position) {
      const candles = candlesByMarket[this.position.market] ?? [];
      const last = candles[this.marketPointers.get(this.position.market) ?? candles.length - 1] ?? candles[candles.length - 1];
      if (last) {
        const exitPrice = last.close * (1 - this.config.slippageRate);
        this.cash += this.closePosition(this.position, exitPrice, last.timestamp, ["paper-final-close"]);
        this.lastSellPriceByMarket.set(this.position.market, exitPrice);
        this.position = null;
        this.lastPositionCandleTimestamp = null;
        this.equityCurve.push({ timestamp: last.timestamp, value: this.cash });
      }
    }
    return this.result();
  }
  result() {
    const finalValue = this.equityCurve[this.equityCurve.length - 1]?.value ?? this.getCurrentValue();
    return {
      strategyId: this.strategy.id,
      strategyName: this.strategy.name,
      guideRuleMode: this.guideRuleMode,
      startedAt: this.equityCurve[0]?.timestamp ?? 0,
      endedAt: this.equityCurve[this.equityCurve.length - 1]?.timestamp ?? 0,
      initialCash: this.initialCash,
      finalValue,
      returnRate: (finalValue - this.initialCash) / this.initialCash,
      autoBlockMode: this.autoBlockMode,
      blockedSignals: this.blockedSignals.slice(),
      safetyBlockedByMarket: { ...this.safetyBlockedByMarket },
      safetyBlockedSignals: this.safetyBlockedSignals,
      trades: this.trades.slice(),
      decisions: this.decisions.slice(),
      equityCurve: this.equityCurve.slice()
    };
  }
  getTradeCount() {
    return this.trades.length;
  }
  getPositionMarket() {
    return this.position?.market ?? null;
  }
  updateOpenPosition(candlesAtTime, timestamp, riskMarkets) {
    const riskExitedMarkets = /* @__PURE__ */ new Set();
    if (!this.position) return riskExitedMarkets;
    if (riskMarkets && !riskMarkets.has(this.position.market)) return riskExitedMarkets;
    const candle = candlesAtTime.get(this.position.market)?.candle;
    if (!candle) return riskExitedMarkets;
    const previousHighestPrice = this.position.highestPrice;
    if (this.lastPositionCandleTimestamp !== candle.timestamp) {
      this.position.holdCandles += 1;
      this.lastPositionCandleTimestamp = candle.timestamp;
    }
    const scenario = this.getScenarioForMarket(this.position.market);
    const stopLossPct = scenario?.params.stopLossPct ?? scenario?.params.emergencyStopPct ?? 0;
    const trailingStopPct = scenario?.params.trailingStopPct ?? 0;
    const takeProfitPct = scenario?.params.takeProfitPct ?? 0;
    const stopPrice = this.position.averagePrice * (1 - stopLossPct);
    const trailingStop = previousHighestPrice * (1 - trailingStopPct);
    const takeProfit = this.position.averagePrice * (1 + takeProfitPct);
    const triggeredStops = [
      stopLossPct > 0 && candle.low <= stopPrice ? stopPrice : null,
      trailingStopPct > 0 && candle.low <= trailingStop ? trailingStop : null
    ].filter((price) => price !== null);
    const takeProfitTriggered = takeProfitPct > 0 && candle.high >= takeProfit;
    if (triggeredStops.length > 0 || takeProfitTriggered) {
      const exitedMarket = this.position.market;
      const exitBasePrice = triggeredStops.length > 0 ? Math.max(...triggeredStops) : takeProfit;
      const exitPrice = exitBasePrice * (1 - this.config.slippageRate);
      this.cash += this.closePosition(this.position, exitPrice, timestamp, ["risk-rule-exit"]);
      this.lastSellPriceByMarket.set(exitedMarket, exitPrice);
      riskExitedMarkets.add(exitedMarket);
      this.position = null;
      this.lastPositionCandleTimestamp = null;
    }
    if (this.position) {
      this.position.highestPrice = Math.max(this.position.highestPrice, candle.high);
    }
    return riskExitedMarkets;
  }
  getScenarioForMarket(market) {
    const selected = this.selectedMarkets.find((item) => item.market === market);
    if (!selected) return null;
    return this.scenarioById.get(selected.bestResult.scenarioId) ?? this.strategy.defaultScenario;
  }
  getPortfolioValue(candlesAtTime) {
    if (!this.position) return this.cash;
    const currentPrice = candlesAtTime.get(this.position.market)?.candle.close ?? this.position.averagePrice;
    return this.cash + this.position.quantity * currentPrice;
  }
  getCurrentValue() {
    return this.equityCurve[this.equityCurve.length - 1]?.value ?? this.cash;
  }
  closePosition(positionToClose, price, timestamp, reasonCodes) {
    const proceeds = positionToClose.quantity * price;
    const fee = proceeds * this.config.feeRate;
    this.trades.push({
      market: positionToClose.market,
      side: "sell",
      timestamp,
      price,
      quantity: positionToClose.quantity,
      fee,
      reasonCodes,
      guideRuleMode: this.guideRuleMode
    });
    return proceeds - fee;
  }
};
function resolveOptions(options) {
  return {
    ...defaultOptions2,
    ...options,
    config: {
      ...defaultOptions2.config,
      ...options.config,
      guideRuleMode: options.guideRuleMode ?? options.config?.guideRuleMode ?? defaultOptions2.guideRuleMode
    }
  };
}
function getScenarioById(strategy) {
  const scenarios = strategy.scenarios?.length ? strategy.scenarios : [strategy.defaultScenario];
  return new Map(scenarios.map((scenario) => [scenario.id, scenario]));
}
function findCandleIndexAtOrBefore(candles, timestamp, startIndex) {
  if (candles.length === 0) return -1;
  const boundedStart = Math.min(Math.max(0, startIndex), candles.length - 1);
  if (candles[boundedStart].timestamp <= timestamp) {
    const nextIndex = boundedStart + 1;
    if (nextIndex >= candles.length || candles[nextIndex].timestamp > timestamp) return boundedStart;
    return findLastIndexAtOrBefore(candles, timestamp, nextIndex, candles.length - 1);
  }
  return findLastIndexAtOrBefore(candles, timestamp, 0, boundedStart);
}
function findLastIndexAtOrBefore(candles, timestamp, low, high) {
  let left = low;
  let right = high;
  let result = -1;
  while (left <= right) {
    const middle = Math.floor((left + right) / 2);
    if (candles[middle].timestamp <= timestamp) {
      result = middle;
      left = middle + 1;
    } else {
      right = middle - 1;
    }
  }
  return result;
}
function scoreSelectedMarket(score, returnRate, maxDrawdown) {
  const normalizedScore = Number.isFinite(score) ? (Math.tanh(score) + 1) / 2 : 0.5;
  return clamp013(normalizedScore * 0.45 + clamp013(returnRate + 0.5) * 0.35 + (1 - clamp013(maxDrawdown)) * 0.2);
}
function clamp013(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

// src/strategies/arbitrage.ts
var arbitrageScenario = {
  id: "relative-strength-arb-default",
  traderId: "arbitrage",
  name: "Relative-value proxy",
  description: "A spot-only proxy for future pair/funding arbitrage infrastructure.",
  params: {
    lookback: 48,
    zEntry: -1.6,
    zExit: -0.2,
    stopLossPct: 0.03,
    maxHoldCandles: 48,
    minProfitPct: 0.01,
    // exit only when z recovers AND return >= this threshold
    cooldownBars: 5
    // bars to skip after closing before re-entering
  }
};
var arbitrageScenarios = [
  {
    ...arbitrageScenario,
    id: "relative-value-balanced",
    name: "Balanced relative value"
  },
  {
    ...arbitrageScenario,
    id: "relative-value-fast",
    name: "Fast relative value",
    params: {
      ...arbitrageScenario.params,
      lookback: 24,
      zEntry: -1.25,
      zExit: -0.05,
      stopLossPct: 0.025,
      maxHoldCandles: 24,
      minProfitPct: 5e-3,
      // fast scenario: 0.5% (quick mean-reversion, lower threshold)
      cooldownBars: 3
    }
  },
  {
    ...arbitrageScenario,
    id: "relative-value-deep",
    name: "Deep relative value",
    params: {
      ...arbitrageScenario.params,
      lookback: 72,
      zEntry: -2.1,
      zExit: -0.35,
      stopLossPct: 0.045,
      maxHoldCandles: 72,
      minProfitPct: 8e-3,
      cooldownBars: 10
    }
  }
];
var arbitrageStrategy = {
  id: "arbitrage",
  name: "Statistical / Funding Arbitrage",
  description: "\uCD08\uAE30 \uBC84\uC804\uC740 \uD604\uBB3C \uB370\uC774\uD130\uB9CC \uC0AC\uC6A9\uD574 \uC0C1\uB300\uC801\uC73C\uB85C \uB20C\uB9B0 \uC885\uBAA9\uC758 \uD68C\uADC0 \uAC00\uB2A5\uC131\uC744 \uD14C\uC2A4\uD2B8\uD569\uB2C8\uB2E4.",
  defaultScenario: arbitrageScenario,
  scenarios: arbitrageScenarios,
  decide(context, scenario = arbitrageScenario) {
    const { candles, candleIndex, position, lastSellCandleIndex } = context;
    const params = scenario.params;
    const current = candles[candleIndex];
    const indicators = getArbitrageIndicators(candles, scenario);
    const window = indicators.returns.slice(Math.max(0, candleIndex - params.lookback), candleIndex);
    if (window.length < params.lookback) return hold("warming-up");
    const average = window.reduce((sum, value) => sum + value, 0) / window.length;
    const variance = window.reduce((sum, value) => sum + (value - average) ** 2, 0) / (window.length - 1);
    const sd = Math.sqrt(variance);
    if (sd === 0) return hold("flat-relative-window");
    const zScore = (indicators.returns[candleIndex] - average) / sd;
    const minProfitPct = params.minProfitPct ?? 0;
    const cooldownBars = params.cooldownBars ?? 0;
    if (position) {
      const returnPct = (current.close - position.averagePrice) / position.averagePrice;
      if (position.holdCandles >= params.maxHoldCandles) {
        return { action: "sell", confidence: 0.58, reasonCodes: ["max-hold-exit"], targetWeight: 0 };
      }
      if (zScore >= params.zExit) {
        if (returnPct >= minProfitPct) {
          return { action: "sell", confidence: 0.58, reasonCodes: ["relative-value-normalized", "profit-target"], targetWeight: 0 };
        }
        return hold("awaiting-profit-target");
      }
      return hold("relative-position-running");
    }
    if (cooldownBars > 0 && lastSellCandleIndex !== void 0) {
      if (candleIndex - lastSellCandleIndex < cooldownBars) {
        return hold("cooldown");
      }
    }
    if (zScore <= params.zEntry) {
      return {
        action: "buy",
        confidence: 0.54,
        reasonCodes: ["temporary-underperformance", "statistical-reversion-candidate"],
        targetWeight: 0.45,
        stopLossPct: params.stopLossPct,
        maxHoldCandles: params.maxHoldCandles
      };
    }
    return hold("no-relative-value-entry");
  }
};
function hold(reason) {
  return { action: "hold", confidence: 0, reasonCodes: [reason], targetWeight: 0 };
}
var arbitrageIndicatorCache = /* @__PURE__ */ new WeakMap();
function getArbitrageIndicators(candles, scenario) {
  let scenarioCache = arbitrageIndicatorCache.get(candles);
  if (!scenarioCache) {
    scenarioCache = /* @__PURE__ */ new Map();
    arbitrageIndicatorCache.set(candles, scenarioCache);
  }
  const key = getMutableCandleCacheKey(candles, scenario);
  const cached = scenarioCache.get(key);
  if (cached) return cached;
  const closes = candles.map((candle) => candle.close);
  const returns = rateOfChange(closes, 1).map((value) => value ?? 0);
  const indicators = {
    returns
  };
  scenarioCache.set(key, indicators);
  return indicators;
}
function getMutableCandleCacheKey(candles, scenario) {
  return `${candles.length}:${candles[candles.length - 1]?.timestamp ?? 0}:${JSON.stringify(scenario.params)}`;
}

// src/strategies/averageDropCycle.ts
var averageDropCycleScenario = {
  id: "average-drop-cycle-5m-entry-0.5-stop-2.0-take-0.5",
  traderId: "general-e",
  name: "5m / entry-0.5% / stop-2.0% / take-0.5%",
  description: "Buy a drop from recent average price, then sell by average-based stop or take-profit.",
  params: {
    averageWindowCandles: 5,
    entryDropPct: 5e-3,
    entryRisePct: 0,
    avgStopPct: 0.02,
    avgTakeProfitPct: 5e-3
  }
};
var averageRiseCycleScenario = {
  id: "average-rise-cycle-5m-entry-0.2-stop-2.0-take-0.5",
  traderId: "general-e",
  name: "5m / rise-entry-0.2% / stop-2.0% / take-0.5%",
  description: "Buy a breakout above VWAP, exit when price drops from entry (stop) or rises further (take-profit).",
  params: {
    averageWindowCandles: 5,
    entryDropPct: 0,
    entryRisePct: 2e-3,
    avgStopPct: 0.02,
    avgTakeProfitPct: 5e-3
  }
};
var averageDropCycleScenarios = buildAverageDropCycleScenarios();
var averageDropCycleStrategy = {
  id: "general-e",
  name: "General-E Average Drop Cycle",
  description: "\uCD5C\uADFC \uD3C9\uADE0 \uAC70\uB798\uAC00\uACA9 \uB300\uBE44 \uAE09\uB77D \uAD6C\uAC04\uC5D0\uC11C \uB9E4\uC218\uD558\uACE0, \uBCF4\uC720 \uC911\uC5D0\uB294 \uD3C9\uADE0\uAC00\uACA9 \uAE30\uBC18 \uC190\uC808/\uC775\uC808 \uC870\uAC74\uC73C\uB85C \uBC18\uBCF5 \uB9E4\uB9E4\uD558\uB294 \uC804\uB7B5\uC785\uB2C8\uB2E4.",
  defaultScenario: averageDropCycleScenario,
  scenarios: averageDropCycleScenarios,
  decide(context, scenario = averageDropCycleScenario) {
    const { candles, candleIndex, position } = context;
    const current = candles[candleIndex];
    const averagePrice = getAverageTradePrice(candles, candleIndex, scenario.params.averageWindowCandles);
    if (averagePrice === null || averagePrice <= 0) return hold2("warming-up");
    const entryRisePct = scenario.params.entryRisePct ?? 0;
    const entryDropPct = scenario.params.entryDropPct;
    const isRiseMode = entryRisePct > 0;
    if (position) {
      if (isRiseMode) {
        if (current.close <= position.averagePrice * (1 - scenario.params.avgStopPct)) {
          return { action: "sell", confidence: 0.76, reasonCodes: ["rise-stop-loss"], targetWeight: 0 };
        }
        if (current.close >= position.averagePrice * (1 + scenario.params.avgTakeProfitPct)) {
          return { action: "sell", confidence: 0.72, reasonCodes: ["rise-take-profit"], targetWeight: 0 };
        }
      } else {
        if (averagePrice <= position.averagePrice * (1 - scenario.params.avgStopPct)) {
          return { action: "sell", confidence: 0.76, reasonCodes: ["average-below-entry-stop"], targetWeight: 0 };
        }
        if (current.close >= averagePrice * (1 + scenario.params.avgTakeProfitPct)) {
          return { action: "sell", confidence: 0.72, reasonCodes: ["price-above-average-take-profit"], targetWeight: 0 };
        }
      }
      return hold2("average-cycle-position-running");
    }
    if (isRiseMode && current.close >= averagePrice * (1 + entryRisePct)) {
      return {
        action: "buy",
        confidence: Math.min(0.9, 0.55 + entryRisePct * 5),
        reasonCodes: ["price-above-average-entry"],
        targetWeight: 0.65
      };
    }
    if (!isRiseMode && entryDropPct > 0 && current.close <= averagePrice * (1 - entryDropPct)) {
      return {
        action: "buy",
        confidence: Math.min(0.9, 0.55 + entryDropPct * 5),
        reasonCodes: ["price-below-average-entry"],
        targetWeight: 0.65
      };
    }
    return hold2("waiting-average-signal");
  }
};
function buildAverageDropCycleScenarios() {
  const scenarios = [];
  const averageWindows = [5, 10, 30, 60];
  const halfPctSteps = [0.5, 1, 1.5, 2];
  for (const averageWindowCandles of averageWindows) {
    for (const pct of halfPctSteps) {
      for (const avgStop of halfPctSteps) {
        for (const avgTake of halfPctSteps) {
          const p = pct.toFixed(1);
          const s = avgStop.toFixed(1);
          const t = avgTake.toFixed(1);
          scenarios.push({
            id: `average-drop-cycle-${averageWindowCandles}m-entry-${p}-stop-${s}-take-${t}`,
            traderId: "general-e",
            name: `${averageWindowCandles}m / drop-${p}% / stop-${s}% / take-${t}%`,
            description: "Drop mode: buy when price falls below VWAP.",
            params: {
              averageWindowCandles,
              entryDropPct: pct / 100,
              entryRisePct: 0,
              avgStopPct: avgStop / 100,
              avgTakeProfitPct: avgTake / 100
            }
          });
          scenarios.push({
            id: `average-rise-cycle-${averageWindowCandles}m-entry-${p}-stop-${s}-take-${t}`,
            traderId: "general-e",
            name: `${averageWindowCandles}m / rise-${p}% / stop-${s}% / take-${t}%`,
            description: "Rise mode: buy when price breaks above VWAP (momentum/breakout entry).",
            params: {
              averageWindowCandles,
              entryDropPct: 0,
              entryRisePct: pct / 100,
              avgStopPct: avgStop / 100,
              avgTakeProfitPct: avgTake / 100
            }
          });
        }
      }
    }
  }
  return scenarios;
}
function getAverageTradePrice(candles, candleIndex, windowCandles) {
  return getAverageTradePrices(candles, windowCandles)[candleIndex] ?? null;
}
var averagePriceCache = /* @__PURE__ */ new WeakMap();
function getAverageTradePrices(candles, windowCandles) {
  let byWindow = averagePriceCache.get(candles);
  if (!byWindow) {
    byWindow = /* @__PURE__ */ new Map();
    averagePriceCache.set(candles, byWindow);
  }
  const window = Math.max(1, windowCandles);
  const key = `${window}:${candles.length}:${candles[candles.length - 1]?.timestamp ?? 0}`;
  const cached = byWindow.get(key);
  if (cached) return cached;
  const averages = [];
  let volumeSum = 0;
  let quoteVolumeSum = 0;
  let closeSum = 0;
  for (let index = 0; index < candles.length; index += 1) {
    if (index < window) {
      averages.push(null);
    } else {
      averages.push(volumeSum > 0 && quoteVolumeSum > 0 ? quoteVolumeSum / volumeSum : closeSum / window);
    }
    const current = candles[index];
    volumeSum += current.volume;
    quoteVolumeSum += current.quoteVolume;
    closeSum += current.close;
    if (index >= window) {
      const removed = candles[index - window];
      volumeSum -= removed.volume;
      quoteVolumeSum -= removed.quoteVolume;
      closeSum -= removed.close;
    }
  }
  byWindow.set(key, averages);
  return averages;
}
function hold2(reason) {
  return { action: "hold", confidence: 0, reasonCodes: [reason], targetWeight: 0 };
}

// src/strategies/rangeGrid.ts
var rangeGridScenario = {
  id: "range-grid-default",
  traderId: "range-grid",
  name: "Bollinger range grid",
  description: "Sideways-market Bollinger lower-band entry with mean-reversion exit.",
  params: {
    period: 20,
    deviations: 2,
    rsiPeriod: 14,
    rsiMaxEntry: 38,
    bandWidthMax: 0.08,
    stopLossPct: 0.04,
    takeProfitPct: 0.035,
    maxHoldCandles: 36,
    minProfitPct: 5e-3
    // exit only when return >= 0.5% (time-based exit always fires)
  }
};
var rangeGridScenarios = [
  {
    ...rangeGridScenario,
    id: "range-grid-balanced",
    name: "Balanced range grid"
  },
  {
    ...rangeGridScenario,
    id: "range-grid-tight",
    name: "Tight range grid",
    params: {
      ...rangeGridScenario.params,
      deviations: 1.8,
      rsiMaxEntry: 42,
      bandWidthMax: 0.055,
      takeProfitPct: 0.025,
      stopLossPct: 0.03,
      maxHoldCandles: 24
    }
  },
  {
    ...rangeGridScenario,
    id: "range-grid-deep",
    name: "Deep oversold grid",
    params: {
      ...rangeGridScenario.params,
      deviations: 2.3,
      rsiMaxEntry: 32,
      bandWidthMax: 0.1,
      takeProfitPct: 0.05,
      stopLossPct: 0.055,
      maxHoldCandles: 48
    }
  }
];
var rangeGridStrategy = {
  id: "range-grid",
  name: "Range / Grid Mean Reversion",
  description: "\uD6A1\uBCF4\uC7A5\uC5D0\uC11C\uB294 \uACFC\uB9E4\uB3C4 \uAD6C\uAC04\uC744 \uC0AC\uACE0 \uD3C9\uADE0 \uD68C\uADC0 \uC2DC \uCCAD\uC0B0\uD569\uB2C8\uB2E4.",
  defaultScenario: rangeGridScenario,
  scenarios: rangeGridScenarios,
  decide(context, scenario = rangeGridScenario) {
    const { candles, candleIndex, position } = context;
    const current = candles[candleIndex];
    const indicators = getRangeGridIndicators(candles, scenario);
    const band = indicators.bands[candleIndex];
    const currentRsi = indicators.rsiValues[candleIndex];
    if (band == null || currentRsi === null) return hold3("warming-up");
    if (position) {
      const isTimeExit = position.holdCandles >= scenario.params.maxHoldCandles;
      const isMeanReversionExit = current.close >= band.middle;
      if (isTimeExit || isMeanReversionExit) {
        const minProfitPct = scenario.params.minProfitPct ?? 0;
        const returnPct = (current.close - position.averagePrice) / position.averagePrice;
        if (!isTimeExit && minProfitPct > 0 && returnPct < minProfitPct) {
          return hold3("min-profit-wait");
        }
        return { action: "sell", confidence: 0.66, reasonCodes: ["mean-reversion-exit"], targetWeight: 0 };
      }
      return hold3("range-position-running");
    }
    const isSideways = band.widthPct <= scenario.params.bandWidthMax;
    const isOversold = current.close <= band.lower && currentRsi <= scenario.params.rsiMaxEntry;
    if (isSideways && isOversold) {
      return {
        action: "buy",
        confidence: 0.64,
        reasonCodes: ["sideways-regime", "lower-band-touch", "rsi-oversold"],
        targetWeight: 0.65,
        stopLossPct: scenario.params.stopLossPct,
        takeProfitPct: scenario.params.takeProfitPct,
        maxHoldCandles: scenario.params.maxHoldCandles
      };
    }
    return hold3("no-range-entry");
  }
};
function hold3(reason) {
  return { action: "hold", confidence: 0, reasonCodes: [reason], targetWeight: 0 };
}
var rangeGridIndicatorCache = /* @__PURE__ */ new WeakMap();
function getRangeGridIndicators(candles, scenario) {
  let scenarioCache = rangeGridIndicatorCache.get(candles);
  if (!scenarioCache) {
    scenarioCache = /* @__PURE__ */ new Map();
    rangeGridIndicatorCache.set(candles, scenarioCache);
  }
  const key = getMutableCandleCacheKey2(candles, scenario);
  const cached = scenarioCache.get(key);
  if (cached) return cached;
  const closes = candles.map((candle) => candle.close);
  const indicators = {
    bands: bollinger(closes, scenario.params.period, scenario.params.deviations),
    rsiValues: rsi(closes, scenario.params.rsiPeriod)
  };
  scenarioCache.set(key, indicators);
  return indicators;
}
function getMutableCandleCacheKey2(candles, scenario) {
  return `${candles.length}:${candles[candles.length - 1]?.timestamp ?? 0}:${JSON.stringify(scenario.params)}`;
}

// src/strategies/generalSum.ts
var generalSumScenario = {
  id: "general-sum-balanced",
  traderId: "general-sum",
  name: "Balanced regime router",
  description: "\uCF54\uC778\uBCC4 \uCD94\uC138\uB97C \uAC10\uC9C0\uD558\uACE0 \uC0C1\uC2B9(A)/\uD6A1\uBCF4(B)/\uACFC\uB9E4\uB3C4(E)/\uD3C9\uADE0\uD68C\uADC0(C) \uC804\uB7B5\uC73C\uB85C \uC790\uB3D9 \uB77C\uC6B0\uD305\uD569\uB2C8\uB2E4.",
  params: {
    fastEma: 12,
    slowEma: 48,
    rsiPeriod: 14,
    bollPeriod: 20,
    bollDeviations: 2,
    trendSlopeLookback: 12,
    uptrendSlopePct: 8e-3,
    downtrendSlopePct: 8e-3,
    sidewaysBandWidthMax: 0.07,
    oversoldRsiMax: 35
  }
};
var generalSumScenarios = [
  generalSumScenario,
  {
    ...generalSumScenario,
    id: "general-sum-sensitive",
    name: "Sensitive regime router",
    params: {
      ...generalSumScenario.params,
      fastEma: 8,
      slowEma: 34,
      trendSlopeLookback: 8,
      uptrendSlopePct: 5e-3,
      downtrendSlopePct: 5e-3,
      sidewaysBandWidthMax: 0.08,
      oversoldRsiMax: 38
    }
  },
  {
    ...generalSumScenario,
    id: "general-sum-conservative",
    name: "Conservative regime router",
    params: {
      ...generalSumScenario.params,
      fastEma: 20,
      slowEma: 60,
      trendSlopeLookback: 20,
      uptrendSlopePct: 0.012,
      downtrendSlopePct: 0.012,
      sidewaysBandWidthMax: 0.06,
      oversoldRsiMax: 30
    }
  }
];
var generalSumStrategy = {
  id: "general-sum",
  name: "General-Sum Regime Router",
  description: "\uCF54\uC778\uBCC4\uB85C \uD604\uC7AC \uCD94\uC138(\uC0C1\uC2B9/\uD6A1\uBCF4/\uACFC\uB9E4\uB3C4/\uD3C9\uADE0\uD68C\uADC0/\uD558\uB77D)\uB97C \uAC10\uC9C0\uD558\uACE0 \uAC00\uC7A5 \uC801\uD569\uD55C \uC804\uB7B5(A~E)\uC73C\uB85C \uC790\uB3D9 \uC804\uD658\uD569\uB2C8\uB2E4. \uCF54\uC778 \uC120\uD0DD\uC740 \uC5EC\uB7EC \uC804\uB7B5\uC5D0 \uC911\uBCF5 \uB4F1\uC7A5\uD55C \uC885\uBAA9\uC744 \uC6B0\uC120\uD569\uB2C8\uB2E4.",
  defaultScenario: generalSumScenario,
  scenarios: generalSumScenarios,
  decide(context, scenario = generalSumScenario) {
    const { candles, candleIndex, position } = context;
    const params = scenario.params;
    const indicators = getSumIndicators(candles, scenario);
    const fast = indicators.fast[candleIndex];
    const slow = indicators.slow[candleIndex];
    const slowPrev = indicators.slow[Math.max(0, candleIndex - params.trendSlopeLookback)];
    const band = indicators.bands[candleIndex];
    const currentRsi = indicators.rsiValues[candleIndex];
    if (fast === null || slow === null || slowPrev === null || slowPrev === 0 || band === null || currentRsi === null) {
      return hold4("warming-up");
    }
    const slowSlope = (slow - slowPrev) / slowPrev;
    const regime = detectRegime(fast, slow, slowSlope, band.widthPct, currentRsi, params);
    if (regime === "downtrend") {
      if (position) {
        return { action: "sell", confidence: 0.72, reasonCodes: ["sum-downtrend-exit"], targetWeight: 0 };
      }
      return hold4("sum-downtrend-blocked");
    }
    const sub = getSubStrategyForRegime(regime);
    const decision = sub.strategy.decide(context, sub.scenario);
    return {
      ...decision,
      reasonCodes: [...decision.reasonCodes, `sum-regime:${regime}`]
    };
  }
};
function detectRegime(fast, slow, slowSlope, bandWidthPct, currentRsi, params) {
  const { uptrendSlopePct, downtrendSlopePct, sidewaysBandWidthMax, oversoldRsiMax } = params;
  if (currentRsi <= oversoldRsiMax) return "oversold";
  if (fast > slow && slowSlope >= uptrendSlopePct) return "uptrend";
  if (fast < slow && slowSlope <= -downtrendSlopePct) return "downtrend";
  if (bandWidthPct <= sidewaysBandWidthMax && Math.abs(slowSlope) < uptrendSlopePct) return "sideways";
  return "mean-reversion";
}
function getSubStrategyForRegime(regime) {
  switch (regime) {
    case "uptrend":
      return { strategy: averageDropCycleStrategy, scenario: averageRiseCycleScenario };
    case "sideways":
      return { strategy: rangeGridStrategy, scenario: rangeGridScenario };
    case "oversold":
      return { strategy: averageDropCycleStrategy, scenario: averageDropCycleScenario };
    case "mean-reversion":
    default:
      return { strategy: arbitrageStrategy, scenario: arbitrageScenario };
  }
}
function hold4(reason) {
  return { action: "hold", confidence: 0, reasonCodes: [reason], targetWeight: 0 };
}
var sumIndicatorCache = /* @__PURE__ */ new WeakMap();
function getSumIndicators(candles, scenario) {
  let scenarioCache = sumIndicatorCache.get(candles);
  if (!scenarioCache) {
    scenarioCache = /* @__PURE__ */ new Map();
    sumIndicatorCache.set(candles, scenarioCache);
  }
  const key = `${candles.length}:${candles[candles.length - 1]?.timestamp ?? 0}:${JSON.stringify(scenario.params)}`;
  const cached = scenarioCache.get(key);
  if (cached) return cached;
  const closes = candles.map((c) => c.close);
  const indicators = {
    fast: ema(closes, scenario.params.fastEma),
    slow: ema(closes, scenario.params.slowEma),
    bands: bollinger(closes, scenario.params.bollPeriod, scenario.params.bollDeviations),
    rsiValues: rsi(closes, scenario.params.rsiPeriod)
  };
  scenarioCache.set(key, indicators);
  return indicators;
}

// src/strategies/momentum.ts
var EXCLUDED_MARKETS = /* @__PURE__ */ new Set(["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-USDT", "KRW-USDC"]);
var momentumScenario = {
  id: "momentum-default",
  traderId: "momentum",
  name: "Regime-filtered momentum",
  description: "EMA trend, RSI, MACD, volume confirmation, fast-EMA exit, and partial profit taking.",
  params: {
    fastEma: 12,
    slowEma: 48,
    rsiPeriod: 14,
    rsiMin: 54,
    volumeLookback: 24,
    volumeMultiplier: 0.8,
    // B: lowered from 1.15 — volume spike is lagging/peak signal
    atrPeriod: 14,
    maxAtrPct: 0.08,
    stopLossPct: 0.035,
    trailingStopPct: 0.045,
    exitRsiMin: 50,
    // A: exit at RSI midline (faster than 48)
    profitTargetPct: 0.03,
    // D: take partial profit at 3%
    profitTargetWeight: 0.5,
    // D: keep 50% after partial profit
    minHoldBars: 30
    // minimum candles before signal-based exit is allowed
  }
};
var momentumScenarios = [
  {
    ...momentumScenario,
    id: "momentum-balanced",
    name: "Balanced momentum"
  },
  {
    ...momentumScenario,
    id: "momentum-fast",
    name: "Fast momentum",
    params: {
      ...momentumScenario.params,
      fastEma: 8,
      slowEma: 34,
      rsiMin: 52,
      volumeMultiplier: 0.7,
      stopLossPct: 0.03,
      trailingStopPct: 0.035,
      exitRsiMin: 50,
      profitTargetPct: 0.025,
      profitTargetWeight: 0.5,
      minHoldBars: 15
    }
  },
  {
    ...momentumScenario,
    id: "momentum-strict",
    name: "Strict momentum",
    params: {
      ...momentumScenario.params,
      fastEma: 20,
      slowEma: 60,
      rsiMin: 58,
      volumeMultiplier: 1.1,
      stopLossPct: 0.025,
      trailingStopPct: 0.04,
      exitRsiMin: 50,
      profitTargetPct: 0.04,
      profitTargetWeight: 0.5,
      minHoldBars: 20
    }
  },
  {
    ...momentumScenario,
    id: "momentum-wide-trail",
    name: "Wide-trail momentum",
    params: {
      ...momentumScenario.params,
      rsiMin: 55,
      volumeMultiplier: 0.7,
      stopLossPct: 0.045,
      trailingStopPct: 0.07,
      exitRsiMin: 50,
      profitTargetPct: 0.05,
      profitTargetWeight: 0.5,
      minHoldBars: 30
    }
  },
  {
    // All indicators scaled to 1h equivalent on 1m candles
    id: "momentum-1h",
    traderId: "momentum",
    name: "Hourly momentum (60/240)",
    description: "All indicator periods scaled to 1h chart equivalent \u2014 suppresses 1m noise.",
    params: {
      fastEma: 60,
      slowEma: 240,
      rsiPeriod: 60,
      // 1h of data for RSI
      rsiMin: 54,
      volumeLookback: 60,
      volumeMultiplier: 0.8,
      atrPeriod: 60,
      maxAtrPct: 0.08,
      stopLossPct: 0.03,
      trailingStopPct: 0.05,
      exitRsiMin: 50,
      macdFast: 60,
      macdSlow: 240,
      macdSignal: 20,
      profitTargetPct: 0.04,
      profitTargetWeight: 0.5,
      minHoldBars: 60
    }
  },
  {
    // All indicators scaled to 30min equivalent on 1m candles
    id: "momentum-30m",
    traderId: "momentum",
    name: "30min momentum (30/120)",
    description: "All indicator periods scaled to 30m chart equivalent \u2014 moderate noise filter.",
    params: {
      fastEma: 30,
      slowEma: 120,
      rsiPeriod: 30,
      // 30min of data for RSI
      rsiMin: 54,
      volumeLookback: 30,
      volumeMultiplier: 0.8,
      atrPeriod: 30,
      maxAtrPct: 0.08,
      stopLossPct: 0.03,
      trailingStopPct: 0.045,
      exitRsiMin: 50,
      macdFast: 30,
      macdSlow: 120,
      macdSignal: 10,
      profitTargetPct: 0.035,
      profitTargetWeight: 0.5,
      minHoldBars: 30
    }
  },
  {
    // All indicators scaled to 2h equivalent on 1m candles
    id: "momentum-2h",
    traderId: "momentum",
    name: "2h momentum (120/480)",
    description: "All indicator periods scaled to 2h chart equivalent \u2014 strongest noise filter.",
    params: {
      fastEma: 120,
      slowEma: 480,
      rsiPeriod: 120,
      // 2h of data for RSI
      rsiMin: 52,
      volumeLookback: 120,
      volumeMultiplier: 0.8,
      atrPeriod: 120,
      maxAtrPct: 0.1,
      stopLossPct: 0.04,
      trailingStopPct: 0.06,
      exitRsiMin: 48,
      macdFast: 120,
      macdSlow: 480,
      macdSignal: 40,
      profitTargetPct: 0.05,
      profitTargetWeight: 0.5,
      minHoldBars: 120
    }
  },
  {
    // C: Pullback entry — enters on dip to fast EMA within established slow-EMA uptrend
    id: "momentum-pullback",
    traderId: "momentum",
    name: "Pullback momentum",
    description: "Enters when price bounces off fast EMA within a slow-EMA uptrend. Avoids overbought entries.",
    params: {
      fastEma: 12,
      slowEma: 48,
      rsiPeriod: 14,
      rsiMin: 45,
      // C: lower threshold — pullback depresses RSI
      rsiMax: 62,
      // C: avoid overbought entries
      volumeLookback: 24,
      volumeMultiplier: 0.7,
      atrPeriod: 14,
      maxAtrPct: 0.08,
      stopLossPct: 0.025,
      // C: tighter stop — entry near support
      trailingStopPct: 0.04,
      exitRsiMin: 50,
      exitEmaBuffer: 5e-3,
      // C: 0.5% below fast EMA before exiting — avoids whipsaw on entry
      profitTargetPct: 0.03,
      profitTargetWeight: 0.5,
      minHoldBars: 20,
      pullbackEntry: 1
      // flag: use pullback entry logic
    }
  }
];
var momentumStrategy = {
  id: "momentum",
  name: "Momentum / Trend Following",
  description: "\uC0C1\uC2B9 \uCD94\uC138\uAC00 \uD655\uC778\uB41C KRW \uB9C8\uCF13\uB9CC \uC9C4\uC785\uD558\uACE0 \uCD94\uC138 \uC57D\uD654 \uC2DC \uBE60\uB974\uAC8C \uC774\uD0C8\uD569\uB2C8\uB2E4.",
  defaultScenario: momentumScenario,
  scenarios: momentumScenarios,
  excludedMarkets: EXCLUDED_MARKETS,
  decide(context, scenario = momentumScenario) {
    if (EXCLUDED_MARKETS.has(context.market)) {
      return hold5("excluded-market");
    }
    const { candles, candleIndex, position } = context;
    const params = scenario.params;
    const current = candles[candleIndex];
    const prev = candleIndex > 0 ? candles[candleIndex - 1] : null;
    const indicators = getMomentumIndicators(candles, scenario);
    const fast = indicators.fast[candleIndex];
    const slow = indicators.slow[candleIndex];
    const currentRsi = indicators.rsiValues[candleIndex];
    const currentMacd = indicators.macdHistogram[candleIndex];
    const currentAtr = indicators.atr[candleIndex];
    const volumeWindow = indicators.volumes.slice(
      Math.max(0, candleIndex - params.volumeLookback),
      candleIndex
    );
    const averageVolume = volumeWindow.length === 0 ? current.volume : volumeWindow.reduce((sum, value) => sum + value, 0) / volumeWindow.length;
    if (fast === null || slow === null || currentRsi === null || currentMacd === null || currentAtr === null) {
      return hold5("warming-up");
    }
    const atrPct = currentAtr / current.close;
    const exitRsiMin = params.exitRsiMin ?? 48;
    const exitEmaBuffer = params.exitEmaBuffer ?? 0;
    if (position) {
      const profitTargetPct = params.profitTargetPct ?? 0;
      if (profitTargetPct > 0 && !position.partialProfitTaken) {
        const returnPct = (current.close - position.averagePrice) / position.averagePrice;
        if (returnPct >= profitTargetPct) {
          return {
            action: "sell",
            confidence: 0.8,
            reasonCodes: ["partial-profit"],
            targetWeight: params.profitTargetWeight ?? 0.5
          };
        }
      }
      const minHoldBars = params.minHoldBars ?? 0;
      if (position.holdCandles < minHoldBars) {
        return hold5("min-hold-period");
      }
      const trendFailed = fast < slow || current.close < fast * (1 - exitEmaBuffer);
      const momentumFailed = currentRsi < exitRsiMin;
      if (trendFailed || momentumFailed) {
        return sell(["momentum-exit", trendFailed ? "trend-failed" : "momentum-failed"]);
      }
      return hold5("position-running");
    }
    const volumeConfirmed = current.volume >= averageVolume * params.volumeMultiplier;
    const uptrend = fast > slow && current.close > slow;
    if (params.pullbackEntry) {
      const rsiMax = params.rsiMax ?? 65;
      const prevFast = prev !== null ? indicators.fast[candleIndex - 1] : null;
      const bouncingOffFast = current.close > fast && current.close <= fast * 1.02 && prevFast !== null && prev !== null && prev.close <= prevFast * 1.005;
      const rsiInRange = currentRsi >= params.rsiMin && currentRsi <= rsiMax;
      if (uptrend && bouncingOffFast && rsiInRange && volumeConfirmed && atrPct < params.maxAtrPct) {
        return {
          action: "buy",
          confidence: 0.8,
          reasonCodes: ["pullback-entry", "near-fast-ema", "rsi-in-range"],
          targetWeight: 0.95,
          stopLossPct: params.stopLossPct,
          trailingStopPct: params.trailingStopPct
        };
      }
    } else {
      const trendUp = fast > slow && current.close > fast;
      const momentumUp = currentRsi >= params.rsiMin && currentMacd > 0;
      if (trendUp && momentumUp && volumeConfirmed && atrPct < params.maxAtrPct) {
        return {
          action: "buy",
          confidence: 0.78,
          reasonCodes: ["trend-up", "rsi-confirmed", "macd-positive", "volume-confirmed"],
          targetWeight: 0.95,
          stopLossPct: params.stopLossPct,
          trailingStopPct: params.trailingStopPct
        };
      }
    }
    return hold5("no-entry");
  }
};
function hold5(reason) {
  return { action: "hold", confidence: 0, reasonCodes: [reason], targetWeight: 0 };
}
function sell(reasonCodes) {
  return { action: "sell", confidence: 0.7, reasonCodes, targetWeight: 0 };
}
var momentumIndicatorCache = /* @__PURE__ */ new WeakMap();
function getMomentumIndicators(candles, scenario) {
  let scenarioCache = momentumIndicatorCache.get(candles);
  if (!scenarioCache) {
    scenarioCache = /* @__PURE__ */ new Map();
    momentumIndicatorCache.set(candles, scenarioCache);
  }
  const key = getMutableCandleCacheKey3(candles, scenario);
  const cached = scenarioCache.get(key);
  if (cached) return cached;
  const closes = candles.map((candle) => candle.close);
  const macdFast = scenario.params.macdFast ?? 12;
  const macdSlow = scenario.params.macdSlow ?? 26;
  const macdSignal = scenario.params.macdSignal ?? 9;
  const indicators = {
    volumes: candles.map((candle) => candle.volume),
    fast: ema(closes, scenario.params.fastEma),
    slow: ema(closes, scenario.params.slowEma),
    rsiValues: rsi(closes, scenario.params.rsiPeriod),
    macdHistogram: macd(closes, macdFast, macdSlow, macdSignal).histogram,
    atr: averageTrueRange(candles, scenario.params.atrPeriod)
  };
  scenarioCache.set(key, indicators);
  return indicators;
}
function getMutableCandleCacheKey3(candles, scenario) {
  return `${candles.length}:${candles[candles.length - 1]?.timestamp ?? 0}:${JSON.stringify(scenario.params)}`;
}

// src/strategies/rangeReentry.ts
var rangeReentryScenario = {
  id: "range-reentry-balanced",
  traderId: "general-d",
  name: "Balanced re-entry",
  description: "General-B range logic with profit-target exits and sell-price pullback re-entry.",
  params: {
    period: 20,
    deviations: 2,
    rsiPeriod: 14,
    rsiMaxEntry: 40,
    bandWidthMax: 0.075,
    fastEma: 12,
    slowEma: 48,
    trendSlopeLookback: 12,
    maxTrendSlopePct: 0.012,
    pullbackPct: 0.012,
    profitTargetPct: 0.025,
    reentryDropPct: 0.025,
    trailingStopAfterProfitPct: 0.012,
    emergencyStopPct: 0.04
  }
};
var rangeReentryScenarios = [
  rangeReentryScenario,
  {
    ...rangeReentryScenario,
    id: "range-reentry-tight-box",
    name: "Tight box re-entry",
    params: {
      ...rangeReentryScenario.params,
      deviations: 1.8,
      rsiMaxEntry: 43,
      bandWidthMax: 0.055,
      pullbackPct: 9e-3,
      trailingStopAfterProfitPct: 9e-3,
      emergencyStopPct: 0.032
    }
  },
  {
    ...rangeReentryScenario,
    id: "range-reentry-deep-pullback",
    name: "Deep pullback re-entry",
    params: {
      ...rangeReentryScenario.params,
      deviations: 2.25,
      rsiMaxEntry: 35,
      bandWidthMax: 0.095,
      pullbackPct: 0.018,
      profitTargetPct: 0.03,
      reentryDropPct: 0.03,
      trailingStopAfterProfitPct: 0.015,
      emergencyStopPct: 0.05
    }
  },
  {
    ...rangeReentryScenario,
    id: "range-reentry-fast-cycle",
    name: "Fast cycle re-entry",
    params: {
      ...rangeReentryScenario.params,
      period: 14,
      fastEma: 8,
      slowEma: 34,
      trendSlopeLookback: 8,
      rsiMaxEntry: 45,
      bandWidthMax: 0.065,
      profitTargetPct: 0.025,
      reentryDropPct: 0.022,
      trailingStopAfterProfitPct: 0.01,
      emergencyStopPct: 0.035
    }
  },
  {
    ...rangeReentryScenario,
    id: "range-reentry-trend-ride",
    name: "Trend-ride re-entry",
    params: {
      ...rangeReentryScenario.params,
      rsiMaxEntry: 48,
      bandWidthMax: 0.09,
      pullbackPct: 8e-3,
      maxTrendSlopePct: 8e-3,
      profitTargetPct: 0.025,
      reentryDropPct: 0.025,
      trailingStopAfterProfitPct: 0.02,
      emergencyStopPct: 0.045
    }
  }
];
var rangeReentryStrategy = {
  id: "general-d",
  name: "General-D Range Re-entry",
  description: "General-B \uAE30\uBC18\uC73C\uB85C \uBC15\uC2A4\uAD8C \uC7AC\uC9C4\uC785\uC744 \uB178\uB9AC\uACE0, +2.5% \uC774\uC775 \uAD6C\uAC04 \uC774\uD6C4 \uCD94\uC138\uB294 \uD2B8\uB808\uC77C\uB9C1\uC73C\uB85C \uB530\uB77C\uAC00\uBA70 \uD558\uB77D \uCD94\uC138 \uC9C4\uC785\uC740 \uCC28\uB2E8\uD569\uB2C8\uB2E4.",
  defaultScenario: rangeReentryScenario,
  scenarios: rangeReentryScenarios,
  decide(context, scenario = rangeReentryScenario) {
    const { candles, candleIndex, lastSellPrice, position } = context;
    const current = candles[candleIndex];
    const indicators = getRangeReentryIndicators(candles, scenario);
    const band = indicators.bands[candleIndex];
    const currentRsi = indicators.rsiValues[candleIndex];
    const fast = indicators.fast[candleIndex];
    const slow = indicators.slow[candleIndex];
    const slowPast = indicators.slow[Math.max(0, candleIndex - scenario.params.trendSlopeLookback)];
    if (band === null || currentRsi === null || fast === null || slow === null || slowPast === null || slowPast === 0) {
      return hold6("warming-up");
    }
    const slowSlope = (slow - slowPast) / slowPast;
    const sideways = Math.abs(slowSlope) <= scenario.params.maxTrendSlopePct && band.widthPct <= scenario.params.bandWidthMax;
    const uptrend = fast > slow && slowSlope > scenario.params.maxTrendSlopePct;
    const downtrend = fast < slow && slowSlope < -scenario.params.maxTrendSlopePct;
    if (position) {
      const gainFromEntry = (current.close - position.averagePrice) / position.averagePrice;
      const lowFromEntry = (current.low - position.averagePrice) / position.averagePrice;
      const targetReached = position.highestPrice >= position.averagePrice * (1 + scenario.params.profitTargetPct);
      const trailingStop = position.highestPrice * (1 - scenario.params.trailingStopAfterProfitPct);
      if (lowFromEntry <= -scenario.params.emergencyStopPct || gainFromEntry <= -scenario.params.emergencyStopPct) {
        return sell2([downtrend ? "emergency-downtrend-exit" : "emergency-stop-exit"]);
      }
      if (targetReached && uptrend && current.close <= trailingStop) {
        return sell2(["profit-target-trailing-exit"]);
      }
      if (gainFromEntry >= scenario.params.profitTargetPct && !uptrend) {
        return sell2(["profit-target-exit"]);
      }
      return hold6(targetReached ? "profit-target-trailing" : "waiting-profit-target");
    }
    if (downtrend) return hold6("downtrend-entry-blocked");
    const rangeEntry = sideways && current.close <= band.lower && currentRsi <= scenario.params.rsiMaxEntry;
    const uptrendPullbackEntry = uptrend && current.close <= fast * (1 - scenario.params.pullbackPct) && currentRsi <= Math.max(scenario.params.rsiMaxEntry, 52);
    if (rangeEntry || uptrendPullbackEntry) {
      return {
        action: "buy",
        confidence: rangeEntry ? 0.66 : 0.6,
        reasonCodes: rangeEntry ? ["box-regime", "lower-band-touch", "rsi-oversold", "reentry-allowed"] : ["uptrend-pullback", "ema-pullback", "reentry-allowed"],
        targetWeight: 0.65
      };
    }
    return hold6("no-reentry-setup");
  }
};
function hold6(reason) {
  return { action: "hold", confidence: 0, reasonCodes: [reason], targetWeight: 0 };
}
function sell2(reasonCodes) {
  return { action: "sell", confidence: 0.68, reasonCodes, targetWeight: 0 };
}
var rangeReentryIndicatorCache = /* @__PURE__ */ new WeakMap();
function getRangeReentryIndicators(candles, scenario) {
  let scenarioCache = rangeReentryIndicatorCache.get(candles);
  if (!scenarioCache) {
    scenarioCache = /* @__PURE__ */ new Map();
    rangeReentryIndicatorCache.set(candles, scenarioCache);
  }
  const key = getMutableCandleCacheKey4(candles, scenario);
  const cached = scenarioCache.get(key);
  if (cached) return cached;
  const closes = candles.map((candle) => candle.close);
  const indicators = {
    bands: bollinger(closes, scenario.params.period, scenario.params.deviations),
    fast: ema(closes, scenario.params.fastEma),
    rsiValues: rsi(closes, scenario.params.rsiPeriod),
    slow: ema(closes, scenario.params.slowEma)
  };
  scenarioCache.set(key, indicators);
  return indicators;
}
function getMutableCandleCacheKey4(candles, scenario) {
  return `${candles.length}:${candles[candles.length - 1]?.timestamp ?? 0}:${JSON.stringify(scenario.params)}`;
}

// src/strategies/index.ts
var strategies = [
  momentumStrategy,
  rangeGridStrategy,
  arbitrageStrategy,
  rangeReentryStrategy,
  averageDropCycleStrategy
];

// scripts/ws-live.ts
var root = process.cwd();
var cachePath = path.join(root, "data", "market", "upbit-krw-1m-daily.json");
var outputDir = path.join(root, "public", "market");
var outputPath = path.join(outputDir, "ws-live-results.json");
var wsUrl = "wss://api.upbit.com/websocket/v1";
var outputIntervalMs = 5e3;
var reconnectDelayMs = 5e3;
var closeProcessDelayMs = 1500;
var maxCandles = Number(process.env.WS_MAX_CANDLES ?? process.env.PAPER_MAX_CANDLES ?? 1440);
var guideModes = ["strict", "ignored"];
var safetyModes = ["enabled", "disabled"];
var modes = ["wsO", "wsX"];
var selectedMarkets = [];
var operationStartAt;
var connectedAt = "";
var totalTicks = 0;
var wsStatus = "connecting";
var activeWs = null;
var closedCandles = {};
var liveCandle = {};
var lastMinute = {};
var closeTimers = /* @__PURE__ */ new Map();
var intraminuteTradeLocks = /* @__PURE__ */ new Set();
var plans = {
  strict: {},
  ignored: {}
};
var sessions = makeSessionStore();
async function init() {
  const cache = await loadMarketCache();
  operationStartAt = parseBoundary(cache.retentionPolicy?.operationStartAt ?? cache.retentionPolicy?.resetFrom);
  await loadPlans();
  selectedMarkets = getPlanMarkets();
  if (selectedMarkets.length === 0) {
    selectedMarkets = cache.selectedMarkets?.length ? cache.selectedMarkets : Object.keys(cache.candlesByMarket);
  }
  seedClosedCandles(cache);
  seedSessions();
  await writeOutput();
  connect();
  setInterval(() => {
    writeOutput().catch((error) => console.error("[ws-live] output failed", error));
  }, outputIntervalMs);
  setInterval(logStatus, 6e4);
  console.log(`[ws-live] Results: ${path.relative(root, outputPath)}`);
}
function getPlanMarkets() {
  const markets = /* @__PURE__ */ new Set();
  for (const guideRuleMode of guideModes) {
    for (const strategy of [...strategies, generalSumStrategy]) {
      const plan = plans[guideRuleMode][strategy.id];
      for (const item of plan?.selectedMarkets ?? []) markets.add(item.market);
    }
  }
  return [...markets].sort();
}
async function loadMarketCache() {
  const cache = JSON.parse(await readFile(cachePath, "utf8"));
  if (!cache.candlesByMarket || Object.keys(cache.candlesByMarket).length === 0) {
    throw new Error(`No candles found in ${path.relative(root, cachePath)}`);
  }
  return cache;
}
async function loadPlans() {
  for (const strategy of strategies) {
    for (const guideRuleMode of guideModes) {
      const planPath = path.join(
        root,
        "data",
        "local",
        "traders",
        strategy.id,
        "scenarios",
        `optimization-${guideRuleMode}.json`
      );
      let payload;
      try {
        payload = JSON.parse(await readFile(planPath, "utf8"));
      } catch {
        throw new Error(`ws-live: plan file not found or unreadable: ${planPath}
Run 'npm run persist:traders' first.`);
      }
      plans[guideRuleMode][strategy.id] = payload.plan;
    }
  }
  for (const guideRuleMode of guideModes) {
    const planPath = path.join(
      root,
      "data",
      "local",
      "traders",
      generalSumStrategy.id,
      "scenarios",
      `optimization-${guideRuleMode}.json`
    );
    try {
      const payload = JSON.parse(await readFile(planPath, "utf8"));
      plans[guideRuleMode][generalSumStrategy.id] = payload.plan;
    } catch {
    }
  }
}
function seedClosedCandles(cache) {
  for (const market of selectedMarkets) {
    closedCandles[market] = (cache.candlesByMarket[market] ?? []).slice(-maxCandles);
  }
}
function seedSessions() {
  const allStrategies = [...strategies, generalSumStrategy];
  for (const mode of modes) {
    for (const guideRuleMode of guideModes) {
      for (const autoBlockMode of safetyModes) {
        for (const strategy of allStrategies) {
          const plan = plans[guideRuleMode][strategy.id];
          if (!plan) continue;
          const session = new PaperTradingSession(strategy, plan, {
            guideRuleMode,
            autoBlockMode,
            maxCandles
          });
          replaySession(session, strategy, plan, guideRuleMode, autoBlockMode);
          sessions[mode][guideRuleMode][autoBlockMode][strategy.id] = session;
        }
      }
    }
  }
}
function replaySession(session, strategy, plan, guideRuleMode, autoBlockMode) {
  void strategy;
  void guideRuleMode;
  void autoBlockMode;
  const selectedCandles = plan.selectedMarkets.map((item) => closedCandles[item.market] ?? []);
  for (const timestamp of getSimulationTimestamps(selectedCandles).filter((candidate) => operationStartAt === void 0 || candidate >= operationStartAt).slice(-maxCandles)) {
    session.step(timestamp, closedCandles);
  }
}
function getSimulationTimestamps(candleSets) {
  const timestamps = /* @__PURE__ */ new Set();
  for (const candles of candleSets) {
    for (const candle of candles) timestamps.add(candle.timestamp);
  }
  return [...timestamps].sort((a, b) => a - b);
}
function connect() {
  wsStatus = "connecting";
  console.log(`[ws-live] Connecting to ${wsUrl}`);
  const ws = new wrapper_default(wsUrl);
  activeWs = ws;
  ws.on("open", () => {
    wsStatus = "connected";
    connectedAt = (/* @__PURE__ */ new Date()).toISOString();
    ws.send(
      JSON.stringify([
        { ticket: "currency-ws-live" },
        { type: "trade", codes: selectedMarkets }
      ])
    );
    console.log(`[ws-live] Connected. Subscribed ${selectedMarkets.length} markets.`);
  });
  ws.on("message", (data) => {
    try {
      const tick = JSON.parse(data.toString("utf8"));
      if (tick.type === "trade") handleTick(tick);
    } catch {
    }
  });
  ws.on("close", () => {
    wsStatus = "disconnected";
    activeWs = null;
    console.log(`[ws-live] Disconnected. Reconnecting in ${reconnectDelayMs / 1e3}s.`);
    setTimeout(connect, reconnectDelayMs);
  });
  ws.on("error", (error) => {
    console.error(`[ws-live] ${error.message}`);
    ws.terminate();
  });
}
function handleTick(tick) {
  const market = tick.code;
  if (!selectedMarkets.includes(market)) return;
  totalTicks += 1;
  const tickTimestamp = tick.trade_timestamp;
  const minuteTimestamp = Math.floor(tickTimestamp / 6e4) * 6e4;
  const previousMinute = lastMinute[market];
  if (previousMinute !== void 0 && minuteTimestamp > previousMinute) {
    const closed = closeLiveCandle(market);
    if (closed) {
      upsertCandle(closedCandles[market], closed);
      scheduleCloseProcessing(closed.timestamp);
    }
    liveCandle[market] = newLiveCandle(market, tick, minuteTimestamp);
  } else if (!liveCandle[market]) {
    liveCandle[market] = newLiveCandle(market, tick, minuteTimestamp);
  } else {
    updateLiveCandle(liveCandle[market], tick);
  }
  lastMinute[market] = minuteTimestamp;
  stepWsOIntraminute(market, tick.trade_price, tickTimestamp);
}
function stepWsOIntraminute(market, executionPrice, timestamp) {
  const virtual = toVirtualCandle(market);
  if (!virtual) return;
  const candlesByMarket = withVirtualCandle(market, virtual);
  const signalMarkets = /* @__PURE__ */ new Set([market]);
  const riskMarkets = /* @__PURE__ */ new Set([market]);
  const executionPrices = /* @__PURE__ */ new Map([[market, executionPrice]]);
  const minuteTimestamp = virtual.timestamp;
  for (const guideRuleMode of guideModes) {
    for (const autoBlockMode of safetyModes) {
      for (const strategy of strategies) {
        const key = sessionMinuteKey(guideRuleMode, autoBlockMode, strategy.id, minuteTimestamp);
        const session = sessions.wsO[guideRuleMode][autoBlockMode][strategy.id];
        if (!session) continue;
        const locked = intraminuteTradeLocks.has(key);
        const tradeCountBefore = session.getTradeCount();
        const decision = session.step(timestamp, candlesByMarket, {
          executionPrices,
          riskMarkets,
          signalMarkets: locked ? /* @__PURE__ */ new Set() : signalMarkets
        });
        if (decision.action !== "hold" || session.getTradeCount() > tradeCountBefore) intraminuteTradeLocks.add(key);
      }
    }
  }
}
function scheduleCloseProcessing(timestamp) {
  if (closeTimers.has(timestamp)) return;
  const timer = setTimeout(() => {
    closeTimers.delete(timestamp);
    processClosedMinute(timestamp);
  }, closeProcessDelayMs);
  closeTimers.set(timestamp, timer);
}
function processClosedMinute(timestamp) {
  for (const guideRuleMode of guideModes) {
    for (const autoBlockMode of safetyModes) {
      for (const strategy of strategies) {
        const wsXSession = sessions.wsX[guideRuleMode][autoBlockMode][strategy.id];
        wsXSession?.step(timestamp, closedCandles);
        const wsOKey = sessionMinuteKey(guideRuleMode, autoBlockMode, strategy.id, timestamp);
        if (!intraminuteTradeLocks.has(wsOKey)) {
          sessions.wsO[guideRuleMode][autoBlockMode][strategy.id]?.step(timestamp, closedCandles);
        }
      }
    }
  }
  for (const key of [...intraminuteTradeLocks]) {
    if (key.endsWith(`:${timestamp}`)) intraminuteTradeLocks.delete(key);
  }
}
async function writeOutput() {
  const caseResults = {
    strict: {
      enabled: serializeCase("strict", "enabled"),
      disabled: serializeCase("strict", "disabled")
    },
    ignored: {
      enabled: serializeCase("ignored", "enabled"),
      disabled: serializeCase("ignored", "disabled")
    }
  };
  const fallbackCase = caseResults.ignored.disabled;
  const output = {
    connectedAt,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    status: wsStatus,
    tickCount: totalTicks,
    operationStartAt,
    selectedMarkets,
    caseResults,
    wsO: fallbackCase.wsO,
    wsX: fallbackCase.wsX,
    liveCandles: Object.fromEntries(
      Object.entries(liveCandle).map(([market, candle]) => [
        market,
        {
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
          timestamp: candle.timestamp
        }
      ])
    )
  };
  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output)}
`, "utf8");
}
function serializeCase(guideRuleMode, autoBlockMode) {
  return {
    wsO: serializeMode("wsO", guideRuleMode, autoBlockMode),
    wsX: serializeMode("wsX", guideRuleMode, autoBlockMode)
  };
}
function serializeMode(mode, guideRuleMode, autoBlockMode) {
  return Object.fromEntries(
    [...strategies, generalSumStrategy].map((strategy) => {
      const session = sessions[mode][guideRuleMode][autoBlockMode][strategy.id];
      return session ? [strategy.id, serializeResult(session.result())] : null;
    }).filter((entry) => entry !== null)
  );
}
function serializeResult(result) {
  const lastTrade = result.trades.at(-1);
  const openPosition = lastTrade?.side === "buy" ? { market: lastTrade.market, entryPrice: lastTrade.price, holdBars: 0 } : null;
  return {
    returnRate: result.returnRate,
    trades: result.trades.length,
    cash: result.finalValue,
    finalValue: result.finalValue,
    position: openPosition,
    startedAt: result.startedAt,
    endedAt: result.endedAt
  };
}
function newLiveCandle(market, tick, timestamp) {
  return {
    market,
    timestamp,
    open: tick.trade_price,
    high: tick.trade_price,
    low: tick.trade_price,
    close: tick.trade_price,
    volume: tick.trade_volume,
    quoteVolume: tick.trade_price * tick.trade_volume
  };
}
function updateLiveCandle(candle, tick) {
  candle.high = Math.max(candle.high, tick.trade_price);
  candle.low = Math.min(candle.low, tick.trade_price);
  candle.close = tick.trade_price;
  candle.volume += tick.trade_volume;
  candle.quoteVolume += tick.trade_price * tick.trade_volume;
}
function closeLiveCandle(market) {
  const candle = liveCandle[market];
  if (!candle) return null;
  return {
    market,
    timestamp: candle.timestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    quoteVolume: candle.quoteVolume
  };
}
function toVirtualCandle(market) {
  return closeLiveCandle(market);
}
function withVirtualCandle(market, virtual) {
  return {
    ...closedCandles,
    [market]: upsertCopy(closedCandles[market] ?? [], virtual)
  };
}
function upsertCandle(candles, candle) {
  const last = candles[candles.length - 1];
  if (last?.timestamp === candle.timestamp) {
    candles[candles.length - 1] = candle;
  } else {
    candles.push(candle);
  }
  if (candles.length > maxCandles) candles.splice(0, candles.length - maxCandles);
}
function upsertCopy(candles, candle) {
  const copy = candles.slice();
  upsertCandle(copy, candle);
  return copy;
}
function makeSessionStore() {
  const store = {};
  for (const mode of modes) {
    store[mode] = {
      strict: { enabled: {}, disabled: {} },
      ignored: { enabled: {}, disabled: {} }
    };
  }
  return store;
}
function sessionMinuteKey(guideRuleMode, autoBlockMode, traderId, timestamp) {
  return `${guideRuleMode}:${autoBlockMode}:${traderId}:${timestamp}`;
}
function parseBoundary(value) {
  if (!value) return void 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : void 0;
}
function logStatus() {
  const fmt = (value) => `${((value ?? 0) * 100).toFixed(2)}%`;
  const row = strategies.map((strategy) => {
    const o = sessions.wsO.ignored.disabled[strategy.id]?.result().returnRate;
    const x = sessions.wsX.ignored.disabled[strategy.id]?.result().returnRate;
    return `${strategy.id}: O ${fmt(o)} / X ${fmt(x)}`;
  }).join(" | ");
  console.log(`[${(/* @__PURE__ */ new Date()).toISOString().slice(11, 19)}] ticks ${totalTicks} | ${row}`);
}
init().catch((error) => {
  console.error("[ws-live] Fatal:", error);
  process.exit(1);
});
process.on("SIGINT", () => {
  activeWs?.terminate();
  process.exit(0);
});
process.on("SIGTERM", () => {
  activeWs?.terminate();
  process.exit(0);
});
