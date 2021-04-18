"use strict";
var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, privateMap, value) {
    if (!privateMap.has(receiver)) {
        throw new TypeError("attempted to set private field on non-instance");
    }
    privateMap.set(receiver, value);
    return value;
};
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, privateMap) {
    if (!privateMap.has(receiver)) {
        throw new TypeError("attempted to get private field on non-instance");
    }
    return privateMap.get(receiver);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _resolve, _reject;
const fs_1 = __importDefault(require("fs"));
const assert_1 = __importDefault(require("assert"));
const callsites_1 = __importDefault(require("callsites"));
const acorn_loose_1 = require("acorn-loose");
const estree_walker_1 = require("estree-walker");
const esbuild_1 = require("esbuild");
/**
 * Why use estree-walker over acorn-walk?
 *
 * acorn-walk's traverser is recursive and designed in a way where the callbacks
 * on the way back up rather than on the way down. This makes it unoptimal for when
 * you're implementing a "search" and you don't need to traverse the rest of the tree
 * once you've found the target.
 *
 * Furthermore, estree-walker has an enter/leave API, which is optimal for scope analysis
 * https://github.com/eslint/eslint-scope
 *
 * Might use this in the future to detect the exact instance of dbgr
 *
 */
const getFileCode = async (filePath) => (await fs_1.default.promises.readFile(filePath)).toString();
const isCallExpression = (node) => node.type === 'CallExpression';
const isIdentifier = (node) => node.type === 'Identifier';
function getCallerFilePath() {
    const stack = callsites_1.default();
    const currentFilePath = stack.shift().getFileName();
    let callerFilePath;
    while (stack.length > 0) {
        callerFilePath = stack.shift().getFileName();
        if (currentFilePath !== callerFilePath) {
            break;
        }
    }
    return callerFilePath;
}
function findNode(fileCode, conditionCallback) {
    const ast = acorn_loose_1.parse(fileCode, {
        ecmaVersion: 'latest',
        sourceType: 'module',
    });
    let nodeString;
    estree_walker_1.walk(ast, {
        enter(node) {
            if (nodeString) {
                this.skip();
                return;
            }
            const nodeMatch = conditionCallback(node);
            if (nodeMatch) {
                nodeString = fileCode.slice(nodeMatch.start, nodeMatch.end);
            }
        },
    });
    return nodeString;
}
async function getDbgrHookCode(fileCode, isTs) {
    let dbgrHookCode = findNode(fileCode, (node) => {
        if (isCallExpression(node)
            && isIdentifier(node.callee)
            && node.callee.name === 'dbgr') {
            const [dbgrHook, evalCallback] = node.arguments;
            assert_1.default(dbgrHook === null || dbgrHook === void 0 ? void 0 : dbgrHook.type.endsWith('FunctionExpression'), 'Dbgr hook function is missing');
            assert_1.default(evalCallback === null || evalCallback === void 0 ? void 0 : evalCallback.type.endsWith('FunctionExpression'), 'Eval callback function is missing');
            return dbgrHook;
        }
    });
    assert_1.default(dbgrHookCode, 'Dbgr call not found');
    // Convert function declaration to expression
    dbgrHookCode = `(${dbgrHookCode})`;
    if (isTs) {
        const { code } = await esbuild_1.transform(dbgrHookCode, {
            loader: 'ts',
        });
        dbgrHookCode = code;
    }
    return dbgrHookCode;
}
class Deferred {
    constructor() {
        this.isResolved = false;
        _resolve.set(this, void 0);
        _reject.set(this, void 0);
        this.$ = new Promise((resolve, reject) => {
            __classPrivateFieldSet(this, _resolve, resolve);
            __classPrivateFieldSet(this, _reject, reject);
        });
        this.resolve = this.resolve.bind(this);
    }
    resolve(value) {
        this.isResolved = true;
        __classPrivateFieldGet(this, _resolve).call(this, value);
    }
}
_resolve = new WeakMap(), _reject = new WeakMap();
async function dbgr(dbgrHook, evalCallback) {
    assert_1.default(typeof dbgrHook === 'function', 'Dbgr hook must be a function');
    assert_1.default((typeof evalCallback === 'function'
        && evalCallback.length === 1
        && /\(?_\)?\s?=>\s?eval\(_\)/.test(evalCallback.toString())), 'Invalid eval callback');
    const callerFilePath = getCallerFilePath();
    const isTs = callerFilePath.endsWith('.ts');
    let lastCode = await getFileCode(callerFilePath);
    let lastDbgrHookCode = await getDbgrHookCode(lastCode, isTs);
    const deferred = new Deferred();
    await dbgrHook(deferred.resolve);
    let watcher;
    if (!deferred.isResolved) {
        watcher = fs_1.default.watch(callerFilePath, async (eventName) => {
            if (eventName !== 'change') {
                return;
            }
            const newCode = await getFileCode(callerFilePath);
            if (newCode === lastCode) {
                return;
            }
            lastCode = newCode;
            const dbgrHookCode = await getDbgrHookCode(newCode, isTs);
            if (dbgrHookCode === lastDbgrHookCode) {
                return;
            }
            lastDbgrHookCode = dbgrHookCode;
            evalCallback(dbgrHookCode)(deferred.resolve);
        });
    }
    await deferred.$;
    if (watcher) {
        watcher.close();
    }
}
module.exports = dbgr;
