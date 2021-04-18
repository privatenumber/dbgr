declare type DbgrHook = (resume?: any) => void | Promise<void>;
declare function dbgr(dbgrHook: DbgrHook, evalCallback: (_: string) => DbgrHook): Promise<void>;
export = dbgr;
