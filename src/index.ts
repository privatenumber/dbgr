import fs from 'fs';
import assert from 'assert';
import callsites from 'callsites';
import { parse, Node } from 'acorn-loose';
import { walk } from 'estree-walker';
import { transform } from 'esbuild';
// Only installed @types/estree
// eslint-disable-next-line import/no-unresolved
import { BaseNode, CallExpression, Identifier } from 'estree';

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

const getFileCode = async (filePath: string) => (await fs.promises.readFile(filePath)).toString();

const isCallExpression = (node: BaseNode): node is CallExpression => node.type === 'CallExpression';
const isIdentifier = (node: BaseNode): node is Identifier => node.type === 'Identifier';

function getCallerFilePath() {
	const stack = callsites();
	const currentFilePath = stack.shift().getFileName();
	let callerFilePath: string;
	while (stack.length > 0) {
		callerFilePath = stack.shift().getFileName();

		if (currentFilePath !== callerFilePath) {
			break;
		}
	}

	return callerFilePath;
}

function findNode(
	fileCode: string,
	conditionCallback: (node: BaseNode) => BaseNode | void,
) {
	const ast = parse(fileCode, {
		ecmaVersion: 'latest',
		sourceType: 'module',
	});

	let nodeString: string;
	walk(ast, {
		enter(node) {
			if (nodeString) {
				this.skip();
				return;
			}

			const nodeMatch = conditionCallback(node);
			if (nodeMatch) {
				nodeString = fileCode.slice(
					(nodeMatch as Node).start,
					(nodeMatch as Node).end,
				);
			}
		},
	});

	return nodeString;
}

async function getDbgrHookCode(fileCode: string, isTs: boolean) {
	let dbgrHookCode = findNode(fileCode, (node) => {
		if (
			isCallExpression(node)
			&& isIdentifier(node.callee)
			&& node.callee.name === 'dbgr'
		) {
			const [dbgrHook, evalCallback] = node.arguments;
			assert(
				dbgrHook?.type.endsWith('FunctionExpression'),
				'Dbgr hook function is missing',
			);
			assert(
				evalCallback?.type.endsWith('FunctionExpression'),
				'Eval callback function is missing',
			);
			return dbgrHook;
		}
	});

	assert(dbgrHookCode, 'Dbgr call not found');

	// Convert function declaration to expression
	dbgrHookCode = `(${dbgrHookCode})`;

	if (isTs) {
		const { code } = await transform(dbgrHookCode, {
			loader: 'ts',
		});
		dbgrHookCode = code;
	}

	return dbgrHookCode;
}

class Deferred<T> {
	$: Promise<T>;

	isResolved = false;

	#resolve: (value) => void;

	#reject: (value) => void;

	constructor() {
		this.$ = new Promise<T>((resolve, reject) => {
			this.#resolve = resolve;
			this.#reject = reject;
		});

		this.resolve = this.resolve.bind(this);
	}

	resolve(value): void {
		this.isResolved = true;
		this.#resolve(value);
	}
}

type DbgrHook = (resume?) => void | Promise<void>;

async function dbgr(
	dbgrHook: DbgrHook,
	evalCallback: (_: string) => DbgrHook,
): Promise<void> {
	assert(
		typeof dbgrHook === 'function',
		'Dbgr hook must be a function',
	);
	assert(
		(
			typeof evalCallback === 'function'
			&& evalCallback.length === 1
			&& /\(?_\)?\s?=>\s?eval\(_\)/.test(evalCallback.toString())
		),
		'Invalid eval callback',
	);

	const callerFilePath = getCallerFilePath();
	const isTs = callerFilePath.endsWith('.ts');
	let lastCode = await getFileCode(callerFilePath);
	let lastDbgrHookCode = await getDbgrHookCode(lastCode, isTs);

	const deferred = new Deferred<void>();

	await dbgrHook(deferred.resolve);

	let watcher: fs.FSWatcher;
	if (!deferred.isResolved) {
		watcher = fs.watch(callerFilePath, async (eventName) => {
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

export = dbgr;
