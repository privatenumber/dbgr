# dbgr <a href="https://npm.im/dbgr"><img src="https://badgen.net/npm/v/dbgr"></a> <a href="https://npm.im/dbgr"><img src="https://badgen.net/npm/dm/dbgr"></a> <a href="https://packagephobia.now.sh/result?p=dbgr"><img src="https://packagephobia.now.sh/badge?p=dbgr"></a>

**dbgr** is a lightweight debugger function that pauses your script, and watches the current file for any changes and only re-runs the specific code that's passed in to it.


<sub>If you like this project, please star it & [follow me](https://github.com/privatenumber) to see what other cool projects I'm working on! ❤️</sub>

## 🙋‍♂️ Why?
You can set breakpoints in Node.js via `debugger` statements, but it could be a hassle to set up and can really slow down your script.

When you're debugging something heavy with slow-startup (eg. server, headless Chrome, etc), you want to use something simple & light to debug.

## 🚀 Install
```sh
npm i -D dbgr
```

## 🚦 Quick Setup

```js
import dbgr from 'dbgr'

// Some async process
(async () => {

    // ...

    await dbgr((resume) => {
        console.log('The debugger has started');

        // Write code here and hit save to
        // automatically re-run this function

        // Call resume() and save to resume the debugger

        // ↓ The eval below is necessary for this to work
    }, _ => eval(_))
})();
```

## 🙋‍♀️ FAQ
### How does it work?
Upon invoking dbgr, it detects the file path of the caller by using [V8 stack trace API](https://v8.dev/docs/stack-trace-api) via [callsites](https://github.com/sindresorhus/callsites). It then watches the file for changes using [`fs.watch`](https://nodejs.org/docs/latest/api/fs.html#fs_fs_watch_filename_options_listener). When a change is detected, it parses the source code using [acorn](https://github.com/acornjs/acorn) to extract the specific function passed into dbgr. It then passes it into the `_ => eval(_)` to run in the original context.

### Does it work in TypeScript files?
Yes. While the AST parser acorn is designed for ES parsing, TS files can be loosely parsed via [acorn-loose](https://github.com/acornjs/acorn/tree/master/acorn-loose), and the content inside the dbgr hook has the types stripped via [esbuild](https://esbuild.github.io/) for it to be "safely" `eval()`'d by the JavaScript runtime.
